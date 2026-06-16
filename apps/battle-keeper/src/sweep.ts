import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";

import { decodeBattleLog, subscribedTopic0, type RawLog } from "./events";
import type { BattleKeeper, KeeperLogger } from "./keeper";
import type { JsonRpcTransport } from "./transport";

export type SweepSnapshot = {
  lastSweepAt: string | null;
  lastSweepError: string | null;
  sweepCount: number;
  recoveredLaunches: number;
  prunedPendingMissions: number;
};

export type LogSweepOptions = {
  /** How many blocks back to backfill each periodic sweep (covers a missed WS window). */
  lookbackBlocks?: bigint;
  /** Max block span per `eth_getLogs` request. Nodes cap the range (the self-hosted node caps at
   * 100k), so a deep backfill is split into chunks of this size. */
  maxRangeBlocks?: bigint;
  logger?: KeeperLogger;
};

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

/**
 * Backstop reconciler: periodically re-reads recent fleet-mission logs over HTTP `eth_getLogs` and
 * feeds them into the keeper, so a mission whose WebSocket event was dropped still gets picked up for
 * BOTH legs — a missed `FleetMissionLaunched` re-queues the arrival, a missed `FleetMissionResolved`
 * drops terminal arrivals, a missed `FleetMissionReturnExposed` transitions to the return leg, and a
 * missed `FleetMissionReturned` drops it. Pairs with the resolution loop's `tick()` (run separately)
 * which submits due legs.
 */
export class LogBackfillSweep {
  private lastSweepAt: string | null = null;
  private lastSweepError: string | null = null;
  private sweepCount = 0;
  private recoveredLaunches = 0;
  private prunedPendingMissions = 0;
  private readonly lookbackBlocks: bigint;
  private readonly maxRangeBlocks: bigint;
  private readonly logger: KeeperLogger | undefined;

  constructor(
    private readonly transport: JsonRpcTransport,
    private readonly gameContractAddress: `0x${string}`,
    private readonly keeper: BattleKeeper,
    options: LogSweepOptions = {}
  ) {
    this.lookbackBlocks = options.lookbackBlocks ?? 2_000n;
    this.maxRangeBlocks = options.maxRangeBlocks ?? 90_000n;
    this.logger = options.logger;
  }

  snapshot(): SweepSnapshot {
    return {
      lastSweepAt: this.lastSweepAt,
      lastSweepError: this.lastSweepError,
      sweepCount: this.sweepCount,
      recoveredLaunches: this.recoveredLaunches,
      prunedPendingMissions: this.prunedPendingMissions
    };
  }

  /**
   * Re-read recent logs and feed them into the keeper. With no argument it covers the rolling
   * `lookbackBlocks` window (the periodic backstop). Pass `lookbackOverride` for a DEEP startup
   * backfill (e.g. tens of thousands of blocks) so missions launched long before the keeper started
   * — including overdue arrivals that block returns — are picked up. The range is split into
   * `maxRangeBlocks` chunks because nodes cap a single `eth_getLogs` span.
   */
  async sweep(lookbackOverride?: bigint): Promise<void> {
    try {
      const latest = BigInt(await this.transport.request<string>("eth_blockNumber", []));
      const lookback = lookbackOverride ?? this.lookbackBlocks;
      const fromBlock = latest > lookback ? latest - lookback : 0n;

      const pendingBefore = this.keeper.snapshot().pendingCount;
      for (let start = fromBlock; start <= latest; start += this.maxRangeBlocks + 1n) {
        const end = start + this.maxRangeBlocks > latest ? latest : start + this.maxRangeBlocks;
        const logs = await this.transport.request<RawLog[]>("eth_getLogs", [
          {
            address: this.gameContractAddress,
            fromBlock: `0x${start.toString(16)}`,
            toBlock: `0x${end.toString(16)}`,
            topics: [Array.from(subscribedTopic0)]
          }
        ]);
        for (const log of logs) {
          this.applyLog(log);
        }
      }

      const pendingAfterLogs = this.keeper.snapshot().pendingCount;
      await this.reconcilePendingStatuses();

      const pendingAfterStatusReconcile = this.keeper.snapshot().pendingCount;
      const recovered = Math.max(0, pendingAfterLogs - pendingBefore);
      const pruned = Math.max(0, pendingAfterLogs - pendingAfterStatusReconcile);
      this.recoveredLaunches += recovered;
      this.prunedPendingMissions += pruned;
      this.sweepCount += 1;
      this.lastSweepAt = new Date().toISOString();
      this.lastSweepError = null;
      if (recovered > 0) {
        this.logger?.warn("[sweep] recovered missions missed by WS feed", { recovered });
      }
      if (pruned > 0) {
        this.logger?.warn("[sweep] pruned stale pending missions by on-chain status", { pruned });
      }
    } catch (error) {
      this.lastSweepError = error instanceof Error ? error.message : String(error);
      this.logger?.error("[sweep] backfill failed", error);
    }
  }

  private applyLog(log: RawLog): void {
    const decoded = decodeBattleLog(log);
    if (!decoded) {
      return;
    }
    if (decoded.kind === "launched") {
      this.keeper.recordLaunched({
        missionId: decoded.missionId,
        missionType: decoded.missionType,
        arrivalAt: decoded.arrivalAt,
        returnAt: decoded.returnAt
      });
    } else if (decoded.kind === "resolved") {
      this.keeper.recordArrivalResolved({
        missionId: decoded.missionId,
        missionType: decoded.missionType,
        returnAt: decoded.returnAt
      });
    } else if (decoded.kind === "returnExposed") {
      this.keeper.recordReturnExposed({
        missionId: decoded.missionId,
        status: decoded.status,
        returnAt: decoded.returnAt
      });
    } else {
      this.keeper.recordReturned(decoded.missionId);
    }
  }

  private async reconcilePendingStatuses(): Promise<void> {
    const pending = this.keeper.pendingMissions();
    for (const mission of pending) {
      const status = await this.readFleetMissionStatus(mission.missionId);
      this.keeper.reconcileMissionStatus(status);
    }
  }

  private async readFleetMissionStatus(missionId: string): Promise<{
    missionId: string;
    status: number;
    missionType: number;
    arrivalAt: number;
    returnAt: number;
  }> {
    const data = encodeFunctionData({
      abi: fleetMissionStatusAbi,
      functionName: "fleetMission",
      args: [BigInt(missionId)]
    });
    const encoded = await this.transport.request<`0x${string}`>("eth_call", [
      { to: this.gameContractAddress, data },
      "latest"
    ]);
    const decoded = decodeFunctionResult({
      abi: fleetMissionStatusAbi,
      functionName: "fleetMission",
      data: encoded
    });
    return {
      missionId,
      status: Number(decoded[0]),
      missionType: Number(decoded[1]),
      arrivalAt: Number(decoded[6]),
      returnAt: Number(decoded[7])
    };
  }
}
