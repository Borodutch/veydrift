import assert from "node:assert/strict";
import test from "node:test";
import { topTenRoutePaths } from "./veydrift-api-route-benchmark.mjs";

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
