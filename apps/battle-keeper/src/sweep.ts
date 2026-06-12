import { decodeBattleLog, subscribedTopic0, type RawLog } from "./events";
import type { BattleKeeper, KeeperLogger } from "./keeper";
import type { JsonRpcTransport } from "./transport";

export type SweepSnapshot = {
  lastSweepAt: string | null;
  lastSweepError: string | null;
  sweepCount: number;
  recoveredLaunches: number;
};

export type LogSweepOptions = {
  /** How many blocks back to backfill each periodic sweep (covers a missed WS window). */
  lookbackBlocks?: bigint;
  /** Max block span per `eth_getLogs` request. Nodes cap the range (the self-hosted node caps at
   * 100k), so a deep backfill is split into chunks of this size. */
  maxRangeBlocks?: bigint;
  logger?: KeeperLogger;
};

/**
 * Backstop reconciler: periodically re-reads recent fleet-mission logs over HTTP `eth_getLogs` and
 * feeds them into the keeper, so a mission whose WebSocket event was dropped still gets picked up for
 * BOTH legs — a missed `FleetMissionLaunched` re-queues the arrival, a missed `FleetMissionResolved`
 * transitions it to the return leg (or drops a terminal one), and a missed `FleetMissionReturned`
 * drops it. Pairs with the resolution loop's `tick()` (run separately) which submits due legs.
 */
export class LogBackfillSweep {
  private lastSweepAt: string | null = null;
  private lastSweepError: string | null = null;
  private sweepCount = 0;
  private recoveredLaunches = 0;
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
      recoveredLaunches: this.recoveredLaunches
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

      const recovered = Math.max(0, this.keeper.snapshot().pendingCount - pendingBefore);
      this.recoveredLaunches += recovered;
      this.sweepCount += 1;
      this.lastSweepAt = new Date().toISOString();
      this.lastSweepError = null;
      if (recovered > 0) {
        this.logger?.warn("[sweep] recovered missions missed by WS feed", { recovered });
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
    } else {
      this.keeper.recordReturned(decoded.missionId);
    }
  }
}
