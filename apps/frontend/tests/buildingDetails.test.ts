import { describe, expect, test } from "bun:test";
import {
  buildingEnergyDetail,
  buildingUpgradeStatus,
  formatCost,
  formatDuration,
  formatNumber,
} from "../src/buildingDetails";
import { createInitialPlayableState, startBuildingUpgrade } from "../src/playableMvp";

describe("building detail helpers", () => {
  test("formats costs, durations, and numbers without raw decimals", () => {
    expect(formatNumber(1234.987)).toBe("1,234");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(95)).toBe("1m 35s");
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

  test("reports queue and energy details from modeled building state", () => {
    const queued = startBuildingUpgrade(createInitialPlayableState(1_000), "metalMine", 1_000);

    expect(buildingUpgradeStatus(queued, "solarPlant")).toMatchObject({
      disabled: true,
      reason: "Building queue occupied by Metal Mine",
    });
    expect(buildingEnergyDetail({ ...queued.buildings, metalMine: 2 }, "metalMine")).toEqual({
      kind: "requires",
      current: 20,
      next: 30,
      delta: 10,
    });
    expect(buildingEnergyDetail({ ...queued.buildings, solarPlant: 1 }, "solarPlant")).toEqual({
      kind: "produces",
      current: 30,
      next: 60,
      delta: 30,
    });
  });
});
