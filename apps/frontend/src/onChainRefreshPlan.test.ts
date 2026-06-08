import { describe, expect, test } from "bun:test";
import { planOnChainRefresh } from "./PlayableMvpApp";

describe("planOnChainRefresh", () => {
  test("always applies authoritative queues + fleet visibility", () => {
    const stale = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
    );
    expect(stale.applyQueues).toBe(true);

    const fresh = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "100" },
      { planetId: "7", lastSettledAt: "200" },
    );
    expect(fresh.applyQueues).toBe(true);
  });

  test("keeps resource state behind the anti-snapback gate for older reads", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
    );
    // The completion poll can report an older settlement than the last spend,
    // but the cleared building queue must still apply.
    expect(plan.applyResourceState).toBe(false);
    expect(plan.applyQueues).toBe(true);
  });

  test("applies resource state when the settlement read is newer", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "100" },
      { planetId: "7", lastSettledAt: "200" },
    );
    expect(plan.applyResourceState).toBe(true);
  });

  test("applies resource state when the active planet changes", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "9", lastSettledAt: "100" },
    );
    expect(plan.applyResourceState).toBe(true);
  });
});
