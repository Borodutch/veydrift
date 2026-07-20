import assert from "node:assert/strict";
import test from "node:test";
import { apiLatencyReport, percentile } from "./veydrift-api-latency-report.mjs";

test("reports normalized route families and excludes streaming requests", () => {
  const lines = [
    "not json",
    JSON.stringify({ kind: "api_request", method: "GET", route: "/highscores", durationMs: 350, stream: false }),
    JSON.stringify({ kind: "api_request", method: "GET", route: "/highscores", durationMs: 100, stream: false }),
    `prefix ${JSON.stringify({ kind: "api_request", method: "GET", route: "/mission/:missionId", durationMs: 5000, stream: false })}`,
    JSON.stringify({ kind: "api_request", method: "GET", route: "/chain/events", durationMs: 99_999, stream: true }),
    JSON.stringify({ kind: "service_start", durationMs: 8000 })
  ];

  assert.deepEqual(apiLatencyReport(lines), {
    thresholdMs: 300,
    parsedApiRequests: 4,
    excludedRequests: 1,
    routes: [
      { route: "GET /mission/:missionId", requests: 1, p50Ms: 5000, p95Ms: 5000, p99Ms: 5000, maxMs: 5000, overThreshold: 1 },
      { route: "GET /highscores", requests: 2, p50Ms: 100, p95Ms: 350, p99Ms: 350, maxMs: 350, overThreshold: 1 }
    ]
  });
});

test("uses nearest-rank percentiles", () => {
  const samples = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(samples, 0.50), 50);
  assert.equal(percentile(samples, 0.95), 95);
  assert.equal(percentile(samples, 0.99), 99);
});
