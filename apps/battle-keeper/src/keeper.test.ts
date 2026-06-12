import { describe, expect, test } from "bun:test";

import { MissionType } from "./events";
import { BattleKeeper, type KeeperLogger } from "./keeper";
import { MissionNotResolvableError, type MissionResolver } from "./resolver";

const silentLogger: KeeperLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

type ResolveBehavior = (missionId: string, callIndex: number) => Promise<string>;

class MockResolver implements MissionResolver {
  calls: string[] = [];
  private callCount = new Map<string, number>();

  constructor(private readonly behavior: ResolveBehavior) {}

  keeperAddress(): string {
    return "0x000000000000000000000000000000000000dEaD";
  }

  async resolveMission(missionId: string): Promise<string> {
    this.calls.push(missionId);
    const index = this.callCount.get(missionId) ?? 0;
    this.callCount.set(missionId, index + 1);
    return this.behavior(missionId, index);
  }
}

function makeKeeper(
  behavior: ResolveBehavior,
  options: { now?: () => number; maxConcurrency?: number } = {}
): { keeper: BattleKeeper; resolver: MockResolver } {
  const resolver = new MockResolver(behavior);
  const keeper = new BattleKeeper(resolver, {
    now: options.now ?? (() => 1_000),
    maxConcurrency: options.maxConcurrency ?? 3,
    logger: silentLogger
  });
  return { keeper, resolver };
}

describe("BattleKeeper pending tracking", () => {
  test("queues Attack and Harvest launches", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });
    keeper.recordLaunched({ missionId: "2", missionType: MissionType.Harvest, arrivalAt: 500 });
    expect(keeper.snapshot().pendingCount).toBe(2);
    expect(keeper.snapshot().pendingMissionIds.sort()).toEqual(["1", "2"]);
  });

  test("ignores non-combat mission types (lazy-settled)", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Transport, arrivalAt: 500 });
    keeper.recordLaunched({ missionId: "2", missionType: MissionType.Deploy, arrivalAt: 500 });
    keeper.recordLaunched({ missionId: "3", missionType: MissionType.Colonize, arrivalAt: 500 });
    keeper.recordLaunched({ missionId: "4", missionType: MissionType.DefenseHold, arrivalAt: 500 });
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("recordResolved drops a mission from pending", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched({ missionId: "7", missionType: MissionType.Attack, arrivalAt: 500 });
    expect(keeper.snapshot().pendingCount).toBe(1);
    keeper.recordResolved("7");
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("a resolved mission is never re-queued", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordResolved("7");
    keeper.recordLaunched({ missionId: "7", missionType: MissionType.Attack, arrivalAt: 500 });
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("duplicate launches do not double-queue", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });
    expect(keeper.snapshot().pendingCount).toBe(1);
  });
});

describe("BattleKeeper resolution loop", () => {
  test("resolves missions whose arrival has passed", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 900 });
    await keeper.tick();
    expect(resolver.calls).toEqual(["1"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
    expect(keeper.snapshot().resolvedCount).toBe(1);
    expect(keeper.snapshot().lastResolvedMissionId).toBe("1");
  });

  test("skips missions that have not arrived yet", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 2_000 });
    await keeper.tick();
    expect(resolver.calls).toEqual([]);
    expect(keeper.snapshot().pendingCount).toBe(1);
  });

  test("resolves once arrival time is reached on a later tick", async () => {
    let now = 1_000;
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => now });
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 1_500 });
    await keeper.tick();
    expect(resolver.calls).toEqual([]);
    now = 1_600;
    await keeper.tick();
    expect(resolver.calls).toEqual(["1"]);
  });

  test("retries on randomness-not-ready revert without crashing", async () => {
    let attempts = 0;
    const { keeper, resolver } = makeKeeper(
      async (missionId, index) => {
        attempts += 1;
        if (index === 0) {
          throw new MissionNotResolvableError(missionId, new Error("NoRandomnessCommitment"));
        }
        return "0xhash";
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });

    await keeper.tick(); // first attempt reverts
    expect(keeper.snapshot().pendingCount).toBe(1);
    expect(keeper.snapshot().resolvedCount).toBe(0);
    expect(keeper.snapshot().submitFailureCount).toBe(1);
    expect(keeper.snapshot().lastError).toContain("not resolvable");

    await keeper.tick(); // second attempt succeeds
    expect(resolver.calls).toEqual(["1", "1"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
    expect(keeper.snapshot().resolvedCount).toBe(1);
    expect(attempts).toBe(2);
  });

  test("does not crash on an unexpected (non-revert) error", async () => {
    const { keeper } = makeKeeper(
      async () => {
        throw new Error("RPC HTTP 503");
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });
    await keeper.tick();
    expect(keeper.snapshot().pendingCount).toBe(1);
    expect(keeper.snapshot().submitFailureCount).toBe(1);
    expect(keeper.snapshot().lastError).toContain("503");
  });
});

describe("BattleKeeper idempotency", () => {
  test("never double-submits a mission across concurrent ticks", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { keeper, resolver } = makeKeeper(
      async () => {
        await gate;
        return "0xhash";
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });

    // Kick off two overlapping ticks while the first submission is still in flight.
    const first = keeper.tick();
    const second = keeper.tick();
    release();
    await Promise.all([first, second]);

    expect(resolver.calls).toEqual(["1"]); // exactly one submission
    expect(keeper.snapshot().resolvedCount).toBe(1);
  });

  test("does not resubmit after a mission resolves mid-flight via observed event", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { keeper, resolver } = makeKeeper(
      async () => {
        await gate;
        return "0xhash";
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });

    const tick = keeper.tick(); // submission in flight (awaiting gate)
    // A FleetMissionResolved event arrives for the same mission while in flight.
    keeper.recordResolved("1");
    release();
    await tick;

    // No second tick re-submits because the mission is now in the resolved set.
    await keeper.tick();
    expect(resolver.calls).toEqual(["1"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
  });
});

describe("BattleKeeper safety sweep reconcile", () => {
  test("reconcilePending adds missed missions and ignores known/resolved ones", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 });
    keeper.recordResolved("9"); // already resolved

    keeper.reconcilePending([
      { missionId: "1", missionType: MissionType.Attack, arrivalAt: 500 }, // already pending
      { missionId: "2", missionType: MissionType.Harvest, arrivalAt: 500 }, // new, recovered
      { missionId: "9", missionType: MissionType.Attack, arrivalAt: 500 } // resolved, ignored
    ]);

    expect(keeper.snapshot().pendingMissionIds.sort()).toEqual(["1", "2"]);
  });
});
