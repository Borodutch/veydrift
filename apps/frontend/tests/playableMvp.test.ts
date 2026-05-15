import { describe, expect, test } from "bun:test";
import {
  buildingCost,
  canAfford,
  createInitialPlayableState,
  productionPerHour,
  settleState,
  startBuildingUpgrade,
  startResearch,
  startShipProduction,
  storageCaps,
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

  test("runs research in parallel with building production", () => {
    const state = createInitialPlayableState(1_000);
    const buildingQueued = startBuildingUpgrade(state, "metalMine", 1_000);
    const researchQueued = startResearch(buildingQueued, "orbitalCartography", 1_000);

    expect(researchQueued.queue?.kind).toBe("building");
    expect(researchQueued.researchQueue?.kind).toBe("research");

    const settled = settleState(researchQueued, 62_000);

    expect(settled.buildings.metalMine).toBe(1);
    expect(settled.research.orbitalCartography).toBe(1);
    expect(settled.queue).toBeUndefined();
    expect(settled.researchQueue).toBeUndefined();
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
});
