// Process-level crash diagnostics for the Veydrift backend (VEY-KANEO-459).
//
// The backend crash-looped with SIGSEGV (exit 139) under an Alchemy live-read timeout storm. A native
// SIGSEGV cannot be caught from JavaScript, but the failure mode that precedes it — a flood of orphaned
// fetch rejections plus climbing memory — is observable. These handlers turn that otherwise-silent
// pressure into structured, greppable diagnostics (with a memory snapshot) so an operator can tell a
// real native crash apart from an orchestrator SIGTERM, and can see resource growth before the kill.
//
// The RPC-layer abort/timeout fix (see HttpJsonRpcTransport.fetchWithTimeout) removes the root cause of
// the orphan accumulation; this module is the matching observability half so a regression is loud.

export type DiagnosticsLogger = (event: string, detail: Record<string, unknown>) => void;

export type CrashDiagnosticsOptions = {
  logger?: DiagnosticsLogger;
  exit?: (code: number) => void;
  target?: Pick<NodeJS.EventEmitter, "on">;
};

const bytesPerMebibyte = 1024 * 1024;

export function memorySnapshot(usage: NodeJS.MemoryUsage = process.memoryUsage()): Record<string, number> {
  return {
    rssMb: toMebibytes(usage.rss),
    heapUsedMb: toMebibytes(usage.heapUsed),
    heapTotalMb: toMebibytes(usage.heapTotal),
    externalMb: toMebibytes(usage.external)
  };
}

function toMebibytes(bytes: number): number {
  return Math.round((bytes / bytesPerMebibyte) * 100) / 100;
}

function reasonText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stackText(error: unknown): string | undefined {
  return error instanceof Error && error.stack ? error.stack : undefined;
}

export function defaultDiagnosticsLogger(event: string, detail: Record<string, unknown>): void {
  // Single-line JSON keeps the diagnostics greppable in the deploy log aggregator and avoids
  // interleaving with concurrent request logging.
  console.error(`veydrift-crash-diagnostics ${JSON.stringify({ event, ...detail })}`);
}

// Pure handler factory so the behavior can be unit-tested without registering real process listeners
// or actually exiting the process.
export function buildDiagnosticsHandlers(
  log: DiagnosticsLogger,
  exit: (code: number) => void
): {
  onUnhandledRejection: (reason: unknown) => void;
  onUncaughtException: (error: unknown) => void;
  onSignal: (signal: string) => void;
} {
  return {
    // Do NOT exit here: an unhandled rejection storm from transiently-failing live reads must not by
    // itself take the server down — it is exactly the noise the RPC timeout fix now bounds. Log it
    // (with memory) so the storm is visible; the process keeps serving the indexed fallback.
    onUnhandledRejection: (reason) => {
      log("unhandledRejection", {
        reason: reasonText(reason),
        ...(stackText(reason) ? { stack: stackText(reason) } : {}),
        memory: memorySnapshot()
      });
    },
    // An uncaught exception leaves the runtime in an undefined state. Bun already crashes on this; we
    // preserve that (exit 1) but first emit a structured reason + memory snapshot so the restart has a
    // diagnosable cause instead of a bare stack on stderr.
    onUncaughtException: (error) => {
      log("uncaughtException", {
        error: reasonText(error),
        ...(stackText(error) ? { stack: stackText(error) } : {}),
        memory: memorySnapshot()
      });
      exit(1);
    },
    // Record orchestrator-initiated shutdowns so a clean SIGTERM/SIGINT is unambiguously distinct from
    // an uncatchable native SIGSEGV in the logs.
    onSignal: (signal) => {
      log("signal", { signal, memory: memorySnapshot() });
      exit(0);
    }
  };
}

let installed = false;

// Register the diagnostics handlers on the process (idempotent). Returns true when it installed, false
// if it was already installed in this process.
export function installCrashDiagnostics(options: CrashDiagnosticsOptions = {}): boolean {
  if (installed) return false;
  installed = true;

  const log = options.logger ?? defaultDiagnosticsLogger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const target = options.target ?? process;
  const handlers = buildDiagnosticsHandlers(log, exit);

  target.on("unhandledRejection", handlers.onUnhandledRejection);
  target.on("uncaughtException", handlers.onUncaughtException);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    target.on(signal, () => handlers.onSignal(signal));
  }

  return true;
}

// Test-only reset so the idempotency latch does not leak between test cases.
export function resetCrashDiagnosticsForTest(): void {
  installed = false;
}
