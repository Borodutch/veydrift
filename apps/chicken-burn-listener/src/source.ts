import type { AbiEvent } from "viem";

import {
  burnEventTopic,
  decodeChickenBurnLog,
  transferBurnTopic,
  type ChickenBurnEvent,
  type RawLog
} from "./events";
import type { ChickenBurnProcessor, ListenerLogger } from "./processor";
import type { JsonRpcTransport } from "./rpc";
import type { JsonStateStore } from "./store";

type SocketLike = {
  close(): void;
  send(data: string): void;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: ((event: unknown) => void) | null;
};

type WebSocketConstructor = new (url: string) => SocketLike;

export type SourceSnapshot = {
  connected: boolean;
  reconnectAttempts: number;
  eventsReceived: number;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  lastBackfillAt: string | null;
};

export class ChickenBurnSource {
  private socket: SocketLike | null = null;
  private stopped = true;
  private connected = false;
  private reconnectAttempts = 0;
  private eventsReceived = 0;
  private lastConnectedAt: string | null = null;
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private lastBackfillAt: string | null = null;
  private nextRequestId = 1;
  private logsSubscriptionRequestId: number | null = null;
  private logsSubscriptionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly topics: `0x${string}`[];

  constructor(
    private readonly http: JsonRpcTransport,
    private readonly wsRpcUrl: string,
    private readonly chickenContractAddress: `0x${string}`,
    private readonly burnEvent: AbiEvent,
    private readonly store: JsonStateStore,
    private readonly processor: ChickenBurnProcessor,
    private readonly options: {
      startBlock: bigint;
      backfillBlocks: bigint;
      maxRangeBlocks: bigint;
      enableTransferBurnFallback?: boolean;
      WebSocketCtor?: WebSocketConstructor;
      logger?: ListenerLogger;
    }
  ) {
    this.topics = options.enableTransferBurnFallback
      ? [burnEventTopic(burnEvent), transferBurnTopic()]
      : [burnEventTopic(burnEvent)];
  }

  snapshot(): SourceSnapshot {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      eventsReceived: this.eventsReceived,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      lastBackfillAt: this.lastBackfillAt
    };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore close failures
      }
      this.socket = null;
    }
    this.connected = false;
  }

  async backfill(lookbackOverride?: bigint): Promise<void> {
    const latest = BigInt(await this.http.request<string>("eth_blockNumber", []));
    const stored = this.store.lastScannedBlock();
    const lookback = lookbackOverride ?? this.options.backfillBlocks;
    const lookbackStart = latest > lookback ? latest - lookback : 0n;
    const fromBlock = maxBigInt(this.options.startBlock, stored === 0n ? lookbackStart : stored + 1n);
    if (fromBlock > latest) {
      return;
    }

    for (let start = fromBlock; start <= latest; start += this.options.maxRangeBlocks + 1n) {
      const end = start + this.options.maxRangeBlocks > latest ? latest : start + this.options.maxRangeBlocks;
      const logs = await this.http.request<RawLog[]>("eth_getLogs", [
        {
          address: this.chickenContractAddress,
          fromBlock: toHex(start),
          toBlock: toHex(end),
          topics: [this.topics]
        }
      ]);
      for (const log of logs) {
        await this.handleRawLog(log);
      }
      await this.store.setLastScannedBlock(end);
    }
    this.lastBackfillAt = new Date().toISOString();
  }

  private connect(): void {
    const WebSocketCtor = (this.options.WebSocketCtor ?? globalThis.WebSocket) as
      | WebSocketConstructor
      | undefined;
    if (!WebSocketCtor) {
      this.lastError = "WebSocket is not available in this runtime.";
      return;
    }

    let socket: SocketLike;
    try {
      socket = new WebSocketCtor(this.wsRpcUrl);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => void this.handleMessage(event.data);
    socket.onerror = () => {
      this.lastError = "WebSocket connection error.";
    };
    socket.onclose = () => this.handleClose();
  }

  private handleOpen(): void {
    this.connected = true;
    this.reconnectAttempts = 0;
    this.lastConnectedAt = new Date().toISOString();
    const id = this.nextRequestId++;
    this.logsSubscriptionRequestId = id;
    this.socket?.send(
      JSON.stringify({
        id,
        jsonrpc: "2.0",
        method: "eth_subscribe",
        params: [
          "logs",
          {
            address: this.chickenContractAddress,
            topics: [this.topics]
          }
        ]
      })
    );
    this.options.logger?.info("[chicken-burn] websocket connected");
  }

  private handleClose(): void {
    this.connected = false;
    this.socket = null;
    this.logsSubscriptionId = null;
    this.logsSubscriptionRequestId = null;
    if (!this.stopped) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(1_000 * 2 ** Math.min(this.reconnectAttempts - 1, 6), 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private async handleMessage(data: unknown): Promise<void> {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: { subscription?: string; result?: unknown };
    };
    try {
      message = JSON.parse(String(data));
    } catch {
      this.lastError = "WebSocket sent invalid JSON.";
      return;
    }
    if (message.error) {
      this.lastError = message.error.message ?? "WebSocket RPC error.";
      return;
    }
    if (
      typeof message.id === "number" &&
      message.id === this.logsSubscriptionRequestId &&
      typeof message.result === "string"
    ) {
      this.logsSubscriptionId = message.result;
      return;
    }
    if (message.method !== "eth_subscription" || !message.params) return;
    if (this.logsSubscriptionId && message.params.subscription !== this.logsSubscriptionId) return;
    if (isRawLog(message.params.result)) {
      await this.handleRawLog(message.params.result);
    }
  }

  private async handleRawLog(log: RawLog): Promise<void> {
    let event = decodeChickenBurnLog(log, this.burnEvent);
    if (
      !event &&
      this.options.enableTransferBurnFallback &&
      log.topics[0] === transferBurnTopic()
    ) {
      const tx = await this.http.request<{ input?: `0x${string}` } | null>("eth_getTransactionByHash", [
        log.transactionHash
      ]);
      event = decodeChickenBurnLog(log, this.burnEvent, tx?.input);
    }
    if (!event) return;
    await this.processor.processBurn(event);
    this.eventsReceived += 1;
    this.lastEventAt = new Date().toISOString();
  }
}

function isRawLog(value: unknown): value is RawLog {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { topics?: unknown }).topics) &&
    typeof (value as { data?: unknown }).data === "string" &&
    typeof (value as { transactionHash?: unknown }).transactionHash === "string"
  );
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}
