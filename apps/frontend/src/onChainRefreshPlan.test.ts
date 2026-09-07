import { describe, expect, test } from "bun:test";
import {
  currentPlanetTransactionInputsAvailable,
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldPollPendingMissionReport,
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

describe("shouldPollPendingMissionReport", () => {
  test("never waits for a battle report for a one-way missile impact", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    expect(shouldPollPendingMissionReport({
      mission: {
        missionId: "77",
        missionType: "MissileAttack",
        status: "Resolved",
        owner: "0x1111111111111111111111111111111111111111",
        originPlanetId: "7",
        targetPlanetId: "9",
        arrivalAt: String(Math.floor(now / 1_000) - 30),
        returnAt: String(Math.floor(now / 1_000) - 30),
        fuelCost: "0",
        recallCost: "0",
        attackGroupId: null,
        joinedAttackMissionIds: [],
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        ships: {},
        transactionHash: "0xabc",
        blockNumber: "123",
      },
      battleReport: null,
    }, now)).toBe(false);
  });
});
