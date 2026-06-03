import { describe, expect, test } from "bun:test";
import {
  buildingCompletionUnavailableReasonFor,
  buildingCompletionUnavailableReasonAfterBackendRevalidation,
  buildingFinishActionErrorLabel,
  canLoadIndexedPageState,
  infrastructureStateForCompletionRevalidation,
  infrastructureActionNoticeFor,
  infrastructureLoadErrorFor,
  infrastructureUnavailableReasonFor,
  loadWalletPlanetSyncSnapshot,
  overviewBuildingReadyToFinishFlag,
  overviewResearchCompletionUnavailableReasonFor,
  refreshedInfrastructureUnavailableReasonFor,
  refreshedInfrastructureUpgradeUnavailableReasonFor,
  researchCompletionUnavailableReasonFor,
  researchStateForCompletionRevalidation,
  researchStartTransactionLabel,
  topBarEnergyFor,
  walletSnapshotHydrationKey,
} from "../src/PlayableMvpApp";
import {
  infrastructureFinishAction,
  infrastructureFinishButtonLabel,
  infrastructureUpgradeButtonLabel,
} from "../src/components/InfrastructurePage";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainInfrastructureState, ChainResearchState, QueueStateResponse } from "../src/walletFlow";

describe("Playable MVP app display helpers", () => {
  const buildingFinishStateReadFailureLabel =
    "Can't check game state right now. Your upgrade is still ready, but Veydrift could not verify the contract state. Retry in a moment.";
  const buildingFinishLiveStateRequiredLabel =
    "Can't verify the current building queue right now. Refresh infrastructure state and retry before finishing.";

  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
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

  test("keeps pending infrastructure copy out of unavailable and button labels", () => {
    expect(infrastructureUnavailableReasonFor({
      buildingAction: {
        status: "pending",
        label: "Building completion: unlock MetaMask if needed, then confirm in your wallet.",
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
      label: "Building upgrade is not ready to finish yet.",
      onFinish: undefined,
      reason: "Building upgrade is not ready to finish yet.",
      visible: true,
    });

    expect(infrastructureFinishAction({
      actionUnavailableReason: "Building completion: unlock MetaMask if needed, then confirm in your wallet.",
      isActionPending: true,
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    })).toEqual({
      disabled: true,
      label: "Building completion: unlock MetaMask if needed, then confirm in your wallet.",
      onFinish: undefined,
      reason: "Building completion: unlock MetaMask if needed, then confirm in your wallet.",
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

  test("keeps actionable building finish preflight errors specific", () => {
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
    })).toEqual({
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
    })).toEqual({
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

  test("lets Overview derive building readiness only when no canonical active building queue is available", () => {
    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: null,
      isBuildingReadyToFinish: false,
    })).toBeUndefined();

    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: buildingQueue({
        readyAt: "1700000600",
      }),
      isBuildingReadyToFinish: false,
    })).toBe(false);

    expect(overviewBuildingReadyToFinishFlag({
      activeBuildingQueue: buildingQueue({
        readyAt: "1700000000",
      }),
      isBuildingReadyToFinish: true,
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

  test("blocks building completion transactions when infrastructure state cannot be verified live", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: null,
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);

    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "contract-state-indexer",
        stale: false,
      }),
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);

    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        stale: true,
      }),
      now: 1_700_000_000_000,
    })).toBe(buildingFinishLiveStateRequiredLabel);
  });

  test("allows building completion wallet submission after backend ready queue revalidation", () => {
    expect(buildingCompletionUnavailableReasonFor({
      canTransact: true,
      infrastructureState: infrastructureState({
        queue: readyBuildingQueue(),
        source: "live-rpc",
        stale: false,
      }),
      now: 1_700_000_000_000,
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
      now: 1_700_000_000_000,
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
      now: 1_700_000_000_000,
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

  test("does not replace loaded infrastructure action reasons while background refreshes run", () => {
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
    })).toBeUndefined();
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

  test("blocks building transactions when refreshed backend infrastructure has an active building queue", () => {
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
    })).toContain("currently upgrading");
  });

  test("hydrates indexed planet state before requesting canonical settlement state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

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
      expect(requestedPaths).toContain(`/wallet/${wallet}/planets`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/queues`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/fleet-visibility`);
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

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement.homePlanetId).toBe("7");
      expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
      expect(snapshot.planetsResponse.planets).toHaveLength(1);
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`]);
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
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`]);
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
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`, `/wallet/${wallet}/queues`]);
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

function infrastructureState({
  energyBalance,
  queue,
  resources,
  source,
  stale,
}: Partial<Pick<ChainInfrastructureState, "energyBalance" | "queue" | "resources" | "source" | "stale">> = {}): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
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

function researchState({
  queue,
}: Partial<Pick<ChainResearchState, "queue">> = {}): ChainResearchState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    researchAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: { "0": 1 },
    technologies: [
      { id: 0, level: 1, cost: { metal: "0", crystal: "1600", deuterium: "800" } },
    ],
    queue: queue ?? null,
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
