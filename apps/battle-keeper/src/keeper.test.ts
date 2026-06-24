import { describe, expect, test } from "bun:test";

import { FleetMissionStatus, MissionType } from "./events";
import { BattleKeeper, type KeeperLogger } from "./keeper";
import { MissionNotResolvableError, type MissionLeg, type MissionResolver } from "./resolver";

const silentLogger: KeeperLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

type ResolveBehavior = (missionId: string, leg: MissionLeg, callIndex: number) => Promise<string>;

class MockResolver implements MissionResolver {
  /** All resolve attempts, in order, as "missionId:leg". */
  calls: string[] = [];
  private callCount = new Map<string, number>();

  constructor(private readonly behavior: ResolveBehavior) {}

  keeperAddress(): string {
    return "0x000000000000000000000000000000000000dEaD";
  }

  async resolveMission(missionId: string, leg: MissionLeg): Promise<string> {
    const key = `${missionId}:${leg}`;
    this.calls.push(key);
    const index = this.callCount.get(key) ?? 0;
    this.callCount.set(key, index + 1);
    return this.behavior(missionId, leg, index);
  }
}

function makeKeeper(
  behavior: ResolveBehavior,
  options: { now?: () => number; maxConcurrency?: number; acsJoinerRetryDelaySeconds?: number } = {}
): { keeper: BattleKeeper; resolver: MockResolver } {
  const resolver = new MockResolver(behavior);
  const keeperOptions = {
    now: options.now ?? (() => 1_000),
    maxConcurrency: options.maxConcurrency ?? 3,
    logger: silentLogger,
    ...(options.acsJoinerRetryDelaySeconds !== undefined
      ? { acsJoinerRetryDelaySeconds: options.acsJoinerRetryDelaySeconds }
      : {})
  };
  const keeper = new BattleKeeper(resolver, keeperOptions);
  return { keeper, resolver };
}

const launch = (
  missionId: string,
  missionType: number,
  arrivalAt: number,
  returnAt = 0,
  randomnessRequestId?: string
): { missionId: string; missionType: number; arrivalAt: number; returnAt: number; randomnessRequestId?: string } => ({
  missionId,
  missionType,
  arrivalAt,
  returnAt,
  ...(randomnessRequestId ? { randomnessRequestId } : {})
});

describe("BattleKeeper pending tracking", () => {
  test("queues every outbound mission type into the arrival leg", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));
    keeper.recordLaunched(launch("2", MissionType.Harvest, 500));
    keeper.recordLaunched(launch("3", MissionType.Transport, 500, 900));
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500));
    keeper.recordLaunched(launch("5", MissionType.Colonize, 500));
    keeper.recordLaunched(launch("6", MissionType.DefenseHold, 500));
    const snap = keeper.snapshot();
    expect(snap.pendingCount).toBe(6);
    expect(snap.awaitingArrivalCount).toBe(6);
    expect(snap.awaitingReturnCount).toBe(0);
    expect(snap.pendingMissionIds.sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("recordArrivalResolved with a return leg transitions arrival -> return", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("3", MissionType.Transport, 500, 900));
    expect(keeper.snapshot().awaitingArrivalCount).toBe(1);
    keeper.recordArrivalResolved({ missionId: "3", missionType: MissionType.Transport, returnAt: 1_500 });
    const snap = keeper.snapshot();
    expect(snap.pendingCount).toBe(1);
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
  });

  test("recordArrivalResolved with no return leg makes the mission terminal", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500));
    keeper.recordArrivalResolved({ missionId: "4", missionType: MissionType.Deploy, returnAt: 0 });
    expect(keeper.snapshot().pendingCount).toBe(0);
    // Terminal: a stale launch must never re-queue it.
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500));
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("recordArrivalResolved treats Deploy as terminal even when returnAt is nonzero", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500, 900));
    keeper.recordArrivalResolved({ missionId: "4", missionType: MissionType.Deploy, returnAt: 900 });

    expect(keeper.snapshot().pendingCount).toBe(0);

    // Terminal: a stale backfill launch with the original returnAt must never re-queue it.
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500, 900));
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("recordArrivalResolved treats successful Colonize as terminal even when returnAt is nonzero", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("5", MissionType.Colonize, 500, 900));
    keeper.recordArrivalResolved({ missionId: "5", missionType: MissionType.Colonize, returnAt: 900 });

    expect(keeper.snapshot().pendingCount).toBe(0);

    // Terminal: a stale backfill launch with the original returnAt must never re-queue it.
    keeper.recordLaunched(launch("5", MissionType.Colonize, 500, 900));
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("recordReturnExposed queues a blocked Colonize return after its resolved event", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("5", MissionType.Colonize, 500, 900));
    keeper.recordArrivalResolved({ missionId: "5", missionType: MissionType.Colonize, returnAt: 900 });
    expect(keeper.snapshot().pendingCount).toBe(0);

    keeper.recordReturnExposed({
      missionId: "5",
      status: FleetMissionStatus.Returning,
      returnAt: 900
    });

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["5"]);
  });

  test("DefenseHold waits until holdUntil instead of retrying from arrivalAt", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("6", MissionType.DefenseHold, 500, 1_500));
    expect(keeper.pendingMissions()[0]?.dueAt).toBe(500);

    keeper.recordDefenseHoldStationed({ missionId: "6", holdUntil: 1_200, returnAt: 1_500 });

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(1);
    expect(keeper.pendingMissions()[0]?.dueAt).toBe(1_200);
  });

  test("status reconciliation prunes a stale Deploy return tracked from old logic", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("4", MissionType.Deploy, 500, 900));
    keeper.recordArrivalResolved({ missionId: "4", missionType: MissionType.Transport, returnAt: 900 });
    expect(keeper.snapshot().awaitingReturnCount).toBe(1);

    keeper.reconcileMissionStatus({
      missionId: "4",
      status: FleetMissionStatus.Resolved,
      missionType: MissionType.Deploy,
      arrivalAt: 500,
      returnAt: 900
    });

    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("status reconciliation keeps a real returning Attack return leg", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("9", MissionType.Attack, 500, 900));

    keeper.reconcileMissionStatus({
      missionId: "9",
      status: FleetMissionStatus.Returning,
      missionType: MissionType.Attack,
      arrivalAt: 500,
      returnAt: 900
    });

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["9"]);
  });

  test("an ACS attack joiner launch queues the main attack group id instead", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000, maxConcurrency: 1 });
    keeper.recordLaunched(launch("78", MissionType.AcsAttack, 900, 1_500, "77"));
    keeper.recordLaunched(launch("77", MissionType.Attack, 900, 1_500));

    expect(keeper.snapshot().pendingMissionIds).toEqual(["77"]);

    await keeper.tick();

    expect(resolver.calls).toEqual(["77:arrival"]);
    expect(keeper.snapshot().pendingMissionIds).not.toContain("78");
  });

  test("an ACS joiner without a separate lead launch still submits only the main attack group id", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched(launch("78", MissionType.AcsAttack, 900, 1_500, "77"));

    await keeper.tick();

    expect(resolver.calls).toEqual(["77:arrival"]);
    expect(keeper.snapshot().pendingMissionIds).not.toContain("78");
  });

  test("recordReturned drops a mission from the return leg", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("3", MissionType.Transport, 500, 900));
    keeper.recordArrivalResolved({ missionId: "3", missionType: MissionType.Transport, returnAt: 1_500 });
    expect(keeper.snapshot().awaitingReturnCount).toBe(1);
    keeper.recordReturned("3");
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("recordArrivalResolved can create a return leg even if the launch was missed", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordArrivalResolved({ missionId: "9", missionType: MissionType.Attack, returnAt: 2_000 });
    const snap = keeper.snapshot();
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["9"]);
  });

  test("a terminal mission is never re-queued", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordReturned("7");
    keeper.recordLaunched(launch("7", MissionType.Attack, 500, 900));
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("duplicate launches do not double-queue", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("1", MissionType.Attack, 500, 900));
    keeper.recordLaunched(launch("1", MissionType.Attack, 500, 900));
    expect(keeper.snapshot().pendingCount).toBe(1);
  });
});

describe("BattleKeeper resolution loop", () => {
  test("resolves an arrival whose time has passed", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched(launch("1", MissionType.Attack, 900)); // no return leg recorded
    await keeper.tick();
    expect(resolver.calls).toEqual(["1:arrival"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
    expect(keeper.snapshot().resolvedCount).toBe(1);
    expect(keeper.snapshot().lastResolvedMissionId).toBe("1");
  });

  test("a non-combat mission (Transport) resolves its arrival then its return", async () => {
    let now = 1_000;
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => now });
    keeper.recordLaunched(launch("3", MissionType.Transport, 900, 2_000));

    await keeper.tick(); // arrival is due
    expect(resolver.calls).toEqual(["3:arrival"]);
    // Our own arrival resolve transitions it to the return leg (using the launch returnAt).
    let snap = keeper.snapshot();
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingCount).toBe(1);

    await keeper.tick(); // return not due yet
    expect(resolver.calls).toEqual(["3:arrival"]);

    now = 2_500;
    await keeper.tick(); // return now due
    expect(resolver.calls).toEqual(["3:arrival", "3:return"]);
    snap = keeper.snapshot();
    expect(snap.pendingCount).toBe(0);
    expect(snap.resolvedCount).toBe(2);
  });

  test("the authoritative FleetMissionResolved returnAt overrides the launch estimate", async () => {
    let now = 1_000;
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => now });
    keeper.recordLaunched(launch("3", MissionType.Harvest, 900, 5_000));
    await keeper.tick(); // arrival resolves; launch estimate said return at 5_000
    // But the on-chain event reports an updated (earlier) return time.
    keeper.recordArrivalResolved({ missionId: "3", missionType: MissionType.Harvest, returnAt: 1_500 });
    now = 1_600;
    await keeper.tick();
    expect(resolver.calls).toEqual(["3:arrival", "3:return"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("a Deploy resolves its arrival and is dropped (no return leg)", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched(launch("4", MissionType.Deploy, 900, 2_000));
    await keeper.tick();
    expect(resolver.calls).toEqual(["4:arrival"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
    // No return leg is ever attempted.
    await keeper.tick();
    expect(resolver.calls).toEqual(["4:arrival"]);
  });

  test("skips missions that have not arrived yet", async () => {
    const { keeper, resolver } = makeKeeper(async () => "0xhash", { now: () => 1_000 });
    keeper.recordLaunched(launch("1", MissionType.Attack, 2_000));
    await keeper.tick();
    expect(resolver.calls).toEqual([]);
    expect(keeper.snapshot().pendingCount).toBe(1);
  });

  test("combat arrival retries on randomness-not-ready revert without crashing", async () => {
    let attempts = 0;
    const { keeper, resolver } = makeKeeper(
      async (missionId, _leg, index) => {
        attempts += 1;
        if (index === 0) {
          throw new MissionNotResolvableError(missionId, new Error("NoRandomnessCommitment"));
        }
        return "0xhash";
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));

    await keeper.tick(); // first attempt reverts
    const retrySnapshot = keeper.snapshot();
    expect(retrySnapshot.pendingCount).toBe(1);
    expect(retrySnapshot.resolvedCount).toBe(0);
    expect(retrySnapshot.submitFailureCount).toBe(1);
    expect(retrySnapshot.lastErrorMissionId).toBe("1");
    expect(retrySnapshot.lastErrorLeg).toBe("arrival");
    expect(retrySnapshot.lastError).toContain("not resolvable");
    expect(retrySnapshot.dueMissions).toEqual([
      expect.objectContaining({
        missionId: "1",
        missionTypeName: "Attack",
        leg: "arrival",
        dueAgeSeconds: 500,
        retryCount: 1,
        lastError: expect.stringContaining("NoRandomnessCommitment")
      })
    ]);

    await keeper.tick(); // second attempt succeeds
    expect(resolver.calls).toEqual(["1:arrival", "1:arrival"]);
    const resolvedSnapshot = keeper.snapshot();
    expect(resolvedSnapshot.pendingCount).toBe(0);
    expect(resolvedSnapshot.resolvedCount).toBe(1);
    expect(resolvedSnapshot.dueMissions).toEqual([]);
    expect(attempts).toBe(2);
  });

  test("a not-yet-due return reverts and is retried on a later tick", async () => {
    let now = 1_000;
    const { keeper, resolver } = makeKeeper(
      async (missionId, leg, index) => {
        // Return leg reverts the first time (e.g. FleetNotArrived), then succeeds.
        if (leg === "return" && index === 0) {
          throw new MissionNotResolvableError(missionId, new Error("FleetNotArrived"));
        }
        return "0xhash";
      },
      { now: () => now }
    );
    keeper.recordLaunched(launch("3", MissionType.Transport, 900, 1_400));
    await keeper.tick(); // arrival resolves -> awaiting return
    now = 1_500;
    await keeper.tick(); // return reverts (still treated not-due), stays pending
    expect(keeper.snapshot().awaitingReturnCount).toBe(1);
    expect(keeper.snapshot().submitFailureCount).toBe(1);
    await keeper.tick(); // return succeeds
    expect(resolver.calls).toEqual(["3:arrival", "3:return", "3:return"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("does not crash on an unexpected (non-revert) error", async () => {
    const { keeper } = makeKeeper(
      async () => {
        throw new Error("RPC HTTP 503");
      },
      { now: () => 1_000 }
    );
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));
    await keeper.tick();
    expect(keeper.snapshot().pendingCount).toBe(1);
    expect(keeper.snapshot().submitFailureCount).toBe(1);
    expect(keeper.snapshot().lastError).toContain("503");
  });
});

describe("BattleKeeper idempotency", () => {
  test("never double-submits the same leg across concurrent ticks", async () => {
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
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));

    // Kick off two overlapping ticks while the first submission is still in flight.
    const first = keeper.tick();
    const second = keeper.tick();
    release();
    await Promise.all([first, second]);

    expect(resolver.calls).toEqual(["1:arrival"]); // exactly one submission
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
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));

    const tick = keeper.tick(); // arrival submission in flight (awaiting gate)
    // A terminal FleetMissionResolved (no return) arrives for the same mission while in flight.
    keeper.recordArrivalResolved({ missionId: "1", missionType: MissionType.Attack, returnAt: 0 });
    release();
    await tick;

    // No second tick re-submits because the mission is now terminal.
    await keeper.tick();
    expect(resolver.calls).toEqual(["1:arrival"]);
    expect(keeper.snapshot().pendingCount).toBe(0);
  });
});

describe("BattleKeeper tick re-entrancy", () => {
  test("a second tick() is a no-op while the first is still in flight (no nonce races)", async () => {
    // Gate the first resolve so it stays in flight while we fire an overlapping tick (as the resolve
    // timer and sweep timer can). The overlapping tick must NOT submit anything.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const { keeper, resolver } = makeKeeper(async () => {
      started += 1;
      await gate;
      return "0xhash";
    });
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));
    keeper.recordLaunched(launch("2", MissionType.Harvest, 500));

    const first = keeper.tick();
    await Promise.resolve(); // let the first tick begin submitting
    await keeper.tick(); // overlapping tick — must short-circuit on the re-entrancy guard
    release();
    await first;

    // Only the first tick's submissions ran; the overlapping tick added no extra calls.
    expect(resolver.calls.sort()).toEqual(["1:arrival", "2:arrival"]);
    expect(started).toBe(2);
  });
});

describe("BattleKeeper safety sweep reconcile", () => {
  test("reconcilePending adds missed missions and ignores known/terminal ones", () => {
    const { keeper } = makeKeeper(async () => "0xhash");
    keeper.recordLaunched(launch("1", MissionType.Attack, 500));
    keeper.recordReturned("9"); // already terminal

    keeper.reconcilePending([
      launch("1", MissionType.Attack, 500), // already pending
      launch("2", MissionType.Harvest, 500, 900), // new, recovered
      launch("9", MissionType.Attack, 500) // terminal, ignored
    ]);

    expect(keeper.snapshot().pendingMissionIds.sort()).toEqual(["1", "2"]);
  });
});
