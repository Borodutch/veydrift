import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defenseAssetManifest, shipAssetManifest } from "../src/gameAssets";
import {
  buildingEffectMetrics,
  buildingCost,
  buildingDurationEstimate,
  canAfford,
  createInitialPlayableState,
  defenseCatalog,
  energyBalance,
  hasCollectableResources,
  productionPerHour,
  researchCatalog,
  researchRequirementsFor,
  shipCatalog,
  storageCaps,
  unmetResearchRequirement,
} from "../src/playableMvp";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

describe("playable MVP contract display helpers", () => {
  test("uses the Solidity MVP starting resources and storage caps", () => {
    const state = createInitialPlayableState(1_000);

    expect(state.resources).toEqual({
      metal: 5_000,
      crystal: 5_000,
      deuterium: 5_000,
    });
    expect(storageCaps(state.buildings)).toEqual({
      metal: 10_000,
      crystal: 10_000,
      deuterium: 10_000,
    });
  });

  test("scales upgrade costs by contract-backed current level", () => {
    const state = createInitialPlayableState(1_000);
    const firstMine = buildingCost(state.buildings, "metalMine");
    const upgradedBuildings = { ...state.buildings, metalMine: 1 };

    expect(firstMine).toEqual({ metal: 60, crystal: 15, deuterium: 0 });
    expect(buildingCost(upgradedBuildings, "metalMine")).toEqual({
      metal: 120,
      crystal: 30,
      deuterium: 0,
    });
  });

  test("mirrors contract production formulas without mutating browser state", () => {
    const state = createInitialPlayableState(1_000);
    const unpowered = {
      ...state.buildings,
      metalMine: 1,
    };
    const powered = {
      ...unpowered,
      solarPlant: 1,
    };

    expect(productionPerHour(unpowered).metal).toBe(0);
    expect(productionPerHour(powered).metal).toBeGreaterThan(30);
  });

  test("maps the full Solidity ship catalog for Shipyard display", () => {
    expect(shipCatalog.map((ship) => [ship.id, ship.key, ship.label])).toEqual([
      [0, "smallCargo", "Small Cargo"],
      [1, "lightFighter", "Light Fighter"],
      [2, "recycler", "Recycler"],
      [3, "colonyShip", "Colony Ship"],
      [4, "largeCargo", "Large Cargo"],
      [5, "heavyFighter", "Heavy Fighter"],
      [6, "cruiser", "Cruiser"],
      [7, "battleship", "Battleship"],
      [8, "espionageProbe", "Espionage Probe"],
      [9, "bomber", "Bomber"],
      [10, "solarSatellite", "Solar Satellite"],
      [11, "destroyer", "Destroyer"],
      [12, "deathstar", "Dreadstar"],
      [13, "battlecruiser", "Battlecruiser"],
      [14, "reaper", "Reaper"],
      [15, "pathfinder", "Pathfinder"],
    ]);
    expect(shipCatalog.map((ship) => ship.asset)).toEqual(shipAssetManifest.map((asset) => asset.src));
  });

  test("maps the Solidity defense catalog for Defenses display", () => {
    expect(defenseCatalog.map((defense) => [defense.id, defense.key, defense.label])).toEqual([
      [0, "rocketLauncher", "Rocket Launcher"],
      [1, "lightLaser", "Light Laser"],
      [2, "heavyLaser", "Heavy Laser"],
      [3, "smallShieldDome", "Small Shield Dome"],
      [4, "gaussCannon", "Gauss Cannon"],
      [5, "ionCannon", "Ion Cannon"],
      [6, "plasmaTurret", "Plasma Turret"],
      [7, "largeShieldDome", "Large Shield Dome"],
      [8, "antiBallisticMissile", "Anti-Ballistic Missile"],
      [9, "interplanetaryMissile", "Interplanetary Missile"],
    ]);
    expect(defenseCatalog.map((defense) => defense.asset)).toEqual(defenseAssetManifest.map((asset) => asset.src));
  });

  test("uses valid deterministic Shipyard and Defenses asset mappings", () => {
    const allAssets = [...shipAssetManifest, ...defenseAssetManifest];
    const srcCounts = new Map<string, number>();

    for (const asset of allAssets) {
      srcCounts.set(asset.src, (srcCounts.get(asset.src) ?? 0) + 1);
      expect(asset.src.startsWith("/assets/game/")).toBe(true);
      expect(existsSync(join(PUBLIC_DIR, asset.src.replace("/assets/", "assets/")))).toBe(true);
    }

    expect([...srcCounts.entries()].filter(([, count]) => count > 1)).toEqual([]);
    expect(shipAssetManifest.every((asset) => asset.category === "ship")).toBe(true);
    expect(defenseAssetManifest.every((asset) => asset.category === "defense")).toBe(true);
    expect(shipAssetManifest.some((asset) => asset.src.includes("/style-pass/generated/ships/"))).toBe(false);
    expect(defenseAssetManifest.every((asset) => asset.src.includes("/style-pass/generated/defenses/"))).toBe(true);
  });

  test("reports Research Lab requirement without queuing local research", () => {
    const state = createInitialPlayableState(1_000);

    expect(unmetResearchRequirement(state, "energy")).toEqual({
      type: "building",
      key: "researchLab",
      level: 1,
    });
  });

  test("mirrors the contract research catalog and prerequisites", () => {
    expect(researchCatalog.map((item) => item.key)).toEqual([
      "energy",
      "laser",
      "ion",
      "hyperspace",
      "plasma",
      "combustionDrive",
      "impulseDrive",
      "hyperspaceDrive",
      "espionage",
      "computer",
      "astrophysics",
      "intergalacticResearchNetwork",
      "graviton",
      "weapons",
      "shielding",
      "armor",
    ]);
    expect(researchRequirementsFor("plasma")).toEqual([
      { type: "building", key: "researchLab", level: 1 },
      { type: "research", key: "energy", level: 8 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "ion", level: 5 },
    ]);
  });

  test("checks affordability against all resource types", () => {
    expect(canAfford(
      { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      { metal: 4_000, crystal: 1_000, deuterium: 5_000 },
    )).toBe(true);
    expect(canAfford(
      { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      { metal: 4_000, crystal: 1_000, deuterium: 5_001 },
    )).toBe(false);
  });

  test("exposes modeled building upgrade duration for UI detail panels", () => {
    const state = createInitialPlayableState(1_000);
    const cost = buildingCost(state.buildings, "metalStorage");
    const upgradedRobotics = {
      ...state.buildings,
      roboticsFactory: 4,
    };

    expect(buildingDurationEstimate(state.buildings, cost)).toBe(60);
    expect(buildingDurationEstimate(upgradedRobotics, { metal: 100_000, crystal: 50_000, deuterium: 0 }))
      .toBe(300);

    const advancedMine = {
      ...state.buildings,
      metalMine: 8,
    };
    expect(buildingDurationEstimate(state.buildings, buildingCost(state.buildings, "metalMine"))).toBe(60);
    expect(buildingDurationEstimate(state.buildings, buildingCost(advancedMine, "metalMine"))).toBe(192);
  });

  test("exposes building effect metrics from the same production and storage formulas", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      metalMine: 1,
      solarPlant: 2,
      metalStorage: 1,
    };

    const mineEffect = buildingEffectMetrics(buildings, "metalMine");
    const storageEffect = buildingEffectMetrics(buildings, "metalStorage");

    expect(mineEffect.kind).toBe("production");
    if (mineEffect.kind === "production") {
      expect(mineEffect.resource).toBe("metal");
      expect(mineEffect.currentPerHour).toBe(productionPerHour(buildings).metal);
      expect(mineEffect.deltaPerHour).toBeGreaterThan(0);
    }

    expect(storageEffect.kind).toBe("storage");
    if (storageEffect.kind === "storage") {
      expect(storageEffect.resource).toBe("metal");
      expect(storageEffect.currentCapacity).toBe(storageCaps(buildings).metal);
      expect(storageEffect.deltaCapacity).toBe(10_000);
    }
  });

  test("uses settled planet multipliers for infrastructure production effects", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      metalMine: 1,
      solarPlant: 1,
    };
    const profile = {
      metalMultiplierBps: 12_000,
      crystalMultiplierBps: 8_500,
      deuteriumMultiplierBps: 11_000,
    };

    const production = productionPerHour(buildings, profile);
    const effect = buildingEffectMetrics(buildings, "metalMine", profile);

    expect(production.metal).toBe(66);
    expect(effect.kind).toBe("production");
    if (effect.kind === "production") {
      expect(effect.currentPerHour).toBe(66);
      expect(effect.nextPerHour).toBe(productionPerHour({ ...buildings, metalMine: 2 }, profile).metal);
      expect(effect.deltaPerHour).toBeGreaterThan(0);
    }
  });

  test("only enables resource collection when at least one whole resource accrued", () => {
    const rates = { metal: 60, crystal: 0, deuterium: 0 };
    const lastSettledAtSeconds = 1_000;

    expect(hasCollectableResources(rates, lastSettledAtSeconds, 1_000_000)).toBe(false);
    expect(hasCollectableResources(rates, lastSettledAtSeconds, 1_059_000)).toBe(false);
    expect(hasCollectableResources(rates, lastSettledAtSeconds, 1_060_000)).toBe(true);
    expect(hasCollectableResources({ metal: 0, crystal: 0, deuterium: 0 }, lastSettledAtSeconds, 1_600_000))
      .toBe(false);
  });

  test("reports modeled energy and unlock effects for utility buildings", () => {
    const state = createInitialPlayableState(1_000);
    const energyEffect = buildingEffectMetrics(state.buildings, "solarPlant");
    const shipyardEffect = buildingEffectMetrics(state.buildings, "shipyard");

    expect(energyBalance({ ...state.buildings, metalMine: 1 })).toMatchObject({
      produced: 0,
      required: 10,
      scaleBps: 0,
    });
    expect(energyEffect.kind).toBe("energy");
    if (energyEffect.kind === "energy") {
      expect(energyEffect.deltaProduced).toBe(30);
    }

    expect(shipyardEffect.kind).toBe("shipyard");
    if (shipyardEffect.kind === "shipyard") {
      expect(shipyardEffect.unlocked).toBe(false);
      expect(shipyardEffect.nextUnlocked).toBe(true);
    }
  });
});
