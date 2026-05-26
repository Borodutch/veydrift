import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defenseAssetManifest, researchAssetManifest, shipAssetManifest } from "../src/gameAssets";
import {
  buildingEffectMetrics,
  buildingCost,
  buildingDurationEstimate,
  canAfford,
  collectibleResourceDeltas,
  createInitialPlayableState,
  defenseCombatStats,
  defenseCatalog,
  energyBalance,
  hasCollectableResources,
  missileSiloCapacity,
  productionCapacityPerHour,
  productionPerHour,
  researchCatalog,
  researchCost,
  researchDurationEstimate,
  researchRequirementsFor,
  shipDurationEstimate,
  shipCatalog,
  shipCombatStats,
  storageCaps,
  unmetResearchRequirement,
} from "../src/playableMvp";
import { infrastructurePlayableState } from "../src/chainState";
import { shouldShowTopBarEnergy } from "../src/overviewData";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

describe("playable MVP contract display helpers", () => {
  test("uses the Solidity MVP starting resources and storage caps", () => {
    const state = createInitialPlayableState(1_000);

    expect(state.resources).toEqual({
      metal: 500,
      crystal: 500,
      deuterium: 0,
    });
    expect(storageCaps(state.buildings)).toEqual({
      metal: 10_000,
      crystal: 10_000,
      deuterium: 10_000,
    });
  });

  test("uses contract infrastructure state without inheriting local debug grants", () => {
    const localDebugState = createInitialPlayableState(1_000);
    localDebugState.resources = { metal: 500_000, crystal: 500_000, deuterium: 500_000 };
    localDebugState.buildings = {
      ...localDebugState.buildings,
      metalMine: 3,
      crystalMine: 3,
      deuteriumSynthesizer: 3,
      solarPlant: 8,
      shipyard: 12,
      metalStorage: 50,
      crystalStorage: 50,
      deuteriumTank: 50,
    };

    const contractState = infrastructurePlayableState({
      wallet: "0x2222222222222222222222222222222222222222",
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5100", crystal: "5000", deuterium: "4900" },
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "60", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 2, cost: { metal: "300", crystal: "120", deuterium: "0" } },
        { id: 7, level: 1, cost: { metal: "2000", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    }, 1_000);

    expect(localDebugState.buildings.metalStorage).toBe(50);
    expect(contractState.resources).toEqual({ metal: 5_100, crystal: 5_000, deuterium: 4_900 });
    expect(contractState.buildings).toMatchObject({
      metalMine: 1,
      crystalMine: 0,
      solarPlant: 2,
      shipyard: 0,
      metalStorage: 1,
      crystalStorage: 0,
      deuteriumTank: 0,
    });
    expect(contractState.queue).toBeUndefined();
  });

  test("scales upgrade costs by contract-backed current level", () => {
    const state = createInitialPlayableState(1_000);
    const firstMine = buildingCost(state.buildings, "metalMine");
    const upgradedBuildings = { ...state.buildings, metalMine: 1 };

    expect(firstMine).toEqual({ metal: 60, crystal: 15, deuterium: 0 });
    expect(buildingCost(upgradedBuildings, "metalMine")).toEqual({
      metal: 90,
      crystal: 22,
      deuterium: 0,
    });
    expect(buildingCost(state.buildings, "roboticsFactory")).toEqual({
      metal: 400,
      crystal: 120,
      deuterium: 200,
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
    expect(productionPerHour(powered).metal).toBeGreaterThan(0);
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
      [8, "bomber", "Bomber"],
      [9, "solarSatellite", "Solar Satellite"],
      [10, "destroyer", "Destroyer"],
      [11, "deathstar", "Dreadstar"],
      [12, "battlecruiser", "Battlecruiser"],
      [13, "reaper", "Reaper"],
      [14, "pathfinder", "Pathfinder"],
      [15, "crawler", "Crawler"],
    ]);
    expect(shipCatalog.map((ship) => ship.asset)).toEqual(shipAssetManifest.map((asset) => asset.src));
  });

  test("uses canonical Veydrift representative ship requirements and duration estimates", () => {
    expect(shipCatalog.find((ship) => ship.key === "smallCargo")?.requirements).toEqual([
      { kind: "building", key: "shipyard", label: "Shipyard", level: 2 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 2 },
    ]);
    expect(shipCatalog.find((ship) => ship.key === "cruiser")?.requirements).toEqual([
      { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 4 },
      { kind: "technology", key: "ion", label: "Ion", level: 2 },
    ]);
    expect(shipCatalog.find((ship) => ship.key === "destroyer")?.requirements).toEqual([
      { kind: "building", key: "shipyard", label: "Shipyard", level: 9 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 6 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 5 },
    ]);

    expect(shipDurationEstimate(2, 0, { metal: 2_000, crystal: 2_000, deuterium: 0 })).toBe(1_920);
    expect(shipDurationEstimate(7, 2, { metal: 45_000, crystal: 15_000, deuterium: 0 })).toBe(2_700);
    expect(shipDurationEstimate(12, 0, { metal: 5_000_000, crystal: 4_000_000, deuterium: 1_000_000 })).toBe(996_924);
  });

  test("derives ship combat info from contract catalog formulas", () => {
    const lightFighter = shipCatalog.find((ship) => ship.key === "lightFighter")!;
    const battleship = shipCatalog.find((ship) => ship.key === "battleship")!;
    const solarSatellite = shipCatalog.find((ship) => ship.key === "solarSatellite")!;

    expect(shipCombatStats(lightFighter).rows).toEqual([
      expect.objectContaining({ label: "Attack", value: 50 }),
      expect.objectContaining({ label: "Shield", value: 10 }),
      expect.objectContaining({ label: "Hull", value: 400 }),
      expect.objectContaining({ label: "Cargo", value: 50 }),
    ]);
    expect(shipCombatStats(battleship).rows).toEqual([
      expect.objectContaining({ label: "Attack", value: 1_000 }),
      expect.objectContaining({ label: "Shield", value: 200 }),
      expect.objectContaining({ label: "Hull", value: 6_000 }),
      expect.objectContaining({ label: "Cargo", value: 1_500 }),
    ]);
    expect(shipCombatStats(solarSatellite).notes[0]).toContain("Cannot be assigned to fleet missions");
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
	    expect(defenseCatalog.find((defense) => defense.key === "rocketLauncher")?.baseCost).toEqual({
	      metal: 2_000,
	      crystal: 0,
	      deuterium: 0,
	    });
	    expect(defenseCatalog.find((defense) => defense.key === "ionCannon")?.baseCost).toEqual({
	      metal: 2_000,
	      crystal: 6_000,
	      deuterium: 0,
	    });
	    expect(defenseCatalog.map((defense) => defense.asset)).toEqual(defenseAssetManifest.map((asset) => asset.src));
	  });

  test("derives defense combat info from current battle rules", () => {
    const rocketLauncher = defenseCatalog.find((defense) => defense.key === "rocketLauncher")!;
    const smallShieldDome = defenseCatalog.find((defense) => defense.key === "smallShieldDome")!;
    const interplanetaryMissile = defenseCatalog.find((defense) => defense.key === "interplanetaryMissile")!;

    expect(defenseCombatStats(rocketLauncher).rows).toEqual([
      expect.objectContaining({ label: "Attack", value: 80 }),
      expect.objectContaining({ label: "Shield", value: 20 }),
      expect.objectContaining({ label: "Hull", value: 200 }),
    ]);
    expect(defenseCombatStats(smallShieldDome).rows).toEqual([
      expect.objectContaining({ label: "Attack", value: 1 }),
      expect.objectContaining({ label: "Shield", value: 2_000 }),
      expect.objectContaining({ label: "Hull", value: 2_000 }),
    ]);
    expect(defenseCombatStats(interplanetaryMissile).rows).toEqual([
      expect.objectContaining({ label: "Fleet battle", value: "Not counted" }),
      expect.objectContaining({ label: "Silo slots", value: 2 }),
    ]);
  });

  test("uses valid deterministic Shipyard, Research, and Defenses asset mappings", () => {
    const allAssets = [...shipAssetManifest, ...researchAssetManifest, ...defenseAssetManifest];
    const srcCounts = new Map<string, number>();

    for (const asset of allAssets) {
      srcCounts.set(asset.src, (srcCounts.get(asset.src) ?? 0) + 1);
      expect(asset.src.startsWith("/assets/game/")).toBe(true);
      expect(existsSync(join(PUBLIC_DIR, asset.src.replace("/assets/", "assets/")))).toBe(true);
    }

    expect([...srcCounts.entries()].filter(([, count]) => count > 1)).toEqual([]);
    expect(shipAssetManifest.every((asset) => asset.category === "ship")).toBe(true);
    expect(researchAssetManifest.every((asset) => asset.category === "research")).toBe(true);
    expect(defenseAssetManifest.every((asset) => asset.category === "defense")).toBe(true);
    expect(shipAssetManifest.every((asset) => asset.src.includes("/style-pass/generated/ships/"))).toBe(true);
    expect(shipAssetManifest.some((asset) => asset.src.includes("/assets/game/ships/"))).toBe(false);
    expect(researchAssetManifest.every((asset) => asset.src.includes("/style-pass/generated/research/"))).toBe(true);
    expect(researchAssetManifest.some((asset) => asset.src.includes("/style-pass/generated/buildings/"))).toBe(false);
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

  test("reports Graviton produced-energy requirement after the lab unlock", () => {
    const state = createInitialPlayableState(1_000);
    const unlockedLab = {
      ...state,
      buildings: {
        ...state.buildings,
        researchLab: 12,
        solarPlant: 0,
      },
    };

    expect(unmetResearchRequirement(unlockedLab, "graviton")).toEqual({
      type: "energy",
      produced: 300_000,
    });
    expect(unmetResearchRequirement({
      ...unlockedLab,
      buildings: {
        ...unlockedLab.buildings,
        solarPlant: 10_000,
      },
    }, "graviton")).toBeUndefined();
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
      "computer",
      "astrophysics",
      "intergalacticResearchNetwork",
      "graviton",
      "weapons",
      "shielding",
      "armor",
    ]);
    expect(researchCatalog.map((item) => item.asset)).toEqual(researchAssetManifest.map((asset) => asset.src));
    expect(researchRequirementsFor("plasma")).toEqual([
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "energy", level: 8 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "ion", level: 5 },
    ]);
    expect(researchRequirementsFor("ion")).toEqual([
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "energy", level: 4 },
      { type: "research", key: "laser", level: 5 },
    ]);
    expect(researchRequirementsFor("intergalacticResearchNetwork")).toEqual([
      { type: "building", key: "researchLab", level: 10 },
      { type: "research", key: "computer", level: 8 },
      { type: "research", key: "hyperspace", level: 8 },
    ]);
    expect(researchRequirementsFor("graviton")).toEqual([
      { type: "building", key: "researchLab", level: 12 },
      { type: "energy", produced: 300_000 },
    ]);
    expect(researchRequirementsFor("astrophysics")).toEqual([
      { type: "building", key: "researchLab", level: 3 },
      { type: "research", key: "impulseDrive", level: 3 },
    ]);
  });

  test("matches canonical Veydrift research cost scaling", () => {
    const base = createInitialPlayableState(1_000).research;

    expect(researchCost({ ...base, energy: 0 }, "energy")).toEqual({ metal: 0, crystal: 800, deuterium: 400 });
    expect(researchCost({ ...base, energy: 2 }, "energy")).toEqual({ metal: 0, crystal: 3_200, deuterium: 1_600 });
    expect(researchCost({ ...base, hyperspaceDrive: 1 }, "hyperspaceDrive")).toEqual({
      metal: 20_000,
      crystal: 40_000,
      deuterium: 12_000,
    });
    expect(researchCost({ ...base, astrophysics: 1 }, "astrophysics")).toEqual({
      metal: 7_000,
      crystal: 14_000,
      deuterium: 7_000,
    });
    expect(researchCost({ ...base, astrophysics: 2 }, "astrophysics")).toEqual({
      metal: 12_300,
      crystal: 24_500,
      deuterium: 12_300,
    });
    expect(researchCost({ ...base, graviton: 3 }, "graviton")).toEqual({
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
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

  test("applies the Veydrift Robotics and Nanite Factory divisors to modeled building upgrade duration", () => {
    const state = createInitialPlayableState(1_000);
    const cost = buildingCost(state.buildings, "metalStorage");
    const upgradedRobotics = {
      ...state.buildings,
      roboticsFactory: 4,
    };

    expect(buildingDurationEstimate(state.buildings, cost)).toBe(1_440);
    expect(buildingDurationEstimate(upgradedRobotics, { metal: 100_000, crystal: 50_000, deuterium: 0 }))
      .toBe(43_200);

    expect(buildingDurationEstimate(state.buildings, buildingCost(state.buildings, "metalMine"))).toBe(108);

    const largeCost = { metal: 120_000, crystal: 0, deuterium: 0 };
    expect(buildingDurationEstimate(state.buildings, largeCost)).toBe(172_800);
    expect(buildingDurationEstimate({ ...state.buildings, roboticsFactory: 1 }, largeCost)).toBe(86_400);
    expect(buildingDurationEstimate({ ...state.buildings, roboticsFactory: 2 }, largeCost)).toBe(57_600);
    expect(buildingDurationEstimate({ ...state.buildings, roboticsFactory: 2, naniteFactory: 1 }, largeCost))
      .toBe(28_800);
  });

  test("estimates research duration with the canonical Veydrift lab level plus one denominator", () => {
    const state = createInitialPlayableState(1_000);
    const cost = { metal: 12_000, crystal: 12_000, deuterium: 0 };
    const labOne = { ...state.buildings, researchLab: 1 };
    const labTwo = { ...state.buildings, researchLab: 2 };

    expect(researchDurationEstimate(state.buildings, cost)).toBe(86_400);
    expect(researchDurationEstimate(labOne, cost)).toBe(43_200);
    expect(researchDurationEstimate(labTwo, cost)).toBe(28_800);
    expect(researchDurationEstimate(labOne, { metal: 0, crystal: 0, deuterium: 300_000 })).toBe(60);
  });

  test("exposes building effect metrics from the same production and storage formulas", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      metalMine: 1,
      solarPlant: 2,
      metalStorage: 1,
      missileSilo: 3,
    };

    const mineEffect = buildingEffectMetrics(buildings, "metalMine");
    const storageEffect = buildingEffectMetrics(buildings, "metalStorage");
    const missileSiloEffect = buildingEffectMetrics(buildings, "missileSilo");

    expect(mineEffect.kind).toBe("production");
    if (mineEffect.kind === "production") {
      expect(mineEffect.resource).toBe("metal");
      expect(mineEffect.currentPerHour).toBe(productionCapacityPerHour(buildings).metal);
      expect(mineEffect.deltaPerHour).toBeGreaterThan(0);
    }

    expect(storageEffect.kind).toBe("storage");
    if (storageEffect.kind === "storage") {
      expect(storageEffect.resource).toBe("metal");
      expect(storageEffect.currentCapacity).toBe(storageCaps(buildings).metal);
      expect(storageEffect.deltaCapacity).toBe(20_000);
    }

    expect(missileSiloCapacity(3)).toBe(30);
    expect(missileSiloEffect).toEqual({
      kind: "missileSilo",
      currentSlots: 30,
      nextSlots: 40,
      deltaSlots: 10,
    });
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
    const capacity = productionCapacityPerHour(buildings, profile);
    const effect = buildingEffectMetrics(buildings, "metalMine", profile);

    expect(production.metal).toBe(33);
    expect(capacity.metal).toBe(33);
    expect(effect.kind).toBe("production");
    if (effect.kind === "production") {
      expect(effect.currentPerHour).toBe(33);
      expect(effect.nextPerHour).toBe(productionCapacityPerHour({ ...buildings, metalMine: 2 }, profile).metal);
      expect(effect.deltaPerHour).toBeGreaterThan(0);
    }

    expect(productionPerHour({
      ...state.buildings,
      deuteriumSynthesizer: 1,
      solarPlant: 3,
    }, profile).deuterium).toBe(12);
  });

  test("shows mine upgrade capacity separately from low-energy throttled production", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      metalMine: 0,
      solarPlant: 0,
    };

    const poweredProduction = productionPerHour({ ...buildings, metalMine: 1 }).metal;
    const effect = buildingEffectMetrics(buildings, "metalMine");

    expect(poweredProduction).toBe(0);
    expect(effect.kind).toBe("production");
    if (effect.kind === "production") {
      expect(effect.currentPerHour).toBe(productionCapacityPerHour(buildings).metal);
      expect(effect.nextPerHour).toBe(productionCapacityPerHour({ ...buildings, metalMine: 1 }).metal);
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

  test("reports collectible resource deltas with storage caps applied", () => {
    const rates = { metal: 120, crystal: 60, deuterium: 30 };
    const lastSettledAtSeconds = 1_000;
    const now = 1_120_000;

    expect(collectibleResourceDeltas(rates, lastSettledAtSeconds, now)).toEqual({
      metal: 4,
      crystal: 2,
      deuterium: 1,
    });

    expect(collectibleResourceDeltas(
      rates,
      lastSettledAtSeconds,
      now,
      { metal: 999, crystal: 998, deuterium: 1_000 },
      { metal: 1_000, crystal: 1_000, deuterium: 1_000 },
    )).toEqual({
      metal: 1,
      crystal: 2,
      deuterium: 0,
    });
  });

  test("reports modeled energy and unlock effects for utility buildings", () => {
    const state = createInitialPlayableState(1_000);
    const energyEffect = buildingEffectMetrics(state.buildings, "solarPlant");
    const shipyardEffect = buildingEffectMetrics(state.buildings, "shipyard");

    expect(energyBalance({ ...state.buildings, metalMine: 1 })).toMatchObject({
      produced: 0,
      required: 11,
      scaleBps: 0,
    });
    expect(energyEffect.kind).toBe("energy");
    if (energyEffect.kind === "energy") {
      expect(energyEffect.deltaProduced).toBe(22);
    }

    expect(shipyardEffect.kind).toBe("shipyard");
    if (shipyardEffect.kind === "shipyard") {
      expect(shipyardEffect.unlocked).toBe(false);
      expect(shipyardEffect.nextUnlocked).toBe(true);
    }
  });

  test("surfaces loaded top-bar energy even when production and usage are zero", () => {
    const state = createInitialPlayableState(1_000);

    expect(shouldShowTopBarEnergy(undefined)).toBe(false);
    expect(shouldShowTopBarEnergy(energyBalance(state.buildings))).toBe(true);
    expect(shouldShowTopBarEnergy(energyBalance({ ...state.buildings, metalMine: 1 }))).toBe(true);
    expect(shouldShowTopBarEnergy(energyBalance({ ...state.buildings, solarPlant: 1 }))).toBe(true);
  });
});
