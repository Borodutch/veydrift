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
  eventsReceived: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  latestSyncedBlock: string | null;
  reconnectAttempts: number;
  reorgDetectedAt: string | null;
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
  private eventsReceived = 0;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
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

  constructor(
    private readonly config: BackendConfig,
    private readonly indexer: Pick<SettlementIndexer, "applyDebrisEvent" | "applyEvent" | "applyMoonChanceEvent"> & Partial<Pick<SettlementIndexer, "applyLog" | "rebuildPlanets">> | undefined,
    private readonly options: {
      reconnectBaseMs?: number;
      WebSocketCtor?: WebSocketConstructor;
    } = {}
  ) {}

  snapshot(): ChainSyncSnapshot {
    return {
      connected: this.connected,
      eventsReceived: this.eventsReceived,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      latestSyncedBlock: this.latestSyncedBlock,
      reconnectAttempts: this.reconnectAttempts,
      reorgDetectedAt: this.reorgDetectedAt,
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
    this.connected = true;
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.subscriptionKinds.clear();
    this.subscribe("logs");
    this.subscribe("newHeads");
    this.notify({ kind: "sync-status", blockNumber: this.latestSyncedBlock });
  }

  private handleClose(): void {
    this.connected = false;
    this.socket = null;
    this.subscriptionKinds.clear();
    this.requestKinds.clear();
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
    this.latestSyncedBlock = BigInt(result.number).toString();
  }

  private handleLog(result: unknown): void {
    if (!isRpcLog(result)) {
      return;
    }

    this.eventsReceived += 1;
    this.lastEventAt = new Date().toISOString();
    this.latestSyncedBlock = BigInt(result.blockNumber).toString();

    const removed = "removed" in result && result.removed === true;
    if (removed) {
      this.reorgDetectedAt = new Date().toISOString();
    }

    if (this.indexer?.applyLog) {
      try {
        this.indexer.applyLog(result);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Failed to index contract log.";
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

    if (removed && this.indexer?.rebuildPlanets) {
      void this.indexer.rebuildPlanets().catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Failed to reconcile indexed planet state after removed log.";
      });
    } else if (!removed && this.indexer?.rebuildPlanets) {
      void this.indexer.rebuildPlanets().catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Failed to refresh indexed planet state.";
      });
    }

    this.notify({
      kind: "chain-event",
      blockNumber: this.latestSyncedBlock,
      transactionHash: result.transactionHash
    });
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
