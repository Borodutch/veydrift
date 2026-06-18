/**
 * Minimal HTTP JSON-RPC transport. The keeper is self-contained, so rather than depend on the
 * backend package we ship a small, retrying transport that surfaces RPC `error` payloads as thrown
 * `RpcError`s (so a contract revert from `eth_call`/`eth_sendRawTransaction` is catchable).
 */

export type JsonRpcTransport = {
  request<T>(method: string, params: unknown[]): Promise<T>;
};

export type RpcTransportSnapshot = {
  activeRpcUrl: string;
  failoverCount: number;
  lastFailoverReason: string | null;
  rpcUrls: string[];
};

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly data: unknown
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return retryableStatuses.has(status);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpJsonRpcTransport implements JsonRpcTransport {
  private nextId = 1;
  private readonly rpcUrls: string[];
  private activeRpcIndex = 0;
  private failoverCount = 0;
  private lastFailoverReason: string | null = null;

  constructor(
    rpcUrl: string | readonly string[],
    private readonly options: { maxAttempts?: number; requestTimeoutMs?: number } = {}
  ) {
    this.rpcUrls = (Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl]).filter((url) => url.trim().length > 0);
    if (this.rpcUrls.length === 0) {
      throw new Error("RPC URL is required.");
    }
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    const timeoutMs = this.options.requestTimeoutMs ?? 15_000;
    let lastError: unknown;

    endpointLoop: for (let endpointAttempt = 0; endpointAttempt < this.rpcUrls.length; endpointAttempt += 1) {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(this.activeRpcUrl(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
            signal: controller.signal
          });

          if (!response.ok) {
            if (isRetryableStatus(response.status) && attempt < maxAttempts - 1) {
              await delay(250 * 2 ** attempt);
              continue;
            }
            if (isRetryableStatus(response.status) && this.failoverRpc(`http_${response.status}`)) {
              await delay(250);
              continue endpointLoop;
            }
            throw new Error(`RPC HTTP ${response.status}`);
          }

          let body: JsonRpcResponse<T>;
          try {
            body = (await response.json()) as JsonRpcResponse<T>;
          } catch (error) {
            lastError = error;
            if (attempt < maxAttempts - 1) {
              await delay(250 * 2 ** attempt);
              continue;
            }
            if (this.failoverRpc("rpc_response_parse_error")) {
              await delay(250);
              continue endpointLoop;
            }
            throw error;
          }
          if (body.error) {
            // Contract reverts and "execution reverted" come back here — never retry, let the caller
            // decide (the keeper treats a resolve revert as "randomness not ready yet" and retries).
            throw new RpcError(body.error.message ?? "RPC error", body.error.code, body.error.data);
          }
          return body.result as T;
        } catch (error) {
          lastError = error;
          // Don't retry deterministic RPC errors (reverts); only transient transport failures.
          if (error instanceof RpcError) {
            throw error;
          }
          if (attempt < maxAttempts - 1) {
            await delay(250 * 2 ** attempt);
            continue;
          }
          if (this.failoverRpc("rpc_response_parse_error")) {
            await delay(250);
            continue endpointLoop;
          }
        } finally {
          clearTimeout(timer);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  snapshot(): RpcTransportSnapshot {
    return {
      activeRpcUrl: this.activeRpcUrl(),
      failoverCount: this.failoverCount,
      lastFailoverReason: this.lastFailoverReason,
      rpcUrls: [...this.rpcUrls]
    };
  }

  private failoverRpc(reason: string): boolean {
    if (this.rpcUrls.length <= 1) return false;
    this.activeRpcIndex = (this.activeRpcIndex + 1) % this.rpcUrls.length;
    this.failoverCount += 1;
    this.lastFailoverReason = reason;
    return true;
  }

  private activeRpcUrl(): string {
    return this.rpcUrls[this.activeRpcIndex] ?? this.rpcUrls[0]!;
  }
}
