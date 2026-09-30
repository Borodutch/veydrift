import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeeperJournal } from "./journal";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, type Abi } from "viem";

import { battleEventsAbi, FleetMissionStatus, MissionType, type RawLog } from "./events";
import { BattleKeeper, type KeeperLogger } from "./keeper";
import type { MissionResolver } from "./resolver";
import { LogBackfillSweep } from "./sweep";
import type { JsonRpcTransport } from "./transport";

const silentLogger: KeeperLogger = { info: () => {}, warn: () => {}, error: () => {} };
const owner = "0x1111111111111111111111111111111111111111" as const;
const gameContract = "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2" as const;

const mockResolver: MissionResolver = {
  keeperAddress: () => "0x000000000000000000000000000000000000dEaD",
  resolveMission: async () => "0xhash"
};

function launchedLog(
  missionId: bigint,
  missionType: number,
  arrivalAt: bigint,
  returnAt: bigint,
  randomnessRequestId = 5n
): RawLog {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionLaunched",
    args: { missionId, owner, missionType }
  });
  const data = encodeAbiParameters(
    [
      { name: "originPlanetId", type: "uint256" },
      { name: "targetPlanetId", type: "uint256" },
      { name: "arrivalAt", type: "uint64" },
      { name: "returnAt", type: "uint64" },
      { name: "randomnessRequestId", type: "uint256" }
    ],
    [100n, 200n, arrivalAt, returnAt, randomnessRequestId]
  );
  return { topics: topics as string[], data };
}

function resolvedLog(missionId: bigint, missionType: number, returnAt: bigint): RawLog {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionResolved",
    args: { missionId, resolver: owner, missionType }
  });
  const data = encodeAbiParameters([{ name: "returnAt", type: "uint64" }], [returnAt]);
  return { topics: topics as string[], data };
}

function returnedLog(missionId: bigint): RawLog {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionReturned",
    args: { missionId, owner, planetId: 200n }
  });
  return { topics: topics as string[], data: "0x" };
}

function returnExposedLog(missionId: bigint, status: number, returnAt: bigint): RawLog {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionReturnExposed",
    args: { missionId, owner, status }
  });
  const data = encodeAbiParameters(
    [
      { name: "originPlanetId", type: "uint256" },
      { name: "targetPlanetId", type: "uint256" },
      { name: "returnAt", type: "uint64" },
      { name: "metal", type: "uint128" },
      { name: "crystal", type: "uint128" },
      { name: "deuterium", type: "uint128" }
    ],
    [100n, 200n, returnAt, 0n, 0n, 0n]
  );
  return { topics: topics as string[], data };
}

const fleetMissionStatusAbi = [
  {
    type: "function",
    name: "fleetMission",
    stateMutability: "view",
    inputs: [{ name: "missionId", type: "uint256" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "missionType", type: "uint8" },
      { name: "owner", type: "address" },
      { name: "originPlanetId", type: "uint256" },
      { name: "targetPlanetId", type: "uint256" },
      { name: "departureAt", type: "uint64" },
      { name: "arrivalAt", type: "uint64" },
      { name: "returnAt", type: "uint64" },
      { name: "fuelCost", type: "uint128" },
      {
        name: "cargo",
        type: "tuple",
        components: [
          { name: "metal", type: "uint128" },
          { name: "crystal", type: "uint128" },
          { name: "deuterium", type: "uint128" }
        ]
      },
      { name: "randomnessRequestId", type: "uint256" }
    ]
  }
] as const satisfies Abi;

function fleetMissionResult(args: {
  status?: number;
  missionType?: number;
  arrivalAt?: bigint;
  returnAt?: bigint;
  randomnessRequestId?: bigint;
} = {}): `0x${string}` {
  return encodeFunctionResult({
    abi: fleetMissionStatusAbi,
    functionName: "fleetMission",
    result: [
      args.status ?? FleetMissionStatus.Returning,
      args.missionType ?? MissionType.Attack,
      owner,
      100n,
      200n,
      800n,
      args.arrivalAt ?? 900n,
      args.returnAt ?? 1_500n,
      0n,
      { metal: 0n, crystal: 0n, deuterium: 0n },
      args.randomnessRequestId ?? 0n
    ]
  });
}

class MockTransport implements JsonRpcTransport {
  constructor(
    private readonly logs: RawLog[],
    private readonly statuses: `0x${string}`[] = []
  ) {}
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (method === "eth_blockNumber") {
      return "0x100" as T;
    }
    if (method === "eth_getLogs") {
      return this.logs as T;
    }
    if (method === "eth_call") {
      return (this.statuses.shift() ?? fleetMissionResult()) as T;
    }
    return "0x0" as T;
  }
}

function makeKeeper(now: () => number): BattleKeeper {
  return new BattleKeeper(mockResolver, { logger: silentLogger, now });
}

describe("LogBackfillSweep", () => {
  test("recovers a missed launch into the arrival leg", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport(
      [launchedLog(1n, MissionType.Attack, 900n, 1_500n)],
      [fleetMissionResult({ status: FleetMissionStatus.Outbound, missionType: MissionType.Attack })]
    );
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["1"]);
    expect(sweep.snapshot().recoveredLaunches).toBe(1);
  });

  test("recovers both legs: a missed Resolved transitions a launched mission to the return leg", async () => {
    const keeper = makeKeeper(() => 1_000);
    // The window contains the launch AND its resolution — the keeper should end awaiting return.
    const transport = new MockTransport(
      [
        launchedLog(3n, MissionType.Transport, 900n, 1_500n),
        resolvedLog(3n, MissionType.Transport, 1_600n)
      ],
      [
        fleetMissionResult({
          status: FleetMissionStatus.Returning,
          missionType: MissionType.Transport,
          returnAt: 1_600n
        })
      ]
    );
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["3"]);
  });

  test("a missed Returned drops a returning mission (terminal)", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport([
      launchedLog(3n, MissionType.Transport, 900n, 1_500n),
      resolvedLog(3n, MissionType.Transport, 1_600n),
      returnedLog(3n)
    ]);
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("a terminal Deploy Resolved drops a launched mission even with a nonzero returnAt", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport([
      launchedLog(4n, MissionType.Deploy, 900n, 1_500n),
      resolvedLog(4n, MissionType.Deploy, 1_500n)
    ]);
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("a successful terminal Colonize Resolved drops a launched mission even with a nonzero returnAt", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport([
      launchedLog(5n, MissionType.Colonize, 900n, 1_500n),
      resolvedLog(5n, MissionType.Colonize, 1_500n)
    ]);
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingCount).toBe(0);
  });

  test("a blocked Colonize return is queued only from FleetMissionReturnExposed", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport(
      [
        launchedLog(6n, MissionType.Colonize, 900n, 1_500n),
        resolvedLog(6n, MissionType.Colonize, 1_500n),
        returnExposedLog(6n, FleetMissionStatus.Returning, 1_500n)
      ],
      [
        fleetMissionResult({
          status: FleetMissionStatus.Returning,
          missionType: MissionType.Colonize,
          returnAt: 1_500n
        })
      ]
    );
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["6"]);
  });

  test("records a sweep error without throwing", async () => {
    const keeper = makeKeeper(() => 1_000);
    const failing: JsonRpcTransport = {
      request: async () => {
        throw new Error("RPC HTTP 503");
      }
    };
    const sweep = new LogBackfillSweep(failing, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(sweep.snapshot().lastSweepError).toContain("503");
  });

  test("reconciles already-tracked due attacks even when log backfill fails", async () => {
    const calls: string[] = [];
    const keeper = makeKeeper(() => 1_000);
    keeper.recordLaunched({ missionId: "8", missionType: MissionType.Attack, arrivalAt: 900, returnAt: 1_500 });
    expect(keeper.snapshot().awaitingArrivalCount).toBe(1);

    const transport: JsonRpcTransport = {
      request: async <T>(method: string): Promise<T> => {
        calls.push(method);
        if (method === "eth_blockNumber") {
          return "0x100" as T;
        }
        if (method === "eth_getLogs") {
          throw new Error("PublicNode backfill failed");
        }
        if (method === "eth_call") {
          return fleetMissionResult({
            status: FleetMissionStatus.Returning,
            missionType: MissionType.Attack,
            arrivalAt: 900n,
            returnAt: 1_500n
          }) as T;
        }
        return "0x0" as T;
      }
    };
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(calls).toContain("eth_call");
    expect(sweep.snapshot().lastSweepError).toContain("PublicNode backfill failed");
    const snap = keeper.snapshot();
    expect(snap.awaitingArrivalCount).toBe(0);
    expect(snap.awaitingReturnCount).toBe(1);
    expect(snap.pendingMissionIds).toEqual(["8"]);
  });

  test("deep backfill splits a wide window into contiguous chunks covering the full range", async () => {
    const keeper = makeKeeper(() => 10_000);
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    const transport: JsonRpcTransport = {
      request: async <T>(method: string, params?: unknown): Promise<T> => {
        if (method === "eth_blockNumber") {
          return `0x${(1_000).toString(16)}` as T;
        }
        if (method === "eth_getLogs") {
          const p = (params as [{ fromBlock: string; toBlock: string }])[0];
          const from = BigInt(p.fromBlock);
          const to = BigInt(p.toBlock);
          ranges.push({ from, to });
          // The mission lives in a NON-first chunk (block 720) to prove chunks beyond the first are scanned.
          return (from <= 720n && 720n <= to
            ? [launchedLog(7n, MissionType.Transport, 900n, 5_000n)]
            : []) as T;
        }
        if (method === "eth_call") {
          return fleetMissionResult({
            status: FleetMissionStatus.Outbound,
            missionType: MissionType.Transport
          }) as T;
        }
        return "0x0" as T;
      }
    };
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, {
      maxRangeBlocks: 100n,
      logger: silentLogger
    });

    await sweep.sweep(500n); // deep lookback => scan blocks [500, 1000] in 100-block chunks

    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]!.from).toBe(500n);
    expect(ranges[ranges.length - 1]!.to).toBe(1_000n);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1n);
    }
    expect(keeper.snapshot().pendingMissionIds).toContain("7");
  });

  test("status reconciliation prunes a stale pending return whose chain status is terminal", async () => {
    const keeper = makeKeeper(() => 2_000);
    keeper.recordLaunched({ missionId: "917", missionType: MissionType.Transport, arrivalAt: 900, returnAt: 1_500 });
    keeper.recordArrivalResolved({ missionId: "917", missionType: MissionType.Transport, returnAt: 1_500 });
    expect(keeper.snapshot().awaitingReturnCount).toBe(1);

    const transport = new MockTransport(
      [],
      [
        fleetMissionResult({
          status: FleetMissionStatus.Resolved,
          missionType: MissionType.Deploy,
          arrivalAt: 900n,
          returnAt: 1_500n
        })
      ]
    );
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingCount).toBe(0);
    expect(sweep.snapshot().prunedPendingMissions).toBe(1);
  });

  test("status reconciliation reopens a terminal missile whose impact was reorged out", async () => {
    const keeper = makeKeeper(() => 2_000);
    keeper.recordLaunched({
      missionId: "918",
      missionType: MissionType.MissileAttack,
      arrivalAt: 900,
      returnAt: 900
    });
    keeper.recordArrivalResolved({ missionId: "918", missionType: MissionType.MissileAttack, returnAt: 0 });
    expect(keeper.snapshot().pendingCount).toBe(0);

    const transport = new MockTransport([], [fleetMissionResult({
      status: FleetMissionStatus.Outbound,
      missionType: MissionType.MissileAttack,
      arrivalAt: 900n,
      returnAt: 900n
    })]);
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingMissionIds).toEqual(["918"]);
  });

  test("canonicalizes a pending ACS joiner to the attack group lead", async () => {
    const keeper = makeKeeper(() => 2_000);
    keeper.recordLaunched({
      missionId: "78",
      missionType: MissionType.AcsAttack,
      arrivalAt: 900,
      returnAt: 1_500,
      randomnessRequestId: "77"
    });

    const transport = new MockTransport(
      [],
      [
        fleetMissionResult({
          status: FleetMissionStatus.Outbound,
          missionType: MissionType.AcsAttack,
          arrivalAt: 900n,
          returnAt: 1_500n,
          randomnessRequestId: 77n
        }),
        fleetMissionResult({
          status: FleetMissionStatus.Outbound,
          missionType: MissionType.Attack,
          arrivalAt: 900n,
          returnAt: 1_500n,
          randomnessRequestId: 42n
        })
      ]
    );
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingMissionIds).toEqual(["77"]);
    const lead = keeper.pendingMissions().find((mission) => mission.missionId === "77");
    expect(lead).toMatchObject({
      missionType: MissionType.Attack,
      leg: "arrival",
      dueAt: 900
    });
  });
});


test("startup log recovery resumes a partially resolved battle with chain-authoritative status", async () => {
  let chunks = 1; // one stage was committed by the previous keeper process
  const resolver: MissionResolver = {
    keeperAddress: () => owner,
    resolveMission: async () => { chunks++; return "0xchunk"; },
    missionStatus: async (missionId) => ({
      missionId, missionType: MissionType.Attack,
      status: chunks < 3 ? FleetMissionStatus.Outbound : FleetMissionStatus.Resolved,
      arrivalAt: 900, returnAt: 950, randomnessRequestId: "5"
    })
  };
  const keeper = new BattleKeeper(resolver, { now: () => 1_000, logger: silentLogger });
  const transport = new MockTransport(
    [launchedLog(96n, MissionType.Attack, 900n, 950n)],
    [fleetMissionResult({ status: FleetMissionStatus.Outbound, missionType: MissionType.Attack })]
  );
  const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });
  await sweep.sweep(90_000n);
  expect(keeper.snapshot().awaitingArrivalCount).toBe(1);
  await keeper.tick();
  expect(chunks).toBe(2);
  expect(keeper.snapshot().awaitingArrivalCount).toBe(1);
  expect(keeper.snapshot().resolvedCount).toBe(0);
  await keeper.tick();
  expect(chunks).toBe(3);
  expect(keeper.snapshot().pendingCount).toBe(0);
});


test("bounded durable discovery recovers old launch, resumes cursor, and consumes return/terminal logs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-history-"));
  const path = join(dir, "state.sqlite");
  let journal = new KeeperJournal(path, "8453:game");
  let state: number = FleetMissionStatus.Outbound;
  let sent = 0;
  const events: Array<{ block: bigint; log: RawLog }> = [
    { block: 50n, log: launchedLog(919n, MissionType.Attack, 10n, 20n) }
  ];
  const ranges: bigint[] = [];
  const transport: JsonRpcTransport = {
    request: async <T>(method: string, params: unknown[]): Promise<T> => {
      if (method === "eth_blockNumber") return "0x3e8" as T; // head 1000; rolling window 998..1000
      if (method === "eth_getLogs") {
        const range = params[0] as { fromBlock: string; toBlock: string };
        const from = BigInt(range.fromBlock), to = BigInt(range.toBlock);
        ranges.push(from);
        return events.filter((event) => event.block >= from && event.block <= to).map((event) => event.log) as T;
      }
      if (method === "eth_call") return fleetMissionResult({
        status: state, missionType: MissionType.Attack, arrivalAt: 10n, returnAt: 2_000n
      }) as T;
      throw new Error(method);
    }
  };
  const resolver: MissionResolver = {
    keeperAddress: () => owner,
    resolveMission: async () => { sent++; return "0xchunk"; },
    missionStatus: async (missionId) => ({ missionId, status: state, missionType: MissionType.Attack,
      arrivalAt: 10, returnAt: 2_000, randomnessRequestId: "5" })
  };
  try {
    let keeper = new BattleKeeper(resolver, { journal, logger: silentLogger, now: () => 1_000 });
    let sweep = new LogBackfillSweep(transport, gameContract, keeper, {
      deploymentBlock: 0n, lookbackBlocks: 2n, maxRangeBlocks: 99n, logger: silentLogger
    });
    await sweep.sweep();
    expect(ranges).toEqual([998n, 0n, 100n]);
    expect(journal.nextBlock()).toBe(200n);
    expect(keeper.snapshot().pendingMissionIds).toEqual(["919"]);
    await keeper.tick();
    expect(sent).toBe(1);
    journal.close();
    journal = new KeeperJournal(path, "8453:game");
    keeper = new BattleKeeper(resolver, { journal, logger: silentLogger, now: () => 1_000 });
    sweep = new LogBackfillSweep(transport, gameContract, keeper, {
      deploymentBlock: 0n, lookbackBlocks: 2n, maxRangeBlocks: 99n, logger: silentLogger
    });
    expect(keeper.snapshot().pendingMissionIds).toEqual(["919"]);
    state = FleetMissionStatus.Returning;
    events.push({ block: 250n, log: returnExposedLog(919n, FleetMissionStatus.Returning, 2_000n) });
    ranges.length = 0;
    await sweep.sweep();
    expect(ranges).toEqual([998n, 200n, 300n]);
    expect(journal.nextBlock()).toBe(400n);
    expect(journal.load()[0]?.leg).toBe("return");
    await keeper.tick();
    expect(sent).toBe(1); // canonical future return, not a duplicate arrival
    state = FleetMissionStatus.Returned;
    events.push({ block: 450n, log: returnedLog(919n) });
    await sweep.sweep();
    expect(journal.nextBlock()).toBe(600n);
    expect(journal.load()).toEqual([]);
    await keeper.tick();
    expect(sent).toBe(1);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});
