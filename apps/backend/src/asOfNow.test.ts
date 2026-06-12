import { describe, expect, test } from "bun:test";

import {
  deriveMissionAsOfNow,
  deriveQueueAsOfNow,
  nowSeconds,
  settleQueueAsOfNow,
  withMissionAsOfNow,
  withQueueAsOfNow
} from "./asOfNow";
import type { FleetMissionSummary, QueueState } from "./evm";

const NOW = 1_000_000;

describe("deriveQueueAsOfNow", () => {
  test("reports remaining time for a future readyAt", () => {
    expect(deriveQueueAsOfNow(String(NOW + 90), NOW)).toEqual({ secondsRemaining: 90, complete: false });
  });

  test("reports complete with zero remaining once readyAt has passed", () => {
    expect(deriveQueueAsOfNow(String(NOW - 1), NOW)).toEqual({ secondsRemaining: 0, complete: true });
    expect(deriveQueueAsOfNow(String(NOW), NOW)).toEqual({ secondsRemaining: 0, complete: true });
  });

  test("treats missing or non-numeric readyAt as not complete", () => {
    expect(deriveQueueAsOfNow(null, NOW)).toEqual({ secondsRemaining: 0, complete: false });
    expect(deriveQueueAsOfNow(undefined, NOW)).toEqual({ secondsRemaining: 0, complete: false });
    expect(deriveQueueAsOfNow("not-a-number", NOW)).toEqual({ secondsRemaining: 0, complete: false });
  });
});

describe("withQueueAsOfNow", () => {
  const queue: QueueState = {
    active: true,
    kind: "ship",
    itemId: 1,
    quantity: 5,
    readyAt: String(NOW + 120),
    cost: { metal: "1", crystal: "2", deuterium: "3" },
    backlog: [
      { active: true, kind: "ship", itemId: 2, readyAt: String(NOW + 600), cost: { metal: "0", crystal: "0", deuterium: "0" } }
    ]
  };

  test("returns null for a null queue", () => {
    expect(withQueueAsOfNow(null, NOW)).toBeNull();
  });

  test("attaches asOfNow without mutating the input and recurses into backlog", () => {
    const enriched = withQueueAsOfNow(queue, NOW)!;
    expect(enriched.asOfNow).toEqual({ secondsRemaining: 120, complete: false });
    expect(enriched.backlog?.[0]?.asOfNow).toEqual({ secondsRemaining: 600, complete: false });
    // Canonical fields are preserved and the original object is untouched.
    expect(enriched.readyAt).toBe(String(NOW + 120));
    expect(queue.asOfNow).toBeUndefined();
    expect(queue.backlog?.[0]?.asOfNow).toBeUndefined();
  });

  test("advances elapsed active entries and promotes the next backlog item", () => {
    const result = settleQueueAsOfNow({
      ...queue,
      readyAt: String(NOW - 30),
      backlog: [
        { active: true, kind: "ship", itemId: 2, quantity: 1, readyAt: String(NOW - 10), cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { active: true, kind: "ship", itemId: 3, quantity: 1, readyAt: String(NOW + 300), cost: { metal: "0", crystal: "0", deuterium: "0" } }
      ]
    }, NOW);

    expect(result.completed.map((entry) => entry.itemId)).toEqual([1, 2]);
    expect(result.queue).toMatchObject({
      itemId: 3,
      asOfNow: { secondsRemaining: 300, complete: false }
    });
  });

  test("returns no active queue once the full backlog is elapsed", () => {
    const result = settleQueueAsOfNow({
      ...queue,
      readyAt: String(NOW - 30),
      backlog: [
        { active: true, kind: "ship", itemId: 2, readyAt: String(NOW - 10), cost: { metal: "0", crystal: "0", deuterium: "0" } }
      ]
    }, NOW);

    expect(result.completed.map((entry) => entry.itemId)).toEqual([1, 2]);
    expect(result.queue).toBeNull();
  });
});

function mission(overrides: Partial<FleetMissionSummary>): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Outbound",
    missionType: "Attack",
    owner: "0x0000000000000000000000000000000000000001",
    originPlanetId: "1",
    targetPlanetId: "2",
    arrivalAt: String(NOW + 60),
    returnAt: String(NOW + 360),
    fuelCost: "0",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    defendsMissionId: null,
    counterplayDefenderMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    returnCargo: null,
    ships: {},
    transactionHash: "0x0",
    blockNumber: "1",
    launchBlockNumber: "1",
    needsResolution: false,
    ...overrides
  };
}

describe("deriveMissionAsOfNow", () => {
  test("reports positive ETAs while both legs are in the future", () => {
    expect(deriveMissionAsOfNow(mission({}), NOW)).toEqual({
      secondsUntilArrival: 60,
      secondsUntilReturn: 360,
      arrived: false,
      returned: false
    });
  });

  test("marks the outbound leg arrived once arrivalAt has passed", () => {
    expect(deriveMissionAsOfNow(mission({ arrivalAt: String(NOW - 10) }), NOW)).toMatchObject({
      secondsUntilArrival: 0,
      arrived: true,
      returned: false
    });
  });

  test("marks the return leg returned once returnAt has passed", () => {
    expect(deriveMissionAsOfNow(mission({ arrivalAt: String(NOW - 100), returnAt: String(NOW - 5) }), NOW)).toEqual({
      secondsUntilArrival: 0,
      secondsUntilReturn: 0,
      arrived: true,
      returned: true
    });
  });
});

describe("withMissionAsOfNow", () => {
  test("attaches asOfNow without dropping canonical fields", () => {
    const enriched = withMissionAsOfNow(mission({}), NOW);
    expect(enriched.asOfNow).toEqual({
      secondsUntilArrival: 60,
      secondsUntilReturn: 360,
      arrived: false,
      returned: false
    });
    expect(enriched.missionId).toBe("1");
    expect(enriched.status).toBe("Outbound");
  });
});

describe("nowSeconds", () => {
  test("converts milliseconds to whole seconds", () => {
    expect(nowSeconds(1_500)).toBe(1);
    expect(nowSeconds(1_999)).toBe(1);
    expect(nowSeconds(2_000)).toBe(2);
  });
});
