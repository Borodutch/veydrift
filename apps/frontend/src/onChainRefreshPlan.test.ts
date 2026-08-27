import { describe, expect, test } from "bun:test";
import {
  currentPlanetTransactionInputsAvailable,
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldRefreshPlanetStateForIdentityChange,
  shouldRefreshAllianceStateForPage,
} from "./PlayableMvpApp";

const playableMvpAppSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();

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
  test("refreshes every selected planet, including Mission Control origins", () => {
    expect(shouldEagerlyRefreshPlanetSwitchForPage("mission-control")).toBe(true);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("overview")).toBe(true);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("infrastructure")).toBe(true);
  });

  test("refreshes hydrated planet changes instead of keeping a stale origin", () => {
    const current = { account: "0x123", activePlanetId: "8", apiBaseUrl: "https://game.test" };
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      { ...current, activePlanetId: "7" },
      current,
    )).toBe(true);
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

describe("currentPlanetTransactionInputsAvailable", () => {
  test("blocks planet-scoped transactions until the selected planet has a fresh snapshot", () => {
    expect(currentPlanetTransactionInputsAvailable(true, false)).toBe(false);
    expect(currentPlanetTransactionInputsAvailable(true, true)).toBe(true);
    expect(currentPlanetTransactionInputsAvailable(false, true)).toBe(false);
  });

  test("does not turn backend maintenance telemetry into a frontend transaction lock", () => {
    expect(playableMvpAppSource).not.toContain("gameMaintenancePaused");
    expect(playableMvpAppSource).not.toContain("GAME_MAINTENANCE_MESSAGE");
  });
});
