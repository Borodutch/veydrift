import { describe, expect, test } from "bun:test";
import {
  buildingCompletionUnavailableReasonFor,
  buildingCompletionUnavailableReasonAfterBackendRevalidation,
  buildingCompletionReadyToFinishFlag,
  buildingUpgradeActionErrorLabel,
  buildingFinishUnavailableReasonForDisplay,
  buildingFinishActionErrorLabel,
  canLoadIndexedPageState,
  canonicalInfrastructureBuildingCompletionQueue,
  completedBuildingFinishSyncReasonFor,
  defenseCompletionPlanetIdFor,
  failedBuildingFinishSyncReasonFor,
  galaxyMissionActionErrorLabel,
  homeGalaxySystemSyncKey,
  homePlanetIdentityRefreshKey,
  hasInfrastructureDisplayState,
  infrastructureBackendSyncPausedLabel,
  infrastructureBackendSyncPausedReasonFor,
  infrastructureStateForCompletionRevalidation,
  infrastructureActionNoticeFor,
  infrastructureDisplayActionNoticeFor,
  infrastructureLoadErrorFor,
  infrastructureUnavailableReasonFor,
  loadWalletPlanetSyncSnapshot,
  overviewBuildingReadyToFinishFlag,
  overviewResearchCompletionUnavailableReasonFor,
  preserveActiveResearchQueue,
  preserveActiveResearchState,
  refreshedInfrastructureUnavailableReasonFor,
  refreshedInfrastructureUpgradeUnavailableReasonFor,
  researchCompletionUnavailableReasonFor,
  researchStateWithFallbackQueue,
  researchStartUnavailableReasonAfterLiveRevalidation,
  researchStartUnavailableReasonFor,
  researchStateForCompletionRevalidation,
  researchStateWithPreservedActiveQueue,
  researchStartTransactionLabel,
  shipyardStateForMissionActions,
  pendingSpendsFromQueues,
  shipCompletionPlanetIdFor,
  topBarEnergyFor,
  walletSpendableResourcesFor,
  walletSnapshotHydrationKey,
} from "../src/PlayableMvpApp";
import {
  infrastructureHeaderFinishAction,
  infrastructureFinishAction,
  infrastructureFinishButtonLabel,
  infrastructureUpgradeButtonLabel,
} from "../src/components/InfrastructurePage";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainDefenseState, ChainInfrastructureState, ChainResearchState, ChainShipyardState, FleetMissionSummary, PlayerQueuesResponse, QueueStateResponse } from "../src/walletFlow";

describe("Playable MVP app display helpers", () => {
  const buildingFinishStateReadFailureLabel =
    "Can't check game state right now. Your upgrade is still ready, but Veydrift could not verify the contract state. Retry in a moment.";
  const buildingFinishLiveStateRequiredLabel =
    "Can't verify the current building queue right now. Refresh infrastructure state and retry before finishing.";
  const buildingCompletionWalletPrompt =
    "Building completion: confirm the game-state update in your wallet; token balance changes are not expected.";

  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps API finish warnings out of building-card action notices", () => {
    expect(infrastructureDisplayActionNoticeFor({
      action: { status: "idle" },
      finishUnavailableReason: infrastructureBackendSyncPausedLabel,
    })).toBeUndefined();

    expect(infrastructureDisplayActionNoticeFor({
      action: {
        status: "error",
        buildingKey: "solarPlant",
        label: "Building upgrade transaction failed.",
      },
      finishUnavailableReason: infrastructureBackendSyncPausedLabel,
    })).toEqual({
      buildingKey: "solarPlant",
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureDisplayActionNoticeFor({
      action: {
        status: "error",
        label: infrastructureBackendSyncPausedLabel,
      },
      finishUnavailableReason: infrastructureBackendSyncPausedLabel,
    })).toBeUndefined();
  });

  test("gates page state refreshes until the current wallet snapshot is hydrated", () => {
    const apiBaseUrl = "https://api.test";
    const account = "0x2222222222222222222222222222222222222222";
    const hydratedWalletSnapshotKey = walletSnapshotHydrationKey(apiBaseUrl, account);

    expect(canLoadIndexedPageState({
      account,
      apiBaseUrl,
      hydratedWalletSnapshotKey,
    })).toBe(true);
    expect(canLoadIndexedPageState({
      account,
      apiBaseUrl,
      hydratedWalletSnapshotKey: walletSnapshotHydrationKey(apiBaseUrl, "0x3333333333333333333333333333333333333333"),
    })).toBe(false);
    expect(canLoadIndexedPageState({
      account: undefined,
      apiBaseUrl,
      hydratedWalletSnapshotKey: undefined,
    })).toBe(true);
  });

  test("keys galaxy home sync by coordinates instead of background snapshot identity", () => {
    expect(homeGalaxySystemSyncKey({ galaxy: 2, system: 44, position: 7 })).toBe("2:44");
    expect(homeGalaxySystemSyncKey({ galaxy: 2, system: 44, position: 9 })).toBe("2:44");
    expect(homeGalaxySystemSyncKey(undefined)).toBeUndefined();
  });

  test("keys home identity refresh by display identity instead of wallet poll churn", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const firstSnapshot = indexedPlanet(wallet);
    const refreshedSnapshot = {
      ...firstSnapshot,
      lastSettledAt: "1770000300",
      resources: {
        metal: "5100",
        crystal: "5000",
        deuterium: "4900",
      },
    };
    const homeCoords = { galaxy: 2, system: 44, position: 9 };
    const key = homePlanetIdentityRefreshKey({
      apiBaseUrl: "https://api.test",
      homeCoords,
      ownerDisplayName: "Explorer",
      settlementPlanet: firstSnapshot,
    });

    expect(homePlanetIdentityRefreshKey({
      apiBaseUrl: "https://api.test",
      homeCoords,
      ownerDisplayName: "Explorer",
      settlementPlanet: refreshedSnapshot,
    })).toBe(key);
    expect(homePlanetIdentityRefreshKey({
      apiBaseUrl: "https://api.test",
      homeCoords: { galaxy: 2, system: 45, position: 9 },
      ownerDisplayName: "Explorer",
      settlementPlanet: refreshedSnapshot,
    })).not.toBe(key);
    expect(homePlanetIdentityRefreshKey({
      apiBaseUrl: "https://api.test",
      homeCoords: undefined,
      ownerDisplayName: "Explorer",
      settlementPlanet: refreshedSnapshot,
    })).toBeUndefined();
  });

  test("turns shipyard load failures into explicit mission-action blockers", () => {
    const unavailable = shipyardStateForMissionActions({
      account: "0x1111111111111111111111111111111111111111",
      activePlanetId: "8",
      homePlanetId: "7",
      shipyardError: "Shipyard API returned 503",
      shipyardLoading: false,
      shipyardState: null,
    });

    expect(unavailable).toMatchObject({
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planetId: "8",
      productionAvailable: false,
      unavailableReason: "Shipyard state could not be loaded: Shipyard API returned 503. Refresh and retry.",
      ships: [],
    });

    expect(shipyardStateForMissionActions({
      account: "0x1111111111111111111111111111111111111111",
      activePlanetId: "8",
      homePlanetId: "7",
      shipyardError: "Shipyard API returned 503",
      shipyardLoading: true,
      shipyardState: null,
    })).toBeNull();
  });

  test("labels mission launch wallet, API/RPC, and preflight failures distinctly", () => {
    expect(galaxyMissionActionErrorLabel("Attack mission", {
      code: -32603,
      message: "Internal JSON-RPC error.",
    })).toBe("Attack mission could not verify game contract state before launch. The game API or RPC is temporarily unavailable; refresh mission state and retry.");

    expect(galaxyMissionActionErrorLabel(
      "Attack mission",
      new Error("The wallet could not read the current game contract state. Retry in a moment while the app checks whether the game API or RPC recovered."),
    )).toBe("Attack mission could not verify game contract state before launch. The game API or RPC is temporarily unavailable; refresh mission state and retry.");

    expect(galaxyMissionActionErrorLabel(
      "Attack mission",
      new Error("Timed out reading wallet accounts from the wallet after 10 seconds."),
    )).toBe("Attack mission could not read wallet state. Unlock or reconnect your wallet, then retry.");

    expect(galaxyMissionActionErrorLabel(
      "Attack mission",
      new Error("execution reverted"),
    )).toBe("Attack mission was rejected by the game contract. Refresh fleet, cargo, fuel, and target state before retrying, or choose a different target if the state changed.");
  });

  test("labels a silent contract revert as a contract rejection, not RPC downtime (VEY-421)", () => {
    // Raw node revert with no reason data (code 3, empty `0x`).
    expect(galaxyMissionActionErrorLabel("Attack mission", {
      code: 3,
      message: "execution reverted",
      data: "0x",
    })).toBe("Attack mission was rejected by the game contract. Refresh fleet, cargo, fuel, and target state before retrying, or choose a different target if the state changed.");

    // MetaMask re-wraps the empty revert as a top-level -32603 with the real
    // revert nested underneath — must still read as a contract rejection.
    expect(galaxyMissionActionErrorLabel("Attack mission", {
      code: -32603,
      message: "Internal JSON-RPC error.",
      data: { code: 3, message: "execution reverted", data: "0x" },
    })).toBe("Attack mission was rejected by the game contract. Refresh fleet, cargo, fuel, and target state before retrying, or choose a different target if the state changed.");

    // A genuine RPC/transport -32603 with no nested revert stays an availability message.
    expect(galaxyMissionActionErrorLabel("Attack mission", {
      code: -32603,
      message: "Internal JSON-RPC error.",
    })).toBe("Attack mission could not verify game contract state before launch. The game API or RPC is temporarily unavailable; refresh mission state and retry.");
  });

  test("keeps pending infrastructure copy out of unavailable and button labels", () => {
    expect(infrastructureUnavailableReasonFor({
      buildingAction: {
        status: "pending",
        label: buildingCompletionWalletPrompt,
      },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState(),
      infrastructureLoading: false,
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
      onChainStatus: "ready",
      runtimeConfigStatus: "ready",
    })).toBeUndefined();

    expect(infrastructureUpgradeButtonLabel({
      binary: false,
      defaultLabel: "Upgrade Level 2",
      statusDisabled: true,
    })).toBe("Upgrade Level 2");
    expect(infrastructureFinishButtonLabel(undefined, false)).toBe("Finish upgrade");
  });

  test("keeps infrastructure finish controls visible with disabled reasons", () => {
    const queue = {
      kind: "building" as const,
      key: "solarPlant" as const,
      label: "Solar Plant",
      readyAt: 1_700_000_600_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    };
    let calls = 0;
    const onFinishBuilding = () => {
      calls += 1;
    };

    expect(infrastructureFinishAction({
      isBuildingReadyToFinish: false,
      onFinishBuilding,
      queue,
    })).toEqual({
      disabled: true,
      label: "Finish upgrade",
      onFinish: undefined,
      reason: "Building upgrade is not ready to finish yet.",
      visible: true,
    });

    expect(infrastructureFinishAction({
      actionUnavailableReason: buildingCompletionWalletPrompt,
      isActionPending: true,
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    })).toEqual({
      disabled: true,
      label: "Finish upgrade",
      onFinish: undefined,
      reason: buildingCompletionWalletPrompt,
      visible: true,
    });

    const ready = infrastructureFinishAction({
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });
    expect(ready.disabled).toBe(false);
    expect(ready.label).toBe("Finish upgrade");
    ready.onFinish?.();
    expect(calls).toBe(1);
  });

  test("keeps infrastructure finish button copy compact on disabled mobile states", async () => {
    const source = await Bun.file(new URL("../src/components/InfrastructurePage.tsx", import.meta.url)).text();
    const longReason = "Infrastructure API is temporarily unavailable. The app will keep retrying, and building actions are paused until current backend state is available.";
    const action = infrastructureFinishAction({
      actionUnavailableReason: longReason,
      isBuildingReadyToFinish: true,
      onFinishBuilding: () => undefined,
      queue: {
        kind: "building",
        key: "solarPlant",
        label: "Solar Plant",
        readyAt: 1_700_000_000_000,
        startedAt: 1_699_999_000_000,
        targetLevel: 2,
      },
    });

    expect(action).toMatchObject({
      disabled: true,
      label: "Finish upgrade",
      reason: longReason,
      visible: true,
    });
    expect(source).toContain("flex h-10 w-full min-w-0 items-center justify-center overflow-hidden");
    expect(source).toContain("max-w-full overflow-hidden text-ellipsis whitespace-nowrap");
  });

  test("keeps disabled infrastructure finish reasons out of the page header", () => {
    const queue = {
      kind: "building" as const,
      key: "solarPlant" as const,
      label: "Solar Plant",
      readyAt: 1_700_000_600_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    };
    const onFinishBuilding = () => undefined;

    expect(infrastructureHeaderFinishAction(infrastructureFinishAction({
      isBuildingReadyToFinish: false,
      onFinishBuilding,
      queue,
    }))).toBeUndefined();

    const ready = infrastructureFinishAction({
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });

    expect(infrastructureHeaderFinishAction(ready)).toBe(ready);
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("translates transient building finish state-read failures into recovery copy", () => {
    expect(buildingFinishActionErrorLabel(
      new Error("The wallet could not read the current game contract state. Retry in a moment while the app checks whether the game API or RPC recovered."),
    )).toBe(buildingFinishStateReadFailureLabel);

    expect(buildingFinishActionErrorLabel(new Error("Internal JSON-RPC error.")))
      .toBe(buildingFinishStateReadFailureLabel);
  });

  test("keeps actionable building finish errors specific", () => {
    expect(buildingFinishActionErrorLabel(
      new Error("No active building upgrade is waiting to be finished. Refresh infrastructure state and retry."),
    )).toBe("No active building upgrade is waiting to be finished. Refresh infrastructure state and retry.");
  });

  test("keeps loaded top bar energy available during infrastructure refresh", () => {
    const settledState = createInitialPlayableState();
    const infrastructureChainState = infrastructureState({
      energyBalance: {
        produced: "100",
        required: "40",
        scaleBps: "10000",
      },
    });

    expect(topBarEnergyFor({
      infrastructureChainState,
      isWalletConnected: true,
      settledState,
    })).toMatchObject({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("keeps loaded top bar energy independent from background refresh errors", () => {
    const settledState = createInitialPlayableState();

    expect(topBarEnergyFor({
      infrastructureChainState: infrastructureState({
        energyBalance: {
          produced: "100",
          required: "40",
          scaleBps: "10000",
        },
      }),
      isWalletConnected: true,
      settledState,
    })).toMatchObject({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("derives top bar energy from indexed infrastructure levels when live energy is unavailable", () => {
    const baseState = createInitialPlayableState();
    const settledState = {
      ...baseState,
      buildings: {
        ...baseState.buildings,
        metalMine: 1,
        solarPlant: 0,
      },
      ships: {
        ...baseState.ships,
        solarSatellite: 3,
      },
    };

    expect(topBarEnergyFor({
      infrastructureChainState: infrastructureState({
        energyBalance: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      isWalletConnected: true,
      planetProductionProfile: {
        maxTemperature: 80,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
      },
      settledState,
    })).toEqual({
      deuteriumConsumed: 0,
      produced: 108,
      required: 11,
      scaleBps: 10000,
      sources: {
        solarPlant: 0,
        fusionReactor: 0,
        fusionReactorDeuteriumConsumed: 0,
        solarSatellites: 108,
        solarSatelliteCount: 3,
        solarSatelliteEnergy: 36,
      },
    });

    expect(topBarEnergyFor({
      infrastructureChainState: infrastructureState({
        energyBalance: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      isWalletConnected: true,
      planetProductionProfile: {
        maxTemperature: 80,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
      },
      settledState: {
        ...settledState,
        ships: {
          ...settledState.ships,
          solarSatellite: 1,
        },
      },
    })?.produced).toBe(36);
  });

  test("does not invent top bar energy when chain state is missing", () => {
    const settledState = createInitialPlayableState();

    expect(topBarEnergyFor({
      infrastructureChainState: null,
      isWalletConnected: true,
      settledState,
    })).toBeUndefined();
  });

  test("names research start confirmations with technology label and target level", () => {
    expect(researchStartTransactionLabel(0, "energy", {
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      resources: { metal: "1000", crystal: "2000", deuterium: "1000" },
      researchLabLevel: 1,
      researchNetworkLabLevels: [],
      technologyLevels: { "0": 1 },
      technologies: [
        { id: 0, level: 1, cost: { metal: "0", crystal: "1600", deuterium: "800" } },
      ],
      queue: null,
    })).toBe("Energy Technology level 2 research");
  });

  test("uses backend-accrued wallet resources without adding local pending deltas", () => {
    const resources = { metal: 1_240, crystal: 930, deuterium: 410 };

    expect(walletSpendableResourcesFor({
      isWalletConnected: true,
      onChainResources: resources,
    })).toBe(resources);

    expect(walletSpendableResourcesFor({
      isWalletConnected: false,
      onChainResources: resources,
    })).toBeUndefined();
  });

  test("pendingSpendsFromQueues collects active queue spends with cost and start time", () => {
    const buildingQueue: QueueStateResponse = {
      active: true,
      kind: "building",
      itemId: 1,
      targetLevel: 7,
      readyAt: "1700003600",
      startedAt: "1700000000",
      cost: { metal: "683", crystal: "170", deuterium: "0" },
    };
    const shipQueue: QueueStateResponse = {
      active: true,
      kind: "ship",
      itemId: 202,
      quantity: 1,
      readyAt: "1700001000",
      startedAt: "1700000500",
      cost: { metal: "2000", crystal: "0", deuterium: "0" },
    };
    const spends = pendingSpendsFromQueues([buildingQueue, shipQueue]);
    expect(spends).toEqual([
      { cost: { metal: 683, crystal: 170, deuterium: 0 }, startedAtMs: 1_700_000_000_000 },
      { cost: { metal: 2_000, crystal: 0, deuterium: 0 }, startedAtMs: 1_700_000_500_000 },
    ]);
  });

  test("pendingSpendsFromQueues ignores inactive, missing, and zero-cost queues", () => {
    const inactive: QueueStateResponse = {
      active: false,
      kind: "building",
      readyAt: null,
      cost: { metal: "100", crystal: "0", deuterium: "0" },
    };
    const zeroCost: QueueStateResponse = {
      active: true,
      kind: "research",
      readyAt: "1700000600",
      startedAt: "1700000000",
      cost: { metal: "0", crystal: "0", deuterium: "0" },
    };
    expect(pendingSpendsFromQueues([inactive, null, undefined, zeroCost])).toEqual([]);
  });

  test("blocks research completion transactions until the active queue is ready", () => {
    expect(researchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_700_000_000_000,
      researchState: researchState({
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000600",
          startedAt: "1699997000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
    })).toBe("Research is not ready to complete yet.");

    expect(researchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_700_000_600_000,
      researchState: researchState({
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000600",
          startedAt: "1699997000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
    })).toBeUndefined();
  });

  test("allows research completion with normalized millisecond readyAt values", () => {
    expect(researchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_700_000_600_000,
      researchState: researchState({
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000600000",
          startedAt: "1699997000000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
    })).toBeUndefined();

    expect(researchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_700_000_600_000,
      researchState: researchState({
        queue: {
          active: true,
          kind: "research",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000600001",
          startedAt: "1699997000000",
          cost: { metal: "0", crystal: "1600", deuterium: "800" },
        },
      }),
    })).toBe("Research is not ready to complete yet.");
  });

  test("revalidates research completion against backend canonical state before wallet submission", async () => {
    const fallback = researchState();
    const latest = researchState({
      queue: {
        active: true,
        kind: "research",
        itemId: 0,
        targetLevel: 2,
        readyAt: "1700000600",
        startedAt: "1699997000",
        cost: { metal: "0", crystal: "1600", deuterium: "800" },
      },
    });
    const calls: unknown[][] = [];

    const result = await researchStateForCompletionRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback,
      loadResearchState: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(latest);
      }) as never,
    });

    expect(result).toBe(latest);
    expect(calls).toEqual([[
      "https://api.test",
      "0x2222222222222222222222222222222222222222",
      "7",
    ]]);
  });

  test("preserves a recently known active research queue when a refresh returns empty queue data", () => {
    const knownQueue = activeResearchQueue();
    const next = researchState({ queue: null });

    expect(researchStateWithPreservedActiveQueue({
      knownResearchQueue: knownQueue,
      next,
    }).queue).toBe(knownQueue);

    expect(researchStartUnavailableReasonFor({
      canTransact: true,
      knownResearchQueue: knownQueue,
      researchState: next,
    })).toBe("Another research is already active. Finish or refresh the active research before starting a new one.");
  });

  test("blocks research start when live wallet queues still report active research", async () => {
    const latestResearch = researchState({ queue: null });
    const latestQueues = walletQueues({ research: activeResearchQueue({ itemId: 1, targetLevel: 4 }) });
    const calls: unknown[][] = [];

    const result = await researchStartUnavailableReasonAfterLiveRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: researchState({ queue: null }),
      loadResearchState: ((...args: unknown[]) => {
        calls.push(["research", ...args]);
        return Promise.resolve(latestResearch);
      }) as never,
      loadWalletQueues: ((...args: unknown[]) => {
        calls.push(["queues", ...args]);
        return Promise.resolve(latestQueues);
      }) as never,
    });

    expect(result).toEqual({
      researchState: latestResearch,
      queues: latestQueues,
      unavailableReason: "Another research is already active. Finish or refresh the active research before starting a new one.",
    });
    expect(calls).toEqual([
      [
        "research",
        "https://api.test",
        "0x2222222222222222222222222222222222222222",
        "7",
      ],
      [
        "queues",
        "https://api.test",
        "0x2222222222222222222222222222222222222222",
        "7",
      ],
    ]);
  });

  test("keeps research start preflight blocked when live state transiently omits a known active queue", async () => {
    const latestResearch = researchState({ queue: null });
    const latestQueues = walletQueues({ research: null });
    const knownQueue = activeResearchQueue();

    const result = await researchStartUnavailableReasonAfterLiveRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: researchState({ queue: knownQueue }),
      knownResearchQueue: knownQueue,
      loadResearchState: (() => Promise.resolve(latestResearch)) as never,
      loadWalletQueues: (() => Promise.resolve(latestQueues)) as never,
    });

    expect(result.unavailableReason).toBe("Another research is already active. Finish or refresh the active research before starting a new one.");
  });

  test("allows Overview-ready research completion to reach backend revalidation before wallet submission", () => {
    const readyOverviewQueue = {
      active: true,
      cost: { metal: "800", crystal: "400", deuterium: "0" },
      itemId: 0,
      kind: "research",
      readyAt: "1700000000",
      targetLevel: 2,
    };

    expect(overviewResearchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_700_000_000_000,
      overviewQueue: readyOverviewQueue,
      researchState: null,
    })).toBeUndefined();

    expect(overviewResearchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_699_999_000_000,
      overviewQueue: readyOverviewQueue,
      researchState: null,
    })).toBe("No active research queue is available to complete.");
  });

  test("lets Overview defense completion use the selected wallet queue planet before Defenses state is loaded", () => {
    expect(defenseCompletionPlanetIdFor({
      activePlanetId: "9",
      defenseState: null,
      walletQueues: playerQueues({
        defense: {
          active: true,
          cost: { metal: "2000", crystal: "0", deuterium: "0" },
          itemId: 0,
          kind: "defense",
          quantity: 1,
          readyAt: "1700000000",
        },
        homePlanetId: "7",
      }),
    })).toBe("9");
  });

  test("falls back to wallet queue home planet for Overview defense completion when page state is absent", () => {
    expect(defenseCompletionPlanetIdFor({
      activePlanetId: undefined,
      defenseState: null,
      walletQueues: playerQueues({ homePlanetId: "7" }),
    })).toBe("7");
  });

  test("keeps loaded defense state as a defense completion fallback", () => {
    expect(defenseCompletionPlanetIdFor({
      activePlanetId: undefined,
      defenseState: defenseState({ homePlanetId: "11" }),
      walletQueues: undefined,
    })).toBe("11");
  });

  test("lets Overview Shipyard completion use the selected wallet queue planet before Shipyard state is loaded", () => {
    expect(shipCompletionPlanetIdFor({
      activePlanetId: "9",
      shipyardState: null,
      walletQueues: playerQueues({
        homePlanetId: "7",
        ship: {
          active: true,
          cost: { metal: "3000", crystal: "1000", deuterium: "0" },
          itemId: 1,
          kind: "ship",
          quantity: 1,
          readyAt: "1700000000",
        },
      }),
    })).toBe("9");
  });

  test("falls back to wallet queue home planet for Overview Shipyard completion when page state is absent", () => {
    expect(shipCompletionPlanetIdFor({
      activePlanetId: undefined,
      shipyardState: null,
      walletQueues: playerQueues({ homePlanetId: "7" }),
    })).toBe("7");
  });

  test("keeps loaded Shipyard state as a Shipyard completion fallback", () => {
    expect(shipCompletionPlanetIdFor({
      activePlanetId: undefined,
      shipyardState: shipyardState({ homePlanetId: "11", planetId: "12" }),
      walletQueues: undefined,
    })).toBe("12");
  });

  test("preserves active research queues when a background wallet poll returns an empty research queue", () => {
    const activeResearch = activeResearchQueue();
    const currentQueues = playerQueues({ research: activeResearch });
    const emptyPollQueues = playerQueues({ research: null });

    expect(preserveActiveResearchQueue(currentQueues, emptyPollQueues).research).toEqual(activeResearch);
  });

  test("preserves active research state during transient empty research refreshes", () => {
    const activeResearch = activeResearchQueue({ targetLevel: 2 });
    const currentState = researchState({ queue: activeResearch });
    const emptyRefresh = researchState({ queue: null });

    expect(preserveActiveResearchState(currentState, emptyRefresh).queue).toEqual(activeResearch);
  });

  test("clears preserved research queues once the refreshed research level confirms completion", () => {
    const activeResearch = activeResearchQueue({ targetLevel: 2 });
    const currentState = researchState({ queue: activeResearch });
    const completedRefresh = researchState({
      queue: null,
      technologyLevels: { "0": 2 },
      technologies: [
        { id: 0, level: 2, cost: { metal: "0", crystal: "3200", deuterium: "1600" } },
      ],
    });

    expect(preserveActiveResearchState(currentState, completedRefresh).queue).toBeNull();
  });

  test("uses a preserved wallet research queue to keep new research starts disabled", () => {
    const activeResearch = activeResearchQueue({ itemId: 0, targetLevel: 2 });
    const loadedResearch = researchState({ queue: null });
    const effectiveResearchState = researchStateWithFallbackQueue(loadedResearch, activeResearch);

    expect(effectiveResearchState?.queue).toEqual(activeResearch);
    expect(researchCompletionUnavailableReasonFor({
      canTransact: true,
      now: 1_699_999_000_000,
      researchState: effectiveResearchState,
    })).toBe("Research is not ready to complete yet.");
  });

  test("lets Overview derive building readiness from the displayed active queue", () => {
    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: null,
      isBuildingReadyToFinish: false,
      now: 1_700_000_000_000,
    })).toBeUndefined();

    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: buildingQueue({
        readyAt: "1700000600",
      }),
      isBuildingReadyToFinish: false,
      now: 1_700_000_000_000,
    })).toBe(false);

    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: buildingQueue({
        readyAt: "1700000000",
      }),
      isBuildingReadyToFinish: false,
      now: 1_700_000_000_000,
    })).toBe(true);

    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: buildingQueue({
        readyAt: "1700000600",
      }),
      isBuildingReadyToFinish: true,
      now: 1_700_000_000_000,
    })).toBe(true);
  });

  test("lets Overview expose ready building queues while wallet submission still requires canonical verification", () => {
    const readyWalletQueue = buildingQueue({
      readyAt: "1700000000",
    });
    const unverifiedInfrastructure = infrastructureState({
      queue: null,
      source: "contract-state-indexer",
      stale: true,
    });

    expect(canonicalInfrastructureBuildingCompletionQueue(unverifiedInfrastructure)).toBeNull();
    expect(buildingCompletionReadyToFinishFlag({
      infrastructureState: unverifiedInfrastructure,
      now: 1_700_000_000_000,
    })).toBe(false);
    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: readyWalletQueue,
      isBuildingReadyToFinish: buildingCompletionReadyToFinishFlag({
        infrastructureState: unverifiedInfrastructure,
        now: 1_700_000_000_000,
      }),
      now: 1_700_000_000_000,
    })).toBe(true);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyWalletQueue,
      infrastructureState: unverifiedInfrastructure,
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);

    const canonicalInfrastructure = infrastructureState({
      queue: readyWalletQueue,
      source: "contract-state-indexer",
      stale: false,
    });
    expect(canonicalInfrastructureBuildingCompletionQueue(canonicalInfrastructure)).toBe(readyWalletQueue);
    expect(buildingCompletionReadyToFinishFlag({
      infrastructureState: canonicalInfrastructure,
      now: 1_700_000_000_000,
    })).toBe(false);
    expect(buildingCompletionReadyToFinishFlag({
      infrastructureState: canonicalInfrastructure,
      now: 1_700_000_030_000,
    })).toBe(true);
  });

  test("blocks stale building completion transactions when backend infrastructure has no active queue", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({ queue: null }),
      now: 1_700_000_000_000,
    })).toBe("No active building upgrade is waiting to be finished. Refresh infrastructure state and retry.");
  });

  test("blocks stale building completion transactions when the backend queue is not ready", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: {
          active: true,
          kind: "building",
          itemId: 0,
          targetLevel: 2,
          readyAt: "1700000600",
          startedAt: "1699997000",
          cost: { metal: "60", crystal: "15", deuterium: "0" },
        },
      }),
      now: 1_700_000_000_000,
    })).toBe("Building upgrade is not ready to finish yet.");
  });

  test("blocks building completion transactions when backend infrastructure state is missing", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: null,
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);
  });

  test("allows ready indexed building completion from warm stale metadata", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();

    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);

    const readyQueue = readyBuildingQueue();
    expect(buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_030_000,
    })).toBe(true);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();

    expect(buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        indexer: {
          indexedState: "stale",
          safeToServeIndexedState: false,
          staleReason: "planet_resources_pending:98",
        },
        queue: readyQueue,
        source: "contract-state-indexer",
      }),
      now: 1_700_000_030_000,
    })).toBe(true);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        indexer: {
          indexedState: "stale",
          safeToServeIndexedState: false,
          staleReason: "planet_resources_pending:98",
        },
        queue: readyQueue,
        source: "contract-state-indexer",
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();
  });

  test("allows indexed ready building queues after backend revalidation without readonly preflight gating", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "contract-state-indexer",
        stale: false,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();
  });

  test("blocks indexed ready building queues while infrastructure detail state is still loading", () => {
    const readyQueue = readyBuildingQueue();

    expect(buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: readyQueue,
      infrastructureState: null,
      now: 1_700_000_000_000,
    })).toBe(false);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyQueue,
      infrastructureState: null,
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);
    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      canTransact: true,
      infrastructureState: null,
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);
  });

  test("keeps visible ready queues paused while indexed infrastructure is stale", () => {
    const readyQueue = readyBuildingQueue();

    expect(buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        queue: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(false);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        queue: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("keeps degraded ready indexed building completion paused", () => {
    const readyQueue = readyBuildingQueue();

    expect(buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        degraded: true,
        queue: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(false);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: readyQueue,
      infrastructureState: infrastructureState({
        degraded: true,
        queue: null,
        source: "contract-state-indexer",
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("keeps displayed building finish verification open only when backend indexed queue is ready", () => {
    const readyQueue = readyBuildingQueue();

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: false,
      }),
      isBuildingReadyToFinish: false,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_030_000,
    })).toBeUndefined();

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("routes degraded ready building finish actions to backend-unavailable copy", () => {
    const readyQueue = readyBuildingQueue();

    expect(infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: false,
      }),
      infrastructureError: "Moon API could not be reached from this browser.",
    })).toBe(infrastructureBackendSyncPausedLabel);

    expect(infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
    })).toBe(infrastructureBackendSyncPausedLabel);

    expect(infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: false,
        indexer: {
          indexedState: "stale",
          safeToServeIndexedState: false,
          staleReason: "planet_resources_pending:98",
        },
      }),
    })).toBe(infrastructureBackendSyncPausedLabel);

    expect(infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState: infrastructureState({
        degraded: true,
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
    })).toBe(infrastructureBackendSyncPausedLabel);

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: false,
        degraded: true,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toBe(infrastructureBackendSyncPausedLabel);
    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_030_000,
    })).toBeUndefined();
    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
      canTransact: true,
      infrastructureState: infrastructureState({
        indexer: {
          indexedState: "stale",
          safeToServeIndexedState: false,
          staleReason: "planet_resources_pending:98",
        },
        queue: readyQueue,
        source: "contract-state-indexer",
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_030_000,
    })).toBeUndefined();
    expect(infrastructureBackendSyncPausedLabel).toContain("Infrastructure API is temporarily unavailable");
    expect(infrastructureBackendSyncPausedLabel).not.toContain("Syncing building queue");
  });

  test("does not show queue catch-up copy for shared wallet building queues", () => {
    const readyQueue = readyBuildingQueue();
    const walletPaths = ["Farcaster mobile", "Rabby", "OKX", "MetaMask", "generic injected wallet"];

    for (const walletPath of walletPaths) {
      const unavailableReason = buildingFinishUnavailableReasonForDisplay({
        activeBuildingQueue: readyQueue,
        backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: false,
        }),
        isBuildingReadyToFinish: true,
        isDisplayedBuildingQueueReady: true,
        now: 1_700_000_030_000,
      });

      expect(`${walletPath}: ${unavailableReason}`).not.toContain("Syncing building queue");
      expect(unavailableReason).toBeUndefined();
    }
  });

  test("does not let backend building finish verification bypass wallet availability", () => {
    const readyQueue = readyBuildingQueue();

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedLabel,
      canTransact: false,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: false,
      }),
      isBuildingReadyToFinish: false,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toBe("Wallet or game contract is unavailable.");
  });

  test("blocks duplicate finish attempts while a submitted building completion is still visible", () => {
    const readyQueue = readyBuildingQueue();

    expect(completedBuildingFinishSyncReasonFor({
      activeBuildingQueue: readyQueue,
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toContain("Waiting for backend state to clear this completed queue");

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      canTransact: true,
      completedBuildingFinishExpectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toContain("Waiting for backend state to clear this completed queue");
  });

  test("clears duplicate finish blocking when the active building queue changes", () => {
    const readyQueue = readyBuildingQueue();

    expect(completedBuildingFinishSyncReasonFor({
      activeBuildingQueue: {
        ...readyQueue,
        targetLevel: 3,
      },
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toBeUndefined();
    expect(completedBuildingFinishSyncReasonFor({
      activeBuildingQueue: null,
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toBeUndefined();
  });

  test("keeps failed finish attempts recoverable after backend revalidation catches up", () => {
    const readyQueue = readyBuildingQueue();

    expect(failedBuildingFinishSyncReasonFor({
      activeBuildingQueue: readyQueue,
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toContain("Building completion failed for this ready queue");

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_030_000,
    })).toBeUndefined();

    expect(buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue: readyQueue,
      canTransact: true,
      completedBuildingFinishExpectation: undefined,
      infrastructureState: infrastructureState({
        queue: readyQueue,
        source: "live-rpc",
        stale: false,
      }),
      isBuildingReadyToFinish: true,
      isDisplayedBuildingQueueReady: true,
      now: 1_700_000_000_000,
    })).toBeUndefined();
  });

  test("keeps wallet cancellation copy retryable for ready building completion", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("Building completion was cancelled in the wallet. The ready queue is still available");
    expect(source).toContain("label: isRejectedByUser ? buildingFinishRejectedLabel : failedSyncReason ?? label");
    expect(source).toContain("if (!isRejectedByUser && failedSyncReason)");
    expect(source).toContain("setFailedBuildingFinishExpectation(undefined);");
    expect(source).not.toContain("}) ?? failedBuildingFinishSyncReasonFor({");
  });

  test("clears failed finish blocking when the active building queue changes", () => {
    const readyQueue = readyBuildingQueue();

    expect(failedBuildingFinishSyncReasonFor({
      activeBuildingQueue: {
        ...readyQueue,
        targetLevel: 3,
      },
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toBeUndefined();
    expect(failedBuildingFinishSyncReasonFor({
      activeBuildingQueue: null,
      expectation: {
        itemId: readyQueue.itemId,
        targetLevel: readyQueue.targetLevel,
      },
    })).toBeUndefined();
  });

  test("allows building completion wallet submission after backend ready queue revalidation", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();
  });

  test("blocks building completion during the client-clock safety window", () => {
    expect(buildingCompletionReadyToFinishFlag({
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_029_000,
    })).toBe(false);
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_029_000,
    })).toBe("Building upgrade is not ready to finish yet.");
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();
  });

  test("allows building completion revalidation with normalized millisecond readyAt values", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: {
          ...readyBuildingQueue(),
          readyAt: "1700000000000",
          startedAt: "1699997000000",
        },
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_030_000,
    })).toBeUndefined();

    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: {
          ...readyBuildingQueue(),
          readyAt: "1700000000001",
          startedAt: "1699997000000",
        },
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_000_000,
    })).toBe("Building upgrade is not ready to finish yet.");
  });

  test("revalidates building completion against backend canonical infrastructure state before wallet submission", async () => {
    const fallback = infrastructureState();
    const latest = infrastructureState({
      queue: readyBuildingQueue(),
    });
    const calls: unknown[][] = [];

    const result = await infrastructureStateForCompletionRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback,
      loadInfrastructureState: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(latest);
      }) as never,
    });

    expect(result).toBe(latest);
    expect(calls).toEqual([[
      "https://api.test",
      "0x2222222222222222222222222222222222222222",
      "7",
    ]]);
  });

  test("uses backend building completion revalidation even when the local queue snapshot is stale", async () => {
    const fallback = infrastructureState({
      queue: {
        ...readyBuildingQueue(),
        readyAt: "1700000600",
      },
      source: "contract-state-indexer",
      stale: true,
    });
    const latest = infrastructureState({
      queue: readyBuildingQueue(),
      source: "live-rpc",
      stale: false,
    });
    const calls: unknown[][] = [];

    const result = await buildingCompletionUnavailableReasonAfterBackendRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback,
      loadInfrastructureState: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(latest);
      }) as never,
      now: 1_700_000_030_000,
    });

    expect(result).toEqual({
      infrastructureState: latest,
      unavailableReason: undefined,
    });
    expect(calls).toEqual([[
      "https://api.test",
      "0x2222222222222222222222222222222222222222",
      "7",
    ]]);
  });

  test("keeps building completion revalidation blocked when the refreshed indexed queue is still stale", async () => {
    const readyQueue = readyBuildingQueue();
    const latest = infrastructureState({
      queue: readyQueue,
      source: "contract-state-indexer",
      stale: true,
    });
    const calls: unknown[][] = [];

    const result = await buildingCompletionUnavailableReasonAfterBackendRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: infrastructureState({
        queue: readyQueue,
        source: "contract-state-indexer",
        stale: true,
      }),
      knownBuildingQueue: readyQueue,
      loadInfrastructureState: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(latest);
      }) as never,
      now: 1_700_000_000_000,
    });

    expect(result).toEqual({
      infrastructureState: latest,
      unavailableReason: infrastructureBackendSyncPausedLabel,
    });
    expect(calls).toEqual([[
      "https://api.test",
      "0x2222222222222222222222222222222222222222",
      "7",
    ]]);
  });

  test("blocks the indexed wallet building queue when completion revalidation has no infrastructure detail yet", async () => {
    const readyQueue = readyBuildingQueue();
    const calls: unknown[][] = [];

    const result = await buildingCompletionUnavailableReasonAfterBackendRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: null,
      knownBuildingQueue: readyQueue,
      loadInfrastructureState: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(null);
      }) as never,
      now: 1_700_000_000_000,
    });

    expect(result).toEqual({
      infrastructureState: null,
      unavailableReason: buildingFinishLiveStateRequiredLabel,
    });
    expect(calls).toEqual([[
      "https://api.test",
      "0x2222222222222222222222222222222222222222",
      "7",
    ]]);
  });

  test("keeps loaded infrastructure usable while a background refresh is pending", () => {
    expect(infrastructureUnavailableReasonFor({
      buildingAction: { status: "idle" },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState(),
      infrastructureLoading: true,
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
      onChainStatus: "loading",
      runtimeConfigStatus: "ready",
    })).toBeUndefined();
  });

  test("pauses infrastructure actions while loaded backend state is refresh-degraded", () => {
    expect(infrastructureUnavailableReasonFor({
      buildingAction: { status: "idle" },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState(),
      infrastructureError: "Infrastructure request failed with 503.",
      infrastructureLoading: false,
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
      onChainStatus: "error",
      runtimeConfigStatus: "ready",
    })).toBe(infrastructureBackendSyncPausedLabel);

    expect(infrastructureUnavailableReasonFor({
      buildingAction: { status: "idle" },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState({ degraded: true, stale: true }),
      infrastructureLoading: false,
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
      onChainStatus: "ready",
      runtimeConfigStatus: "ready",
    })).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("uses infrastructure loading and error reasons before the first state arrives", () => {
    expect(infrastructureUnavailableReasonFor({
      buildingAction: { status: "idle" },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: null,
      infrastructureLoading: true,
      isWalletConnected: true,
      onChainResources: undefined,
      onChainStatus: "loading",
      runtimeConfigStatus: "ready",
    })).toBe("Loading your wallet resources and building levels");

    expect(infrastructureUnavailableReasonFor({
      buildingAction: { status: "idle" },
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: null,
      infrastructureError: "Infrastructure request failed with 503.",
      infrastructureLoading: false,
      isWalletConnected: true,
      onChainResources: undefined,
      onChainStatus: "error",
      runtimeConfigStatus: "ready",
    })).toBe("Game state unavailable; upgrades are disabled until your wallet resources and building levels load.");
  });

  test("keeps active construction visible when reload has a queue but infrastructure details fail", () => {
    const activeBuilding = {
      active: true,
      kind: "building",
      itemId: 3,
      targetLevel: 9,
      readyAt: "1770000600",
      startedAt: "1770000000",
      cost: { metal: "300", crystal: "120", deuterium: "0" },
    };

    expect(infrastructureLoadErrorFor({
      activeBuildingQueue: activeBuilding,
      infrastructureChainState: null,
      infrastructureError: "Infrastructure request failed with 503.",
      isWalletConnected: true,
    })).toBe("Infrastructure request failed with 503.");

    expect(infrastructureLoadErrorFor({
      activeBuildingQueue: null,
      infrastructureChainState: null,
      infrastructureError: "Infrastructure request failed with 503.",
      isWalletConnected: true,
    })).toBe("Infrastructure request failed with 503.");

    expect(infrastructureLoadErrorFor({
      activeBuildingQueue: null,
      infrastructureChainState: infrastructureState(),
      infrastructureError: "Infrastructure request failed with 503.",
      isWalletConnected: true,
    })).toBe("Infrastructure request failed with 503.");

    expect(hasInfrastructureDisplayState({
      activeBuildingQueue: activeBuilding,
      homePlanetId: "7",
      infrastructureChainState: null,
      onChainResources: { metal: 500, crystal: 300, deuterium: 100 },
    })).toBe(true);

    expect(hasInfrastructureDisplayState({
      activeBuildingQueue: null,
      homePlanetId: "7",
      infrastructureChainState: null,
      onChainResources: { metal: 500, crystal: 300, deuterium: 100 },
    })).toBe(false);
  });

  test("allows building transactions from refreshed backend infrastructure resources", () => {
    expect(refreshedInfrastructureUnavailableReasonFor({
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState(),
      isWalletConnected: true,
      onChainResources: undefined,
      runtimeConfigStatus: "ready",
    })).toBeUndefined();
  });

  test("blocks building transactions when refreshed infrastructure is unavailable", () => {
    expect(refreshedInfrastructureUnavailableReasonFor({
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: {
        ...infrastructureState(),
        infrastructureAvailable: false,
        unavailableReason: "Infrastructure is unavailable on this deployment.",
      },
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
      runtimeConfigStatus: "ready",
    })).toBe("Infrastructure is unavailable on this deployment.");
  });

  test("blocks building transactions when refreshed backend resources cannot afford the upgrade", () => {
    expect(refreshedInfrastructureUpgradeUnavailableReasonFor({
      buildingKey: "solarPlant",
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState({
        resources: { metal: "0", crystal: "0", deuterium: "0" },
      }),
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
      runtimeConfigStatus: "ready",
    })).toContain("Requires");
  });

  test("blocks Shipyard upgrades while refreshed backend infrastructure is stale", () => {
    expect(refreshedInfrastructureUpgradeUnavailableReasonFor({
      buildingKey: "shipyard",
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState({
        source: "contract-state-indexer",
        stale: true,
      }),
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
      runtimeConfigStatus: "ready",
    })).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("keeps Shipyard upgrade backend read failures out of wallet reconnect copy", () => {
    const label = buildingUpgradeActionErrorLabel(
      new Error("Infrastructure API failed: 400: RPC 3: execution reverted")
    );

    expect(label).toBe(infrastructureBackendSyncPausedLabel);
    expect(label).not.toContain("wallet");
    expect(label).not.toContain("Base Sepolia");
  });

  test("blocks building transactions with ready-to-finish copy when refreshed backend infrastructure has a ready active queue", () => {
    expect(refreshedInfrastructureUpgradeUnavailableReasonFor({
      buildingKey: "metalMine",
      gameContract: "0x3333333333333333333333333333333333333333",
      homePlanetId: "7",
      infrastructureChainState: infrastructureState({
        queue: {
          active: true,
          itemId: 1,
          targetLevel: 2,
          readyAt: "1770000300",
          startedAt: "1770000000",
          cost: { metal: "60", crystal: "15", deuterium: "0" },
        },
      }),
      isWalletConnected: true,
      onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
      runtimeConfigStatus: "ready",
    })).toContain("ready to finish");
  });

  test("hydrates indexed planet state before requesting canonical settlement state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];
    const activeMission = fleetMission({ missionId: "42", owner: wallet, originPlanetId: "7", targetPlanetId: "9" });

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/settlement")) {
        throw new Error("indexed state should hydrate before canonical settlement reads");
      }

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          queues: { research: null },
          planets: [indexedPlanet(wallet)],
        }));
      }

      if (url.pathname.endsWith("/fleet-visibility")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          incoming: [],
          outgoing: [activeMission],
          returning: [],
          joinableAttacks: [],
          completedMissions: [],
          battleReports: [],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement).toMatchObject({
        wallet,
        hasFirstPlanet: true,
        homePlanetId: "7",
        planet: {
          planetId: "7",
          resources: {
            metal: "5000",
            crystal: "4900",
            deuterium: "4800",
          },
        },
      });
      expect(snapshot.planetsResponse.planets).toHaveLength(1);
      expect(snapshot.fleetVisibility.outgoing.map((mission) => mission.missionId)).toEqual(["42"]);
      expect(requestedPaths).toContain(`/wallet/${wallet}/planets`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/fleet-visibility`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/queues`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not start a pending settlement read before showing indexed planet state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/settlement")) {
        return new Promise<Response>(() => undefined);
      }

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          queues: { research: null },
          planets: [indexedPlanet(wallet)],
        }));
      }

      if (url.pathname.endsWith("/fleet-visibility")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          incoming: [],
          outgoing: [],
          returning: [],
          joinableAttacks: [],
          completedMissions: [],
          battleReports: [],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement.homePlanetId).toBe("7");
      expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
      expect(snapshot.planetsResponse.planets).toHaveLength(1);
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`, `/wallet/${wallet}/fleet-visibility`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps indexed active building queues in the reload snapshot", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const activeBuilding = {
      active: true,
      kind: "building",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1770000600",
      startedAt: "1770000000",
      cost: {
        metal: "120",
        crystal: "30",
        deuterium: "0",
      },
    };

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          queues: { research: null },
          planets: [{
            ...indexedPlanet(wallet),
            queues: {
              building: activeBuilding,
              defense: null,
              ship: null,
            },
          }],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.queues.building).toEqual(activeBuilding);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps indexed active research queues in the reload snapshot", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];
    const activeResearch = {
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1770000600",
      startedAt: "1770000000",
      cost: {
        metal: "800",
        crystal: "400",
        deuterium: "0",
      },
    };

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          queues: {
            research: activeResearch,
          },
          planets: [indexedPlanet(wallet)],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.queues.research).toEqual(activeResearch);
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`, `/wallet/${wallet}/fleet-visibility`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches active research queues when indexed planets omit the global queue snapshot", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];
    const activeResearch = {
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1770000600",
      startedAt: "1770000000",
      cost: {
        metal: "800",
        crystal: "400",
        deuterium: "0",
      },
    };

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);

      if (url.pathname.endsWith("/settlement")) {
        throw new Error("indexed state should hydrate before canonical settlement reads");
      }

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          planets: [indexedPlanet(wallet)],
        }));
      }

      if (url.pathname.endsWith("/queues")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          building: null,
          defense: null,
          ship: null,
          research: activeResearch,
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.queues.research).toEqual(activeResearch);
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`, `/wallet/${wallet}/queues`, `/wallet/${wallet}/fleet-visibility`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses indexed queues for the requested active planet", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const homeBuilding = {
      active: true,
      kind: "building",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1770000600",
      startedAt: "1770000000",
      cost: { metal: "120", crystal: "30", deuterium: "0" },
    };
    const colonyBuilding = {
      active: true,
      kind: "building",
      itemId: 1,
      targetLevel: 3,
      readyAt: "1770000900",
      startedAt: "1770000300",
      cost: { metal: "144", crystal: "72", deuterium: "0" },
    };

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          planets: [
            {
              ...indexedPlanet(wallet),
              queues: { building: homeBuilding, defense: null, ship: null },
            },
            {
              ...indexedPlanet(wallet),
              planetId: "8",
              isHomePlanet: false,
              coordinates: "2:44:10",
              queues: { building: colonyBuilding, defense: null, ship: null },
            },
          ],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, "8");

      expect(snapshot.queues.homePlanetId).toBe("8");
      expect(snapshot.queues.building).toEqual(colonyBuilding);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to canonical settlement state when indexed planets are empty", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: null,
          planets: [],
        }));
      }

      if (url.pathname.endsWith("/settlement")) {
        return Promise.resolve(Response.json({
          wallet,
          hasFirstPlanet: true,
          homePlanetId: "7",
          planet: indexedPlanet(wallet),
        }));
      }

      if (url.pathname.endsWith("/queues")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          building: null,
          defense: null,
          ship: null,
          research: null,
        }));
      }

      if (url.pathname.endsWith("/fleet-visibility")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          incoming: [],
          outgoing: [],
          returning: [],
          joinableAttacks: [],
          completedMissions: [],
          battleReports: [],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement.homePlanetId).toBe("7");
      expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
      expect(requestedPaths[0]).toBe(`/wallet/${wallet}/planets`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/queues`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/fleet-visibility`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function fleetMission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId: "1",
    status: "Outbound",
    missionType: "Attack",
    owner: "0x1111111111111111111111111111111111111111",
    originPlanetId: "7",
    targetPlanetId: "9",
    arrivalAt: "1770000300",
    returnAt: "1770000600",
    fuelCost: "25",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {
      lightFighter: "1",
    },
    transactionHash: "0xabc",
    blockNumber: "1",
    ...overrides,
  };
}

function infrastructureState({
  degraded,
  energyBalance,
  indexer,
  queue,
  resources,
  source,
  stale,
}: Partial<Pick<ChainInfrastructureState, "degraded" | "energyBalance" | "indexer" | "queue" | "resources" | "source" | "stale">> = {}): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    degraded,
    indexer,
    source,
    stale,
    infrastructureAvailable: true,
    resources: resources ?? { metal: "500", crystal: "500", deuterium: "0" },
    productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
    energyBalance,
    storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
    buildings: [],
    queue: queue ?? null,
  };
}

function readyBuildingQueue(): QueueStateResponse {
  return {
    active: true,
    kind: "building",
    itemId: 0,
    targetLevel: 2,
    readyAt: "1700000000",
    startedAt: "1699997000",
    cost: { metal: "60", crystal: "15", deuterium: "0" },
  };
}

function activeResearchQueue({
  itemId = 0,
  targetLevel = 2,
}: Partial<Pick<QueueStateResponse, "itemId" | "targetLevel">> = {}): QueueStateResponse {
  return {
    active: true,
    kind: "research",
    itemId,
    targetLevel,
    readyAt: "1700000600",
    startedAt: "1699997000",
    cost: { metal: "0", crystal: "1600", deuterium: "800" },
  };
}

function playerQueues({
  defense,
  homePlanetId,
  research,
  ship,
}: Partial<Pick<PlayerQueuesResponse, "defense" | "homePlanetId" | "research" | "ship">> = {}): PlayerQueuesResponse {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: homePlanetId ?? "7",
    building: null,
    defense: defense ?? null,
    ship: ship ?? null,
    research: research ?? null,
  };
}

function defenseState({
  homePlanetId,
}: Partial<Pick<ChainDefenseState, "homePlanetId">> = {}): ChainDefenseState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: homePlanetId ?? "7",
    productionAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    shipyardLevel: 1,
    naniteLevel: 0,
    missileSiloLevel: 0,
    technologyLevels: {},
    defenses: [],
    queue: null,
  };
}

function shipyardState({
  homePlanetId,
  planetId,
}: Partial<Pick<ChainShipyardState, "homePlanetId" | "planetId">> = {}): ChainShipyardState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: homePlanetId ?? "7",
    planetId: planetId ?? null,
    productionAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    shipyardLevel: 1,
    naniteLevel: 0,
    technologyLevels: {},
    ships: [],
    queue: null,
  };
}

function researchState({
  queue,
  technologyLevels,
  technologies,
}: Partial<Pick<ChainResearchState, "queue" | "technologies" | "technologyLevels">> = {}): ChainResearchState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    researchAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: technologyLevels ?? { "0": 1 },
    technologies: technologies ?? [
      { id: 0, level: 1, cost: { metal: "0", crystal: "1600", deuterium: "800" } },
    ],
    queue: queue ?? null,
  };
}

function activeResearchQueue({
  itemId = 0,
  targetLevel = 2,
}: Partial<Pick<QueueStateResponse, "itemId" | "targetLevel">> = {}): QueueStateResponse {
  return {
    active: true,
    kind: "research",
    itemId,
    targetLevel,
    readyAt: "1700000600",
    startedAt: "1699997000",
    cost: { metal: "0", crystal: "1600", deuterium: "800" },
  };
}

function walletQueues({
  research,
}: {
  research: QueueStateResponse | null;
}) {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    building: null,
    defense: null,
    ship: null,
    research,
  };
}

function buildingQueue(overrides: Partial<QueueStateResponse> = {}): QueueStateResponse {
  return {
    active: true,
    cost: { metal: "60", crystal: "15", deuterium: "0" },
    itemId: 0,
    kind: "building",
    readyAt: "1700000000",
    targetLevel: 2,
    ...overrides,
  };
}

function indexedPlanet(wallet: string) {
  return {
    planetId: "7",
    owner: wallet,
    name: null,
    galaxy: 2,
    system: 44,
    position: 9,
    fields: 211,
    temperature: -8,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "1770000000",
    resources: {
      metal: "5000",
      crystal: "4900",
      deuterium: "4800",
    },
    coordinates: "2:44:9",
    fieldsUsed: 3,
    fieldsCapacity: 211,
    isHomePlanet: true,
    keyLevels: {
      metalMine: 1,
      crystalMine: 1,
      deuteriumSynthesizer: 0,
      solarPlant: 1,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    moon: null,
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
  };
}
