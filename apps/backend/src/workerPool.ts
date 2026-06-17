// Worker-pool topology for the multi-threaded Bun backend (VEY-KANEO-466).
//
// The backend runs as N = CPU worker processes that all bind the same port with
// SO_REUSEPORT (Bun.serve `reusePort`), so the kernel load-balances connections
// across workers and a slow request on one worker never blocks the others.
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
export const WRITER_INTERNAL_PORT_ENV = "VEYDRIFT_WRITER_INTERNAL_PORT";
export const DEFAULT_MAX_WORKER_COUNT = 4;

export type WorkerRole = "writer" | "reader";

// Methods that never mutate state are served locally by a reader. Everything else is forwarded to the
// single writer so all DB writes — and the writer's in-memory indexer bookkeeping (e.g. the bounded
// fleet-mission reconcile queue drained after applyLog) — happen on exactly one process.
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Request headers that must not be copied verbatim when re-issuing a forwarded request: the body is
// re-encoded by fetch (content-length) and the connection is to the writer's loopback listener (host).
const STRIPPED_FORWARD_REQUEST_HEADERS = ["content-length", "host", "connection"];

export type WorkerAssignment =
  | { kind: "supervisor"; workerCount: number }
  | { kind: "worker"; role: WorkerRole; index: number };

// Resolve how many worker processes to run. `VEYDRIFT_WORKER_COUNT` is an
// explicit override (useful for tests, constrained containers, or pinning a
// single-process deployment). Without an override, keep the pool memory-bounded:
// each worker opens the indexed SQLite read model and carries per-process caches,
// so using every host CPU can multiply RAM during api-test divergence scans.
// The result is always at least 1 so the backend can boot on a single-core host.
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
  return Math.max(1, Math.min(cpus, DEFAULT_MAX_WORKER_COUNT));
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

// Wrap a reader's request handler so it serves read-only methods locally and forwards every mutating
// request to the single writer's loopback listener at `writerOrigin` (e.g. "http://127.0.0.1:4001").
// This keeps readers as pure WAL read-replicas: the writer is the sole mutator of the SQLite index and
// the only holder of the in-memory indexer state, so cross-process state never diverges (VEY-KANEO-466).
export function createForwardingFetch(
  localHandler: (request: Request) => Promise<Response>,
  writerOrigin: string,
  fetchImpl: typeof fetch = fetch
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (READ_ONLY_METHODS.has(request.method)) {
      return localHandler(request);
    }

    const url = new URL(request.url);
    const target = `${writerOrigin}${url.pathname}${url.search}`;
    const headers = new Headers(request.headers);
    for (const name of STRIPPED_FORWARD_REQUEST_HEADERS) {
      headers.delete(name);
    }
    const body = await request.arrayBuffer();

    let upstream: Response;
    try {
      upstream = await fetchImpl(target, {
        method: request.method,
        headers,
        redirect: "manual",
        ...(body.byteLength > 0 ? { body } : {})
      });
    } catch {
      return Response.json(
        {
          error: "writer_unavailable",
          message: "The write request could not be forwarded to the indexer/writer worker."
        },
        { status: 502, headers: { "access-control-allow-origin": "*" } }
      );
    }

    // Re-emit the writer's response (status, headers including CORS, body) to the original client.
    // content-length / content-encoding are dropped so the runtime recomputes them for the re-sent body.
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    const responseBody = await upstream.arrayBuffer();
    return new Response(responseBody.byteLength > 0 ? responseBody : null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  };
}
