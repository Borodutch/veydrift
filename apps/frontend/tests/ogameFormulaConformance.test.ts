import { describe, expect, test } from "bun:test";
import {
  type BuildingKey,
  buildingCost,
  buildingDurationEstimate,
  createInitialPlayableState,
  energyBalance,
  productionCapacityPerHour,
  productionPerHour,
  researchDurationEstimate,
  storageCaps,
} from "../src/playableMvp";

describe("vanilla OGame formula conformance", () => {
  test("uses vanilla mine production, deuterium temperature, and energy throttling", () => {
    const state = createInitialPlayableState();
    const buildings = {
      ...state.buildings,
      metalMine: 5,
      crystalMine: 4,
      deuteriumSynthesizer: 3,
      solarPlant: 12,
    };
    const profile = {
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 13_040,
    };

    expect(energyBalance(buildings)).toEqual({
      produced: 753,
      required: 217,
      scaleBps: 10_000,
    });
    expect(productionCapacityPerHour(buildings, profile)).toEqual({
      metal: 241,
      crystal: 117,
      deuterium: 50,
    });
    expect(productionPerHour({ ...buildings, solarPlant: 0 }, profile)).toEqual({
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
  });

  test("uses vanilla storage capacities", () => {
    const state = createInitialPlayableState();
    const buildings = {
      ...state.buildings,
      crystalStorage: 3,
      deuteriumTank: 10,
    };

    expect(storageCaps(buildings)).toEqual({
      metal: 10_000,
      crystal: 75_000,
      deuterium: 5_355_000,
    });
  });

  test("uses vanilla per-building cost growth factors", () => {
    const state = createInitialPlayableState();

    expect(costAt(state.buildings, "metalMine", 2)).toEqual({
      metal: 135,
      crystal: 33,
      deuterium: 0,
    });
    expect(costAt(state.buildings, "crystalMine", 3)).toEqual({
      metal: 196,
      crystal: 98,
      deuterium: 0,
    });
    expect(costAt(state.buildings, "deuteriumSynthesizer", 4)).toEqual({
      metal: 1_139,
      crystal: 379,
      deuterium: 0,
    });
    expect(costAt(state.buildings, "solarPlant", 9)).toEqual({
      metal: 2_883,
      crystal: 1_153,
      deuterium: 0,
    });
    expect(costAt(state.buildings, "roboticsFactory", 1)).toEqual({
      metal: 800,
      crystal: 240,
      deuterium: 400,
    });
    expect(costAt(state.buildings, "metalStorage", 10)).toEqual({
      metal: 1_024_000,
      crystal: 0,
      deuterium: 0,
    });
  });

  test("uses vanilla building and research durations", () => {
    const state = createInitialPlayableState();

    expect(buildingDurationEstimate(state.buildings, { metal: 6_000, crystal: 0, deuterium: 0 }))
      .toBe(8_640);
    expect(
      buildingDurationEstimate(
        { ...state.buildings, roboticsFactory: 1 },
        { metal: 6_000, crystal: 0, deuterium: 0 },
      ),
    ).toBe(4_320);
    expect(researchDurationEstimate(state.buildings, { metal: 12_000, crystal: 12_000, deuterium: 50_000 }))
      .toBe(86_400);
    expect(
      researchDurationEstimate(
        { ...state.buildings, researchLab: 1 },
        { metal: 12_000, crystal: 12_000, deuterium: 50_000 },
      ),
    ).toBe(43_200);
  });
});

function costAt(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  currentLevel: number,
) {
  return buildingCost({ ...buildings, [key]: currentLevel }, key);
}
