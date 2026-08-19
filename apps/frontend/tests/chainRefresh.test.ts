import { describe, expect, test } from "bun:test";
import {
  beginRefreshRequest,
  canApplyRefreshRequest,
  markFreshStateWrite,
  missionLaunchSubmitBlocker,
  newestFleetVisibility,
  previousMissionTransactionBlockerLabel,
  shouldClearCachedShipyardStateForPageRefresh,
  shouldEagerlyRefreshPlanetSwitchForPage,
  shouldRefreshPlanetStateForIdentityChange,
  shouldRefreshAllianceStateForPage,
  shouldRefreshMissionActionStateForPage,
  shouldRefreshShipyardStateForPage,
} from "../src/PlayableMvpApp";
import {
  backendResourceSnapshot,
  promoteCanonicalPlanetResources,
  walletSettlementWithCanonicalPlanetResources,
} from "../src/planetResourceStore";
import type { ChainInfrastructureState, FleetMissionVisibilityResponse, WalletSettlementResponse } from "../src/walletFlow";

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

  test("invalidates an older in-flight resource poll after a confirmed write", () => {
    const gate = { current: 0 };
    const olderPollRequest = beginRefreshRequest(gate);

    markFreshStateWrite(gate);

    expect(canApplyRefreshRequest(gate, olderPollRequest)).toBe(false);
  });

  test("rejects a slower Mission Control response from an older indexed revision", () => {
    const current = fleetVisibilitySnapshot("12:4", "900");
    const olderRevision = fleetVisibilitySnapshot("12:3", "901");
    const currentWithoutRevision = fleetVisibilitySnapshot(undefined, "900");
    const olderBlock = fleetVisibilitySnapshot(undefined, "899");
    const currentGeneratedAt = fleetVisibilitySnapshot("12:4", "900", "2026-08-10T00:00:02.000Z");
    const olderGeneratedAt = fleetVisibilitySnapshot("12:4", "900", "2026-08-10T00:00:01.000Z");

    expect(newestFleetVisibility(current, olderRevision)).toBe(current);
    expect(newestFleetVisibility(currentWithoutRevision, olderBlock)).toBe(currentWithoutRevision);
    expect(newestFleetVisibility(currentGeneratedAt, olderGeneratedAt)).toBe(currentGeneratedAt);
    expect(newestFleetVisibility(current, fleetVisibilitySnapshot("12:5", "901")).indexedRevision).toBe("12:5");
  });

  test("accepts the backend-authoritative revision after a rolling two-part to three-part deploy", () => {
    const legacy = fleetVisibilitySnapshot("350126:109385", "350126");
    const authoritative = fleetVisibilitySnapshot("350126:109385:49", "350126");

    expect(newestFleetVisibility(legacy, authoritative)).toBe(authoritative);
  });

  test("orders state-only changes and rejects older authoritative Mission Control responses", () => {
    const current = fleetVisibilitySnapshot("350126:109385:49", "350126");
    const newerAllianceState = fleetVisibilitySnapshot("350126:109385:50", "350126");
    const olderAllianceState = fleetVisibilitySnapshot("350126:109385:48", "350127");
    const olderMissionState = fleetVisibilitySnapshot("350125:109385:99", "350127");

    expect(newestFleetVisibility(current, newerAllianceState)).toBe(newerAllianceState);
    expect(newestFleetVisibility(current, olderAllianceState)).toBe(current);
    expect(newestFleetVisibility(current, olderMissionState)).toBe(current);
  });

  test("renders only backend-confirmed missions and waits for the indexer after mission transactions", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("waitForFleetVisibilityIndexedThrough");
    expect(source).toContain("refreshMissionControl");
    expect(source).not.toContain("setPendingMissionLaunches");
    expect(source).not.toContain("mergePendingMissionLaunches");
  });

  test("promotes an indexed spend snapshot directly into the canonical top-bar settlement", () => {
    const beforeSpend = settlementSnapshot("7", "100", {
      metal: "500",
      crystal: "400",
      deuterium: "300",
    });
    const confirmedSpend = {
      ...infrastructureSnapshot("7", "200"),
      resources: { metal: "120", crystal: "80", deuterium: "40" },
      resourcesAsOfNow: { metal: "121", crystal: "81", deuterium: "40" },
      resourceSnapshot: {
        planetId: "7",
        transactionHash: "0xspend",
        blockNumber: "0x20",
        lastSettledAt: "200",
        resources: { metal: "120", crystal: "80", deuterium: "40" },
      },
    };

    const store = promoteCanonicalPlanetResources({}, backendResourceSnapshot(confirmedSpend, {
      planetId: "7",
      wallet: beforeSpend.wallet,
    }), { confirmedTransaction: true });
    const promoted = walletSettlementWithCanonicalPlanetResources(beforeSpend, store, beforeSpend.wallet);

    expect(promoted?.planet?.resources).toEqual({ metal: "120", crystal: "80", deuterium: "40" });
    expect(promoted?.planet?.resourcesAsOfNow).toEqual({ metal: "121", crystal: "81", deuterium: "40" });
    expect(promoted?.planet?.resourceSnapshot?.transactionHash).toBe("0xspend");
  });

  test("uses one confirmed-resource promotion path for all shared production spends", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    for (const endpoint of ["infrastructure", "defenses", "shipyard", "research"]) {
      expect(source).toContain(`await convergeBackendIndexedResourceState(\n          () => backendData!.${endpoint}`);
    }
    expect(source).toContain("promoteBackendResourceState(state, { confirmedTransaction: true })");
  });

  test("promotes every indexed planet or moon resource transaction from the chain event stream", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("chainEventResourceChanges(event)");
    expect(source).toContain("refreshConfirmedResourceChangeFromEvent(change)");
    expect(source).toContain("convergeBackendIndexedResourceState(");
    expect(source).toContain("applyBackendConfirmedMoonResourceState(state as unknown as ChainMoonState)");
    expect(source).toContain("resourceChange: {\n        bodyKind: originIsMoon ?");
    expect(source).toContain('), { bodyKind: "planet", planetId: homePlanetId });');
    expect(source).toContain('), { bodyKind: "moon", planetId: moonState.homePlanetId });');
  });

  test("uses the wallet-scoped canonical resource store instead of component-local balance mutation", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("canonicalPlanetResourcesRef");
    expect(source).toContain("walletPlanetsWithCanonicalPlanetResources");
    expect(source).toContain("walletSettlementWithCanonicalPlanetResources");
    expect(source).toContain("resourceStateWithCanonicalPlanetResources");
    expect(source).toContain("riftStateWithCanonicalPlanetResources");
    expect(source).not.toContain("Client-side ledger of submitted-but-not-yet-settled resource spends");
    expect(source).not.toMatch(/set(?:OnChain|Infrastructure|Defense|Shipyard|Research).*Resources/);
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

  test("refreshes Shipyard state on the Shipyard page without clearing confirmed inventory", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(shouldRefreshShipyardStateForPage("shipyard")).toBe(true);
    expect(shouldRefreshShipyardStateForPage("galaxy")).toBe(true);
    expect(shouldRefreshShipyardStateForPage("mission-control")).toBe(false);
    expect(shouldRefreshShipyardStateForPage("research")).toBe(false);
    expect(shouldClearCachedShipyardStateForPageRefresh("shipyard")).toBe(false);
    expect(source).toContain("if (!shouldRefreshShipyardStateForPage(page)) return;");
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
    })).toBeUndefined();

    expect(missionLaunchSubmitBlocker({
      actionState: { status: "pending" },
    })).toBe(previousMissionTransactionBlockerLabel);
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
    expect(source).toContain("const [missionSnapshot] = await Promise.all([");
    expect(source).toContain("waitForMissionLaunchState(loadMissionLaunchSnapshot, submittedTxHash");
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

function fleetVisibilitySnapshot(
  indexedRevision: string | undefined,
  indexedBlock: string,
  generatedAt = "2026-08-10T00:00:00.000Z",
): FleetMissionVisibilityResponse {
  return {
    generatedAt,
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
    indexedBlock,
    ...(indexedRevision === undefined ? {} : { indexedRevision }),
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
