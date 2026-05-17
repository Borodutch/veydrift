import { describe, expect, test } from "bun:test";
import {
  buildingEnergyDetail,
  buildingUpgradeStatus,
  formatCost,
  formatDuration,
  formatNumber,
} from "../src/buildingDetails";
import { createInitialPlayableState } from "../src/playableMvp";

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

  test("uses chain/API unavailable reason before local affordability", () => {
    expect(
      buildingUpgradeStatus(
        createInitialPlayableState(1_000),
        "metalMine",
        { actionUnavailableReason: "Chain/API resources unavailable; upgrades are disabled until real wallet resources load." },
      ),
    ).toMatchObject({
      disabled: true,
      reason: "Chain/API resources unavailable; upgrades are disabled until real wallet resources load.",
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
