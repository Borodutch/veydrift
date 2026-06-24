// Worker-pool topology for the multi-threaded Bun backend (VEY-KANEO-466).
//
// The backend runs as N = CPU worker processes. Reader workers bind the public
// port with SO_REUSEPORT (Bun.serve `reusePort`), so the kernel load-balances
// user-facing requests across readers. The writer binds only a private loopback
// listener so chain-sync ingestion cannot stall public reads.
//
// Exactly one worker (index 0) is the "writer": it owns the chain indexer
// ingestion, the cold-start rebuild, the bounded per-planet reconciles, mission
// resolution, and the randomness committer. Those last two submit on-chain
// transactions, so they MUST run exactly once — never once per worker. The
// remaining workers are "readers": they serve requests from the shared SQLite
// database opened in WAL mode, which lets many readers run concurrently with the
// single writer without blocking it.
//
// This module is intentionally side-effect free (no port binding, no spawning)
// so the topology decisions can be unit-tested in isolation.

export const WORKER_ROLE_ENV = "VEYDRIFT_WORKER_ROLE";
export const WORKER_INDEX_ENV = "VEYDRIFT_WORKER_INDEX";
export const WORKER_COUNT_ENV = "VEYDRIFT_WORKER_COUNT";
export const LEGACY_MAX_WORKER_COUNT_ENV = "VEYDRIFT_MAX_WORKER_COUNT";
export const WRITER_INTERNAL_PORT_ENV = "VEYDRIFT_WRITER_INTERNAL_PORT";
export const DEFAULT_MAX_WORKER_COUNT = 2;

export type WorkerRole = "writer" | "reader";

// Methods that never mutate state are served locally by a reader. Everything else is forwarded to the
// single writer so all DB writes — and the writer's in-memory indexer bookkeeping (e.g. the bounded
// fleet-mission reconcile queue drained after applyLog) — happen on exactly one process.
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITER_ONLY_READ_PATHS = new Set([
  // The live chain event stream is owned by the writer's chain-sync subscription.
  "/chain/events"
]);
const WRITER_PREFERRED_READ_PATHS = new Set<string>([
  // Public QA/debug needs the writer-owned chain-sync snapshot; reader workers have chainSync=null.
  "/debug/indexer"
]);
const WRITER_PREFERRED_READ_PREFIXES: string[] = [];
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

// Request headers that must not be copied verbatim when re-issuing a forwarded request: the body is
// re-encoded by fetch (content-length) and the connection is to the writer's loopback listener (host).
const STRIPPED_FORWARD_REQUEST_HEADERS = ["content-length", "host", "connection"];

export type WorkerAssignment =
  | { kind: "supervisor"; workerCount: number }
  | { kind: "worker"; role: WorkerRole; index: number };

// Resolve how many worker processes to run. `VEYDRIFT_WORKER_COUNT` is the
// explicit override (useful for tests, constrained containers, or pinning a
// single-process deployment). `VEYDRIFT_MAX_WORKER_COUNT` is retained as a
// legacy cap for deployed service configs that predate the explicit override.
// Without either, keep the pool bounded to a deliberate default so auto-sizing
// does not unexpectedly spawn one reader per host CPU. The result is always at
// least 1 so the backend can boot on a single-core host.
export function resolveWorkerCount(
  env: Record<string, string | undefined>,
  hardwareConcurrency: number
): number {
  const override = env[WORKER_COUNT_ENV];
  if (override !== undefined && override.trim() !== "") {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  const cpus = Number.isFinite(hardwareConcurrency) ? Math.floor(hardwareConcurrency) : 1;
  const legacyCap = parsePositiveIntegerEnv(env[LEGACY_MAX_WORKER_COUNT_ENV]);
  const maxWorkerCount = legacyCap ?? DEFAULT_MAX_WORKER_COUNT;
  return Math.max(1, Math.min(cpus, maxWorkerCount));
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
}

// The first worker is the single writer; every other worker is a reader.
export function roleForIndex(index: number): WorkerRole {
  return index === 0 ? "writer" : "reader";
}

// Decide what this process should do. A process spawned with `VEYDRIFT_WORKER_ROLE`
// set is a leaf worker that just binds the port; a process without it is the
// supervisor that spawns and watches the worker pool.
export function resolveWorkerAssignment(
  env: Record<string, string | undefined>,
  hardwareConcurrency: number
): WorkerAssignment {
  const role = env[WORKER_ROLE_ENV];
  if (role === "writer" || role === "reader") {
    const parsedIndex = Number.parseInt(env[WORKER_INDEX_ENV] ?? "0", 10);
    return { kind: "worker", role, index: Number.isFinite(parsedIndex) ? parsedIndex : 0 };
  }

  return { kind: "supervisor", workerCount: resolveWorkerCount(env, hardwareConcurrency) };
}

// Private loopback port the writer also listens on (in addition to the shared reusePort socket) so
// readers can forward writes to it deterministically. Defaults to mainPort + 1; override with
// VEYDRIFT_WRITER_INTERNAL_PORT if that collides with another service.
export function resolveWriterInternalPort(
  env: Record<string, string | undefined>,
  mainPort: number
): number {
  const override = env[WRITER_INTERNAL_PORT_ENV];
  if (override !== undefined && override.trim() !== "") {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }

  return mainPort + 1;
}

// Wrap a reader's request handler so it serves read-only traffic locally and forwards only writes plus
// writer-owned streams to the single writer's loopback listener at `writerOrigin`
// (e.g. "http://127.0.0.1:4001"). Keeping indexed GETs on readers preserves the 9-reader capacity for
// normal gameplay bursts while writer-only paths remain deterministic.
export function createForwardingFetch(
  localHandler: (request: Request) => Promise<Response>,
  writerOrigin: string,
  fetchImpl: typeof fetch = fetch,
  localBootstrapHandler?: (request: Request) => Response | Promise<Response> | undefined
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (READ_ONLY_METHODS.has(request.method) && !WRITER_ONLY_READ_PATHS.has(url.pathname)) {
      const bootstrapResponse = await localBootstrapHandler?.(request);
      if (bootstrapResponse) return bootstrapResponse;
      if (isWriterPreferredReadPath(request.method, url.pathname)) {
        return forwardToWriter(request, url, writerOrigin, fetchImpl);
      }
      return localHandler(request);
    }

    return forwardToWriter(request, url, writerOrigin, fetchImpl);
  };
}

function isWriterPreferredReadPath(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return WRITER_PREFERRED_READ_PATHS.has(pathname)
    || WRITER_PREFERRED_READ_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function forwardToWriter(
  request: Request,
  url: URL,
  writerOrigin: string,
  fetchImpl: typeof fetch
): Promise<Response> {
    const target = `${writerOrigin}${url.pathname}${url.search}`;
    const headers = new Headers(request.headers);
    for (const name of STRIPPED_FORWARD_REQUEST_HEADERS) {
      headers.delete(name);
    }
    const body = BODYLESS_METHODS.has(request.method)
      ? undefined
      : await request.arrayBuffer();

    const abortController = new AbortController();
    const abortForwardedRequest = () => {
      abortController.abort();
    };
    if (request.signal?.aborted) {
      abortForwardedRequest();
    } else {
      request.signal?.addEventListener("abort", abortForwardedRequest, { once: true });
    }
    let upstream: Response;
    try {
      upstream = await fetchImpl(target, {
        method: request.method,
        headers,
        redirect: "manual",
        signal: abortController.signal,
        ...(body && body.byteLength > 0 ? { body } : {})
      });
    } catch {
      request.signal?.removeEventListener("abort", abortForwardedRequest);
      return Response.json(
        {
          error: "writer_unavailable",
          message: "The write request could not be forwarded to the indexer/writer worker."
        },
        { status: 502, headers: { "access-control-allow-origin": "*" } }
      );
    }

    // Re-emit the writer's response (status, headers including CORS, body) to the original client.
    // Keep the body as a stream so long-lived SSE reads (/chain/events) flush immediately instead of
    // waiting for the writer response to finish.
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    return new Response(forwardedResponseBody(upstream.body, abortController, () => {
      request.signal?.removeEventListener("abort", abortForwardedRequest);
    }), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
}

export function createRequestLoggingFetch(
  fetchHandler: (request: Request) => Promise<Response>,
  workerRole: WorkerRole
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const url = new URL(request.url);
    try {
      const response = await fetchHandler(request);
      logBackendRequest(request, url, workerRole, response.status, performance.now() - startedAt);
      return response;
    } catch (error) {
      logBackendRequest(request, url, workerRole, 500, performance.now() - startedAt, error);
      throw error;
    }
  };
}

function logBackendRequest(
  request: Request,
  url: URL,
  workerRole: WorkerRole,
  status: number,
  durationMs: number,
  error?: unknown
): void {
  const entry = {
    durationMs: Math.round(durationMs),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    status,
    workerRole,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
  };
  console.info("veydrift-api-request", JSON.stringify(entry));
}

function forwardedResponseBody(
  upstreamBody: ReadableStream<Uint8Array> | null,
  abortController: AbortController,
  cleanup: () => void
): ReadableStream<Uint8Array> | null {
  if (!upstreamBody) {
    cleanup();
    return null;
  }

  const reader = upstreamBody.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        cleanup();
        controller.error(error);
        abortController.abort();
      }
    },
    async cancel(reason) {
      cleanup();
      abortController.abort();
      try {
        await reader.cancel(reason);
      } catch {
        // The upstream may already be closed by the abort; cancellation is best-effort.
      }
    }
  });
}
