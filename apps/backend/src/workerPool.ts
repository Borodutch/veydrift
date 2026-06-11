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

export type WorkerRole = "writer" | "reader";

export type WorkerAssignment =
  | { kind: "supervisor"; workerCount: number }
  | { kind: "worker"; role: WorkerRole; index: number };

// Resolve how many worker processes to run. `VEYDRIFT_WORKER_COUNT` is an
// explicit override (useful for tests, constrained containers, or pinning a
// single-process deployment); otherwise we use the host CPU count. The result is
// always at least 1 so the backend can boot on a single-core host.
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
  return Math.max(1, cpus);
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
