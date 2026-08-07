import { describe, expect, test } from "bun:test";
import {
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldRefreshPlanetStateForIdentityChange,
  shouldRefreshAllianceStateForPage,
} from "./PlayableMvpApp";

describe("shouldRefreshAllianceStateForPage", () => {
  test("loads alliance membership for Mission Control and Raid Finder before the Alliance tab is opened", () => {
    expect(shouldRefreshAllianceStateForPage("mission-control")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("raid-target-finder")).toBe(true);
  });
});

describe("shouldClearCachedShipyardStateForPageRefresh", () => {
  test("keeps the last confirmed inventory visible while launch pages refresh", () => {
    expect(shouldClearCachedShipyardStateForPageRefresh("shipyard")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("raid-target-finder")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("mission-control")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("rankings")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("galaxy")).toBe(false);
  });

  test("also keeps cached shipyard inventory on unrelated pages", () => {
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
