import { describe, expect, test } from "bun:test";
import { demolitionQueueLabel } from "../src/buildingDetails";
import { buildingQueueItemForDisplay } from "../src/chainState";
import {
  buildingDemolitionConsequences,
  buildingDemolitionDurationSeconds,
  buildingDemolitionPrice,
  demolitionPrice,
  demolitionShortfallReason,
  missileSlotsUsed,
  moonDemolitionDurationSeconds,
  moonDemolitionPrice,
  planetDemolitionUnavailableReason,
} from "../src/demolition";
import { buildingCatalog, type BuildingKey } from "../src/playableMvp";
import type { QueueStateResponse } from "../src/walletFlow";

describe("demolition price", () => {
  test("matches the contract vectors for the metal mine", () => {
    // 16 -> 15 with Ion 1, and 1 -> 0 without Ion.
    expect(buildingDemolitionPrice("metalMine", 16, 1)).toEqual({
      cost: { metal: 16_815, crystal: 4_203, deuterium: 0 },
      fullCost: { metal: 17_515, crystal: 4_378, deuterium: 0 },
      discountPercent: 4,
    });
    expect(buildingDemolitionPrice("metalMine", 1, 0).cost).toEqual({ metal: 40, crystal: 10, deuterium: 0 });
  });

  test("Ion Technology discounts the price but never the duration input", () => {
    const price = demolitionPrice({ metal: 1_000, crystal: 0, deuterium: 0 }, 2, [2, 1], 3);
    expect(price.cost.metal).toBe(880);
    expect(price.fullCost.metal).toBe(1_000);
    expect(price.discountPercent).toBe(12);
  });

  test("is free from Ion Technology 25", () => {
    const price = demolitionPrice({ metal: 1_000, crystal: 500, deuterium: 100 }, 5, [2, 1], 30);
    expect(price.cost).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(price.fullCost.metal).toBe(8_000);
    expect(price.discountPercent).toBe(100);
  });

  test("moon buildings use the flat 2x factor", () => {
    expect(moonDemolitionPrice({ metal: 400, crystal: 120, deuterium: 200 }, 2, 3).cost)
      .toEqual({ metal: 352, crystal: 105, deuterium: 176 });
  });
});

const zeroResources = { metal: 0, crystal: 0, deuterium: 0 };
const idle = { buildingQueueBusy: false, missileSlotsUsed: 0, productionActive: false, researchActive: false };

describe("demolition availability", () => {
  test("explains every blocked case with the exact reason", () => {
    expect(planetDemolitionUnavailableReason("terraformer", 3, zeroResources, idle)).toBe("Terraformer can't be demolished");
    expect(planetDemolitionUnavailableReason("metalMine", 3, zeroResources, { ...idle, buildingQueueBusy: true })).toBe("Building queue busy");
    expect(planetDemolitionUnavailableReason("shipyard", 3, zeroResources, { ...idle, productionActive: true })).toBe("Shipyard in use");
    expect(planetDemolitionUnavailableReason("naniteFactory", 1, zeroResources, { ...idle, productionActive: true })).toBe("Nanite Factory in use");
    expect(planetDemolitionUnavailableReason("researchLab", 2, zeroResources, { ...idle, researchActive: true })).toBe("Research Lab in use");
    expect(planetDemolitionUnavailableReason("metalMine", 2, zeroResources, { ...idle, productionActive: true, researchActive: true })).toBeUndefined();
    // Level 3 -> 2 leaves 20 slots.
    expect(planetDemolitionUnavailableReason("missileSilo", 3, zeroResources, { ...idle, missileSlotsUsed: 21 })).toBe("Missile Silo is too full");
    expect(planetDemolitionUnavailableReason("missileSilo", 3, zeroResources, { ...idle, missileSlotsUsed: 20 })).toBeUndefined();
    expect(planetDemolitionUnavailableReason("metalMine", 2, { metal: 10, crystal: 0, deuterium: 5 }, {
      ...idle,
      resources: { metal: 10, crystal: 0, deuterium: 4 },
    })).toBe("Not enough deuterium");
    expect(planetDemolitionUnavailableReason("metalMine", 2, zeroResources, { ...idle, actionUnavailableReason: "Connect a wallet" })).toBe("Connect a wallet");
  });

  test("lists every missing resource", () => {
    expect(demolitionShortfallReason({ metal: 0, crystal: 0, deuterium: 0 }, { metal: 1, crystal: 1, deuterium: 1 }))
      .toBe("Not enough metal, crystal and deuterium");
    expect(demolitionShortfallReason({ metal: 5, crystal: 0, deuterium: 0 }, { metal: 1, crystal: 1, deuterium: 0 }))
      .toBe("Not enough crystal");
    expect(demolitionShortfallReason(undefined, { metal: 1, crystal: 1, deuterium: 1 })).toBeUndefined();
  });

  test("counts stored and queued missile slots", () => {
    expect(missileSlotsUsed(
      [{ id: 8, count: 3 }, { id: 9, count: 2 }, { id: 0, count: 50 }],
      { active: true, itemId: 9, quantity: 1, backlog: [{ active: true, itemId: 8, quantity: 4 }] },
    )).toBe(3 + 4 + 2 + 4);
    expect(missileSlotsUsed([{ id: 8, count: 3 }], { active: false, itemId: 9, quantity: 5 })).toBe(3);
  });
});

describe("demolition consequences and queue display", () => {
  const buildings = { ...emptyBuildings(), metalStorage: 2, shipyard: 1, roboticsFactory: 3 };

  test("describes what the lower level loses", () => {
    expect(buildingDemolitionConsequences(buildings, "metalStorage")[0]).toMatch(/^Metal storage −[\d,]+ \(stock above the cap is kept\)$/);
    expect(buildingDemolitionConsequences(buildings, "shipyard")).toEqual(["Ships and defenses can't be built here until it's rebuilt"]);
    expect(buildingDemolitionConsequences(buildings, "roboticsFactory")).toEqual(["Construction speed x4 → x3"]);
    expect(buildingDemolitionConsequences(buildings, "metalMine")).toEqual([]);
  });

  test("labels a queued demolition as a downgrade", () => {
    expect(demolitionQueueLabel("Metal Mine", 15)).toBe("Demolishing Metal Mine 16 → 15");
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 0,
      targetLevel: 15,
      action: "demolish",
      readyAt: "2000",
      startedAt: "1000",
      cost: { metal: "0", crystal: "0", deuterium: "0" },
    } as QueueStateResponse, 1_500_000);
    expect(queue).toMatchObject({ key: "metalMine", targetLevel: 15, demolish: true });
  });

  test("moon demolitions only use the moon Robotics Factory for time", () => {
    const fullCost = { metal: 40_000, crystal: 80_000, deuterium: 0 };
    expect(moonDemolitionDurationSeconds(2, fullCost)).toBe(buildingDemolitionDurationSeconds({ ...emptyBuildings(), roboticsFactory: 2 }, fullCost));
  });
});

function emptyBuildings() {
  return Object.fromEntries(buildingCatalog.map((building) => [building.key, 0])) as Record<BuildingKey, number>;
}
