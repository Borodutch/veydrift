import { describe, expect, test } from "bun:test";
import {
  buildingLevelInfoColumns,
  buildingLevelInfoRows,
  buildingEnergyDetail,
  buildingUpgradeStatus,
  formatBuildingRequirements,
  formatCost,
  formatDuration,
  formatNumber,
} from "../src/buildingDetails";
import { buildingRequirementsFor, createInitialPlayableState, unmetBuildingRequirement } from "../src/playableMvp";

describe("building detail helpers", () => {
  test("formats costs, durations, and numbers without raw decimals", () => {
    expect(formatNumber(1234.987)).toBe("1,234");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(2 * 60 * 60 + 15 * 60)).toBe("2h 15m");
    expect(formatDuration(3 * 24 * 60 * 60 + 4 * 60 * 60 + 59 * 60)).toBe("3d 4h");
    expect(formatDuration(2 * 7 * 24 * 60 * 60 + 24 * 60 * 60 + 23 * 60 * 60)).toBe("2w 1d");
    expect(formatDuration(62549994824590 * 60 + 13)).toBe("99w+");
    expect(formatCost({ metal: 60, crystal: 15, deuterium: 0 })).toBe("Metal 60 / Crystal 15");
  });

  test("reports specific disabled reasons when resources are short", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10, crystal: 5_000, deuterium: 5_000 },
    };

    expect(buildingUpgradeStatus(state, "metalMine")).toMatchObject({
      disabled: true,
      reason: "Requires 50 more Metal",
      targetLevel: 1,
    });
  });

  test("uses action unavailable reason before local affordability", () => {
    expect(
      buildingUpgradeStatus(
        createInitialPlayableState(1_000),
        "metalMine",
        { actionUnavailableReason: "Game state unavailable; upgrades are disabled until your wallet resources load." },
      ),
    ).toMatchObject({
      disabled: true,
      reason: "Game state unavailable; upgrades are disabled until your wallet resources load.",
      targetLevel: 1,
    });
  });

  test("blocks Research Lab until Robotics Factory 1 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingRequirementsFor("researchLab")).toEqual([
      { type: "building", key: "roboticsFactory", level: 1 },
    ]);
    expect(unmetBuildingRequirement(state, "researchLab")).toEqual({
      type: "building",
      key: "roboticsFactory",
      level: 1,
    });
    expect(formatBuildingRequirements("researchLab")).toBe("Robotics Factory 1");
    expect(buildingUpgradeStatus(state, "researchLab")).toMatchObject({
      disabled: true,
      reason: "Requires Robotics Factory 1",
      targetLevel: 1,
    });
  });

  test("allows Research Lab after Robotics Factory 1 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingUpgradeStatus(state, "researchLab")).toMatchObject({
      disabled: false,
      reason: "Ready for Level 1",
      targetLevel: 1,
    });
  });

  test("blocks Shipyard until Robotics Factory 2 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingRequirementsFor("shipyard")).toEqual([
      { type: "building", key: "roboticsFactory", level: 2 },
    ]);
    expect(buildingUpgradeStatus(state, "shipyard")).toMatchObject({
      disabled: true,
      reason: "Requires Robotics Factory 2",
      targetLevel: 1,
    });
  });

  test("reports queue and energy details from modeled building state", () => {
    const queued = {
      ...createInitialPlayableState(1_000),
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 1,
      },
    };

    expect(buildingUpgradeStatus(queued, "solarPlant")).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Metal Mine Level 1",
    });
    expect(buildingEnergyDetail({ ...queued.buildings, metalMine: 2 }, "metalMine")).toEqual({
      kind: "requires",
      current: 24,
      next: 39,
      delta: 15,
    });
    expect(buildingEnergyDetail({ ...queued.buildings, solarPlant: 1 }, "solarPlant")).toEqual({
      kind: "produces",
      current: 22,
      next: 48,
      delta: 26,
    });
  });

  test("names the active building instead of the selected inactive detail", () => {
    const queued = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 2,
      },
    };

    expect(buildingUpgradeStatus(queued, "researchLab")).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Metal Mine Level 2",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus(queued, "metalMine")).toMatchObject({
      disabled: true,
      reason: "Metal Mine Level 2 upgrade in progress",
      targetLevel: 2,
    });
  });

  test("treats the Rift bridge as a binary build instead of an upgrade ladder", () => {
    const readyState = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 4,
        researchLab: 2,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        energy: 5,
        hyperspace: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingUpgradeStatus(readyState, "interdimensionalRiftStabilizer")).toMatchObject({
      disabled: false,
      reason: "Ready to build Rift bridge",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus({
      ...readyState,
      buildings: {
        ...readyState.buildings,
        interdimensionalRiftStabilizer: 1,
      },
    }, "interdimensionalRiftStabilizer")).toMatchObject({
      disabled: true,
      reason: "Rift bridge built on this planet",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus({
      ...readyState,
      queue: {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Interdimensional Rift Stabilizer",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 1,
      },
    }, "metalMine")).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Interdimensional Rift Stabilizer",
    });
  });

  test("builds Metal Mine level table rows with costs, production, and energy use", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "metalMine", undefined, 3);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: false,
      energyRequired: true,
      production: true,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 60, crystal: 15, deuterium: 0 },
      current: true,
      durationSeconds: 108,
      energyRequired: 11,
      level: 1,
      next: false,
      production: { resource: "metal", perHour: 33 },
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 90, crystal: 22, deuterium: 0 },
      current: false,
      durationSeconds: 161,
      energyRequired: 24,
      level: 2,
      next: true,
      production: { resource: "metal", perHour: 72 },
    });
  });

  test("builds Solar Plant level table rows with energy output", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "solarPlant", undefined, 2);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: true,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 75, crystal: 30, deuterium: 0 },
      durationSeconds: 151,
      energyProduced: 22,
      level: 1,
      next: true,
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 112, crystal: 45, deuterium: 0 },
      energyProduced: 48,
      level: 2,
    });
  });

  test("builds Fusion Reactor level table rows with energy output and deuterium use", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "fusionReactor", undefined, 2, 3);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: true,
      effect: false,
      energyProduced: true,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 900, crystal: 360, deuterium: 180 },
      deuteriumConsumed: 11,
      energyProduced: 32,
      level: 1,
      next: true,
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 1_620, crystal: 648, deuterium: 324 },
      deuteriumConsumed: 25,
      energyProduced: 69,
      level: 2,
    });
    expect(rows.map((row) => row.effect)).toEqual([undefined, undefined]);
  });

  test("builds storage level table rows without production or energy columns", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "metalStorage", undefined, 2);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: false,
      energyRequired: false,
      production: false,
      storage: true,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 1000, crystal: 0, deuterium: 0 },
      durationSeconds: 1440,
      level: 1,
      storage: { resource: "metal", capacity: 20_000 },
    });
  });

  test("adjusts level table construction times with Robotics and Nanite levels", () => {
    const buildings = {
      ...createInitialPlayableState(1_000).buildings,
      roboticsFactory: 1,
      naniteFactory: 1,
    };

    const rows = buildingLevelInfoRows(buildings, "metalStorage", undefined, 2);

    expect(rows.map((row) => row.durationSeconds)).toEqual([360, 720]);
  });

  test("builds Missile Silo rows with Veydrift missile slot capacity", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        missileSilo: 1,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "missileSilo", undefined, 4);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: true,
      energyProduced: false,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows.map(({ effect, level }) => ({ effect, level }))).toEqual([
      { effect: "10 missile slots", level: 1 },
      { effect: "20 missile slots", level: 2 },
      { effect: "30 missile slots", level: 3 },
      { effect: "40 missile slots", level: 4 },
    ]);
    expect(rows[0]).toMatchObject({ current: true, next: false });
    expect(rows[1]).toMatchObject({ current: false, next: true });
  });

  test("builds level table rows with the current construction-time divisor", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 1,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "metalMine", undefined, 2);

    expect(rows.map(({ durationSeconds, level }) => ({ durationSeconds, level }))).toEqual([
      { durationSeconds: 60, level: 1 },
      { durationSeconds: 80, level: 2 },
    ]);
  });
});
