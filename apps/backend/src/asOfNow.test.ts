import { describe, expect, test } from "bun:test";

import {
  deriveMissionAsOfNow,
  deriveQueueAsOfNow,
  nowSeconds,
  settleCompletedQueue,
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

describe("settleCompletedQueue (VEY-KANEO-461)", () => {
  const defenseQueue = (readyAt: string, backlog?: QueueState[]): QueueState => ({
    active: true,
    kind: "defense",
    itemId: 0,
    quantity: 1,
    readyAt,
    cost: { metal: "2000", crystal: "0", deuterium: "0" },
    ...(backlog ? { backlog } : {})
  });

  test("returns the queue untouched while the active head is still building", () => {
    const queue = defenseQueue(String(NOW + 60));
    const settled = settleCompletedQueue(queue, NOW);
    expect(settled.completed).toEqual([]);
    expect(settled.active).toEqual(queue);
  });

  test("folds an elapsed single-item queue into completed and clears the active queue", () => {
    const settled = settleCompletedQueue(defenseQueue(String(NOW - 1)), NOW);
    expect(settled.active).toBeNull();
    expect(settled.completed).toEqual([{ itemId: 0, quantity: 1, targetLevel: null }]);
  });

  test("completes elapsed head + backlog entries in order, promoting the first pending one", () => {
    const queue = defenseQueue(String(NOW - 100), [
      { active: true, kind: "defense", itemId: 0, quantity: 2, readyAt: String(NOW - 50), cost: { metal: "2000", crystal: "0", deuterium: "0" } },
      { active: true, kind: "defense", itemId: 1, quantity: 5, readyAt: String(NOW + 50), cost: { metal: "1500", crystal: "500", deuterium: "0" } }
    ]);
    const settled = settleCompletedQueue(queue, NOW);
    expect(settled.completed).toEqual([
      { itemId: 0, quantity: 1, targetLevel: null },
      { itemId: 0, quantity: 2, targetLevel: null }
    ]);
    expect(settled.active?.itemId).toBe(1);
    expect(settled.active?.readyAt).toBe(String(NOW + 50));
    expect(settled.active?.backlog).toBeUndefined();
  });

  test("keeps an entry queued behind an earlier still-pending one even if its readyAt elapsed", () => {
    const queue = defenseQueue(String(NOW + 50), [
      { active: true, kind: "defense", itemId: 1, quantity: 5, readyAt: String(NOW - 10), cost: { metal: "1500", crystal: "500", deuterium: "0" } }
    ]);
    const settled = settleCompletedQueue(queue, NOW);
    expect(settled.completed).toEqual([]);
    expect(settled.active?.itemId).toBe(0);
    expect(settled.active?.backlog).toHaveLength(1);
  });

  test("does not mutate the input queue", () => {
    const queue = defenseQueue(String(NOW - 1), [
      { active: true, kind: "defense", itemId: 1, quantity: 5, readyAt: String(NOW + 50), cost: { metal: "1500", crystal: "500", deuterium: "0" } }
    ]);
    const snapshot = JSON.stringify(queue);
    settleCompletedQueue(queue, NOW);
    expect(JSON.stringify(queue)).toBe(snapshot);
  });

  test("treats a null readyAt as not yet due", () => {
    const settled = settleCompletedQueue(defenseQueue(null as unknown as string), NOW);
    expect(settled.completed).toEqual([]);
    expect(settled.active?.readyAt).toBeNull();
  });
});

describe("nowSeconds", () => {
  test("converts milliseconds to whole seconds", () => {
    expect(nowSeconds(1_500)).toBe(1);
    expect(nowSeconds(1_999)).toBe(1);
    expect(nowSeconds(2_000)).toBe(2);
  });
});
