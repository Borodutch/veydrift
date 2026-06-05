import { describe, expect, test } from "bun:test";
import {
  beginRefreshRequest,
  canApplyRefreshRequest,
  markFreshStateWrite,
  recordedResourceSnapshotFreshness,
  resourceSnapshotFreshnessForInfrastructure,
  resourceSnapshotFreshnessForSettlement,
  shouldApplyResourceSnapshot,
  shouldRefreshAllianceStateForPage,
} from "../src/PlayableMvpApp";
import type { ChainInfrastructureState, WalletSettlementResponse } from "../src/walletFlow";

describe("playable chain refresh", () => {
  test("uses backend chain events instead of the old fast unconditional polling loops", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("new window.EventSource");
    expect(source).toContain("/chain/events");
    expect(source).toContain("snapshot.subscribedToHeads && snapshot.subscribedToLogs");
    expect(source).toContain("120_000");
    expect(source).not.toContain("30_000");
    expect(source).not.toContain("2_500");
  });

  test("polls the canonical wallet resource snapshot for the hydrated top bar", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("TOP_BAR_RESOURCE_POLL_INTERVAL_MS = 10_000");
    expect(source).toContain("refreshTopBarResources");
    expect(source).toContain("document.visibilityState === \"hidden\"");
    expect(source).toContain("refreshOnChainState()");
    expect(source).toContain("refreshInfrastructureState()");
    expect(source).toContain("onChainRefreshGate");
    expect(source).toContain("infrastructureRefreshGate");
    expect(source).toContain("canApplyRefreshRequest");
    expect(source).toContain("markFreshStateWrite");
  });

  test("blocks older top-bar poll refreshes after newer transaction state writes", () => {
    const gate = { current: 0 };
    const olderPollRequest = beginRefreshRequest(gate);

    expect(canApplyRefreshRequest(gate, olderPollRequest)).toBe(true);

    markFreshStateWrite(gate);

    expect(canApplyRefreshRequest(gate, olderPollRequest)).toBe(false);

    const newerPollRequest = beginRefreshRequest(gate);

    expect(canApplyRefreshRequest(gate, newerPollRequest)).toBe(true);
  });

  test("rejects older accrued resource snapshots after newer transaction writes", () => {
    let latestSnapshot = resourceSnapshotFreshnessForSettlement(undefined);
    let topBarResources = { metal: "0", crystal: "0", deuterium: "0" };
    const applySettlementResources = (settlement: WalletSettlementResponse): boolean => {
      const nextSnapshot = resourceSnapshotFreshnessForSettlement(settlement);
      if (!shouldApplyResourceSnapshot(latestSnapshot, nextSnapshot)) {
        return false;
      }

      latestSnapshot = recordedResourceSnapshotFreshness(latestSnapshot, nextSnapshot);
      topBarResources = settlement.planet?.resources ?? topBarResources;
      return true;
    };

    expect(applySettlementResources(settlementSnapshot("7", "200", { metal: "120", crystal: "80", deuterium: "40" }))).toBe(true);
    expect(applySettlementResources(settlementSnapshot("7", "100", { metal: "20", crystal: "10", deuterium: "5" }))).toBe(false);
    expect(topBarResources).toEqual({ metal: "120", crystal: "80", deuterium: "40" });
  });

  test("uses infrastructure last-settled markers to reject older resource polls", () => {
    const current = resourceSnapshotFreshnessForInfrastructure(infrastructureSnapshot("7", "200"));
    const older = resourceSnapshotFreshnessForInfrastructure(infrastructureSnapshot("7", "100"));
    const otherPlanet = resourceSnapshotFreshnessForInfrastructure(infrastructureSnapshot("8", "50"));
    const markerless = resourceSnapshotFreshnessForInfrastructure({
      ...infrastructureSnapshot("7", "300"),
      planetLastSettledAt: undefined,
    });

    expect(shouldApplyResourceSnapshot(current, older)).toBe(false);
    expect(shouldApplyResourceSnapshot(current, otherPlanet)).toBe(true);
    expect(recordedResourceSnapshotFreshness(current, markerless)).toBe(current);
  });

  test("refreshes alliance state for rankings so same-alliance rows can highlight", () => {
    expect(shouldRefreshAllianceStateForPage("rankings")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("alliance")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("overview")).toBe(false);
  });

  test("does not create browser-side gameplay read providers for transaction preflights", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const walletFlowSource = await Bun.file(new URL("../src/walletFlow.ts", import.meta.url)).text();

    expect(source).not.toContain("baseSepoliaReadProvider");
    expect(source).not.toContain("transactionReadProvider");
    expect(source).not.toContain("{ readProvider }");
    expect(source).not.toContain("receiptProvider");
    expect(source).not.toContain("waitForReceipt(");
    expect(walletFlowSource).not.toContain("waitForReceipt(");
    expect(walletFlowSource).toContain("eth_getTransactionReceipt");
    expect(source).toContain("confirmSubmittedTransaction(txHash)");
    expect(source).toContain("sendStartBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n          building,\n        )");
    expect(source).not.toContain("building,\n          { readProvider },");
    expect(source).toContain("sendFinishBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n        )");
    expect(source).not.toContain("sendCollectResourcesTransaction");
  });
});

function settlementSnapshot(
  planetId: string,
  lastSettledAt: string,
  resources: { metal: string; crystal: string; deuterium: string },
): WalletSettlementResponse {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    hasFirstPlanet: true,
    homePlanetId: planetId,
    planet: {
      planetId,
      owner: "0x2222222222222222222222222222222222222222",
      name: null,
      galaxy: 1,
      system: 2,
      position: 3,
      fields: 200,
      temperature: 20,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      lastSettledAt,
      resources,
    },
  };
}

function infrastructureSnapshot(planetId: string, planetLastSettledAt: string): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: planetId,
    planetId,
    planetLastSettledAt,
    infrastructureAvailable: true,
    resources: { metal: "120", crystal: "80", deuterium: "40" },
    productionPerHour: { metal: "60", crystal: "30", deuterium: "10" },
    energyBalance: null,
    storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
    buildings: [],
    queue: null,
  };
}
