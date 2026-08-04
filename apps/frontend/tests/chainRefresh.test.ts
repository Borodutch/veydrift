import { describe, expect, test } from "bun:test";
import {
  beginRefreshRequest,
  canApplyRefreshRequest,
  markFreshStateWrite,
  missionLaunchSubmitBlocker,
  previousMissionIndexingBlockerLabel,
  previousMissionTransactionBlockerLabel,
  recordedResourceSnapshotFreshness,
  resourceSnapshotFreshnessForInfrastructure,
  resourceSnapshotFreshnessForSettlement,
  shouldApplyResourceSnapshot,
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldRefreshPlanetStateForIdentityChange,
  shouldRefreshAllianceStateForPage,
  shouldRefreshMissionActionStateForPage,
} from "../src/PlayableMvpApp";
import type { ChainInfrastructureState, WalletSettlementResponse } from "../src/walletFlow";

describe("playable chain refresh", () => {
  test("uses backend chain events instead of the old fast unconditional polling loops", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("new window.EventSource");
    expect(source).toContain("/chain/events");
    expect(source).toContain("snapshot.subscribedToHeads && snapshot.subscribedToLogs");
    expect(source).toContain("120_000");
    expect(source).not.toMatch(/window\.setInterval\([\s\S]{0,600},\s*30_000\)/);
    expect(source).not.toMatch(/window\.setInterval\([\s\S]{0,600},\s*2_500\)/);
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

  test("refreshes alliance state for Mission Control membership and rankings highlights", () => {
    expect(shouldRefreshAllianceStateForPage("mission-control")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("rankings")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("alliance")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("alliance-invites")).toBe(false);
    expect(shouldRefreshAllianceStateForPage("overview")).toBe(false);
  });

  test("refreshes mission action state eagerly only where launch controls are already visible", () => {
    expect(shouldRefreshMissionActionStateForPage("galaxy")).toBe(true);
    expect(shouldRefreshMissionActionStateForPage("planet")).toBe(true);
    expect(shouldRefreshMissionActionStateForPage("mission-control")).toBe(false);
    expect(shouldRefreshMissionActionStateForPage("rankings")).toBe(true);
    expect(shouldRefreshMissionActionStateForPage("raid-target-finder")).toBe(true);
    expect(shouldRefreshMissionActionStateForPage("shipyard")).toBe(false);
    expect(shouldRefreshMissionActionStateForPage("overview")).toBe(true);
  });

  test("keeps Mission Control planet switches cached until a launch composer opens", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(shouldClearCachedShipyardStateForPageRefresh("shipyard")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("galaxy")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("mission-control")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("rankings")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("raid-target-finder")).toBe(false);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("mission-control")).toBe(false);
    expect(shouldEagerlyRefreshPlanetSwitchForPage("overview")).toBe(true);
    expect(source).toContain("refreshShipyardState({ clearCachedState: true });");
    expect(source).toContain("Mission Control can switch origins entirely from its cached wallet roster.");
  });

  test("skips only hydrated Mission Control planet switches, never initial or connection reads", () => {
    const connected = { account: "0x123", activePlanetId: "7", apiBaseUrl: "https://game.test" };

    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      connected,
      { ...connected, activePlanetId: "8" },
    )).toBe(false);
    expect(shouldRefreshPlanetStateForIdentityChange(
      "overview",
      connected,
      { ...connected, activePlanetId: "8" },
    )).toBe(true);
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      { ...connected, activePlanetId: undefined },
      connected,
    )).toBe(true);
    expect(shouldRefreshPlanetStateForIdentityChange(
      "mission-control",
      connected,
      { ...connected, account: "0x456" },
    )).toBe(true);
  });

  test("blocks follow-up mission submits while a previous mission is settling", () => {
    expect(missionLaunchSubmitBlocker({
      actionState: { status: "idle" },
      pendingMissionLaunchCount: 0,
    })).toBeUndefined();

    expect(missionLaunchSubmitBlocker({
      actionState: { status: "pending" },
      pendingMissionLaunchCount: 0,
    })).toBe(previousMissionTransactionBlockerLabel);

    expect(missionLaunchSubmitBlocker({
      actionState: { status: "success" },
      pendingMissionLaunchCount: 1,
    })).toBe(previousMissionIndexingBlockerLabel);
  });

  test("does not create browser-side gameplay read providers for transaction preflights", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const walletFlowSource = await Bun.file(new URL("../src/walletFlow.ts", import.meta.url)).text();

    expect(source).not.toContain("baseSepoliaReadProvider");
    expect(source).not.toContain("transactionReadProvider");
    expect(source).not.toContain("{ readProvider }");
    expect(source).not.toContain("receiptProvider");
    expect(source).not.toContain("waitForReceipt(");
    expect(walletFlowSource).not.toContain("eth_estimateGas");
    expect(walletFlowSource).not.toContain("waitForReceipt(");
    expect(walletFlowSource).toContain("eth_getTransactionReceipt");
    expect(source).toContain("confirm: confirmSubmittedTransaction");
    expect(source).toContain("sendStartBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n          building,\n        )");
    expect(source).not.toContain("building,\n          { readProvider },");
    // VEY-KANEO-507: ready production queues reconcile inside the upgraded contracts,
    // so the frontend no longer adds a manual finish-before-start wallet transaction.
    expect(source).not.toContain("sendFinishBuildingUpgradeTransaction");
    expect(source).not.toContain("sendCollectResourcesTransaction");
  });

  test("gates mutating transaction families until receipt and backend sync work settle", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    for (const snippet of [
      "key: `building:start:",
      "key: `alliance:",
      "key: `rift:",
      "key: `galaxy:",
      "key: `moon:",
      "key: \"planet:rename\"",
      "key: \"planet:abandon\"",
      "key: `mission:",
    ]) {
      expect(source).toContain(snippet);
    }

    expect(source).toContain("runGatedTransaction(\"player-profile:update\"");
    expect(source).toContain("const gameContractTransactionInputsAvailable = Boolean(provider && account && gameContract)");
    expect(source).toContain("const gameTransactionInputsAvailable = gameActionsAvailableForBody(activeBodyKind, gameContractTransactionInputsAvailable)");
    expect(source).toContain("const missionTransactionInputsAvailable = gameContractTransactionInputsAvailable");
    expect(source).toContain("const canSubmitGameTransaction = gameTransactionInputsAvailable && !transactionActionPending");
    expect(source).toContain("const canSubmitMissionTransaction = missionTransactionInputsAvailable && !transactionActionPending");
    expect(source).toContain("runCoordinatedWriteTransaction");
    expect(source).toContain("resourceIndexingExpectationForTransaction(txHash, resourceBaseline, receipt)");
    expect(source).toContain("const allianceTransactionUnavailableReason = transactionUnavailableReasonFor({");
    expect(source).toContain("const moonTransactionUnavailableReason = transactionUnavailableReasonFor({");
    expect(source).toContain("setRiftAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));");
    expect(source).toContain("transactionUnavailableReason={gameTransactionUnavailableReason}");
    expect(source).toContain("transactionUnavailableReason={allianceTransactionUnavailableReason}");
    expect(source).toContain("transactionUnavailableReason={moonTransactionUnavailableReason}");
    expect(source).toContain("await Promise.allSettled([\n              refreshShipyardState(),");
    expect(source).toContain("await Promise.allSettled([\n          refreshRiftState(),");
    expect(source).toContain("refreshOnChainState(undefined, { force: true }),");
    expect(source).not.toContain("void refreshOnChainState(undefined, { force: true });");
  });

  test("keeps mission confirmation open until receipt confirmation and indexing settle", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("): Promise<boolean> => {\n    let completed = false;");
    expect(source).toContain("confirm: confirmSubmittedTransaction");
    expect(source).toContain("await waitForMissionLaunchState(loadMissionLaunchSnapshot, submittedTxHash");
    expect(source).toContain("if (state.phase === \"success\") setGalaxyAction({ status: \"success\", label: `${label} confirmed.` });");
    expect(source).toContain("completed = result;");
    expect(source).toContain("const closeMissionCreationWhenComplete = (transaction: Promise<boolean>) => {");
    expect(source).toContain("if (await transaction) closeMissionCreation();");
    expect(source).toContain("closeMissionCreationWhenComplete(runGalaxyTransaction(\"Colony mission\"");
    expect(source).toContain("closeMissionCreationWhenComplete(runGalaxyTransaction(\"Missile attack\"");
    expect(source).toContain("closeMissionCreationWhenComplete(runGalaxyTransaction(\"Stationed defense\"");
    expect(source).toContain("closeMissionCreationWhenComplete(runMission());");
    expect(source).toContain("const closeAcsDefendWhenComplete = (transaction: Promise<boolean>) => {");
    expect(source).toContain("if (await transaction) setPendingAcsDefend(null);");
    expect(source).toContain("if (completed) closeJoinAttack();");
    expect(source.match(/actionPendingLabel=\{galaxyAction\.status === "pending" \? galaxyAction\.label : undefined\}/g) ?? [])
      .toHaveLength(3);
    expect(source).not.toContain("setPendingGalaxyMission(null);\n    setPendingJoinAttack(null);\n    setPendingAcsDefend(null);\n    if (action.kind === \"attack\"");
    expect(source).not.toContain("closeMissionCreation();\n      void runGalaxyTransaction(\"Colony mission\"");
    expect(source).not.toContain("closeMissionCreation();\n      void runGalaxyTransaction(\"Missile attack\"");
    expect(source).not.toContain("closeMissionCreation();\n      void runGalaxyTransaction(\"Stationed defense\"");
    expect(source).not.toContain("closeMissionCreation();\n    void runMission();");
    expect(source).not.toContain("setPendingAcsDefend(null);\n    const driveLevels");
    expect(source).not.toContain("setPendingJoinAttack(null);\n    setPendingAcsDefend(null);\n    const driveLevels");
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
