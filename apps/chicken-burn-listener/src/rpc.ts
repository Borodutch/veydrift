export type JsonRpcTransport = {
  request<T>(method: string, params: unknown[]): Promise<T>;
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
};

export class JsonRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly data: unknown
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export class HttpJsonRpcTransport implements JsonRpcTransport {
  private nextId = 1;

  constructor(private readonly rpcUrl: string) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params })
    });
    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }
    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new JsonRpcError(body.error.message ?? "RPC error", body.error.code, body.error.data);
    }
    return body.result as T;
  }
}
