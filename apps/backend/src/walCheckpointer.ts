import { safeDiagnosticText } from "./safeDiagnostics";

export type WalCheckpointDatabase = {
  databasePath: string;
  intervalMs: number;
};

export type WalCheckpointRequest = {
  databases: WalCheckpointDatabase[];
};

export type WalCheckpointResult = { databasePath: string } & (
  | { ok: true; busy: number; log: number; checkpointed: number; durationMs: number }
  | { ok: false; error: string; durationMs: number }
);

export type WalCheckpointerSnapshot = {
  mode: "worker" | "main-thread-fallback";
  intervalMs: number;
  passes: number;
  failures: number;
  lastOkAt: string | null;
  lastError: string | null;
  lastLogPages: number | null;
  lastCheckpointedPages: number | null;
  lastDurationMs: number | null;
  maxDurationMs: number;
};

export type WalCheckpointWorker = {
  postMessage(message: unknown): void;
  terminate(): void;
  unref?(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type WalCheckpointTarget = {
  /** Key in the /health `walCheckpoint` snapshot. */
  name: string;
  databasePath: string;
  /** Toggles SQLite's commit-time autocheckpoint on the writer's own connection. */
  setAutoCheckpoint: (pages: number) => void;
  /**
   * Every pass that backfills the whole WAL lets the writer's next commit restart the WAL, and
   * that restart fsyncs the WAL header on the writer's thread even at synchronous = NORMAL. The
   * interval therefore bounds how often the writer pays that fsync.
   */
  intervalMs?: number;
};

export type WalCheckpointerOptions = {
  targets: WalCheckpointTarget[];
  /** Without a successful worker pass for this long the writer checkpoints on commit again. */
  staleAfterMs?: number;
  now?: () => number;
  createWorker?: () => WalCheckpointWorker;
  /**
   * Called once if the worker errors before any database had a successful pass, e.g. when its
   * module fails to load (newer Bun reports that asynchronously rather than throwing).
   */
  onWorkerFailed?: () => void;
  logger?: Pick<Console, "warn">;
};

const defaultAutoCheckpointPages = 1000;
const defaultIntervalMs = 30_000;
/** The former main-thread path ran TRUNCATE above this many WAL pages; now it is only reported. */
export const largeWalLogPages = 16_384;
const largeWalWarnIntervalMs = 10 * 60 * 1_000;

type TargetState = {
  target: WalCheckpointTarget;
  staleAfterMs: number;
  offloaded: boolean;
  lastOkAtMs: number;
  lastLargeWalWarnAtMs: number | null;
  snapshot: WalCheckpointerSnapshot;
};

/**
 * Runs WAL checkpoints for the writer's SQLite databases on one worker thread with its own
 * connections (#74). A writer connection stops autocheckpointing once the worker has proved it
 * works for that database, so neither the frame copy nor its fsync runs on the writer's event
 * loop. If the worker stalls or dies, the writer falls back to SQLite's commit-time
 * autocheckpoint so no WAL can grow without bound.
 */
export class WalCheckpointer {
  private readonly worker: WalCheckpointWorker;
  private readonly watchdog: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn">;
  private readonly states = new Map<string, TargetState>();
  private readonly onWorkerFailed: (() => void) | undefined;
  private anyPass = false;
  private workerFailureReported = false;

  constructor(options: WalCheckpointerOptions) {
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
    this.onWorkerFailed = options.onWorkerFailed;
    const databases: WalCheckpointDatabase[] = [];
    for (const target of options.targets) {
      if (this.states.has(target.databasePath)) continue;
      const intervalMs = target.intervalMs ?? defaultIntervalMs;
      databases.push({ databasePath: target.databasePath, intervalMs });
      this.states.set(target.databasePath, {
        target,
        staleAfterMs: options.staleAfterMs ?? Math.max(30_000, 3 * intervalMs),
        offloaded: false,
        lastOkAtMs: this.now(),
        lastLargeWalWarnAtMs: null,
        snapshot: {
          mode: "main-thread-fallback",
          intervalMs,
          passes: 0,
          failures: 0,
          lastOkAt: null,
          lastError: null,
          lastLogPages: null,
          lastCheckpointedPages: null,
          lastDurationMs: null,
          maxDurationMs: 0
        }
      });
    }
    this.worker = (options.createWorker ?? (() => new Worker(new URL("./walCheckpointWorker.ts", import.meta.url).href)))();
    try {
      this.worker.unref?.();
      this.worker.onmessage = (event) => this.onResult(event.data as WalCheckpointResult);
      this.worker.onerror = (event) => this.onWorkerError(event);
      const request: WalCheckpointRequest = { databases };
      this.worker.postMessage(request);
    } catch (error) {
      try { this.worker.terminate(); } catch {}
      throw error;
    }
    this.watchdog = setInterval(() => this.checkStale(), 5_000);
    this.watchdog.unref?.();
  }

  snapshot(): Record<string, WalCheckpointerSnapshot> {
    return Object.fromEntries([...this.states.values()].map((state) => [state.target.name, { ...state.snapshot }]));
  }

  stop(): void {
    clearInterval(this.watchdog);
    try { this.worker.postMessage({ stop: true }); } catch {}
    this.worker.terminate();
    for (const state of this.states.values()) this.setOffloaded(state, false);
  }

  private onWorkerError(event: ErrorEvent): void {
    // The message can carry the worker module's install path: log it, keep it off /health.
    this.logger.warn("Veydrift SQLite WAL checkpoint worker error", safeDiagnosticText(event.message || "unknown error"));
    for (const databasePath of this.states.keys()) {
      this.onResult({ databasePath, ok: false, error: "WAL checkpoint worker error", durationMs: 0 });
    }
    if (!this.anyPass && !this.workerFailureReported) {
      // The writer checkpoints on its own thread from here on; a worker that survived its error
      // must not start offloading again behind that fallback.
      this.workerFailureReported = true;
      try { this.worker.terminate(); } catch {}
      this.onWorkerFailed?.();
    }
  }

  private onResult(result: WalCheckpointResult): void {
    const state = this.states.get(result.databasePath);
    if (!state) return;
    const snapshot = state.snapshot;
    snapshot.lastDurationMs = result.durationMs;
    snapshot.maxDurationMs = Math.max(snapshot.maxDurationMs, result.durationMs);
    if (!result.ok) {
      snapshot.failures += 1;
      // `lastError` is served on the public /health: keep the database path and secrets out of it.
      const error = safeDiagnosticText(result.error.split(state.target.databasePath).join(`<${state.target.name}>`), 512);
      if (snapshot.lastError !== error) {
        this.logger.warn("Veydrift SQLite WAL checkpoint worker failed", state.target.name, error);
      }
      snapshot.lastError = error;
      return;
    }
    this.anyPass = true;
    snapshot.passes += 1;
    snapshot.lastError = null;
    snapshot.lastLogPages = result.log;
    snapshot.lastCheckpointedPages = result.checkpointed;
    state.lastOkAtMs = this.now();
    snapshot.lastOkAt = new Date(state.lastOkAtMs).toISOString();
    this.setOffloaded(state, true);
    this.warnIfLarge(state, result.log, result.busy);
  }

  /**
   * PASSIVE never truncates, so a WAL whose readers keep missing the restart window grows
   * silently. Report it (at most every 10 min per database) rather than block the writer on a
   * TRUNCATE.
   */
  private warnIfLarge(state: TargetState, logPages: number, busy: number): void {
    if (logPages <= largeWalLogPages) return;
    const at = this.now();
    if (state.lastLargeWalWarnAtMs !== null && at - state.lastLargeWalWarnAtMs < largeWalWarnIntervalMs) return;
    state.lastLargeWalWarnAtMs = at;
    this.logger.warn(`sqlite_wal_large ${JSON.stringify({ name: state.target.name, logPages, busy })}`);
  }

  private checkStale(): void {
    for (const state of this.states.values()) {
      if (state.offloaded && this.now() - state.lastOkAtMs > state.staleAfterMs) {
        this.logger.warn("Veydrift SQLite WAL checkpoint worker is stale; writer autocheckpoint re-enabled", state.target.name);
        this.setOffloaded(state, false);
      }
    }
  }

  private setOffloaded(state: TargetState, offloaded: boolean): void {
    if (state.offloaded === offloaded) return;
    try {
      state.target.setAutoCheckpoint(offloaded ? 0 : defaultAutoCheckpointPages);
      state.offloaded = offloaded;
      state.snapshot.mode = offloaded ? "worker" : "main-thread-fallback";
    } catch (error) {
      this.logger.warn("Veydrift SQLite autocheckpoint toggle failed", state.target.name, error instanceof Error ? error.message : String(error));
    }
  }
}
