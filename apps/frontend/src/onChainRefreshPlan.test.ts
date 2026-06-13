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

  test("force-applies resource state for an explicit post-action refetch even on an equal lastSettledAt (VEY-KANEO-484)", () => {
    // After a confirmed build/research/ship/defense spend, the explicit refetch must update the
    // displayed resources without a page reload even when the backend momentarily returns the SAME
    // settlement read (indexer lag / spend not yet reflected) — which the gate would otherwise drop.
    const equal = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "200" },
      { force: true },
    );
    expect(equal.applyResourceState).toBe(true);

    const older = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
      { force: true },
    );
    expect(older.applyResourceState).toBe(true);
  });

  test("force does not change the always-on queue/fleet application", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
      { force: true },
    );
    expect(plan.applyQueues).toBe(true);
  });

  test("without force, periodic polls keep the anti-snapback gate for older reads", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
    );
    expect(plan.applyResourceState).toBe(false);
  });
});
