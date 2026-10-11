import { emitObservabilityEvent } from "./observability";

// A synchronous SQLite fsync or checkpoint on a contended disk freezes the whole writer: chain
// events, the mission tick and lease renewals all wait (#74). Sample how late a short timer fires
// and publish one per-window summary so stalls are measurable without attaching a profiler.

export type EventLoopLagSummary = {
  samples: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  over500Ms: number;
  over1000Ms: number;
};

export function summarizeEventLoopLag(lagsMs: readonly number[]): EventLoopLagSummary | null {
  if (lagsMs.length === 0) return null;
  const sorted = [...lagsMs].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!; // nearest rank
  return {
    samples: sorted.length,
    p50Ms: quantile(0.5),
    p99Ms: quantile(0.99),
    maxMs: sorted.at(-1)!,
    over500Ms: sorted.filter((lag) => lag > 500).length,
    over1000Ms: sorted.filter((lag) => lag > 1_000).length
  };
}

export function startEventLoopLagSampler(options: {
  component: string;
  intervalMs?: number;
  reportEveryMs?: number;
  emit?: (summary: EventLoopLagSummary, windowMs: number) => void;
}): () => void {
  const intervalMs = options.intervalMs ?? 100;
  const reportEveryMs = options.reportEveryMs ?? 60_000;
  const emit = options.emit ?? ((summary, windowMs) => emitObservabilityEvent(
    { kind: "event_loop_lag", component: options.component, windowMs, ...summary },
    summary.maxMs > 1_000 ? "warn" : "info"
  ));
  let lags: number[] = [];
  let expectedAt = performance.now() + intervalMs;
  let windowStartedAt = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, Math.round(now - expectedAt)));
    expectedAt = now + intervalMs;
    if (now - windowStartedAt >= reportEveryMs) {
      const summary = summarizeEventLoopLag(lags);
      const windowMs = Math.round(now - windowStartedAt);
      lags = [];
      windowStartedAt = now;
      if (summary) emit(summary, windowMs);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
