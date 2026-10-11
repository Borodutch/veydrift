export type EventLoopLagWindow = {
  windowMs: number;
  /** Sample intervals in the window, including the ones a freeze swallowed. */
  samples: number;
  /** Percentiles over those intervals, so p99 reflects the share of time the loop was stalled. */
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Timer fires (freezes) more than this late. */
  over500Ms: number;
  over1000Ms: number;
};

export type EventLoopLagSnapshot = {
  sampleIntervalMs: number;
  lastHour: EventLoopLagWindow;
};

export type EventLoopLagMonitorOptions = {
  sampleIntervalMs?: number;
  /** Window of the periodic `writer_event_loop_lag` log line. */
  reportIntervalMs?: number;
  /** A single delay at least this long is logged on its own as `writer_event_loop_stall`. */
  stallLogMs?: number;
  now?: () => number;
  log?: (line: string) => void;
};

const hourMs = 60 * 60 * 1_000;
const snapshotCacheMs = 10_000;

/**
 * Measures how late a fixed-interval timer fires on this process (#74). The delay is the time the
 * event loop could not service timers: synchronous SQLite commits, checkpoints, long CPU work.
 * Keeps one hour of samples for /health and logs a summary of each report window.
 */
export class EventLoopLagMonitor {
  private readonly sampleIntervalMs: number;
  private readonly reportIntervalMs: number;
  private readonly stallLogMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly samples: Float64Array;
  private readonly sampledAt: Float64Array;
  private next = 0;
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reportTimer: ReturnType<typeof setInterval> | undefined;
  private expectedAt = 0;
  private cachedSnapshot: { at: number; value: EventLoopLagSnapshot } | null = null;

  constructor(options: EventLoopLagMonitorOptions = {}) {
    this.sampleIntervalMs = options.sampleIntervalMs ?? 100;
    this.reportIntervalMs = options.reportIntervalMs ?? 5 * 60 * 1_000;
    this.stallLogMs = options.stallLogMs ?? 1_000;
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? ((line) => console.log(line));
    const capacity = Math.ceil(hourMs / this.sampleIntervalMs) + 1;
    this.samples = new Float64Array(capacity);
    this.sampledAt = new Float64Array(capacity);
  }

  start(): void {
    if (this.timer) return;
    this.schedule();
    this.reportTimer = setInterval(() => {
      this.log(`writer_event_loop_lag ${JSON.stringify(this.window(this.reportIntervalMs))}`);
    }, this.reportIntervalMs);
    this.reportTimer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.timer = undefined;
    this.reportTimer = undefined;
  }

  /** Records one observed delay; exposed so tests can feed samples deterministically. */
  record(lagMs: number, at = this.now()): void {
    this.samples[this.next] = lagMs;
    this.sampledAt[this.next] = at;
    this.next = (this.next + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    if (lagMs >= this.stallLogMs) {
      this.log(`writer_event_loop_stall ${JSON.stringify({ lagMs: Math.round(lagMs) })}`);
    }
  }

  /** /health is public and forwarded to the writer: recompute the hour at most every 10 s. */
  snapshot(): EventLoopLagSnapshot {
    const at = this.now();
    if (!this.cachedSnapshot || at - this.cachedSnapshot.at >= snapshotCacheMs) {
      this.cachedSnapshot = { at, value: { sampleIntervalMs: this.sampleIntervalMs, lastHour: this.window(hourMs, at) } };
    }
    return this.cachedSnapshot.value;
  }

  window(windowMs: number, at = this.now()): EventLoopLagWindow {
    const values: number[] = [];
    const interval = this.sampleIntervalMs;
    let over500Ms = 0;
    let over1000Ms = 0;
    let maxMs = 0;
    const windowStart = at - windowMs;
    for (let index = 0; index < this.count; index += 1) {
      const sampledAt = this.sampledAt[index]!;
      if (sampledAt < windowStart) continue;
      const lagMs = this.samples[index]!;
      maxMs = Math.max(maxMs, lagMs);
      if (lagMs > 500) over500Ms += 1;
      if (lagMs > 1_000) over1000Ms += 1;
      // A freeze of any length delays only one timer fire. Also record the ticks it swallowed
      // (L - interval, L - 2·interval, …), HdrHistogram-style, so each sample stands for one
      // interval of wall time and a periodic freeze cannot hide below the p99. The tick recorded
      // with lag m was due at sampledAt - m, so a freeze that began before the window only
      // contributes the ticks that were due inside it.
      let missed = lagMs;
      const inWindowMs = sampledAt - windowStart;
      if (missed > inWindowMs) missed -= Math.ceil((missed - inWindowMs) / interval) * interval;
      if (missed < interval && lagMs >= interval) missed = ((lagMs - interval) % interval) + interval;
      if (missed < interval) missed = Math.min(missed, lagMs);
      for (; ; missed -= interval) {
        values.push(missed);
        if (missed - interval < interval) break;
      }
    }
    values.sort((left, right) => left - right);
    const percentile = (fraction: number) => values.length
      ? values[Math.min(values.length - 1, Math.floor(fraction * values.length))]!
      : 0;
    return {
      windowMs,
      samples: values.length,
      p50Ms: Math.round(percentile(0.5)),
      p99Ms: Math.round(percentile(0.99)),
      maxMs: Math.round(maxMs),
      over500Ms,
      over1000Ms
    };
  }

  private schedule(): void {
    this.expectedAt = this.now() + this.sampleIntervalMs;
    this.timer = setTimeout(() => {
      const firedAt = this.now();
      this.record(Math.max(0, firedAt - this.expectedAt), firedAt);
      this.schedule();
    }, this.sampleIntervalMs);
    this.timer.unref?.();
  }
}
