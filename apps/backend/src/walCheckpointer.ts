export type WalCheckpointRequest = {
  databasePath: string;
  intervalMs: number;
};

export type WalCheckpointResult =
  | { ok: true; busy: number; log: number; checkpointed: number; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export type WalCheckpointerSnapshot = {
  mode: "worker" | "main-thread-fallback";
  passes: number;
  failures: number;
  lastOkAt: string | null;
  lastError: string | null;
  lastLogPages: number | null;
  lastCheckpointedPages: number | null;
  lastDurationMs: number | null;
  maxDurationMs: number;
};

type WorkerLike = {
  postMessage(message: unknown): void;
  terminate(): void;
  unref?(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type WalCheckpointerOptions = {
  databasePath: string;
  /** Toggles SQLite's commit-time autocheckpoint on the writer's own connection. */
  setAutoCheckpoint: (pages: number) => void;
  intervalMs?: number;
  /** Without a successful worker pass for this long the writer checkpoints on commit again. */
  staleAfterMs?: number;
  now?: () => number;
  createWorker?: () => WorkerLike;
  logger?: Pick<Console, "warn">;
};

const defaultAutoCheckpointPages = 1000;

/**
 * Runs index WAL checkpoints on a worker thread with its own connection (#74). The writer's
 * connection stops autocheckpointing once the worker has proved it works, so neither the frame
 * copy nor its fsync runs on the writer's event loop. If the worker stalls or dies, the writer
 * falls back to SQLite's commit-time autocheckpoint so the WAL cannot grow without bound.
 */
export class WalCheckpointer {
  private readonly worker: WorkerLike;
  private readonly watchdog: ReturnType<typeof setInterval>;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn">;
  private offloaded = false;
  private lastOkAtMs: number;
  private state: WalCheckpointerSnapshot = {
    mode: "main-thread-fallback",
    passes: 0,
    failures: 0,
    lastOkAt: null,
    lastError: null,
    lastLogPages: null,
    lastCheckpointedPages: null,
    lastDurationMs: null,
    maxDurationMs: 0
  };

  constructor(private readonly options: WalCheckpointerOptions) {
    const intervalMs = options.intervalMs ?? 1_000;
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
    this.lastOkAtMs = this.now();
    this.worker = (options.createWorker ?? (() => new Worker(new URL("./walCheckpointWorker.ts", import.meta.url).href)))();
    this.worker.unref?.();
    this.worker.onmessage = (event) => this.onResult(event.data as WalCheckpointResult);
    this.worker.onerror = (event) => {
      this.onResult({ ok: false, error: event.message || "WAL checkpoint worker error", durationMs: 0 });
    };
    const request: WalCheckpointRequest = { databasePath: options.databasePath, intervalMs };
    this.worker.postMessage(request);
    this.watchdog = setInterval(() => this.checkStale(), Math.max(intervalMs, 1_000));
    this.watchdog.unref?.();
  }

  snapshot(): WalCheckpointerSnapshot {
    return { ...this.state };
  }

  stop(): void {
    clearInterval(this.watchdog);
    try { this.worker.postMessage({ stop: true }); } catch {}
    this.worker.terminate();
    this.setOffloaded(false);
  }

  private onResult(result: WalCheckpointResult): void {
    this.state.lastDurationMs = result.durationMs;
    this.state.maxDurationMs = Math.max(this.state.maxDurationMs, result.durationMs);
    if (!result.ok) {
      this.state.failures += 1;
      if (this.state.lastError !== result.error) {
        this.logger.warn("Veydrift SQLite WAL checkpoint worker failed", result.error);
      }
      this.state.lastError = result.error;
      return;
    }
    this.state.passes += 1;
    this.state.lastError = null;
    this.state.lastLogPages = result.log;
    this.state.lastCheckpointedPages = result.checkpointed;
    this.lastOkAtMs = this.now();
    this.state.lastOkAt = new Date(this.lastOkAtMs).toISOString();
    this.setOffloaded(true);
  }

  private checkStale(): void {
    if (this.offloaded && this.now() - this.lastOkAtMs > this.staleAfterMs) {
      this.logger.warn("Veydrift SQLite WAL checkpoint worker is stale; writer autocheckpoint re-enabled");
      this.setOffloaded(false);
    }
  }

  private setOffloaded(offloaded: boolean): void {
    if (this.offloaded === offloaded) return;
    try {
      this.options.setAutoCheckpoint(offloaded ? 0 : defaultAutoCheckpointPages);
      this.offloaded = offloaded;
      this.state.mode = offloaded ? "worker" : "main-thread-fallback";
    } catch (error) {
      this.logger.warn("Veydrift SQLite autocheckpoint toggle failed", error instanceof Error ? error.message : String(error));
    }
  }
}
