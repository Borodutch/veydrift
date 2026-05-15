import { describe, expect, test } from "bun:test";
import {
  buildingEffectMetrics,
  buildingCost,
  canAfford,
  createInitialPlayableState,
  energyBalance,
  productionPerHour,
  researchCatalog,
  researchRequirementsFor,
  settleState,
  startBuildingUpgrade,
  startResearch,
  startShipProduction,
  storageCaps,
  unmetResearchRequirement,
} from "../src/playableMvp";

describe("playable MVP simulation", () => {
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

  test("scales upgrade costs by current level", () => {
    const state = createInitialPlayableState(1_000);
    const firstMine = buildingCost(state.buildings, "metalMine");
    const queued = startBuildingUpgrade(state, "metalMine", 1_000);
    const upgraded = settleState(queued, 62_000);

    expect(firstMine).toEqual({ metal: 60, crystal: 15, deuterium: 0 });
    expect(buildingCost(upgraded.buildings, "metalMine")).toEqual({
      metal: 120,
      crystal: 30,
      deuterium: 0,
    });
  });

  test("collects lazy production and requires solar energy for powered buildings", () => {
    const state = createInitialPlayableState(1_000);
    const queued = startBuildingUpgrade(state, "metalMine", 1_000);
    const settled = settleState(queued, 3_601_000);
    const rates = productionPerHour(settled.buildings);

    expect(settled.queue).toBeUndefined();
    expect(settled.buildings.metalMine).toBe(1);
    expect(settled.resources.metal).toBeGreaterThan(4_940);
    expect(rates.metal).toBe(0);

    const solarQueued = startBuildingUpgrade(settled, "solarPlant", 3_601_000);
    const powered = settleState(solarQueued, 3_662_000);

    expect(productionPerHour(powered.buildings).metal).toBeGreaterThan(30);
  });

  test("requires a shipyard before ship production", () => {
    const state = createInitialPlayableState(1_000);
    const withoutShipyard = startShipProduction(state, "smallCargo", 1, 1_000);
    const withShipyard = {
      ...state,
      buildings: {
        ...state.buildings,
        shipyard: 1,
      },
    };
    const queued = startShipProduction(withShipyard, "smallCargo", 1, 1_000);

    expect(withoutShipyard.queue).toBeUndefined();
    expect(queued.queue?.kind).toBe("ship");
  });

  test("requires Research Lab before any research can start", () => {
    const state = createInitialPlayableState(1_000);
    const queued = startResearch(state, "energy", 1_000);

    expect(queued.researchQueue).toBeUndefined();
    expect(unmetResearchRequirement(state, "energy")).toEqual({
      type: "building",
      key: "researchLab",
      level: 1,
    });
  });

  test("runs unlocked research in parallel with building production", () => {
    const initial = createInitialPlayableState(1_000);
    const state = {
      ...initial,
      buildings: {
        ...initial.buildings,
        researchLab: 1,
      },
    };
    const buildingQueued = startBuildingUpgrade(state, "metalMine", 1_000);
    const researchQueued = startResearch(buildingQueued, "energy", 1_000);

    expect(researchQueued.queue?.kind).toBe("building");
    expect(researchQueued.researchQueue?.kind).toBe("research");

    const settled = settleState(researchQueued, 62_000);

    expect(settled.buildings.metalMine).toBe(1);
    expect(settled.research.energy).toBe(1);
    expect(settled.queue).toBeUndefined();
    expect(settled.researchQueue).toBeUndefined();
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
