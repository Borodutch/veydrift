import { expect, test } from "bun:test";
import { startEventLoopLagSampler, summarizeEventLoopLag, type EventLoopLagSummary } from "./eventLoopLag";

test("summarizes lag quantiles and stall counts", () => {
  expect(summarizeEventLoopLag([])).toBeNull();
  const lags = [...Array.from({ length: 97 }, () => 2), 600, 1_200, 3_500];
  expect(summarizeEventLoopLag(lags)).toEqual({
    samples: 100, p50Ms: 2, p99Ms: 1_200, maxMs: 3_500, over500Ms: 3, over1000Ms: 2
  });
});

test("a blocked event loop shows up as lag in the next window", async () => {
  const summaries: EventLoopLagSummary[] = [];
  const stop = startEventLoopLagSampler({ component: "test", intervalMs: 10, reportEveryMs: 150, emit: (s) => summaries.push(s) });
  const worstLag = () => Math.max(0, ...summaries.map((s) => s.maxMs));
  try {
    await Bun.sleep(30);
    const blockedUntil = performance.now() + 250;
    while (performance.now() < blockedUntil) { /* simulate a synchronous fsync stall */ }
    // A starved runner may flush a pre-stall window first; wait for the window holding the stall.
    for (let i = 0; i < 100 && worstLag() < 200; i++) await Bun.sleep(10);
  } finally { stop(); }
  expect(worstLag()).toBeGreaterThanOrEqual(200);
});
