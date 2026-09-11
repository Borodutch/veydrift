type ObservabilityLevel = "info" | "warn" | "error";

type BaseObservabilityEvent = {
  kind: string;
  component?: string;
  durationMs?: number;
  workerRole?: string;
  workerIndex?: string | null;
};

export type ApiRequestObservabilityEvent = {
  kind: "api_request";
  durationMs: number;
  requestBodyBytes: number | null;
  responseBodyBytes: number | null;
  responseBodyComplete: boolean;
  error?: string;
  method: string;
  path: string;
  queryKeys: string[];
  route: string;
  status: number;
  stream: boolean;
  workerRole: string;
};

export function emitObservabilityEvent(
  event: BaseObservabilityEvent & Record<string, unknown>,
  level: ObservabilityLevel = "info"
): void {
  const line = JSON.stringify({
    schemaVersion: 1,
    service: process.env.VEYDRIFT_SERVICE_NAME ?? "veydrift",
    emittedAt: new Date().toISOString(),
    pid: typeof process !== "undefined" ? process.pid : null,
    workerIndex: process.env.VEYDRIFT_WORKER_INDEX ?? null,
    ...event
  });
  console[level](line);
}

export function apiRequestEvent(
  request: Request,
  url: URL,
  workerRole: string,
  status: number,
  durationMs: number,
  error?: string
): ApiRequestObservabilityEvent {
  const entry: ApiRequestObservabilityEvent = {
    kind: "api_request",
    durationMs: Math.round(durationMs),
    // Declared payload length, not headers or wire/compression overhead. Never
    // consume a request just for logging; chunked/unknown lengths stay null.
    requestBodyBytes: request.body === null ? 0 : contentLength(request.headers),
    responseBodyBytes: null,
    responseBodyComplete: false,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    queryKeys: [...url.searchParams.keys()].sort(),
    route: normalizedRoute(url.pathname),
    status,
    stream: url.pathname === "/chain/events",
    workerRole
  };
  if (error) entry.error = error;
  return entry;
}

function logApiRequestEvent(entry: ApiRequestObservabilityEvent): void {
  const level: ObservabilityLevel = entry.status >= 500 || entry.durationMs >= 1_000 ? "warn" : "info";
  emitObservabilityEvent(entry, level);
}

function contentLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export function createRequestLoggingFetch(
  handler: (request: Request) => Promise<Response>,
  workerRole: string
): (request: Request) => Promise<Response> {
  return async (request) => {
    const startedAt = performance.now();
    const entry = apiRequestEvent(request, new URL(request.url), workerRole, 500, 0);
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      entry.durationMs = Math.round(performance.now() - startedAt);
      entry.error = error instanceof Error ? error.message : String(error);
      logApiRequestEvent(entry);
      throw error;
    }
    // Keep handler latency comparable to existing logs, independent of client
    // download speed. Count emitted payload bytes without cloning/buffering.
    entry.durationMs = Math.round(performance.now() - startedAt);
    entry.status = response.status;
    entry.stream ||= response.headers.get("content-type")?.startsWith("text/event-stream") ?? false;
    if (entry.stream || response.body === null || request.method === "HEAD") {
      entry.responseBodyBytes = entry.stream ? null : 0;
      entry.responseBodyComplete = !entry.stream;
      logApiRequestEvent(entry);
      return response;
    }
    const reader = response.body.getReader();
    let bytes = 0;
    let logged = false;
    const finish = (complete: boolean) => {
      if (logged) return;
      logged = true;
      entry.responseBodyBytes = bytes;
      entry.responseBodyComplete = complete;
      logApiRequestEvent(entry);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish(true);
            reader.releaseLock();
            controller.close();
          } else {
            bytes += value.byteLength;
            controller.enqueue(value);
          }
        } catch (error) {
          finish(false);
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        finish(false);
        try { await reader.cancel(reason); } finally { reader.releaseLock(); }
      }
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

export function normalizedRoute(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const normalized = parts.map((part, index) => {
    const previous = parts[index - 1] ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(part)) return ":wallet";
    if (/^0x[a-fA-F0-9]{64}$/.test(part)) return ":hash";
    if (/^\d+$/.test(part)) {
      if (previous === "mission") return ":missionId";
      if (previous === "planet" || previous === "planets") return ":planetId";
      return ":id";
    }
    return part;
  });
  return `/${normalized.join("/")}`;
}
