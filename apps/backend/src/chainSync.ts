import type { BackendConfig } from "./config";
import {
  decodeDebrisFieldLog,
  decodeMoonChanceReportLog,
  decodeSettledPlanetLog,
  isDebrisFieldLog,
  isMoonChanceReportLog,
  isSettledPlanetLog,
  type RpcLog
} from "./evm";
import type { SettlementIndexer } from "./indexer";

type SocketLike = {
  close(): void;
  send(data: string): void;
  onclose: ((event: CloseEvent | Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
};

type WebSocketConstructor = new (url: string) => SocketLike;

type LogBackfiller = {
  listContractLogs(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]>;
};

type JsonRpcNotification = {
  method?: string;
  params?: {
    subscription?: string;
    result?: unknown;
  };
};

type JsonRpcResult = {
  id?: number;
  result?: unknown;
  error?: {
    message?: string;
  };
};

export type ChainSyncSnapshot = {
  connected: boolean;
  detectedGaps: number;
  eventsReceived: number;
  lastGap: {
    fromBlock: string;
    toBlock: string;
  } | null;
  lastGapDetectedAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  lastSelfHealAt: string | null;
  latestWebsocketBlock: string | null;
  latestSyncedBlock: string | null;
  reconnectAttempts: number;
  reorgDetectedAt: string | null;
  selfHealRecoveredEvents: number;
  subscribedAddresses: string[];
  subscribedToHeads: boolean;
  subscribedToLogs: boolean;
  wsEnabled: boolean;
};

export type ChainSyncEvent = {
  blockNumber: string | null;
  kind: "chain-event" | "sync-status";
  transactionHash?: string;
};

type ChainSyncListener = (event: ChainSyncEvent) => void;

export class ChainSyncService {
  private connected = false;
  private detectedGaps = 0;
  private eventsReceived = 0;
  private blockTimestamps = new Map<string, string>();
  private lastGap: { fromBlock: string; toBlock: string } | null = null;
  private lastGapDetectedAt: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
  private latestWebsocketBlock: string | null = null;
  private latestSyncedBlock: string | null = null;
  private listeners = new Set<ChainSyncListener>();
  private nextRequestId = 1;
  private reconnectAttempts = 0;
  private reorgDetectedAt: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private requestKinds = new Map<number, "logs" | "newHeads">();
  private socket: SocketLike | null = null;
  private stopped = true;
  private subscriptionKinds = new Map<string, "logs" | "newHeads">();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastActivityAt = 0;
  private lastFullReconcileAt = 0;
  private pendingReconcileReason: string | null = null;
  private throttledReconcileTimer: ReturnType<typeof setTimeout> | undefined;
  private backfillInProgress = false;
  private selfHealTimer: ReturnType<typeof setInterval> | undefined;
  private lastSelfHealAt: string | null = null;
  private selfHealRecoveredEvents = 0;

  constructor(
    private readonly config: BackendConfig,
    private readonly indexer: Pick<SettlementIndexer, "applyDebrisEvent" | "applyEvent" | "applyMoonChanceEvent"> & Partial<Pick<SettlementIndexer, "applyLog" | "markStale" | "rebuild" | "reconcile">> | undefined,
    private readonly options: {
      reconnectBaseMs?: number;
      WebSocketCtor?: WebSocketConstructor;
      logBackfiller?: LogBackfiller;
      heartbeatIntervalMs?: number;
      heartbeatTimeoutMs?: number;
      reconcileThrottleMs?: number;
      selfHealIntervalMs?: number;
      selfHealDepthBlocks?: number;
    } = {}
  ) {}

  private heartbeatIntervalMs(): number {
    return this.options.heartbeatIntervalMs ?? 25_000;
  }

  private heartbeatTimeoutMs(): number {
    return this.options.heartbeatTimeoutMs ?? Math.max(this.heartbeatIntervalMs() * 2, 60_000);
  }

  private reconcileThrottleMs(): number {
    return this.options.reconcileThrottleMs ?? 30_000;
  }

  private selfHealIntervalMs(): number {
    return this.options.selfHealIntervalMs ?? 60_000;
  }

  private selfHealDepthBlocks(): bigint {
    const configured = this.options.selfHealDepthBlocks;
    if (configured === undefined || !Number.isFinite(configured) || configured <= 0) {
      return 256n;
    }
    return BigInt(Math.floor(configured));
  }

  snapshot(): ChainSyncSnapshot {
    return {
      connected: this.connected,
      detectedGaps: this.detectedGaps,
      eventsReceived: this.eventsReceived,
      lastGap: this.lastGap,
      lastGapDetectedAt: this.lastGapDetectedAt,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      lastSelfHealAt: this.lastSelfHealAt,
      latestWebsocketBlock: this.latestWebsocketBlock,
      latestSyncedBlock: this.latestSyncedBlock,
      reconnectAttempts: this.reconnectAttempts,
      reorgDetectedAt: this.reorgDetectedAt,
      selfHealRecoveredEvents: this.selfHealRecoveredEvents,
      subscribedAddresses: this.subscribedAddresses(),
      subscribedToHeads: [...this.subscriptionKinds.values()].includes("newHeads"),
      subscribedToLogs: [...this.subscriptionKinds.values()].includes("logs"),
      wsEnabled: Boolean(this.config.wsRpcUrl)
    };
  }

  start(): void {
    if (!this.config.wsRpcUrl || !this.config.gameContractAddress || this.socket) {
      return;
    }

    this.stopped = false;
    const WebSocketCtor = (this.options.WebSocketCtor ?? globalThis.WebSocket) as WebSocketConstructor | undefined;
    if (!WebSocketCtor) {
      this.lastError = "WebSocket is not available in this runtime.";
      return;
    }

    const socket = new WebSocketCtor(this.config.wsRpcUrl);
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => {
      this.lastError = "WebSocket RPC connection error.";
    };
    socket.onclose = () => this.handleClose();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.throttledReconcileTimer) {
      clearTimeout(this.throttledReconcileTimer);
      this.throttledReconcileTimer = undefined;
    }
    this.pendingReconcileReason = null;
    this.stopHeartbeat();
    this.stopSelfHeal();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
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
          controller.enqueue(encode(event.kind, event.kind === "sync-status" ? this.snapshot() : event));
        });
      },
      cancel: () => {
        removeListener?.();
      }
    });
  }

  private handleOpen(): void {
    const reconnectingAfterProgress = this.latestWebsocketBlock !== null;
    this.connected = true;
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.subscriptionKinds.clear();
    this.lastActivityAt = Date.now();
    this.startHeartbeat();
    this.startSelfHeal();
    this.subscribe("logs");
    this.subscribe("newHeads");
    if (reconnectingAfterProgress) {
      // Recover only the blocks missed while disconnected, not the entire index.
      this.recoverGap(this.nextBlockAfterSynced(), "latest", "websocket reconnected");
    }
    this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
  }

  private handleClose(): void {
    this.connected = false;
    this.socket = null;
    this.subscriptionKinds.clear();
    this.requestKinds.clear();
    this.stopHeartbeat();
    this.stopSelfHeal();
    if (!this.stopped) {
      this.scheduleReconnect();
    }
    this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
  }

  private scheduleReconnect(): void {
    if (!this.config.wsRpcUrl || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;
    const base = this.options.reconnectBaseMs ?? 1_000;
    const delay = Math.min(base * 2 ** Math.min(this.reconnectAttempts - 1, 6), 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start();
    }, delay);
  }

  private subscribe(kind: "logs" | "newHeads"): void {
    const id = this.nextRequestId++;
    this.requestKinds.set(id, kind);
    if (kind === "logs") {
      const addresses = [
        this.config.gameContractAddress,
        this.config.moonContractAddress,
        this.config.allianceContractAddress,
        this.config.resourceTokenAddresses.metal,
        this.config.resourceTokenAddresses.crystal,
        this.config.resourceTokenAddresses.deuterium
      ].filter((address): address is `0x${string}` => Boolean(address));
      this.socket?.send(JSON.stringify({
        id,
        jsonrpc: "2.0",
        method: "eth_subscribe",
        params: [
          "logs",
          {
            address: addresses.length === 1 ? addresses[0] : addresses
          }
        ]
      }));
      return;
    }

    this.socket?.send(JSON.stringify({
      id,
      jsonrpc: "2.0",
      method: "eth_subscribe",
      params: ["newHeads"]
    }));
  }

  private handleMessage(data: unknown): void {
    this.lastActivityAt = Date.now();
    let message: JsonRpcNotification & JsonRpcResult;
    try {
      message = JSON.parse(String(data)) as JsonRpcNotification & JsonRpcResult;
    } catch {
      this.lastError = "WebSocket RPC sent invalid JSON.";
      return;
    }

    if (message.error) {
      this.lastError = message.error.message ?? "WebSocket RPC error.";
      return;
    }

    if (typeof message.id === "number" && typeof message.result === "string") {
      const kind = this.requestKinds.get(message.id);
      if (kind) {
        this.subscriptionKinds.set(message.result, kind);
        this.requestKinds.delete(message.id);
        this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
      }
      return;
    }

    if (message.method !== "eth_subscription" || !message.params?.subscription) {
      return;
    }

    const kind = this.subscriptionKinds.get(message.params.subscription);
    if (kind === "newHeads") {
      this.handleHead(message.params.result);
      return;
    }

    if (kind === "logs") {
      this.handleLog(message.params.result);
    }
  }

  private handleHead(result: unknown): void {
    if (!isRecord(result) || typeof result.number !== "string") {
      return;
    }
    const block = BigInt(result.number);
    if (typeof result.timestamp === "string") {
      this.blockTimestamps.set(block.toString(), BigInt(result.timestamp).toString());
      this.pruneBlockTimestamps(block);
    }
    const previous = this.latestWebsocketBlock ? BigInt(this.latestWebsocketBlock) : null;
    this.latestWebsocketBlock = block.toString();
    this.latestSyncedBlock = block.toString();
    if (previous !== null && block > previous + 1n) {
      this.recordGap((previous + 1n).toString(), block.toString());
      this.recoverGap(previous + 1n, block, `websocket head gap ${previous + 1n}-${block}`);
    }
    this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
  }

  private handleLog(result: unknown): void {
    if (!isRpcLog(result)) {
      return;
    }

    this.eventsReceived += 1;
    this.lastEventAt = new Date().toISOString();
    const block = BigInt(result.blockNumber);
    this.latestWebsocketBlock = maxBlockString(this.latestWebsocketBlock, block);
    this.latestSyncedBlock = block.toString();

    const removed = "removed" in result && result.removed === true;
    if (removed) {
      this.reorgDetectedAt = new Date().toISOString();
    }

    if (this.indexer?.applyLog) {
      try {
        const blockTimestamp = this.logBlockTimestamp(result, block);
        const applied = this.indexer.applyLog(blockTimestamp ? { ...result, blockTimestamp } : result);
        if (applied.removed) {
          this.requestReconciliation("removed log/reorg");
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Failed to index contract log.";
        this.indexer?.markStale?.("websocket log decode/apply failure");
        this.requestReconciliation("websocket log decode/apply failure");
      }
    } else if (isSettledPlanetLog(result)) {
      try {
        this.indexer?.applyEvent(decodeSettledPlanetLog(result));
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Failed to index settlement log.";
      }
    } else if (isDebrisFieldLog(result)) {
      try {
        this.indexer?.applyDebrisEvent(decodeDebrisFieldLog(result));
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Failed to index debris field log.";
      }
    } else if (isMoonChanceReportLog(result)) {
      try {
        this.indexer?.applyMoonChanceEvent(decodeMoonChanceReportLog(result));
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Failed to index moon chance log.";
      }
    }

    this.notify({
      kind: "chain-event",
      blockNumber: this.latestSyncedBlock,
      transactionHash: result.transactionHash
    });
  }

  private logBlockTimestamp(result: RpcLog & { blockTimestamp?: unknown }, block: bigint): string | undefined {
    const directTimestamp = isRecord(result) && typeof result.blockTimestamp === "string"
      ? result.blockTimestamp
      : undefined;
    if (directTimestamp) {
      try {
        return BigInt(directTimestamp).toString();
      } catch {
        return undefined;
      }
    }

    return this.blockTimestamps.get(block.toString());
  }

  private pruneBlockTimestamps(latestBlock: bigint): void {
    const minBlock = latestBlock > 256n ? latestBlock - 256n : 0n;
    for (const block of this.blockTimestamps.keys()) {
      if (BigInt(block) < minBlock) this.blockTimestamps.delete(block);
    }
  }

  private notify(event: ChainSyncEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private recordGap(fromBlock: string, toBlock: string): void {
    this.detectedGaps += 1;
    this.lastGap = { fromBlock, toBlock };
    this.lastGapDetectedAt = new Date().toISOString();
  }

  private nextBlockAfterSynced(): bigint | null {
    const anchor = this.latestSyncedBlock ?? this.latestWebsocketBlock;
    if (anchor === null) return null;
    try {
      return BigInt(anchor) + 1n;
    } catch {
      return null;
    }
  }

  /**
   * Recover a missed block range incrementally: fetch only the gap's logs and apply
   * them through the indexer (idempotent). Falls back to a (throttled) full
   * reconciliation only when no incremental backfiller is wired or the backfill fails.
   */
  private recoverGap(fromBlock: bigint | null, toBlock: bigint | "latest", reason: string): void {
    if (this.options.logBackfiller && this.indexer?.applyLog && fromBlock !== null) {
      void this.backfillRange(this.options.logBackfiller, fromBlock, toBlock, reason);
      return;
    }
    this.requestReconciliation(reason);
  }

  private async backfillRange(
    backfiller: LogBackfiller,
    fromBlock: bigint,
    toBlock: bigint | "latest",
    reason: string,
    options: { selfHeal?: boolean } = {}
  ): Promise<void> {
    const applyLog = this.indexer?.applyLog;
    if (!applyLog) {
      this.requestReconciliation(reason);
      return;
    }
    if (this.backfillInProgress) {
      return;
    }
    this.backfillInProgress = true;
    try {
      const logs = await backfiller.listContractLogs(fromBlock, toBlock);
      let needsReconcile = false;
      let recovered = 0;
      let lastRecoveredHash: string | undefined;
      for (const log of logs) {
        if (!isRpcLog(log)) continue;
        const block = BigInt(log.blockNumber);
        this.latestWebsocketBlock = maxBlockString(this.latestWebsocketBlock, block);
        this.latestSyncedBlock = maxBlockString(this.latestSyncedBlock, block);
        try {
          const blockTimestamp = this.logBlockTimestamp(log, block);
          const applied = applyLog.call(this.indexer, blockTimestamp ? { ...log, blockTimestamp } : log);
          if (applied.applied) {
            this.eventsReceived += 1;
            this.lastEventAt = new Date().toISOString();
            recovered += 1;
            lastRecoveredHash = log.transactionHash;
          }
          if (applied.removed) {
            this.reorgDetectedAt = new Date().toISOString();
            needsReconcile = true;
          }
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : "Failed to index backfilled log.";
          needsReconcile = true;
        }
      }
      if (options.selfHeal) {
        this.lastSelfHealAt = new Date().toISOString();
        this.selfHealRecoveredEvents += recovered;
      }
      if (needsReconcile) {
        this.requestReconciliation("reorg/decode failure during backfill");
      }
      if (recovered > 0) {
        // A previously-dropped log was re-applied. Emit a chain-event so the read cache
        // invalidates and SSE subscribers refresh, otherwise the healed mission/resource
        // state would stay invisible until the next live event.
        this.notify({
          kind: "chain-event",
          blockNumber: this.latestSyncedBlock,
          ...(lastRecoveredHash ? { transactionHash: lastRecoveredHash } : {})
        });
      }
      this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Failed to backfill chain logs.";
      this.requestReconciliation(reason);
    } finally {
      this.backfillInProgress = false;
    }
  }

  private requestReconciliation(reason: string): void {
    const reconcile = this.indexer?.reconcile ?? this.indexer?.rebuild;
    if (!reconcile) return;

    const throttleMs = this.reconcileThrottleMs();
    const sinceLast = Date.now() - this.lastFullReconcileAt;
    if (this.lastFullReconcileAt !== 0 && sinceLast < throttleMs) {
      // A full reconcile ran recently; collapse this request into a single trailing
      // pass so a flapping websocket cannot trigger a rebuild storm.
      this.pendingReconcileReason = reason;
      if (!this.throttledReconcileTimer) {
        this.throttledReconcileTimer = setTimeout(() => {
          this.throttledReconcileTimer = undefined;
          const pending = this.pendingReconcileReason;
          this.pendingReconcileReason = null;
          if (pending && !this.stopped) {
            this.runReconciliation(pending);
          }
        }, throttleMs - sinceLast);
      }
      return;
    }

    this.runReconciliation(reason);
  }

  private runReconciliation(reason: string): void {
    const reconcile = this.indexer?.reconcile ?? this.indexer?.rebuild;
    if (!reconcile) return;
    this.lastFullReconcileAt = Date.now();
    this.indexer?.markStale?.(reason);
    void reconcile.call(this.indexer, reason).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : "Failed to reconcile indexed state.";
    });
  }

  /**
   * Periodically re-scan a recent block range and replay its logs through the indexer
   * (idempotent). This self-heals live events that an RPC provider silently dropped from
   * the `logs` subscription while the socket stayed connected and `newHeads` kept flowing —
   * a case neither head-gap recovery, reconnect backfill, nor the heartbeat can detect,
   * since there is no block gap and the connection looks healthy.
   */
  private startSelfHeal(): void {
    this.stopSelfHeal();
    const interval = this.selfHealIntervalMs();
    if (interval <= 0) return;
    if (!this.options.logBackfiller || !this.indexer?.applyLog) return;
    this.selfHealTimer = setInterval(() => this.selfHealTick(), interval);
  }

  private stopSelfHeal(): void {
    if (this.selfHealTimer) {
      clearInterval(this.selfHealTimer);
      this.selfHealTimer = undefined;
    }
  }

  private selfHealTick(): void {
    if (this.stopped || !this.connected) return;
    const backfiller = this.options.logBackfiller;
    if (!backfiller || !this.indexer?.applyLog) return;
    // A reconnect/gap backfill is already covering recent blocks; skip this pass.
    if (this.backfillInProgress) return;

    const anchor = this.latestSyncedBlock ?? this.latestWebsocketBlock;
    if (anchor === null) return;
    let latest: bigint;
    try {
      latest = BigInt(anchor);
    } catch {
      return;
    }

    const depth = this.selfHealDepthBlocks();
    let fromBlock = latest > depth ? latest - depth + 1n : 0n;
    const floor = this.config.indexFromBlock;
    if (fromBlock < floor) fromBlock = floor;
    if (fromBlock > latest) return;

    void this.backfillRange(backfiller, fromBlock, "latest", "periodic self-heal", { selfHeal: true });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.heartbeatIntervalMs();
    if (interval <= 0) return;
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private heartbeatTick(): void {
    if (!this.socket || !this.connected) return;
    const idle = Date.now() - this.lastActivityAt;
    if (idle > this.heartbeatTimeoutMs()) {
      // The socket looks alive but has gone silent past the timeout; force a reconnect
      // so dropped subscriptions are re-established instead of silently missing events.
      this.lastError = "WebSocket heartbeat timeout; forcing reconnect.";
      this.stopHeartbeat();
      this.socket.close();
      return;
    }
    if (idle >= this.heartbeatIntervalMs()) {
      // Quiet but within timeout: send a cheap liveness probe to keep the connection
      // warm and elicit traffic. Healthy newHeads traffic keeps this from ever firing.
      const id = this.nextRequestId++;
      this.socket.send(JSON.stringify({ id, jsonrpc: "2.0", method: "eth_blockNumber", params: [] }));
    }
  }

  private subscribedAddresses(): string[] {
    return [
      this.config.gameContractAddress,
      this.config.moonContractAddress,
      this.config.allianceContractAddress,
      this.config.resourceTokenAddresses.metal,
      this.config.resourceTokenAddresses.crystal,
      this.config.resourceTokenAddresses.deuterium
    ].filter((address): address is `0x${string}` => Boolean(address));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRpcLog(value: unknown): value is RpcLog {
  return isRecord(value)
    && typeof value.blockNumber === "string"
    && typeof value.transactionHash === "string"
    && Array.isArray(value.topics)
    && value.topics.every((topic) => typeof topic === "string")
    && typeof value.data === "string";
}

function maxBlockString(current: string | null, next: bigint): string {
  if (current === null) return next.toString();
  const currentBlock = BigInt(current);
  return next > currentBlock ? next.toString() : current;
}
