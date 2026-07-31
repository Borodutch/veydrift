import { describe, expect, test } from "bun:test";
import {
  planOnChainRefresh,
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldRefreshPlanetStateForIdentityChange,
  shouldRefreshAllianceStateForPage,
} from "./PlayableMvpApp";

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

  test("applies resource state for older reads because backend snapshots are authoritative", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
    );
    expect(plan.applyResourceState).toBe(true);
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

  test("without force, periodic polls still apply backend snapshots for older reads", () => {
    const plan = planOnChainRefresh(
      { planetId: "7", lastSettledAt: "200" },
      { planetId: "7", lastSettledAt: "100" },
    );
    expect(plan.applyResourceState).toBe(true);
  });
});

describe("shouldRefreshAllianceStateForPage", () => {
  test("loads alliance membership for Mission Control and Raid Finder before the Alliance tab is opened", () => {
    expect(shouldRefreshAllianceStateForPage("mission-control")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("raid-target-finder")).toBe(true);
  });
});

describe("shouldClearCachedShipyardStateForPageRefresh", () => {
  test("forces pages with visible launch controls to replace stale shipyard inventory", () => {
    expect(shouldClearCachedShipyardStateForPageRefresh("shipyard")).toBe(true);
    expect(shouldClearCachedShipyardStateForPageRefresh("raid-target-finder")).toBe(true);
    expect(shouldClearCachedShipyardStateForPageRefresh("mission-control")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("rankings")).toBe(true);
    expect(shouldClearCachedShipyardStateForPageRefresh("galaxy")).toBe(true);
  });

  test("does not clear cached shipyard inventory on unrelated pages", () => {
    expect(shouldClearCachedShipyardStateForPageRefresh("research")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("alliance")).toBe(false);
  });
});

describe("shouldEagerlyRefreshPlanetSwitchForPage", () => {
  test("uses cached planet state while switching origins on Mission Control", () => {
    expect(shouldEagerlyRefreshPlanetSwitchForPage("mission-control")).toBe(false);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("overview")).toBe(true);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("infrastructure")).toBe(true);
  });

  test("still refreshes initial hydration and connection changes", () => {
    const current = { account: "0x123", activePlanetId: "8", apiBaseUrl: "https://game.test" };
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      { ...current, activePlanetId: "7" },
      current,
    )).toBe(false);
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      { ...current, activePlanetId: undefined },
      current,
    )).toBe(true);
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      { ...current, apiBaseUrl: "https://other.test" },
      current,
    )).toBe(true);
  });
});
