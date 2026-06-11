import { installCrashDiagnostics } from "./crashDiagnostics";
import { createRequestHandler } from "./server";
import {
  resolveWorkerAssignment,
  roleForIndex,
  WORKER_INDEX_ENV,
  WORKER_ROLE_ENV,
  type WorkerRole
} from "./workerPool";

// Install before binding the port so a startup-time unhandled rejection or signal is captured with a
// structured reason + memory snapshot (VEY-KANEO-459). Each worker process re-runs this file, so the
// supervisor and every worker get their own crash diagnostics.
installCrashDiagnostics();

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const idleTimeout = Number.parseInt(process.env.VEYDRIFT_HTTP_IDLE_TIMEOUT_SECONDS ?? "30", 10);

// Bind this process to the shared port with SO_REUSEPORT so the kernel load-balances connections
// across all workers — a slow request handled by one worker never blocks the others (VEY-KANEO-466).
// The writer worker (index 0) also runs chain-sync ingestion + the on-chain committers; reader workers
// serve from the shared WAL database and skip those background loops (see server.ts role gating).
function serveWorker(role: WorkerRole, index: number): void {
  Bun.serve({
    idleTimeout,
    port,
    reusePort: true,
    fetch: createRequestHandler({ role })
  });
  console.log(`Veydrift backend worker ${index} (${role}) listening on http://localhost:${port} [reusePort]`);
}

// Spawn and supervise the worker pool. Worker 0 is the writer; the rest are readers. A worker that
// exits unexpectedly is respawned (with a short backoff so an instant boot crash can't spin the CPU).
function superviseWorkers(workerCount: number): void {
  if (workerCount <= 1) {
    // Single-core / pinned deployments keep the original single-process behavior: the supervisor
    // itself is the writer and binds the port directly, with no child processes.
    serveWorker("writer", 0);
    return;
  }

  const children = new Map<number, ReturnType<typeof Bun.spawn>>();
  let shuttingDown = false;

  const spawnChild = (index: number): void => {
    const role = roleForIndex(index);
    const child = Bun.spawn({
      cmd: ["bun", import.meta.path],
      env: {
        ...process.env,
        [WORKER_ROLE_ENV]: role,
        [WORKER_INDEX_ENV]: String(index)
      },
      stdio: ["inherit", "inherit", "inherit"]
    });
    children.set(index, child);
    void child.exited.then((code) => {
      children.delete(index);
      if (shuttingDown) return;
      console.error(`Veydrift backend worker ${index} (${role}) exited with code ${code}; respawning in 1s`);
      setTimeout(() => {
        if (!shuttingDown) spawnChild(index);
      }, 1_000);
    });
  };

  for (let index = 0; index < workerCount; index += 1) {
    spawnChild(index);
  }

  // Forward the supervisor's shutdown to the workers so they never outlive it as orphaned port
  // listeners. installCrashDiagnostics() turns SIGTERM/SIGINT into process.exit(0) (and an uncaught
  // exception into process.exit(1)); the "exit" event fires synchronously for all of those paths, so
  // killing the workers here covers every catchable shutdown. (SIGKILL is uncatchable; container
  // teardown reaps the workers in that case.)
  process.on("exit", () => {
    shuttingDown = true;
    for (const child of children.values()) {
      child.kill();
    }
  });

  console.log(
    `Veydrift backend supervisor started ${workerCount} workers (1 writer + ${workerCount - 1} reader) on http://localhost:${port}`
  );
}

const assignment = resolveWorkerAssignment(process.env, navigator.hardwareConcurrency);
if (assignment.kind === "worker") {
  serveWorker(assignment.role, assignment.index);
} else {
  superviseWorkers(assignment.workerCount);
}
