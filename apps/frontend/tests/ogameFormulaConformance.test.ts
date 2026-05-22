import { describe, expect, test } from "bun:test";
import {
  type BuildingKey,
  buildingCost,
  buildingDurationEstimate,
  createInitialPlayableState,
  defenseCatalog,
  energyBalance,
  fusionReactorDeuteriumConsumption,
  fusionReactorEnergyProduction,
  missingUnlockRequirements,
  productionCapacityPerHour,
  productionPerHour,
  researchCatalog,
  researchCost,
  researchDurationEstimate,
  researchRequirementsFor,
  shipCatalog,
  shipDurationEstimate,
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
      deuteriumConsumed: 0,
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
    expect(storageCaps({ ...buildings, deuteriumTank: 50 }).deuterium)
      .toBe(180_862_636_975_685_000);
  });

  test("uses vanilla Fusion Reactor energy-tech scaling and deuterium draw", () => {
    const state = createInitialPlayableState();
    const buildings = {
      ...state.buildings,
      deuteriumSynthesizer: 3,
      fusionReactor: 2,
    };
    const profile = {
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 13_040,
    };

    expect(energyBalance(buildings, 3)).toEqual({
      deuteriumConsumed: 25,
      produced: 69,
      required: 79,
      scaleBps: 8_734,
    });
    expect(fusionReactorEnergyProduction(1, 3)).toBe(32);
    expect(fusionReactorDeuteriumConsumption(1)).toBe(11);
    expect(fusionReactorDeuteriumConsumption(2)).toBe(25);
    expect(productionPerHour(buildings, profile, 3)).toEqual({
      metal: 0,
      crystal: 0,
      deuterium: 21,
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
    expect(costAt(state.buildings, "fusionReactor", 1)).toEqual({
      metal: 1_620,
      crystal: 648,
      deuterium: 324,
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

    expect(buildingDurationEstimate(state.buildings, costAt(state.buildings, "metalMine", 0)))
      .toBe(108);
    expect(buildingDurationEstimate(state.buildings, costAt(state.buildings, "solarPlant", 0)))
      .toBe(151);
    expect(buildingDurationEstimate(state.buildings, costAt(state.buildings, "deuteriumSynthesizer", 0)))
      .toBe(432);
    expect(buildingDurationEstimate(state.buildings, costAt(state.buildings, "roboticsFactory", 0)))
      .toBe(748);
    expect(buildingDurationEstimate(state.buildings, { metal: 6_000, crystal: 0, deuterium: 0 }))
      .toBe(8_640);
    expect(
      buildingDurationEstimate(
        { ...state.buildings, roboticsFactory: 1 },
        { metal: 6_000, crystal: 0, deuterium: 0 },
      ),
    ).toBe(4_320);
    expect(
      buildingDurationEstimate(
        { ...state.buildings, roboticsFactory: 1, naniteFactory: 2 },
        { metal: 6_000, crystal: 0, deuterium: 0 },
      ),
    ).toBe(1_080);
    expect(researchDurationEstimate(state.buildings, { metal: 12_000, crystal: 12_000, deuterium: 50_000 }))
      .toBe(86_400);
    expect(
      researchDurationEstimate(
        { ...state.buildings, researchLab: 1 },
        { metal: 12_000, crystal: 12_000, deuterium: 50_000 },
      ),
    ).toBe(43_200);
  });

  test("uses vanilla ship costs, requirements, cargo, and shipyard duration", () => {
    const smallCargo = shipCatalog.find((ship) => ship.key === "smallCargo");
    const cruiser = shipCatalog.find((ship) => ship.key === "cruiser");
    const deathstar = shipCatalog.find((ship) => ship.key === "deathstar");
    const reaper = shipCatalog.find((ship) => ship.key === "reaper");
    const pathfinder = shipCatalog.find((ship) => ship.key === "pathfinder");

    expect(smallCargo).toMatchObject({
      baseCost: { metal: 2_000, crystal: 2_000, deuterium: 0 },
      requirements: [
        { kind: "building", key: "shipyard", label: "Shipyard", level: 2 },
        { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 2 },
      ],
    });
    expect(cruiser).toMatchObject({
      baseCost: { metal: 20_000, crystal: 7_000, deuterium: 2_000 },
      requirements: [
        { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
        { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 4 },
        { kind: "technology", key: "ion", label: "Ion", level: 2 },
      ],
    });
    expect(deathstar?.baseCost).toEqual({ metal: 5_000_000, crystal: 4_000_000, deuterium: 1_000_000 });
    expect(reaper?.baseCost).toEqual({ metal: 85_000, crystal: 55_000, deuterium: 20_000 });
    expect(pathfinder).toMatchObject({
      baseCost: { metal: 8_000, crystal: 15_000, deuterium: 8_000 },
      requirements: [
        { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
        { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 2 },
        { kind: "technology", key: "shielding", label: "Shielding", level: 4 },
      ],
    });
    expect(shipDurationEstimate(2, 0, { metal: 2_000, crystal: 2_000, deuterium: 0 })).toBe(1_920);
    expect(shipDurationEstimate(7, 2, { metal: 45_000, crystal: 15_000, deuterium: 0 })).toBe(2_700);
  });

  test("uses vanilla defense costs and requirements", () => {
    expect(defenseCatalog.find((defense) => defense.key === "rocketLauncher")).toMatchObject({
      baseCost: { metal: 2_000, crystal: 0, deuterium: 0 },
      requirements: [{ kind: "building", key: "shipyard", label: "Shipyard", level: 1 }],
    });
    expect(defenseCatalog.find((defense) => defense.key === "ionCannon")).toMatchObject({
      baseCost: { metal: 2_000, crystal: 6_000, deuterium: 0 },
    });
    expect(defenseCatalog.find((defense) => defense.key === "gaussCannon")).toMatchObject({
      baseCost: { metal: 20_000, crystal: 15_000, deuterium: 2_000 },
      requirements: [
        { kind: "building", key: "shipyard", label: "Shipyard", level: 6 },
        { kind: "technology", key: "energy", label: "Energy", level: 6 },
        { kind: "technology", key: "weapons", label: "Weapons", level: 3 },
        { kind: "technology", key: "shielding", label: "Shielding", level: 1 },
      ],
    });
    expect(defenseCatalog.find((defense) => defense.key === "plasmaTurret")?.baseCost)
      .toEqual({ metal: 50_000, crystal: 50_000, deuterium: 30_000 });
  });

  test("uses vanilla research costs, requirements, and duration scaling", () => {
    const state = createInitialPlayableState();

    expect(researchCatalog.find((research) => research.key === "energy")?.baseCost)
      .toEqual({ metal: 0, crystal: 800, deuterium: 400 });
    expect(researchCost({ ...state.research, energy: 3 }, "energy"))
      .toEqual({ metal: 0, crystal: 6_400, deuterium: 3_200 });
    expect(researchRequirementsFor("plasma")).toEqual([
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "energy", level: 8 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "ion", level: 5 },
    ]);
    expect(missingUnlockRequirements([
      { kind: "technology", key: "energy", label: "Energy Technology", level: 8 },
      { kind: "technology", key: "laser", label: "Laser", level: 10 },
    ], {
      buildings: {},
      research: { energy: 8, laser: 9 },
    })).toEqual(["Requires Laser 10"]);
  });
});

function costAt(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  currentLevel: number,
) {
  return buildingCost({ ...buildings, [key]: currentLevel }, key);
}
