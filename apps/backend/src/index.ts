import { installCrashDiagnostics } from "./crashDiagnostics";
import { createRequestHandler } from "./server";
import {
  createForwardingFetch,
  resolveWorkerAssignment,
  resolveWriterInternalPort,
  roleForIndex,
  WORKER_INDEX_ENV,
  WORKER_ROLE_ENV,
  WRITER_INTERNAL_PORT_ENV,
  type WorkerRole
} from "./workerPool";

// Install before binding the port so a startup-time unhandled rejection or signal is captured with a
// structured reason + memory snapshot (VEY-KANEO-459). Each worker process re-runs this file, so the
// supervisor and every worker get their own crash diagnostics.
installCrashDiagnostics();

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const idleTimeout = Number.parseInt(process.env.VEYDRIFT_HTTP_IDLE_TIMEOUT_SECONDS ?? "30", 10);

// Reader workers bind the shared public port with SO_REUSEPORT so the kernel load-balances user-facing
// reads across them. The writer worker (index 0) runs chain-sync ingestion + the on-chain committers
// and stays off the public socket so applyLog/poll work cannot stall normal API reads.
//
// `writerInternalPort` is set only when running as a pool (more than one worker). Readers forward every
// mutating request and the SSE stream there so the writer remains the sole mutator of the SQLite index
// and the only holder of the live chain-sync stream.
function serveWorker(role: WorkerRole, index: number, writerInternalPort?: number): void {
  const handler = createRequestHandler({ role });

  if (role === "writer" && writerInternalPort !== undefined) {
    Bun.serve({
      idleTimeout,
      port: writerInternalPort,
      hostname: "127.0.0.1",
      fetch: handler
    });
    console.log(
      `Veydrift backend worker ${index} (writer) listening privately on http://127.0.0.1:${writerInternalPort}; ` +
        `public reads served by reader workers`
    );
    return;
  }

  if (role === "reader" && writerInternalPort !== undefined) {
    Bun.serve({
      idleTimeout,
      port,
      reusePort: true,
      fetch: createForwardingFetch(handler, `http://127.0.0.1:${writerInternalPort}`)
    });
    console.log(
      `Veydrift backend worker ${index} (reader) listening on http://localhost:${port} [reusePort]; ` +
        `forwarding writes to http://127.0.0.1:${writerInternalPort}`
    );
    return;
  }

  Bun.serve({
    idleTimeout,
    port,
    reusePort: true,
    fetch: handler
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

  const writerInternalPort = resolveWriterInternalPort(process.env, port);
  const children = new Map<number, ReturnType<typeof Bun.spawn>>();
  let shuttingDown = false;

  const spawnChild = (index: number): void => {
    const role = roleForIndex(index);
    const child = Bun.spawn({
      cmd: ["bun", import.meta.path],
      env: {
        ...process.env,
        [WORKER_ROLE_ENV]: role,
        [WORKER_INDEX_ENV]: String(index),
        [WRITER_INTERNAL_PORT_ENV]: String(writerInternalPort)
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

  // Keep the supervisor event loop alive. Bun child-process handles are not a reliable liveness
  // anchor in all container/runtime combinations, and if the supervisor exits cleanly Swarm treats the
  // task as "Complete" and tears down the worker children.
  const keepAlive = setInterval(() => {}, 60 * 60 * 1_000);

  // Forward the supervisor's shutdown to the workers so they never outlive it as orphaned port
  // listeners. installCrashDiagnostics() turns SIGTERM/SIGINT into process.exit(0) (and an uncaught
  // exception into process.exit(1)); the "exit" event fires synchronously for all of those paths, so
  // killing the workers here covers every catchable shutdown. (SIGKILL is uncatchable; container
  // teardown reaps the workers in that case.)
  process.on("exit", () => {
    clearInterval(keepAlive);
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
  serveWorker(assignment.role, assignment.index, resolveWriterInternalPort(process.env, port));
} else {
  superviseWorkers(assignment.workerCount);
}
