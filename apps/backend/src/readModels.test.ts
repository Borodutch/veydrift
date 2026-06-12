import { describe, expect, test } from "bun:test";

import {
  buildingDurationSeconds,
  deriveBuildingRows,
  deriveDefenseRows,
  deriveShipRows,
  deriveTechnologyRows,
  researchDurationSeconds,
  unitDurationSeconds
} from "./readModels";

// VEY-KANEO-472: predicted next-build/upgrade/research durations restored server-side.
// These mirror VeydriftFormulas.{buildingDuration,unitDuration,researchDuration} with the
// deployed constants QUEUE_UNIVERSE_SPEED = 1 and MIN_QUEUE_SECONDS = 1.
describe("duration formulas (VEY-KANEO-472)", () => {
  test("buildingDurationSeconds matches the contract formula and floors at 1 second", () => {
    // ((metal + crystal) * 3600) / (2500 * (robotics + 1) * 2^nanite)
    expect(buildingDurationSeconds(0, 0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.max(1, Math.floor((1_000 * 3_600) / 2_500))
    );
    // Robotics and Nanite both speed the build up.
    expect(buildingDurationSeconds(4, 0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / (2_500 * 5))
    );
    expect(buildingDurationSeconds(0, 3, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / (2_500 * 8))
    );
    // Tiny cost still yields the minimum queue duration, never zero.
    expect(buildingDurationSeconds(0, 0, { metal: 1, crystal: 0, deuterium: 0 })).toBe(1);
  });

  test("researchDurationSeconds matches the contract formula", () => {
    expect(researchDurationSeconds(0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / 1_000)
    );
    expect(researchDurationSeconds(2, { metal: 1_000, crystal: 1_000, deuterium: 0 })).toBe(
      Math.floor((2_000 * 3_600) / (1_000 * 3))
    );
  });

  test("unitDurationSeconds ceils the whole batch and scales with quantity", () => {
    const single = unitDurationSeconds(0, 0, { metal: 4_000, crystal: 0, deuterium: 0 }, 1);
    expect(single).toBe(Math.ceil((4_000 * 3_600) / 2_500));
    const five = unitDurationSeconds(0, 0, { metal: 4_000, crystal: 0, deuterium: 0 }, 5);
    expect(five).toBe(Math.ceil((4_000 * 5 * 3_600) / 2_500));
    // Zero-cost rows floor at the minimum queue duration, never zero.
    expect(unitDurationSeconds(0, 0, { metal: 0, crystal: 0, deuterium: 0 }, 1)).toBe(1);
  });
});

describe("derive*Rows expose predicted durations (VEY-KANEO-472)", () => {
  test("building rows always carry a next-upgrade durationSeconds keyed off robotics/nanite", () => {
    // Robotics Factory is building id 4, Nanite Factory is id 11.
    const rows = deriveBuildingRows((id) => (id === 4 ? 3 : id === 11 ? 1 : 0));
    const metalMine = rows.find((row) => row.id === 0)!;
    expect(metalMine.durationSeconds).toBe(
      buildingDurationSeconds(3, 1, {
        metal: Number(metalMine.cost.metal),
        crystal: Number(metalMine.cost.crystal),
        deuterium: Number(metalMine.cost.deuterium)
      })
    );
    expect(metalMine.durationSeconds).toBeGreaterThan(0);
  });

  test("ship rows expose per-unit durations only when shipyard/nanite levels are provided", () => {
    const without = deriveShipRows(() => 0);
    expect(without.every((row) => row.durationSeconds === undefined)).toBe(true);

    const withLevels = deriveShipRows(() => 0, undefined, { shipyardLevel: 2, naniteLevel: 1 });
    const lightFighter = withLevels.find((row) => row.id === 1)!;
    expect(lightFighter.durationSeconds).toBe(
      unitDurationSeconds(2, 1, {
        metal: Number(lightFighter.cost.metal),
        crystal: Number(lightFighter.cost.crystal),
        deuterium: Number(lightFighter.cost.deuterium)
      }, 1)
    );
  });

  test("defense rows expose per-unit durations only when levels are provided", () => {
    expect(deriveDefenseRows(() => 0).every((row) => row.durationSeconds === undefined)).toBe(true);
    const withLevels = deriveDefenseRows(() => 0, { shipyardLevel: 0, naniteLevel: 0 });
    expect(withLevels.find((row) => row.id === 0)!.durationSeconds).toBeGreaterThan(0);
  });

  test("technology rows expose research durations only when the lab level is provided", () => {
    expect(deriveTechnologyRows(() => 0).every((row) => row.durationSeconds === undefined)).toBe(true);
    const withLab = deriveTechnologyRows(() => 0, 4);
    const first = withLab.find((row) => row.id === 0)!;
    expect(first.durationSeconds).toBe(
      researchDurationSeconds(4, {
        metal: Number(first.cost.metal),
        crystal: Number(first.cost.crystal),
        deuterium: Number(first.cost.deuterium)
      })
    );
  });
});
