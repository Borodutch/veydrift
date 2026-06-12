/**
 * Minimal HTTP JSON-RPC transport. The keeper is self-contained, so rather than depend on the
 * backend package we ship a small, retrying transport that surfaces RPC `error` payloads as thrown
 * `RpcError`s (so a contract revert from `eth_call`/`eth_sendRawTransaction` is catchable).
 */

export type JsonRpcTransport = {
  request<T>(method: string, params: unknown[]): Promise<T>;
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

  constructor(
    private readonly rpcUrl: string,
    private readonly options: { maxAttempts?: number; requestTimeoutMs?: number } = {}
  ) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    const timeoutMs = this.options.requestTimeoutMs ?? 15_000;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(this.rpcUrl, {
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
          throw new Error(`RPC HTTP ${response.status}`);
        }

        const body = (await response.json()) as JsonRpcResponse<T>;
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
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
