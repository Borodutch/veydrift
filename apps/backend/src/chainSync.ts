import type { BackendConfig } from "./config";
import { canonicalHealPlanetIdsForLog } from "./evm";
import type { RpcLog } from "./evm";
import type { SettlementIndexer } from "./indexer";

// HTTP-poll ingestion source. `getHeadBlock` resolves the current chain head (eth_blockNumber) and
// `listContractLogs` returns every indexed-contract log in a block range (chunked internally). The
// indexer primarily mutates from these polled logs — there is no websocket subscription and no global
// canonical-reconcile sweep. A dropped-transport problem cannot exist because each poll re-derives the
// range from the durable cursor and re-scans head; applyLog dedups by txHash:logIndex, so overlapping
// ranges are idempotent. Combat/fleet logs may also enqueue a planet-scoped canonical heal when the
// contract does not emit enough per-unit survivor data to update ship/defense rows from logs alone.
type LogBackfiller = {
  failoverRpc?(reason: string): boolean;
  getHeadBlock(): Promise<bigint>;
  listContractLogs(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]>;
};

type ChainSyncIndexer = Partial<Pick<SettlementIndexer, "applyLog" | "clearPendingReconciliationReason" | "healCanonicalPlanets" | "markStale" | "snapshot">>;

export type ChainSyncSnapshot = {
  connected: boolean;
  eventsReceived: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  lastPolledAt: string | null;
  latestHeadBlock: string | null;
  lastHeadAdvancedAt: string | null;
  latestSyncedBlock: string | null;
  headStallPollCount: number;
  pollFailureCount: number;
  reorgDetectedAt: string | null;
  subscribedAddresses: string[];
  // Retained for /health-readiness compatibility (backendReadiness gates on these). Under the polling
  // ingester both mirror `connected`: once the poll loop has fetched head and is applying logs, the
  // backend is "subscribed" to heads and logs via the poll, just over HTTP instead of a websocket.
  subscribedToHeads: boolean;
  subscribedToLogs: boolean;
  pollingEnabled: boolean;
};

export type ChainSyncEvent = {
  blockNumber: string | null;
  kind: "chain-event" | "sync-status";
  transactionHash?: string;
};

type ChainSyncListener = (event: ChainSyncEvent) => void;

// Consecutive failed polls before /health readiness is downgraded. A single transient getLogs /
// eth_blockNumber blip must not flap the backend out of "ready" (and trip the redeploy health gate);
// a sustained RPC outage should. lastError surfaces immediately on the very first failure regardless.
const CONNECTED_FAILURE_THRESHOLD = 5;
const HEAD_STALL_FAILURE_THRESHOLD = 30;

export class ChainSyncService {
  private connected = false;
  private eventsReceived = 0;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
  private lastHeadAdvancedAt: string | null = null;
  private lastPolledAt: string | null = null;
  private latestHeadBlock: string | null = null;
  private latestSyncedBlock: string | null = null;
  private reorgDetectedAt: string | null = null;
  private listeners = new Set<ChainSyncListener>();
  // Only flips true via stop(); start() also clears it. A pre-start poll() (the interval/tests drive
  // poll() directly) must run, so this defaults false — the timer is what actually starts the loop.
  private stopped = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollInProgress = false;
  private pollFailureCount = 0;
  private headStallPollCount = 0;
  private headStallReason: string | null = null;
  // Next block the poll loop must scan FROM. null until the first successful head fetch, after which we
  // resume from the durable DB cursor. A cold/manual event replay may seed history; the live poll must
  // never skip directly to head because there is no startup canonical self-heal to cover the gap.
  private cursor: bigint | null = null;

  constructor(
    private readonly config: BackendConfig,
    private readonly indexer: ChainSyncIndexer | undefined,
    private readonly options: {
      logBackfiller?: LogBackfiller;
      pollIntervalMs?: number;
    } = {}
  ) {}

  private pollIntervalMs(): number {
    const configured = this.config.pollIntervalMs;
    if (configured !== undefined && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return 4_000;
  }

  snapshot(): ChainSyncSnapshot {
    return {
      connected: this.connected,
      eventsReceived: this.eventsReceived,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      lastHeadAdvancedAt: this.lastHeadAdvancedAt,
      lastPolledAt: this.lastPolledAt,
      latestHeadBlock: this.latestHeadBlock,
      latestSyncedBlock: this.latestSyncedBlock,
      headStallPollCount: this.headStallPollCount,
      pollFailureCount: this.pollFailureCount,
      reorgDetectedAt: this.reorgDetectedAt,
      subscribedAddresses: this.subscribedAddresses(),
      subscribedToHeads: this.connected,
      subscribedToLogs: this.connected,
      pollingEnabled: Boolean(this.options.logBackfiller)
    };
  }

  start(): void {
    if (this.pollTimer || !this.config.gameContractAddress) {
      return;
    }
    if (!this.options.logBackfiller || !this.indexer?.applyLog) {
      this.lastError =
        "Chain-sync polling disabled: no log backfiller / indexer applyLog available.";
      return;
    }

    this.stopped = false;
    // Kick an immediate poll (anchors the cursor at head) then run on the interval. void: the loop
    // catches its own errors and never rejects, so an unhandled rejection can't escape here.
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs());
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  addListener(listener: ChainSyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  eventStream(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const encode = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let removeListener: (() => void) | undefined;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encode("sync-status", this.snapshot()));
        removeListener = this.addListener((event) => {
          controller.enqueue(
            encode(event.kind, event.kind === "sync-status" ? this.snapshot() : event)
          );
        });
      },
      cancel: () => {
        removeListener?.();
      }
    });
  }

  // One poll pass: resolve head, ingest [cursor+1, head], advance the cursor. Reentrancy-guarded so a
  // slow getLogs that overruns the interval can never run two passes against the same range at once.
  // Public so the interval drives it and tests can step the loop deterministically.
  async poll(): Promise<void> {
    if (this.stopped || this.pollInProgress) {
      return;
    }
    const backfiller = this.options.logBackfiller;
    const applyLog = this.indexer?.applyLog;
    if (!backfiller || !applyLog) {
      return;
    }
    this.pollInProgress = true;
    try {
      const head = await backfiller.getHeadBlock();
      this.lastPolledAt = new Date().toISOString();
      if (this.isHeadStalled(head)) {
        this.markHeadStalled(head);
        this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
        return;
      }
      this.latestHeadBlock = head.toString();
      this.markConnected();

      if (this.cursor === null) {
        this.cursor = this.initialCursor();
      }

      if (head <= this.cursor) {
        // No new blocks since the last pass; nothing to ingest. Still a healthy poll.
        this.clearRecoveredHeadStall();
        this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
        return;
      }

      const fromBlock = this.cursor < 0n ? 0n : this.cursor + 1n;
      const logs = await backfiller.listContractLogs(fromBlock, head);
      const { applied, lastHash } = await this.applyLogs(logs, applyLog);
      // Advance the cursor to the scanned head ONLY after a clean ingest — a throw skips this and the
      // next pass retries the same range. Events are absolute-state SETs + txHash:logIndex deduped, so
      // the retried overlap is idempotent.
      this.cursor = head;
      this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, head);
      if (applied > 0) {
        this.notify({
          kind: "chain-event",
          blockNumber: this.latestSyncedBlock,
          ...(lastHash ? { transactionHash: lastHash } : {})
        });
      }
      this.clearRecoveredHeadStall();
      this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
    } catch (error) {
      // No self-heal escalation: record the failure, leave the cursor put, and let the next interval
      // retry the same range. A heavy canonical reconcile is never triggered from a transient RPC blip.
      this.lastError =
        error instanceof Error ? error.message : "Chain-sync poll failed.";
      this.pollFailureCount += 1;
      if (this.pollFailureCount >= CONNECTED_FAILURE_THRESHOLD) {
        this.connected = false;
      }
    } finally {
      this.pollInProgress = false;
    }
  }

  private async applyLogs(
    logs: RpcLog[],
    applyLog: NonNullable<SettlementIndexer["applyLog"]>
  ): Promise<{ applied: number; lastHash: string | undefined }> {
    let applied = 0;
    let lastHash: string | undefined;
    for (const log of sortRpcLogs(logs)) {
      if (!isRpcLog(log)) continue;
      const block = BigInt(log.blockNumber);
      this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, block);
      try {
        const result = applyLog.call(this.indexer, log);
        if (result.applied) {
          this.eventsReceived += 1;
          this.lastEventAt = new Date().toISOString();
          applied += 1;
          lastHash = log.transactionHash;
          await this.queueTargetedCanonicalHeal(log);
        }
        if (result.removed) {
          // A reorg-removed log. The contract re-emits the canonical post-state on the new chain, and
          // the next poll re-scans head, so we only record it for observability — no reconcile sweep.
          this.reorgDetectedAt = new Date().toISOString();
        }
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : "Failed to index contract log.";
        throw error;
      }
    }
    return { applied, lastHash };
  }

  private async queueTargetedCanonicalHeal(log: RpcLog): Promise<void> {
    const planetIds = canonicalHealPlanetIdsForLog(log);
    if (planetIds.length === 0) return;
    await this.indexer?.healCanonicalPlanets?.(planetIds);
  }

  private markConnected(): void {
    this.pollFailureCount = 0;
    if (!this.connected) {
      this.connected = true;
      this.lastConnectedAt = new Date().toISOString();
    }
    this.lastError = null;
  }

  private isHeadStalled(head: bigint): boolean {
    const headLabel = head.toString();
    if (this.latestHeadBlock === headLabel) {
      this.headStallPollCount += 1;
    } else {
      this.headStallPollCount = 0;
      this.lastHeadAdvancedAt = new Date().toISOString();
    }
    return this.headStallPollCount >= HEAD_STALL_FAILURE_THRESHOLD;
  }

  private markHeadStalled(head: bigint): void {
    const headLabel = head.toString();
    this.latestHeadBlock = headLabel;
    this.connected = false;
    this.pollFailureCount = CONNECTED_FAILURE_THRESHOLD;
    this.headStallReason = `rpc_head_stalled:${headLabel}`;
    const failedOver = this.options.logBackfiller?.failoverRpc?.(this.headStallReason) ?? false;
    this.lastError = failedOver
      ? `RPC head stalled at block ${headLabel}; failed over to fallback RPC`
      : `RPC head stalled at block ${headLabel}`;
    this.indexer?.markStale?.(this.headStallReason);
  }

  private clearRecoveredHeadStall(): void {
    if (!this.headStallReason || this.headStallPollCount !== 0) return;
    this.indexer?.clearPendingReconciliationReason?.(this.headStallReason);
    this.headStallReason = null;
  }

  private initialCursor(): bigint {
    const latestIndexedBlock = this.indexer?.snapshot?.().latestIndexedBlock;
    if (latestIndexedBlock) {
      try {
        return BigInt(latestIndexedBlock);
      } catch {
        // Fall through to the configured replay base.
      }
    }
    return this.config.indexFromBlock > 0n ? this.config.indexFromBlock - 1n : -1n;
  }

  private notify(event: ChainSyncEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private subscribedAddresses(): string[] {
    return [
      this.config.gameContractAddress,
      this.config.moonContractAddress,
      this.config.allianceContractAddress,
      this.config.resourceTokenAddresses.metal,
      this.config.resourceTokenAddresses.crystal,
      this.config.resourceTokenAddresses.deuterium,
      // VEY-KANEO-479: the RandomnessEngine feeds RandomnessFulfilled into the index.
      this.config.randomnessEngineAddress
    ].filter((address): address is `0x${string}` => Boolean(address));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRpcLog(value: unknown): value is RpcLog {
  return (
    isRecord(value) &&
    typeof value.blockNumber === "string" &&
    typeof value.transactionHash === "string" &&
    Array.isArray(value.topics) &&
    value.topics.every((topic) => typeof topic === "string") &&
    typeof value.data === "string"
  );
}

function maxBlockString(current: string | null, next: bigint): string {
  if (current === null) return next.toString();
  const currentBlock = BigInt(current);
  return next > currentBlock ? next.toString() : current;
}

function sortRpcLogs(logs: readonly RpcLog[]): RpcLog[] {
  return [...logs].sort((left, right) => {
    const blockDelta = compareBigIntish(left.blockNumber, right.blockNumber);
    if (blockDelta !== 0) return blockDelta;
    return compareBigIntish(logIndexFor(left), logIndexFor(right));
  });
}

function logIndexFor(log: RpcLog): string {
  return (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0";
}

function compareBigIntish(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}
