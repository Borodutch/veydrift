import { describe, expect, test } from "bun:test";
import ts from "typescript";
import {
  missionLaunchSubmitBlocker,
  previousMissionTransactionBlockerLabel,
  shouldRefreshAllianceStateForPage,
  shouldRefreshMissionActionStateForPage,
  shouldRefreshShipyardStateForPage,
} from "../src/PlayableMvpApp";
import type { ChainInfrastructureState, WalletSettlementResponse } from "../src/walletFlow";

describe("playable chain refresh", () => {
  test("every contract sender receives its attempt's observed wallet, including conditional fleet sends", async () => {
    const text = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const source = ts.createSourceFile("PlayableMvpApp.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const unobserved: string[] = [];
    let senders = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /^send.*Transaction$/.test(node.expression.getText(source)) && node.arguments[0]?.getText(source) === "provider") {
        senders++;
        let parent: ts.Node | undefined = node.parent;
        while (parent && !((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.parameters.some(parameter => parameter.name.getText(source) === "provider"))) parent = parent.parent;
        if (!parent) unobserved.push(node.expression.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(senders).toBeGreaterThan(40);
    expect(unobserved).toEqual([]);
  });
  test("uses backend chain events instead of the old fast unconditional polling loops", async () => {
const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
 expect(source).toContain("backendData.startGameplaySync(account");
 expect(source).not.toContain(".startPolling("); expect(source).not.toContain(".scheduleRefresh(");
 expect(storeSource).toContain("/chain/events"); expect(storeSource).toContain("120_000");
  });

  test("polls the canonical wallet resource snapshot for the hydrated top bar", async () => {
const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
 expect(source).toContain("const topBarResources = backendSpendableResources");
 expect(source).toContain('activeBodyKind === "moon" ? moonState : infrastructureChainState');
 expect(storeSource).toContain('document.visibilityState === "hidden"');
 expect(source).not.toContain("const onChainRefreshGate");
  });






  test("renders only backend-confirmed missions and waits for the indexer after mission transactions", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("indexing.missionLaunch(");
    expect(source).toContain("refreshMissionControl");
    expect(source).not.toContain("setPendingMissionLaunches");
    expect(source).not.toContain("mergePendingMissionLaunches");
  });


  test("uses backend application plus one-shot canonical refreshes for production spends", async () => {
    const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
    // Transaction convergence belongs to the backend status boundary. The
    // store plans below can only perform one-shot canonical refreshes after
    // application and cannot install a second frontend predicate loop.
    expect(storeSource).toContain("resourceChange:");
    expect(storeSource).toContain("production:");
    expect(storeSource).not.toContain("waitForStartedDefenseProductionState(");
    expect(storeSource).not.toContain("resourceIndexingExpectationForTransaction(txHash, baseline");
  });

  test("promotes every indexed planet or moon resource transaction from the chain event stream", async () => {
const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
 expect(storeSource).toContain("activeScopeKeys(planetIds)");
 expect(storeSource).toContain("payload.wallets");
 expect(storeSource).not.toContain("promoteResourceState(");
  });

  test("uses the wallet-scoped canonical resource store instead of component-local balance mutation", async () => {
const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
 expect(source).not.toContain("canonicalPlanetResourcesSnapshot");
 expect(source).toContain("const infrastructureChainState = infrastructureSnapshot?.data ?? null");
 expect(source).toContain("const topBarResources = backendSpendableResources");
 expect(source).not.toMatch(/const set(?:OnChainQueues|InfrastructureChainState|FleetVisibility) =/);
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
    expect(source).toContain("shipyardQuery, shouldRefreshShipyardStateForPage(page) || composingMission");
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
    expect(walletFlowSource).not.toContain("eth_getTransactionReceipt");
    expect(source).not.toContain("confirm: confirmSubmittedTransaction");
    const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
    expect(storeSource).toContain("/transactions/${encodeURIComponent(transactionHash)}/status");
    expect(walletFlowSource).toContain('method: "eth_call"');
    expect(walletFlowSource).toContain('method: "eth_sendTransaction"');
    expect(source).not.toContain("building,\n          { readProvider },");
    // VEY-KANEO-507: ready production queues reconcile inside the upgraded contracts,
    // so the frontend no longer adds a manual finish-before-start wallet transaction.
    expect(source).not.toContain("sendFinishBuildingUpgradeTransaction");
    expect(source).not.toContain("sendCollectResourcesTransaction");
  });

  test("keeps submission gates and scoped pending actions in the central store", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
    expect(source).toContain("runCoordinatedWriteTransaction");
    expect(source).toContain("backendData.runWriteTransaction({");
    expect(storeSource).toContain("readonly transactionGates = new Map<string, TransactionActionGate>()");
    expect(storeSource).not.toContain("this.transactionGateFor(walletScope).run(descriptor.key,");
    expect(storeSource).toContain("this.submissionAttempts.get(identity)");
    expect(source).toContain("const gameContractTransactionInputsAvailable = Boolean(provider && account && gameContract)");
    expect(source).not.toContain("gameMaintenancePaused");
    expect(source).toContain("gameActionsAvailableForBody(");
    expect(source).toContain("activePlanetStateFresh");
    expect(source).toContain("const missionTransactionInputsAvailable = currentPlanetTransactionInputsAvailable(");
    expect(source).not.toContain("GAME_MAINTENANCE_MESSAGE");
    expect(source).toContain("const canSubmitGameTransaction = gameTransactionInputsAvailable;");
    expect(source).toContain("const canSubmitMissionTransaction = missionTransactionInputsAvailable && !missionTransactionPending");
    expect(source).toContain("runCoordinatedWriteTransaction");
    expect(storeSource).toContain("trackPendingTransaction(");
    expect(storeSource).toContain("writePendingTransaction(");
    expect(source).toContain("const allianceTransactionUnavailableReason = transactionUnavailableReasonFor({");
    expect(source).toContain("const moonTransactionUnavailableReason = transactionUnavailableReasonFor({");
    expect(source).toContain("setRiftAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));");
    expect(source).toContain("transactionUnavailableReason={gameTransactionUnavailableReason}");
    expect(source).toContain("transactionUnavailableReason={allianceTransactionUnavailableReason}");
    expect(source).toContain("transactionUnavailableReason={moonTransactionUnavailableReason}");
    expect(source).toContain("indexing: options.syncMissionLaunch");
    expect(source).toContain("backendData!.indexing.missionLaunch(");
  });

  test("closes mission creation after submission while the store observes indexing", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("const runGalaxyTransaction = useCallback(");
    expect(source).toContain("): Promise<WriteTransactionOutcome> => {");
    expect(source).not.toContain("confirm: confirmSubmittedTransaction");
    const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();
    expect(storeSource).toContain("trackPendingTransaction(");
    expect(storeSource).not.toContain("waitForMissionLaunchState(");
    expect(storeSource).toContain("missionLaunch:");
    expect(source).toContain("return result;");
    expect(source).toContain("const closeMissionCreationWhenComplete = (transaction: Promise<WriteTransactionOutcome>) => {");
    expect(source).toContain("waitForIndexing: false");
    expect(source).toContain("if (transactionWasSubmitted((await transaction).outcome)) closeMissionCreation();");
    expect(source).toContain('"Colony mission"');
    expect(source).toContain('"Missile attack"');
    expect(source).toContain('"Stationed defense"');
    expect(source).toContain("closeMissionCreationWhenComplete(runMission());");
    expect(source).toContain("const closeAcsDefendWhenComplete = (transaction: Promise<WriteTransactionOutcome>) => {");
    expect(source).toContain("if (transactionWasSubmitted((await transaction).outcome)) setPendingAcsDefend(null);");
    expect(source).toContain("if (transactionWasSubmitted(outcome.outcome)) closeJoinAttack();");
    expect(source.match(/actionPendingLabel=\{isActionBusy\(galaxyAction\) \? galaxyAction\.label : undefined\}/g) ?? [])
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
