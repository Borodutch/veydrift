import assert from "node:assert/strict";
import test from "node:test";
import {
  failedBenchmarkRoutes,
  performanceRoutePaths,
  topTenRoutePaths
} from "./veydrift-api-route-benchmark.mjs";

test("benchmarks the production top ten without long-lived streams", () => {
  const routes = topTenRoutePaths({
    wallet: "0x1111111111111111111111111111111111111111",
    missionId: "42",
    targetPlanetId: "7"
  });

  assert.equal(routes.length, 10);
  assert.equal(routes.some((route) => route.includes("/chain/events")), false);
  assert.deepEqual(routes.map((route) => new URL(route, "http://local").pathname), [
    "/highscores",
    "/wallet/0x1111111111111111111111111111111111111111/attack-protection",
    "/wallet/0x1111111111111111111111111111111111111111/missions",
    "/mission/42",
    "/wallet/0x1111111111111111111111111111111111111111/alliance",
    "/universe/systems",
    "/wallet/0x1111111111111111111111111111111111111111/overview",
    "/wallet/0x1111111111111111111111111111111111111111/referrals",
    "/wallet/0x1111111111111111111111111111111111111111/settlement",
    "/wallet/0x1111111111111111111111111111111111111111/planets"
  ]);
});

test("adds the global completed archive as a p99/max tail guard", () => {
  const routes = performanceRoutePaths({
    wallet: "0x1111111111111111111111111111111111111111",
    missionId: "42",
    targetPlanetId: "7"
  });

  assert.equal(routes.length, 11);
  assert.equal(routes.at(-1), "/missions?status=completed&page=1&pageSize=25");
  assert.deepEqual(failedBenchmarkRoutes([
    { route: "GET /missions", p95Ms: 38, p99Ms: 5_530, maxMs: 5_530 },
    { route: "GET /highscores", p95Ms: 268, p99Ms: 362, maxMs: 362 }
  ], 300), [
    { route: "GET /missions", p95Ms: 38, p99Ms: 5_530, maxMs: 5_530 }
  ]);
});
