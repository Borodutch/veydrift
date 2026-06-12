import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import { battleEventsAbi, MissionType, type RawLog } from "./events";
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

function launchedLog(missionId: bigint, missionType: number, arrivalAt: bigint, returnAt: bigint): RawLog {
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
    [100n, 200n, arrivalAt, returnAt, 5n]
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

class MockTransport implements JsonRpcTransport {
  constructor(private readonly logs: RawLog[]) {}
  async request<T>(method: string): Promise<T> {
    if (method === "eth_blockNumber") {
      return "0x100" as T;
    }
    if (method === "eth_getLogs") {
      return this.logs as T;
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
    const transport = new MockTransport([launchedLog(1n, MissionType.Attack, 900n, 1_500n)]);
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
    const transport = new MockTransport([
      launchedLog(3n, MissionType.Transport, 900n, 1_500n),
      resolvedLog(3n, MissionType.Transport, 1_600n)
    ]);
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

  test("a terminal Resolved (no return) drops a launched mission", async () => {
    const keeper = makeKeeper(() => 1_000);
    const transport = new MockTransport([
      launchedLog(4n, MissionType.Deploy, 900n, 0n),
      resolvedLog(4n, MissionType.Deploy, 0n)
    ]);
    const sweep = new LogBackfillSweep(transport, gameContract, keeper, { logger: silentLogger });

    await sweep.sweep();

    expect(keeper.snapshot().pendingCount).toBe(0);
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
});
