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
  /** How many blocks back to backfill each sweep (covers a missed WS window). */
  lookbackBlocks?: bigint;
  logger?: KeeperLogger;
};

/**
 * Backstop reconciler: periodically re-reads recent battle logs over HTTP `eth_getLogs` and feeds
 * them into the keeper, so a mission whose WebSocket `FleetMissionLaunched` was dropped still gets
 * picked up. Resolved events in the window also drop already-settled missions. Pairs with the
 * resolution loop's `tick()` (run separately) which actually submits due missions.
 */
export class LogBackfillSweep {
  private lastSweepAt: string | null = null;
  private lastSweepError: string | null = null;
  private sweepCount = 0;
  private recoveredLaunches = 0;
  private readonly lookbackBlocks: bigint;
  private readonly logger: KeeperLogger | undefined;

  constructor(
    private readonly transport: JsonRpcTransport,
    private readonly gameContractAddress: `0x${string}`,
    private readonly keeper: BattleKeeper,
    options: LogSweepOptions = {}
  ) {
    this.lookbackBlocks = options.lookbackBlocks ?? 2_000n;
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

  async sweep(): Promise<void> {
    try {
      const latestHex = await this.transport.request<string>("eth_blockNumber", []);
      const latest = BigInt(latestHex);
      const fromBlock = latest > this.lookbackBlocks ? latest - this.lookbackBlocks : 0n;
      const logs = await this.transport.request<RawLog[]>("eth_getLogs", [
        {
          address: this.gameContractAddress,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: "latest",
          topics: [Array.from(subscribedTopic0)]
        }
      ]);

      const pendingBefore = this.keeper.snapshot().pendingCount;
      for (const log of logs) {
        const decoded = decodeBattleLog(log);
        if (!decoded) {
          continue;
        }
        if (decoded.kind === "launched") {
          this.keeper.recordLaunched({
            missionId: decoded.missionId,
            missionType: decoded.missionType,
            arrivalAt: decoded.arrivalAt
          });
        } else {
          this.keeper.recordResolved(decoded.missionId);
        }
      }
      const pendingAfter = this.keeper.snapshot().pendingCount;
      const recovered = Math.max(0, pendingAfter - pendingBefore);
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
}
