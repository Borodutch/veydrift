import type { BackendConfig } from "./config";
import { canonicalHealPlanetIdsForLog, isSettledPlanetLog } from "./evm";
import type { RpcLog } from "./evm";
import type { SettlementIndexer } from "./indexer";

// HTTP catch-up source. `getHeadBlock` resolves the current chain head (eth_blockNumber) and
// `listContractLogs` returns every indexed-contract log in a block range (chunked internally). The
// primary live path is a websocket log subscriber when configured; this backfiller remains the durable
// cursor recovery path for startup gaps, websocket setup failures, and detected block gaps. applyLog
// dedups by txHash:logIndex, so overlapping ranges are idempotent. Combat/fleet logs may also enqueue a
// planet-scoped canonical heal when the contract does not emit enough per-unit survivor data to update
// ship/defense rows from logs alone.
type LogBackfiller = {
  failoverRpc?(reason: string): boolean;
  getHeadBlock(): Promise<bigint>;
  listContractLogs(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]>;
  rpcMetrics?(): unknown;
};

export type ChainSyncLiveSource = "viem_ws" | "fallback_poll";

export type LiveLogSubscriber = {
  subscribe(options: {
    addresses: `0x${string}`[];
    onError: (error: Error) => void;
    onLogs: (logs: RpcLog[]) => void;
  }): (() => void) | Promise<() => void>;
};

type ChainSyncIndexer = Partial<Pick<SettlementIndexer, "applyLog" | "clearPendingReconciliationReason" | "healCanonicalPlanets" | "markStale" | "snapshot">>;

export type ChainSyncSnapshot = {
  connected: boolean;
  eventsReceived: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  lastPolledAt: string | null;
  lastPollDurationMs: number | null;
  lastGetLogsDurationMs: number | null;
  lastGetLogsRange: { fromBlock: string; toBlock: string } | null;
  latestHeadBlock: string | null;
  lastHeadAdvancedAt: string | null;
  latestSyncedBlock: string | null;
  pollBacklogBlocks: string | null;
  pollBacklogMs: number | null;
  recentEventReceiveLagMs: {
    count: number;
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
  activeSource: ChainSyncLiveSource | null;
  liveListenerConnected: boolean;
  liveListenerErrorCount: number;
  liveListenerLastError: string | null;
  lastHandlerDurationMs: number | null;
  maxHandlerDurationMs: number | null;
  slowHandlerCount300Ms: number;
  slowHandlerCount1000Ms: number;
  recentHandlerDurationMs: {
    count: number;
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
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
  walletPlanetsChanged?: boolean;
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
  private lastPollDurationMs: number | null = null;
  private lastGetLogsDurationMs: number | null = null;
  private lastGetLogsRange: { fromBlock: string; toBlock: string } | null = null;
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
  private activeSource: ChainSyncLiveSource | null = null;
  private liveListenerConnected = false;
  private liveListenerErrorCount = 0;
  private liveListenerLastError: string | null = null;
  private liveUnsubscribe: (() => void) | undefined;
  private liveLogQueue: Promise<void> = Promise.resolve();
  private lastHandlerDurationMs: number | null = null;
  private maxHandlerDurationMs: number | null = null;
  private slowHandlerCount300Ms = 0;
  private slowHandlerCount1000Ms = 0;
  // Next block the poll loop must scan FROM. null until the first successful head fetch, after which we
  // resume from the durable DB cursor. A cold/manual event replay may seed history; the live poll must
  // never skip directly to head because there is no startup canonical self-heal to cover the gap.
  private cursor: bigint | null = null;
  private readonly recentEventReceiveLagsMs: number[] = [];
  private readonly recentHandlerDurationsMs: number[] = [];

  constructor(
    private readonly config: BackendConfig,
    private readonly indexer: ChainSyncIndexer | undefined,
    private readonly options: {
      diagnosticsPublisher?: (snapshot: ChainSyncSnapshot) => void;
      liveLogSubscriber?: LiveLogSubscriber;
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
      lastPollDurationMs: this.lastPollDurationMs,
      lastGetLogsDurationMs: this.lastGetLogsDurationMs,
      lastGetLogsRange: this.lastGetLogsRange,
      latestHeadBlock: this.latestHeadBlock,
      latestSyncedBlock: this.latestSyncedBlock,
      pollBacklogBlocks: this.pollBacklogBlocks(),
      pollBacklogMs: this.pollBacklogMs(),
      recentEventReceiveLagMs: this.recentEventReceiveLagSummary(),
      activeSource: this.activeSource,
      liveListenerConnected: this.liveListenerConnected,
      liveListenerErrorCount: this.liveListenerErrorCount,
      liveListenerLastError: this.liveListenerLastError,
      lastHandlerDurationMs: this.lastHandlerDurationMs,
      maxHandlerDurationMs: this.maxHandlerDurationMs,
      slowHandlerCount300Ms: this.slowHandlerCount300Ms,
      slowHandlerCount1000Ms: this.slowHandlerCount1000Ms,
      recentHandlerDurationMs: this.recentHandlerDurationSummary(),
      headStallPollCount: this.headStallPollCount,
      pollFailureCount: this.pollFailureCount,
      reorgDetectedAt: this.reorgDetectedAt,
      subscribedAddresses: this.subscribedAddresses(),
      subscribedToHeads: this.connected,
      subscribedToLogs: this.liveListenerConnected || this.connected,
      pollingEnabled: Boolean(this.options.logBackfiller) && !this.liveListenerConnected
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
    if (this.startLiveListener()) {
      this.activeSource = "viem_ws";
      // Catch up any missed range before relying on the live subscription. Future websocket logs fill
      // cursor gaps on demand; the interval is only a fallback when websocket setup fails.
      void this.poll();
      return;
    }

    this.startFallbackPolling();
  }

  stop(): void {
    this.stopped = true;
    this.liveUnsubscribe?.();
    this.liveUnsubscribe = undefined;
    this.liveListenerConnected = false;
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

  eventStream(signal?: AbortSignal): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const encode = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let removeListener: (() => void) | undefined;
    let removeAbortListener: (() => void) | undefined;
    let closed = false;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const cleanup = () => {
          if (closed) return;
          closed = true;
          removeListener?.();
          removeListener = undefined;
          removeAbortListener?.();
          removeAbortListener = undefined;
          try {
            controller.close();
          } catch {
            // The browser/client may already have torn the stream down.
          }
        };

        if (signal) {
          if (signal.aborted) {
            cleanup();
            return;
          }
          signal.addEventListener("abort", cleanup, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", cleanup);
        }

        controller.enqueue(encode("sync-status", this.snapshot()));
        removeListener = this.addListener((event) => {
          try {
            controller.enqueue(
              encode(event.kind, event.kind === "sync-status" ? this.snapshot() : event)
            );
          } catch {
            cleanup();
          }
        });
      },
      cancel: () => {
        removeListener?.();
        removeListener = undefined;
        removeAbortListener?.();
        removeAbortListener = undefined;
        closed = true;
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
    const pollStartedAt = Date.now();
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
      this.lastGetLogsRange = { fromBlock: fromBlock.toString(), toBlock: head.toString() };
      const getLogsStartedAt = Date.now();
      let logs: RpcLog[];
      try {
        logs = await backfiller.listContractLogs(fromBlock, head);
      } finally {
        this.lastGetLogsDurationMs = Date.now() - getLogsStartedAt;
      }
      const { applied, lastHash, walletPlanetsChanged } = await this.applyLogs(logs, applyLog);
      // Advance the cursor to the scanned head ONLY after a clean ingest — a throw skips this and the
      // next pass retries the same range. Events are absolute-state SETs + txHash:logIndex deduped, so
      // the retried overlap is idempotent.
      this.cursor = head;
      this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, head);
      if (applied > 0) {
        this.notify({
          kind: "chain-event",
          blockNumber: this.latestSyncedBlock,
          ...(lastHash ? { transactionHash: lastHash } : {}),
          ...(walletPlanetsChanged ? { walletPlanetsChanged } : {})
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
      this.lastPollDurationMs = Date.now() - pollStartedAt;
      this.pollInProgress = false;
      this.publishDiagnostics();
    }
  }

  private publishDiagnostics(): void {
    try {
      this.options.diagnosticsPublisher?.(this.snapshot());
    } catch (error) {
      console.warn("Veydrift chain-sync diagnostics publish failed", error);
    }
  }

  private startFallbackPolling(): void {
    if (this.pollTimer) return;
    this.activeSource = "fallback_poll";
    // Kick an immediate poll (anchors the cursor at head) then run on the interval. void: the loop
    // catches its own errors and never rejects, so an unhandled rejection can't escape here.
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs());
  }

  private startLiveListener(): boolean {
    const subscriber = this.options.liveLogSubscriber;
    if (!subscriber) return false;

    try {
      const unsubscribe = subscriber.subscribe({
        addresses: this.subscribedAddresses(),
        onError: (error) => this.handleLiveListenerError(error),
        onLogs: (logs) => this.enqueueLiveLogs(logs)
      });
      void Promise.resolve(unsubscribe)
        .then((resolvedUnsubscribe) => {
          if (this.stopped) {
            resolvedUnsubscribe();
            return;
          }
          this.liveUnsubscribe = resolvedUnsubscribe;
          this.liveListenerConnected = true;
          this.connected = true;
          this.lastConnectedAt ??= new Date().toISOString();
          this.liveListenerLastError = null;
          this.lastError = null;
          this.publishDiagnostics();
        })
        .catch((error) => this.handleLiveListenerError(error));
      return true;
    } catch (error) {
      this.handleLiveListenerError(error);
      return false;
    }
  }

  private handleLiveListenerError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Viem websocket live listener failed.";
    this.liveListenerConnected = false;
    this.liveListenerErrorCount += 1;
    this.liveListenerLastError = message;
    this.lastError = message;
    if (!this.pollTimer) {
      this.startFallbackPolling();
    }
    this.publishDiagnostics();
  }

  private enqueueLiveLogs(logs: RpcLog[]): void {
    this.liveLogQueue = this.liveLogQueue
      .then(() => this.handleLiveLogs(logs))
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Failed to handle live chain logs.";
        this.publishDiagnostics();
      });
  }

  private async handleLiveLogs(logs: RpcLog[]): Promise<void> {
    const applyLog = this.indexer?.applyLog;
    if (this.stopped || !applyLog || logs.length === 0) return;
    if (this.cursor === null) {
      this.cursor = this.initialCursor();
    }

    const sortedLogs = sortRpcLogs(logs).filter(isRpcLog);
    for (const log of sortedLogs) {
      const block = BigInt(log.blockNumber);
      if (this.cursor !== null && block > this.cursor + 1n) {
        await this.catchUpRange(this.cursor + 1n, block - 1n);
      }
      const { applied, lastHash, walletPlanetsChanged } = await this.applyLogs([log], applyLog, "viem_ws");
      this.cursor = maxBigInt(this.cursor, block);
      this.latestHeadBlock = maxBlockString(this.latestHeadBlock, block);
      this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, block);
      this.markConnected();
      if (applied > 0) {
        this.notify({
          kind: "chain-event",
          blockNumber: this.latestSyncedBlock,
          ...(lastHash ? { transactionHash: lastHash } : {}),
          ...(walletPlanetsChanged ? { walletPlanetsChanged } : {})
        });
      }
    }
    this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
    this.publishDiagnostics();
  }

  private async catchUpRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    if (toBlock < fromBlock) return;
    const backfiller = this.options.logBackfiller;
    const applyLog = this.indexer?.applyLog;
    if (!backfiller || !applyLog) return;
    this.lastGetLogsRange = { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() };
    const getLogsStartedAt = Date.now();
    let logs: RpcLog[];
    try {
      logs = await backfiller.listContractLogs(fromBlock, toBlock);
    } finally {
      this.lastGetLogsDurationMs = Date.now() - getLogsStartedAt;
    }
    await this.applyLogs(logs, applyLog, "fallback_poll");
    this.cursor = maxBigInt(this.cursor, toBlock);
    this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, toBlock);
  }

  private async applyLogs(
    logs: RpcLog[],
    applyLog: NonNullable<SettlementIndexer["applyLog"]>,
    source: ChainSyncLiveSource = "fallback_poll"
  ): Promise<{ applied: number; lastHash: string | undefined; walletPlanetsChanged: boolean }> {
    let applied = 0;
    let lastHash: string | undefined;
    let walletPlanetsChanged = false;
    for (const log of sortRpcLogs(logs)) {
      if (!isRpcLog(log)) continue;
      const block = BigInt(log.blockNumber);
      this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, block);
      const handlerStartedAt = Date.now();
      let result: ReturnType<NonNullable<SettlementIndexer["applyLog"]>> | undefined;
      try {
        result = applyLog.call(this.indexer, log);
        if (result.applied) {
          this.recordEventReceiveLag(log);
          this.eventsReceived += 1;
          this.lastEventAt = new Date().toISOString();
          applied += 1;
          lastHash = log.transactionHash;
          walletPlanetsChanged ||= isSettledPlanetLog(log);
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
      } finally {
        this.recordHandlerCompletion(log, source, Date.now() - handlerStartedAt, result);
      }
    }
    return { applied, lastHash, walletPlanetsChanged };
  }

  private async queueTargetedCanonicalHeal(log: RpcLog): Promise<void> {
    const planetIds = canonicalHealPlanetIdsForLog(log);
    if (planetIds.length === 0) return;
    void this.indexer?.healCanonicalPlanets?.(planetIds);
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

  private pollBacklogBlocks(): string | null {
    if (this.latestHeadBlock === null) return null;
    const synced = this.cursor ?? this.parseBlockLabel(this.latestSyncedBlock);
    if (synced === null) return null;
    try {
      const backlog = BigInt(this.latestHeadBlock) - synced;
      return (backlog > 0n ? backlog : 0n).toString();
    } catch {
      return null;
    }
  }

  private pollBacklogMs(): number | null {
    const backlogBlocks = this.pollBacklogBlocks();
    if (backlogBlocks === null) return null;
    const blocks = Number(backlogBlocks);
    if (!Number.isFinite(blocks)) return null;
    // Base Sepolia targets ~2s blocks; exact observed tx lag is reported from blockTimestamp logs.
    return Math.round(blocks * 2_000);
  }

  private parseBlockLabel(label: string | null): bigint | null {
    if (label === null) return null;
    try {
      return BigInt(label);
    } catch {
      return null;
    }
  }

  private recordEventReceiveLag(log: RpcLog): void {
    if (!("blockTimestamp" in log) || typeof log.blockTimestamp !== "string") return;
    let blockTimestampSeconds: bigint;
    try {
      blockTimestampSeconds = BigInt(log.blockTimestamp);
    } catch {
      return;
    }
    const lagMs = Date.now() - Number(blockTimestampSeconds * 1_000n);
    if (!Number.isFinite(lagMs) || lagMs < 0) return;
    this.recentEventReceiveLagsMs.push(Math.round(lagMs));
    if (this.recentEventReceiveLagsMs.length > 100) {
      this.recentEventReceiveLagsMs.splice(0, this.recentEventReceiveLagsMs.length - 100);
    }
  }

  private recentEventReceiveLagSummary(): ChainSyncSnapshot["recentEventReceiveLagMs"] {
    if (this.recentEventReceiveLagsMs.length === 0) {
      return { count: 0, max: null, p50: null, p95: null };
    }
    const sorted = [...this.recentEventReceiveLagsMs].sort((left, right) => left - right);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.at(-1) ?? null
    };
  }

  private recordHandlerCompletion(
    log: RpcLog,
    source: ChainSyncLiveSource,
    durationMs: number,
    result: ReturnType<NonNullable<SettlementIndexer["applyLog"]>> | undefined
  ): void {
    this.lastHandlerDurationMs = durationMs;
    this.maxHandlerDurationMs = Math.max(this.maxHandlerDurationMs ?? 0, durationMs);
    this.recentHandlerDurationsMs.push(durationMs);
    if (this.recentHandlerDurationsMs.length > 100) {
      this.recentHandlerDurationsMs.splice(0, this.recentHandlerDurationsMs.length - 100);
    }
    if (durationMs > 300) this.slowHandlerCount300Ms += 1;
    if (durationMs > 1_000) this.slowHandlerCount1000Ms += 1;

    const logLine = {
      msg: "Veydrift chain event handled",
      source,
      eventTopic: log.topics[0] ?? null,
      contractAddress: (log as RpcLog & { address?: string }).address ?? null,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: logIndexFor(log),
      removed: Boolean((log as RpcLog & { removed?: boolean }).removed),
      receivedAt: new Date().toISOString(),
      durationMs,
      applyResult: result
        ? {
          applied: result.applied,
          duplicate: result.duplicate,
          ignored: result.ignored,
          removed: result.removed
        }
        : null,
      sideEffects: {
        targetedCanonicalHealPlanetIds: canonicalHealPlanetIdsForLog(log)
      }
    };
    const serialized = JSON.stringify(logLine);
    if (durationMs > 1_000) {
      console.warn(serialized);
    } else if (durationMs > 300) {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  private recentHandlerDurationSummary(): ChainSyncSnapshot["recentHandlerDurationMs"] {
    if (this.recentHandlerDurationsMs.length === 0) {
      return { count: 0, max: null, p50: null, p95: null };
    }
    const sorted = [...this.recentHandlerDurationsMs].sort((left, right) => left - right);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.at(-1) ?? null
    };
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

  private subscribedAddresses(): `0x${string}`[] {
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

function maxBigInt(current: bigint | null, next: bigint): bigint {
  if (current === null) return next;
  return next > current ? next : current;
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

function percentile(sortedValues: readonly number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)
  );
  return sortedValues[index] ?? null;
}
