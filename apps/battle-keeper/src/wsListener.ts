import { decodeBattleLog, subscribedTopic0, type RawLog } from "./events";
import type { BattleKeeper } from "./keeper";
import type { KeeperLogger } from "./keeper";

type SocketLike = {
  close(): void;
  send(data: string): void;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: ((event: unknown) => void) | null;
};

type WebSocketConstructor = new (url: string) => SocketLike;

export type WsListenerSnapshot = {
  connected: boolean;
  reconnectAttempts: number;
  eventsReceived: number;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
};

export type WsListenerOptions = {
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  WebSocketCtor?: WebSocketConstructor;
  logger?: KeeperLogger;
};

/**
 * Subscribes to the game contract's battle events over a WebSocket JSON-RPC connection and forwards
 * them to the {@link BattleKeeper}. Auto-reconnects with capped exponential backoff so a dropped
 * socket never wedges the keeper (the periodic safety sweep covers the gap until reconnect).
 */
export class WsBattleListener {
  private socket: SocketLike | null = null;
  private stopped = true;
  private connected = false;
  private reconnectAttempts = 0;
  private eventsReceived = 0;
  private lastConnectedAt: string | null = null;
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private nextRequestId = 1;
  private logsSubscriptionRequestId: number | null = null;
  private logsSubscriptionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly wsRpcUrl: string,
    private readonly gameContractAddress: `0x${string}`,
    private readonly keeper: BattleKeeper,
    private readonly options: WsListenerOptions = {}
  ) {}

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
        // ignore
      }
      this.socket = null;
    }
    this.connected = false;
  }

  snapshot(): WsListenerSnapshot {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      eventsReceived: this.eventsReceived,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError
    };
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
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => {
      this.lastError = "WebSocket connection error.";
    };
    socket.onclose = () => this.handleClose();
  }

  private handleOpen(): void {
    this.connected = true;
    this.reconnectAttempts = 0;
    this.lastConnectedAt = new Date().toISOString();
    this.subscribeToLogs();
    this.options.logger?.info("[ws] connected, subscribed to battle events");
  }

  private subscribeToLogs(): void {
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
            address: this.gameContractAddress,
            // topic[0] OR-filter: only the three battle events we act on.
            topics: [Array.from(subscribedTopic0)]
          }
        ]
      })
    );
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
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectAttempts += 1;
    const base = this.options.reconnectBaseMs ?? 1_000;
    const max = this.options.reconnectMaxMs ?? 30_000;
    const delay = Math.min(base * 2 ** Math.min(this.reconnectAttempts - 1, 6), max);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped) {
        this.connect();
      }
    }, delay);
  }

  private handleMessage(data: unknown): void {
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

    // Subscription confirmation: capture the subscription id.
    if (
      typeof message.id === "number" &&
      message.id === this.logsSubscriptionRequestId &&
      typeof message.result === "string"
    ) {
      this.logsSubscriptionId = message.result;
      return;
    }

    if (message.method !== "eth_subscription" || !message.params) {
      return;
    }
    if (this.logsSubscriptionId && message.params.subscription !== this.logsSubscriptionId) {
      return;
    }

    this.handleLog(message.params.result);
  }

  private handleLog(result: unknown): void {
    if (!isRawLog(result)) {
      return;
    }
    const decoded = decodeBattleLog(result);
    if (!decoded) {
      return;
    }
    this.eventsReceived += 1;
    this.lastEventAt = new Date().toISOString();
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
}

function isRawLog(value: unknown): value is RawLog {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { topics?: unknown }).topics) &&
    typeof (value as { data?: unknown }).data === "string"
  );
}
