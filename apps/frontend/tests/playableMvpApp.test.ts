import { describe, expect, test } from "bun:test";
import {
  buildingCompletionUnavailableReasonFor,
  buildingCompletionUnavailableReasonAfterBackendRevalidation,
  buildingCompletionReadyToFinishFlag,
  buildingUpgradeActionErrorLabel,
  buildingFinishUnavailableReasonForDisplay,
  buildingCompletionAutoRefreshDelayMs,
  buildingFinishActionErrorLabel,
  attackProtectionSubmitBlocker,
  attackerCombatTechLevelsForMission,
  batchSupplyPlanMatchesOrders,
  batchSupplySourceForPlanet,
  beginRefreshRequest,
  canLoadIndexedPageState,
  canApplyRefreshRequest,
  colonizationLimitBlocker,
  canonicalInfrastructureBuildingCompletionQueue,
  completedBuildingFinishSyncReasonFor,
  defenseCompletionPlanetIdFor,
  failedBuildingFinishSyncReasonFor,
  galaxyMissionActionErrorLabel,
  gameActionsAvailableForBody,
  homeGalaxySystemSyncKey,
  homePlanetIdentityRefreshKey,
  hasInfrastructureDisplayState,
  infrastructureBackendSyncPausedLabel,
  infrastructureBackendSyncPausedReasonFor,
  infrastructureStateForCompletionRevalidation,
  infrastructureActionNoticeFor,
  infrastructureDisplayActionNoticeFor,
  infrastructureLoadErrorFor,
  infrastructureMissionResolutionPendingLabel,
  infrastructureUnavailableReasonFor,
  loadWalletPlanetSyncSnapshot,
  markFreshStateWrite,
  overviewMyPlanetMoonActionsFor,
  overviewMyPlanetActionsFor,
  overviewWatchedPlanetActionsFor,
  overviewWatchedPlanetMoonActionsFor,
  overviewBuildingReadyToFinishFlag,
  replanBatchSupplyForConfirmation,
  revalidateAttackProtectionBeforeSubmit,
  overviewResearchCompletionUnavailableReasonFor,
  preserveActiveResearchQueue,
  preserveActiveResearchState,
  planetHasIncomingAttack,
  planetScopedFleetVisibility,
  previousMissionIndexingBlockerLabel,
  refreshedInfrastructureUnavailableReasonFor,
  refreshedInfrastructureUpgradeUnavailableReasonFor,
  researchCompletionUnavailableReasonFor,
  researchStateWithFallbackQueue,
  researchStartUnavailableReasonAfterLiveRevalidation,
  researchStartUnavailableReasonFor,
  selectedResearchStartBlocker,
  researchStateForCompletionRevalidation,
  researchStartPlanetIdFor,
  researchStateWithPreservedActiveQueue,
  researchStartTransactionLabel,
  resolvedOrbitBodyKind,
  highscorePlanetForMission,
  raidTargetPlanetForMission,
  missionOriginResources,
  missionCooperativeActionAvailable,
  missionShipInventoryBlocker,
  nextProductionQueueCompletionEventMs,
  selectedPlanetIdForWalletRead,
  selectedPlanetIdFromRoster,
  shipyardStateForMissionActions,
  shipyardStateWithMissionLaunchBlocker,
  shipCompletionPlanetIdFor,
  topBarEnergyFor,
  transactionUnavailableReasonFor,
  clearRecoveredWalletContractUnavailableAction,
  walletCurrentResourcesFor,
  walletCurrentResourcesForActiveBody,
  walletQueuesForManagedPlanet,
  walletSettlementForManagedPlanet,
  walletSpendableResourcesFor,
  walletSnapshotHydrationKey,
  acsDefendCoordinationBlocker,
} from "../src/PlayableMvpApp";
import { infrastructureUpgradeButtonLabel } from "../src/components/InfrastructurePage";
import { AttackIntelPanel, missionTargetCompositionUnits, publicTargetBattleForecast, targetResourceIntel } from "../src/components/MissionCreationPage";
import { emptyMissionShips } from "../src/galaxyActions";
import { createInitialPlayableState } from "../src/playableMvp";
import type { RaidTarget } from "../src/raidTargetFinder";
import type { Planet } from "../src/types";
import type {
  ChainAllianceState,
  ChainDefenseState,
  ChainInfrastructureState,
  ChainResearchState,
  ChainShipyardState,
  FleetMissionSummary,
  HighscoreEntry,
  HighscorePlanet,
  PlayerQueuesResponse,
  QueueStateResponse,
  WalletPlanetsResponse,
  WalletSettlementResponse,
} from "../src/walletFlow";

const playableMvpSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

function collectRenderedText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectRenderedText);
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [String(node)];
  if (typeof node !== "object") return [];

  const vnode = node as {
    type?: unknown;
    props?: Record<string, unknown> & { children?: unknown };
  };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    return collectRenderedText(render({ ...(vnode.props ?? {}) }));
  }
  return collectRenderedText(vnode.props?.children);
}

describe("Playable MVP app display helpers", () => {
  const buildingFinishStateReadFailureLabel = "Can't check game state right now. Your upgrade is still ready, but Veydrift could not verify the contract state. Retry in a moment.";
  const buildingFinishLiveStateRequiredLabel = "Can't verify the current building queue right now. Refresh infrastructure state and retry before finishing.";
  const buildingCompletionWalletPrompt = "Building completion: confirm the game-state update in your wallet; token balance changes are not expected.";

  test("does not duplicate pending infrastructure action messages", () => {
    expect(
      infrastructureActionNoticeFor({
        status: "pending",
        label: "Waiting for wallet confirmation",
      }),
    ).toBeUndefined();
  });

  test("keeps API finish warnings out of building-card action notices", () => {
    expect(
      infrastructureDisplayActionNoticeFor({
        action: { status: "idle" },
        finishUnavailableReason: infrastructureBackendSyncPausedLabel,
      }),
    ).toBeUndefined();

    expect(
      infrastructureDisplayActionNoticeFor({
        action: {
          status: "error",
          buildingKey: "solarPlant",
          label: "Building upgrade transaction failed.",
        },
        finishUnavailableReason: infrastructureBackendSyncPausedLabel,
      }),
    ).toEqual({
      buildingKey: "solarPlant",
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(
      infrastructureDisplayActionNoticeFor({
        action: {
          status: "error",
          label: infrastructureBackendSyncPausedLabel,
        },
        finishUnavailableReason: infrastructureBackendSyncPausedLabel,
      }),
    ).toBeUndefined();
  });

  test("uses shipyard combat techs for mission previews when research state is absent", () => {
    expect(
      attackerCombatTechLevelsForMission({
        researchTechnologyLevels: undefined,
        shipyardTechnologyLevels: { "5": 4, "6": 0, "7": 5 },
      }),
    ).toEqual({ weapons: 4, shielding: 0, armor: 5 });

    expect(
      attackerCombatTechLevelsForMission({
        researchTechnologyLevels: { "5": 3 },
        shipyardTechnologyLevels: { "5": 4, "6": 2, "7": 5 },
      }),
    ).toEqual({ weapons: 3, shielding: 2, armor: 5 });
  });

  test("blocks colonization locally when Astrophysics colony limit is reached", () => {
    expect(
      colonizationLimitBlocker({
        planetCount: 1,
        researchTechnologyLevels: { "12": 0 },
        shipyardTechnologyLevels: undefined,
      }),
    ).toContain("Research Astrophysics");

    expect(
      colonizationLimitBlocker({
        planetCount: 1,
        researchTechnologyLevels: { "12": 1 },
        shipyardTechnologyLevels: undefined,
      }),
    ).toBeUndefined();
  });

  test("gates page state refreshes until the current wallet snapshot is hydrated", () => {
    const apiBaseUrl = "https://api.test";
    const account = "0x2222222222222222222222222222222222222222";
    const hydratedWalletSnapshotKey = walletSnapshotHydrationKey(apiBaseUrl, account);

    expect(
      canLoadIndexedPageState({
        account,
        apiBaseUrl,
        hydratedWalletSnapshotKey,
      }),
    ).toBe(true);
    expect(
      canLoadIndexedPageState({
        account,
        apiBaseUrl,
        hydratedWalletSnapshotKey: walletSnapshotHydrationKey(apiBaseUrl, "0x3333333333333333333333333333333333333333"),
      }),
    ).toBe(false);
    expect(
      canLoadIndexedPageState({
        account: undefined,
        apiBaseUrl,
        hydratedWalletSnapshotKey: undefined,
      }),
    ).toBe(true);
  });

  test("scopes Overview and TopBar snapshots to the newly selected planet immediately", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const firstPlanet = indexedPlanet(wallet);
    const selectedPlanet = {
      ...indexedPlanet(wallet),
      planetId: "8",
      name: "Colony Gate",
      galaxy: 6,
      system: 9,
      position: 13,
      coordinates: "6:9:13",
      isHomePlanet: false,
      resources: {
        metal: "900",
        crystal: "800",
        deuterium: "700",
      },
      resourcesAsOfNow: {
        metal: "990",
        crystal: "880",
        deuterium: "770",
      },
    };

    const settlement = walletSettlementForManagedPlanet(
      {
        wallet,
        hasFirstPlanet: true,
        homePlanetId: firstPlanet.planetId,
        planet: firstPlanet,
      },
      selectedPlanet,
    );

    expect(settlement?.homePlanetId).toBe("8");
    expect(settlement?.planet?.planetId).toBe("8");
    expect(settlement?.planet?.galaxy).toBe(6);
    expect(
      walletCurrentResourcesFor({
        settlementResources: settlement?.planet?.resourcesAsOfNow ?? settlement?.planet?.resources,
      }),
    ).toEqual({
      metal: 990,
      crystal: 880,
      deuterium: 770,
    });
  });

  test("uses moon body resources and keeps planet-only game actions blocked while moon missions can launch", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const planet = {
      ...indexedPlanet(wallet),
      resourcesAsOfNow: {
        metal: "9000",
        crystal: "8000",
        deuterium: "7000",
      },
      moon: {
        exists: true,
        bodyKind: "moon" as const,
        parentPlanetId: "7",
        planetId: "7",
        coordinates: "2:44:9",
        resources: {
          metal: "100",
          crystal: "200",
          deuterium: "300",
        },
        resourcesAsOfNow: {
          metal: "111",
          crystal: "222",
          deuterium: "333",
        },
        ships: [
          {
            id: 1,
            count: 4,
            cost: { metal: "0", crystal: "0", deuterium: "0" },
          },
        ],
        defenses: [
          {
            id: 2,
            count: 5,
            cost: { metal: "0", crystal: "0", deuterium: "0" },
          },
        ],
      },
    };

    expect(resolvedOrbitBodyKind("moon", planet)).toBe("moon");
    expect(resolvedOrbitBodyKind("moon", { ...planet, moon: null })).toBe("planet");
    expect(
      walletCurrentResourcesForActiveBody({
        activeBodyKind: "moon",
        moonResourcesAsOfNow: planet.moon.resourcesAsOfNow,
        planetResources: planet.resourcesAsOfNow,
      }),
    ).toEqual({
      metal: 111,
      crystal: 222,
      deuterium: 333,
    });
    expect(
      walletCurrentResourcesForActiveBody({
        activeBodyKind: "planet",
        moonResourcesAsOfNow: planet.moon.resourcesAsOfNow,
        planetResources: planet.resourcesAsOfNow,
      }),
    ).toEqual({
      metal: 9000,
      crystal: 8000,
      deuterium: 7000,
    });
    expect(gameActionsAvailableForBody("moon", true)).toBe(false);
    expect(gameActionsAvailableForBody("planet", true)).toBe(true);
    expect(playableMvpSource).toMatch(/const missionTransactionInputsAvailable\s*=\s*currentPlanetTransactionInputsAvailable\(/);
    expect(playableMvpSource).toMatch(/gameContractTransactionInputsAvailable,\s*activePlanetStateFresh\)/);
    expect(playableMvpSource).toMatch(/const missionLaunchBlocker\s*=\s*missionTransactionUnavailableReason \?\? missionLaunchStateBlocker;/);
    expect(playableMvpSource).toContain("canTransact={canSubmitMissionTransaction}");
    expect(playableMvpSource).toContain("transactionUnavailableReason={missionTransactionUnavailableReason}");
  });

  test("scopes production queues to the newly selected planet without carrying old queues", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const selectedPlanet = {
      ...indexedPlanet(wallet),
      planetId: "8",
      queues: {
        building: buildingQueue({
          itemId: 2,
          kind: "building",
          targetLevel: 4,
        }),
        defense: buildingQueue({ itemId: 1, kind: "defense", quantity: 3 }),
        ship: null,
      },
    };

    const queues = walletQueuesForManagedPlanet(
      playerQueues({
        homePlanetId: "7",
        defense: buildingQueue({ itemId: 0, kind: "defense", quantity: 1 }),
        research: activeResearchQueue({ itemId: 3 }),
        ship: buildingQueue({ itemId: 0, kind: "ship", quantity: 2 }),
      }),
      selectedPlanet,
    );

    expect(queues?.homePlanetId).toBe("8");
    expect(queues?.building?.itemId).toBe(2);
    expect(queues?.defense?.itemId).toBe(1);
    expect(queues?.defense?.quantity).toBe(3);
    expect(queues?.ship).toBeNull();
    expect(queues?.research?.itemId).toBe(3);
  });

  test("invalidates stale in-flight planet reads after an explicit planet switch", () => {
    const gate = { current: 0 };
    const oldPlanetRequest = beginRefreshRequest(gate);

    markFreshStateWrite(gate);
    const newPlanetRequest = beginRefreshRequest(gate);

    expect(canApplyRefreshRequest(gate, oldPlanetRequest)).toBe(false);
    expect(canApplyRefreshRequest(gate, newPlanetRequest)).toBe(true);
  });

  test("falls back to a live owned planet when the selected planet id is stale", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const home = indexedPlanet(wallet);
    const colony = {
      ...indexedPlanet(wallet),
      planetId: "8",
      isHomePlanet: false,
    };

    expect(
      selectedPlanetIdFromRoster({
        homePlanetId: home.planetId,
        planets: [home, colony],
        selectedPlanetId: "999",
      }),
    ).toBe("7");

    expect(
      selectedPlanetIdForWalletRead({
        activePlanetId: "999",
        homePlanetId: home.planetId,
        walletPlanets: [home, colony],
      }),
    ).toBe("7");

    expect(
      selectedPlanetIdForWalletRead({
        activePlanetId: undefined,
        homePlanetId: undefined,
        walletPlanets: [],
      }),
    ).toBeUndefined();
  });

  test("omits the selected planet id for forced home-planet sync snapshots", async () => {
    const requestedPlanetIds: Array<string | undefined> = [];
    const wallet = "0x2222222222222222222222222222222222222222";
    const home = indexedPlanet(wallet);
    const response = walletPlanetsResponse(wallet, [home]);

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      "999",
      { forceHomePlanet: true },
      {
        fetchWalletOverviewSnapshot: async (_apiUrl, _account, planetId) => {
          requestedPlanetIds.push(planetId);
          return {
            settlement: walletSettlementForManagedPlanet(walletSettlementResponse(wallet), home)!,
            planetsResponse: response,
            queues: playerQueues({ homePlanetId: home.planetId }),
            fleetVisibility: emptyFleetVisibilityFixture(wallet, home.planetId),
          };
        },
      },
    );

    expect(requestedPlanetIds).toEqual([undefined]);
    expect(snapshot.settlement.homePlanetId).toBe("7");
    expect(snapshot.settlement.planet?.planetId).toBe("7");
    expect(snapshot.planetsResponse.planets.map((planet) => planet.planetId)).toEqual(["7"]);
  });

  test("scopes Overview fleet rows to the selected planet", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const visibility = {
      ...emptyFleetVisibilityFixture(wallet, "7"),
      incoming: [
        fleetMission({
          missionId: "in-selected",
          missionType: "Attack",
          targetPlanetId: "8",
        }),
        fleetMission({
          missionId: "in-other",
          missionType: "Attack",
          targetPlanetId: "7",
        }),
      ],
      outgoing: [
        fleetMission({
          missionId: "self-inbound",
          owner: wallet,
          originPlanetId: "7",
          targetPlanetId: "8",
        }),
        fleetMission({
          missionId: "out-selected",
          originPlanetId: "8",
          targetPlanetId: "9",
        }),
        fleetMission({
          missionId: "out-other",
          originPlanetId: "7",
          targetPlanetId: "9",
        }),
        fleetMission({
          missionId: "transport-to-selected",
          missionType: "Transport",
          originPlanetId: "7",
          targetPlanetId: "8",
        }),
      ],
      returning: [
        fleetMission({
          missionId: "ret-selected",
          originPlanetId: "8",
          targetPlanetId: "9",
          status: "Returning",
        }),
        fleetMission({
          missionId: "ret-other",
          originPlanetId: "7",
          targetPlanetId: "9",
          status: "Returning",
        }),
        fleetMission({
          missionId: "terminal-selected",
          originPlanetId: "8",
          targetPlanetId: "9",
          status: "Returned",
        }),
      ],
    };

    const scoped = planetScopedFleetVisibility(visibility, "8", ["7", "8"]);

    expect(scoped?.incoming.map((mission) => mission.missionId)).toEqual(["in-selected", "self-inbound", "transport-to-selected"]);
    expect(scoped?.outgoing.map((mission) => mission.missionId)).toEqual(["out-selected"]);
    expect(scoped?.returning.map((mission) => mission.missionId)).toEqual(["ret-selected"]);

    const switched = planetScopedFleetVisibility(visibility, "7", ["7", "8"]);
    expect(switched?.incoming.map((mission) => mission.missionId)).toEqual(["in-other"]);
    expect(switched?.outgoing.map((mission) => mission.missionId)).toEqual(["in-selected", "self-inbound", "out-other", "transport-to-selected"]);
    expect(switched?.returning.map((mission) => mission.missionId)).toEqual(["ret-other"]);
  });

  test("does not scope private inbound fleet rows to a planet the wallet does not own", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const visibility = {
      ...emptyFleetVisibilityFixture(wallet, "7"),
      incoming: [fleetMission({ missionId: "private-inbound", targetPlanetId: "99" })],
    };

    expect(planetScopedFleetVisibility(visibility, "99", ["7", "8"])).toBeUndefined();
  });

  test("Overview owned planet actions use the selected planet as origin and hide same-body self-target actions", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const selectedPlanet = {
      ...indexedPlanet(wallet),
      planetId: "8",
      name: "Astro",
      coordinates: "6:9:13",
      galaxy: 6,
      system: 9,
      position: 13,
      isHomePlanet: false,
    };
    const otherPlanet = {
      ...indexedPlanet(wallet),
      planetId: "7",
      name: "New Zion",
      coordinates: "2:44:9",
      isHomePlanet: true,
    };
    const selectedShipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "8",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [{ id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
      queue: null,
    };

    expect(
      overviewMyPlanetActionsFor({
        account: wallet,
        activePlanetId: "8",
        defenseState: null,
        homePlanetId: "7",
        planet: selectedPlanet,
        shipyardState: selectedShipyardState,
      }),
    ).toEqual([]);

    const actions = overviewMyPlanetActionsFor({
      account: wallet,
      activePlanetId: "8",
      defenseState: null,
      homePlanetId: "7",
      planet: otherPlanet,
      shipyardState: selectedShipyardState,
    });

    expect(actions.find((action) => action.kind === "transport")).toMatchObject({
      enabled: true,
      mission: "transport",
      ships: { smallCargo: 0 },
    });
    expect(actions.find((action) => action.kind === "deploy")).toMatchObject({
      enabled: true,
      mission: "deploy",
      ships: { smallCargo: 0 },
    });
  });

  test("Overview selected planet offers moon actions on the moon row", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const selectedPlanet = {
      ...indexedPlanet(wallet),
      planetId: "8",
      name: "Astro",
      coordinates: "6:9:13",
      galaxy: 6,
      system: 9,
      position: 13,
      isHomePlanet: false,
      moon: {
        exists: true,
        planetId: "8",
        diameter: "7420",
        createdAt: "1780000000",
        resources: { metal: "100", crystal: "50", deuterium: "25" },
        resourcesAsOfNow: { metal: "100", crystal: "50", deuterium: "25" },
      },
    };
    const selectedShipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "8",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [{ id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
      queue: null,
    };

    const planetActions = overviewMyPlanetActionsFor({
      account: wallet,
      activePlanetId: "8",
      defenseState: null,
      homePlanetId: "7",
      planet: selectedPlanet,
      shipyardState: selectedShipyardState,
    });
    const moonActions = overviewMyPlanetMoonActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: selectedPlanet,
      shipyardState: selectedShipyardState,
    });

    expect(planetActions).toEqual([]);
    expect(moonActions).toHaveLength(3);
    expect(moonActions[0]).toMatchObject({
      enabled: true,
      kind: "transport",
      label: "Transport",
      mission: "transport",
      defaultTargetIsMoon: true,
      ships: { smallCargo: 0 },
    });
    expect(moonActions[1]).toMatchObject({
      enabled: true,
      kind: "deploy",
      label: "Deploy",
      mission: "deploy",
      defaultTargetIsMoon: true,
      ships: { smallCargo: 0 },
    });
    expect(moonActions[2]).toMatchObject({
      enabled: false,
      kind: "defenseHold",
      label: "Defend",
      mission: "defenseHold",
      reason: "Stationed defense can only target planets in the current mission contract.",
    });
  });

  test("Overview watched moon rows expose moon-targeted actions", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const enemy = "0x3333333333333333333333333333333333333333";
    const selectedShipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    };
    const watchedPlanet = (owner: string): Planet => ({
      alliance: null,
      debrisField: null,
      diameter: 12000,
      fields: 180,
      galaxy: 2,
      hasMoon: true,
      id: "9",
      image: "/assets/game/style-pass/generated/planets/hot-desert.webp",
      metalMultiplierBps: 10000,
      crystalMultiplierBps: 10000,
      deuteriumMultiplierBps: 10000,
      moonChance: null,
      moonName: "Moon",
      name: "Watched",
      occupiedBy: {
        owner,
        ownerDisplayName: null,
        planetId: "9",
      },
      owner,
      ownerId: owner,
      position: 9,
      resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
      system: 44,
      temperature: { min: -20, max: 40 },
      type: "hot-desert",
    });

    const ownMoonActions = overviewWatchedPlanetMoonActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: watchedPlanet(wallet),
      shipyardState: selectedShipyardState,
    });
    const enemyMoonActions = overviewWatchedPlanetMoonActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: watchedPlanet(enemy),
      shipyardState: selectedShipyardState,
    });

    expect(ownMoonActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    expect(ownMoonActions.slice(0, 2).every((action) => action.enabled && action.defaultTargetIsMoon === true)).toBe(true);
    expect(ownMoonActions[2]).toMatchObject({
      enabled: false,
      kind: "defenseHold",
      reason: "Stationed defense can only target planets in the current mission contract.",
    });
    expect(enemyMoonActions).toHaveLength(1);
    expect(enemyMoonActions[0]).toMatchObject({
      enabled: true,
      kind: "attack",
      label: "Attack",
      mission: "attack",
      defaultTargetIsMoon: true,
    });
  });

  test("Overview watched planet rows expose only valid planet-targeted actions", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const enemy = "0x3333333333333333333333333333333333333333";
    const selectedShipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    };
    const watchedPlanet = (owner: string): Planet => ({
      alliance: null,
      debrisField: null,
      diameter: 12000,
      fields: 180,
      galaxy: 2,
      hasMoon: true,
      id: "9",
      image: "/assets/game/style-pass/generated/planets/hot-desert.webp",
      metalMultiplierBps: 10000,
      crystalMultiplierBps: 10000,
      deuteriumMultiplierBps: 10000,
      moonChance: null,
      moonName: "Moon",
      name: "Watched",
      occupiedBy: {
        owner,
        ownerDisplayName: null,
        planetId: "9",
      },
      owner,
      ownerId: owner,
      position: 9,
      resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
      system: 44,
      temperature: { min: -20, max: 40 },
      type: "hot-desert",
    });

    const ownActions = overviewWatchedPlanetActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: watchedPlanet(wallet),
      shipyardState: selectedShipyardState,
    });
    const enemyActions = overviewWatchedPlanetActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: watchedPlanet(enemy),
      shipyardState: selectedShipyardState,
    });
    const unavailableActions = overviewWatchedPlanetActionsFor({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      planet: watchedPlanet(enemy),
      shipyardState: null,
    });

    expect(ownActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    expect(ownActions.every((action) => action.enabled && action.defaultTargetIsMoon !== true)).toBe(true);
    expect(enemyActions.map((action) => action.label)).toEqual(["Attack"]);
    expect(enemyActions.every((action) => action.enabled && action.defaultTargetIsMoon !== true)).toBe(true);
    expect(unavailableActions).toEqual([]);
  });

  test("Overview owned planet disabled action copy names the selected planet state", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const otherPlanet = {
      ...indexedPlanet(wallet),
      planetId: "7",
      name: "New Zion",
      isHomePlanet: true,
    };

    const loadingActions = overviewMyPlanetActionsFor({
      account: wallet,
      activePlanetId: "8",
      defenseState: null,
      homePlanetId: "7",
      planet: otherPlanet,
      shipyardState: null,
    });

    expect(loadingActions.find((action) => action.kind === "transport")).toMatchObject({
      enabled: false,
      reason: "Selected planet fleet inventory is still syncing.",
    });

    const emptyShipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "8",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [],
      queue: null,
    };
    const emptyActions = overviewMyPlanetActionsFor({
      account: wallet,
      activePlanetId: "8",
      defenseState: null,
      homePlanetId: "7",
      planet: otherPlanet,
      shipyardState: emptyShipyardState,
    });

    expect(emptyActions.find((action) => action.kind === "transport")).toMatchObject({
      enabled: false,
      reason: "Requires a cargo-capable ship on your selected planet.",
    });
  });

  test("detects incoming attacks per planet for selector warning badges", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const visibility = {
      ...emptyFleetVisibilityFixture(wallet, "7"),
      incoming: [
        fleetMission({
          missionId: "attack",
          missionType: "Attack",
          owner: "0x3333333333333333333333333333333333333333",
          targetPlanetId: "8",
        }),
        fleetMission({
          missionId: "transport",
          missionType: "Transport",
          targetPlanetId: "7",
        }),
        fleetMission({
          missionId: "owned-attack",
          missionType: "Attack",
          owner: wallet,
          targetPlanetId: "9",
        }),
      ],
    };

    expect(planetHasIncomingAttack(visibility, "8")).toBe(true);
    expect(planetHasIncomingAttack(visibility, "7")).toBe(false);
    expect(planetHasIncomingAttack(visibility, "9")).toBe(false);
  });

  test("does not transfer moon attacks to the parent planet and includes grouped attacks", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const visibility = {
      ...emptyFleetVisibilityFixture(wallet, "7"),
      incoming: [
        fleetMission({
          missionId: "moon-attack",
          targetIsMoon: true,
          targetPlanetId: "7",
        }),
        fleetMission({
          missionId: "group-attack",
          missionType: "AcsAttack",
          targetPlanetId: "8",
        }),
      ],
    };

    expect(planetHasIncomingAttack(visibility, "7")).toBe(false);
    expect(planetHasIncomingAttack(visibility, "8")).toBe(true);
  });

  test("keeps a delayed older attack response from replacing the latest target", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const refreshGate = { current: 0 };
    const olderRequest = beginRefreshRequest(refreshGate);
    const latestRequest = beginRefreshRequest(refreshGate);
    let applied = emptyFleetVisibilityFixture(wallet, "7");
    const apply = (requestId: number, targetPlanetId: string) => {
      if (!canApplyRefreshRequest(refreshGate, requestId)) return;
      applied = {
        ...emptyFleetVisibilityFixture(wallet, "7"),
        incoming: [
          fleetMission({
            missionId: `attack-${targetPlanetId}`,
            targetPlanetId,
          }),
        ],
      };
    };

    apply(latestRequest, "8");
    apply(olderRequest, "7");

    expect(planetHasIncomingAttack(applied, "8")).toBe(true);
    expect(planetHasIncomingAttack(applied, "7")).toBe(false);
  });

  test("shows planet picker moon overlays without standalone moon selector buttons", () => {
    const itemSource = sourceBetween(playableMvpSource, "function PlanetSelectorItem", "function PlanetSelectorButton");
    const buttonSource = sourceBetween(playableMvpSource, "function PlanetSelectorButton", "function planetDisplayName");

    expect(itemSource).toMatch(/isPlanetSelectorParentSelected\(\s*planet\.planetId,\s*selectedPlanet\.planetId,?\s*\)/);
    expect(itemSource).toContain("showMoonIndicator={planet.moon?.exists === true}");
    expect(itemSource).not.toContain("PlanetSelectorMoonButton");
    expect(itemSource).not.toContain("selectedMoonBody");
    expect(buttonSource).toContain("veydrift-planet-selector-button");
    expect(buttonSource).toContain("planetImage(planet)");
    expect(buttonSource).toContain("showMoonIndicator");
    expect(buttonSource).toContain("PlanetMoonIndicator");
    expect(buttonSource).toContain('className="!-right-1 !-top-1 !h-5 !w-5 xl:!h-5 xl:!w-5"');
  });

  test("uses one route owner to invalidate transient mission screens for tab and history navigation", () => {
    const routeOwnerSource = sourceBetween(playableMvpSource, "const applyInspectRoute = useCallback", "const navigateToInspectRoute = useCallback");
    const historyListenerSource = sourceBetween(playableMvpSource, "const navigateToInspectRoute = useCallback", "const loadPublicBattleReports = useCallback");
    const tabNavigationSource = sourceBetween(playableMvpSource, "const handleNavigate = useCallback", "const handleOpenMissionReport = useCallback");

    expect(routeOwnerSource).toContain("setPendingGalaxyMission(null)");
    expect(routeOwnerSource).toContain("setPendingAttackProtection(null)");
    expect(routeOwnerSource).toContain("setPendingJoinAttack(null)");
    expect(routeOwnerSource).toContain("setPendingAcsDefend(null)");
    expect(routeOwnerSource).toContain("setPage(route.page)");
    expect(historyListenerSource).toContain("applyInspectRoute(parseInspectRouteFromLocation(window.location))");
    expect(tabNavigationSource).toContain('navigateToInspectRoute({ kind: "page", page: target })');
    expect(tabNavigationSource).not.toContain("setPendingGalaxyMission");
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

    expect(
      homePlanetIdentityRefreshKey({
        apiBaseUrl: "https://api.test",
        homeCoords,
        ownerDisplayName: "Explorer",
        settlementPlanet: refreshedSnapshot,
      }),
    ).toBe(key);
    expect(
      homePlanetIdentityRefreshKey({
        apiBaseUrl: "https://api.test",
        homeCoords: { galaxy: 2, system: 45, position: 9 },
        ownerDisplayName: "Explorer",
        settlementPlanet: refreshedSnapshot,
      }),
    ).not.toBe(key);
    expect(
      homePlanetIdentityRefreshKey({
        apiBaseUrl: "https://api.test",
        homeCoords: undefined,
        ownerDisplayName: "Explorer",
        settlementPlanet: refreshedSnapshot,
      }),
    ).toBeUndefined();
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

    expect(
      shipyardStateForMissionActions({
        account: "0x1111111111111111111111111111111111111111",
        activePlanetId: "8",
        homePlanetId: "7",
        shipyardError: "Shipyard API returned 503",
        shipyardLoading: true,
        shipyardState: null,
      }),
    ).toBeNull();
  });

  test("turns previous mission indexing into a mission-action blocker", () => {
    const state = shipyardStateWithMissionLaunchBlocker({
      account: "0x1111111111111111111111111111111111111111",
      activePlanetId: "8",
      blocker: previousMissionIndexingBlockerLabel,
      homePlanetId: "7",
      shipyardState: null,
    });

    expect(state).toMatchObject({
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planetId: "8",
      fleetLaunchAvailable: false,
      fleetLaunchUnavailableReason: previousMissionIndexingBlockerLabel,
      ships: [],
    });
  });

  test("blocks backend-refetched mission manifests that exceed available ship inventory", () => {
    expect(
      missionShipInventoryBlocker({
        shipyardState: {
          fleetLaunchAvailable: false,
          fleetLaunchUnavailableReason: "Fleet slot state is waiting for mission settlement.",
          fleetSlots: { active: 0, limit: 5 },
          ships: [{ id: 0, count: 3 }],
        },
        ships: { smallCargo: 1 },
      }),
    ).toBe("Fleet slot state is waiting for mission settlement.");

    const blocker = missionShipInventoryBlocker({
      shipyardState: {
        fleetSlots: { active: 0, limit: 5 },
        ships: [
          { id: 0, count: 3 },
          { id: 1, count: 4 },
          { id: 5, count: 6 },
        ],
      },
      ships: {
        smallCargo: 4,
        lightFighter: 4,
        recycler: 0,
        colonyShip: 0,
        largeCargo: 0,
        heavyFighter: 1,
        cruiser: 0,
        battleship: 0,
        bomber: 0,
        destroyer: 0,
        deathstar: 0,
        battlecruiser: 0,
        reaper: 0,
        pathfinder: 0,
      },
    });

    expect(blocker).toBe("Need 4 Small Cargo, only 3 available on the origin planet; refresh fleet state or reduce selected ships before launching.");
  });

  test("builds Supply sources from canonical launchable cargo remaining after a partial mission", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const planet = { ...indexedPlanet(wallet), planetId: "8", name: "Astro" };
    const state: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "8",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 1, limit: 5 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 4, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 4, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      launchableShips: [
        { id: 0, count: 4, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 4, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    };

    const partialSource = batchSupplySourceForPlanet(planet, state);
    expect(partialSource).toMatchObject({
      planetId: "8",
      label: "Astro",
      ships: { smallCargo: 4, largeCargo: 1 },
    });
    expect(partialSource.unavailableReason).toBeUndefined();

    expect(batchSupplySourceForPlanet(planet, { ...state, launchableShips: [] })).toMatchObject({
      ships: { largeCargo: 0, smallCargo: 0 },
      unavailableReason: "No usable cargo ships are available on this planet.",
    });
  });

  test("replans Supply cargo from confirmation-time source inventories", () => {
    const plan = replanBatchSupplyForConfirmation({
      maxOrders: 1,
      orders: [
        {
          originPlanetId: "8",
          originLabel: "Astro",
          cargo: { metal: 100, crystal: 0, deuterium: 0 },
          ships: {
            smallCargo: 0,
            lightFighter: 0,
            recycler: 0,
            colonyShip: 0,
            largeCargo: 1,
            heavyFighter: 0,
            cruiser: 0,
            battleship: 0,
            bomber: 0,
            destroyer: 0,
            deathstar: 0,
            battlecruiser: 0,
            reaper: 0,
            pathfinder: 0,
          },
          fuelCost: 0,
          travelSeconds: 0,
        },
      ],
      sources: [
        {
          planetId: "8",
          label: "Astro",
          coordinates: { galaxy: 1, system: 1, position: 1 },
          resources: { metal: 50, crystal: 0, deuterium: 100 },
          ships: { largeCargo: 1 },
          driveLevels: {
            combustionDrive: 0,
            impulseDrive: 0,
            hyperspaceDrive: 0,
          },
        },
      ],
      target: { galaxy: 1, system: 1, position: 2 },
    });

    expect(plan.delivered).toMatchObject({
      metal: 50,
      crystal: 0,
      deuterium: 0,
    });
    expect(plan.missing).toMatchObject({ metal: 50, crystal: 0, deuterium: 0 });
  });

  test("requires Supply confirmation when a fresh plan changes an origin fleet or cargo", () => {
    const orders = [
      {
        originPlanetId: "8",
        originLabel: "Astro",
        cargo: { metal: 50, crystal: 0, deuterium: 0 },
        ships: {
          smallCargo: 0,
          lightFighter: 0,
          recycler: 0,
          colonyShip: 0,
          largeCargo: 1,
          heavyFighter: 0,
          cruiser: 0,
          battleship: 0,
          bomber: 0,
          destroyer: 0,
          deathstar: 0,
          battlecruiser: 0,
          reaper: 0,
          pathfinder: 0,
        },
        fuelCost: 0,
        travelSeconds: 0,
      },
    ];

    expect(batchSupplyPlanMatchesOrders(orders, [{ ...orders[0], ships: { ...orders[0].ships } }])).toBe(true);
    expect(
      batchSupplyPlanMatchesOrders(orders, [
        {
          ...orders[0],
          ships: { ...orders[0].ships, largeCargo: 2 },
        },
      ]),
    ).toBe(false);
  });

  test("shows cooperative mission actions only with ships and an open fleet slot", () => {
    expect(missionCooperativeActionAvailable(undefined)).toBeUndefined();
    expect(
      missionCooperativeActionAvailable({
        fleetSlots: { active: 0, limit: 5 },
        ships: [{ id: 0, count: 3 }],
      }),
    ).toBe(true);
    expect(
      missionCooperativeActionAvailable({
        fleetSlots: { active: 5, limit: 5 },
        ships: [{ id: 0, count: 3 }],
      }),
    ).toBe(false);
    expect(
      missionCooperativeActionAvailable({
        fleetSlots: { active: 0, limit: 5 },
        ships: [],
      }),
    ).toBe(false);
    expect(
      missionCooperativeActionAvailable({
        fleetLaunchAvailable: false,
        fleetSlots: { active: 0, limit: 5 },
        ships: [{ id: 0, count: 3 }],
      }),
    ).toBe(false);
  });

  test("validates Moon-origin manifests against moon ships while retaining global fleet slots", () => {
    const moonInventory = {
      fleetSlots: { active: 2, limit: 5 },
      ships: [
        { id: 2, count: 1 },
        { id: 4, count: 2 },
      ],
    };

    expect(
      missionShipInventoryBlocker({
        originBody: "moon",
        shipyardState: moonInventory,
        ships: { recycler: 1, largeCargo: 2 },
      }),
    ).toBeUndefined();
    expect(
      missionShipInventoryBlocker({
        originBody: "moon",
        shipyardState: moonInventory,
        ships: { recycler: 1, largeCargo: 3 },
      }),
    ).toBe("Need 3 Large Cargo, only 2 available on the origin moon; refresh fleet state or reduce selected ships before launching.");
    expect(
      missionShipInventoryBlocker({
        originBody: "moon",
        shipyardState: null,
        ships: { recycler: 1 },
      }),
    ).toBe("Moon fleet state is still loading.");
  });

  test("labels mission launch wallet, server, and preflight failures distinctly", () => {
    expect(
      galaxyMissionActionErrorLabel("Attack mission", {
        code: -32603,
        message: "Internal JSON-RPC error.",
      }),
    ).toBe("Servers are unavailable. Retrying in 10 seconds.");

    expect(
      galaxyMissionActionErrorLabel(
        "Attack mission",
        new Error("The wallet could not read the current game contract state. Retry in a moment while the app checks whether the game API or RPC recovered."),
      ),
    ).toBe("Servers are unavailable. Retrying in 10 seconds.");

    expect(galaxyMissionActionErrorLabel("Attack mission", new Error("Timed out reading wallet accounts from the wallet after 10 seconds."))).toBe(
      "Attack mission could not read wallet state. Unlock or reconnect your wallet, then retry.",
    );

    expect(galaxyMissionActionErrorLabel("Attack mission", new Error("execution reverted"))).toBe(
      "Attack mission was rejected by mission preflight. Refresh fleet, cargo, fuel, and target state before retrying.",
    );
  });

  test("labels a -32603-wrapped on-chain revert as a mission rejection, not RPC unavailable", () => {
    // VEY-KANEO-421: a genuine on-chain revert with no decodable reason arrives
    // wrapped in an internal JSON-RPC error (code -32603). It must be classified
    // as a mission rejection, not transient RPC/node unavailability.
    expect(
      galaxyMissionActionErrorLabel("Attack mission", {
        code: -32603,
        message: "Internal JSON-RPC error.",
        data: { originalError: { code: 3, message: "execution reverted" } },
      }),
    ).toBe("Attack mission was rejected by mission preflight. Refresh fleet, cargo, fuel, and target state before retrying.");

    expect(
      galaxyMissionActionErrorLabel("Attack mission", {
        code: -32603,
        message: "Internal JSON-RPC error.",
        data: {
          originalError: {
            code: 3,
            message: "execution reverted",
            data: "0x65dba1c3",
          },
        },
      }),
    ).toBe("Attack mission was rejected by mission preflight. Refresh fleet, cargo, fuel, and target state before retrying.");

    // A bare -32603 with no revert markers is genuine server unavailability and
    // must keep the transient retry label.
    expect(
      galaxyMissionActionErrorLabel("Attack mission", {
        code: -32603,
        message: "Internal JSON-RPC error.",
      }),
    ).toBe("Servers are unavailable. Retrying in 10 seconds.");
  });

  test("keeps Group Defend submit gating aligned with contract coordination rules", () => {
    const account = "0x1111111111111111111111111111111111111111";
    const defender = "0x2222222222222222222222222222222222222222";
    const missionForOwner = (owner: string | undefined): FleetMissionSummary =>
      ({
        targetPlanet: owner ? { owner } : null,
      }) as FleetMissionSummary;
    const allianceState = (memberAddresses: string[], allianceId = "7"): ChainAllianceState => ({
      wallet: account,
      allianceAvailable: true,
      membership: { allianceId, role: "member", joinedAt: "1" },
      profile: null,
      directory: [],
      pendingInvites: [],
      pendingJoinRequests: [],
      allianceJoinRequests: [],
      diplomacy: [],
      activeWars: [],
      members: memberAddresses.map((address) => ({
        address,
        role: "member",
        joinedAt: "1",
      })),
    });

    expect(acsDefendCoordinationBlocker(missionForOwner(account), account, null)).toBeUndefined();
    expect(acsDefendCoordinationBlocker(missionForOwner(defender), account, allianceState([account, defender]))).toBeUndefined();
    expect(acsDefendCoordinationBlocker(missionForOwner(defender), account, allianceState([account], "0"))).toBe("Group defense is only available for your own planets or same-alliance planets.");
    expect(acsDefendCoordinationBlocker(missionForOwner(defender), account, allianceState([account]))).toBe("Group defense is only available for your own planets or same-alliance planets.");
    expect(acsDefendCoordinationBlocker(missionForOwner(undefined), account, allianceState([account]))).toBe("Defended planet state is still syncing.");
    expect(acsDefendCoordinationBlocker(missionForOwner(defender), account, null, true)).toBeUndefined();
  });

  test("blocks stale attack submissions after target protection refresh", () => {
    expect(
      attackProtectionSubmitBlocker({
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      }),
    ).toBe("Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.");

    expect(
      attackProtectionSubmitBlocker({
        allowed: false,
        blockedReason: "same_alliance",
        blockedReasonLabel: null,
      }),
    ).toBe("Attack blocked: target belongs to your alliance.");

    expect(
      attackProtectionSubmitBlocker({
        allowed: true,
        blockedReason: "none",
        blockedReasonLabel: null,
      }),
    ).toBeUndefined();
  });

  test("revalidates canonical protection before any wallet submission can run", async () => {
    let protectionReads = 0;
    let walletSubmissions = 0;

    await expect(
      (async () => {
        await revalidateAttackProtectionBeforeSubmit(async () => {
          protectionReads += 1;
          return {
            allowed: false,
            blockedReason: "score_protection" as const,
            blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
          };
        });
        walletSubmissions += 1;
      })(),
    ).rejects.toThrow("Attack blocked: score protection");

    expect(protectionReads).toBe(1);
    expect(walletSubmissions).toBe(0);

    await revalidateAttackProtectionBeforeSubmit(async () => ({
      allowed: true,
      blockedReason: "none" as const,
      blockedReasonLabel: null,
    }));
    walletSubmissions += 1;
    expect(walletSubmissions).toBe(1);
  });

  test("keeps pending infrastructure copy out of unavailable and button labels", () => {
    expect(
      infrastructureUnavailableReasonFor({
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
      }),
    ).toBeUndefined();

    expect(
      infrastructureUpgradeButtonLabel({
        binary: false,
        defaultLabel: "Upgrade Level 2",
        statusDisabled: true,
      }),
    ).toBe("Upgrade Level 2");
  });

  test("uses transaction sync copy instead of stale wallet unavailable copy while actions are gated", () => {
    expect(
      transactionUnavailableReasonFor({
        activeActionLabel: "Ship production: syncing indexed state...",
        inputsAvailable: true,
        transactionPending: true,
        unavailableReason: "Wallet or game contract unavailable",
      }),
    ).toBe("Ship production: syncing indexed state...");

    expect(
      transactionUnavailableReasonFor({
        inputsAvailable: true,
        transactionPending: true,
        unavailableReason: "Wallet or game contract unavailable",
      }),
    ).toBe("Transaction is syncing indexed state. Wait for it to finish before starting another action.");

    expect(
      transactionUnavailableReasonFor({
        inputsAvailable: false,
        transactionPending: true,
        unavailableReason: "Wallet or game contract unavailable",
      }),
    ).toBe("Wallet or game contract unavailable");

    expect(
      transactionUnavailableReasonFor({
        inputsAvailable: true,
        transactionPending: false,
        unavailableReason: "Wallet or game contract unavailable",
      }),
    ).toBeUndefined();
  });

  test("clears recovered wallet/contract unavailable action errors without hiding real failures", () => {
    expect(
      clearRecoveredWalletContractUnavailableAction(
        {
          status: "error",
          label: "Wallet, game contract, or home planet is unavailable.",
        },
        true,
      ),
    ).toEqual({ status: "idle" });

    expect(
      clearRecoveredWalletContractUnavailableAction(
        {
          status: "error",
          label: "Wallet, game contract, or resource token is unavailable.",
        },
        true,
      ),
    ).toEqual({ status: "idle" });

    expect(
      clearRecoveredWalletContractUnavailableAction(
        {
          status: "error",
          label: "Wallet, game contract, or home planet is unavailable.",
        },
        false,
      ),
    ).toEqual({
      status: "error",
      label: "Wallet, game contract, or home planet is unavailable.",
    });

    expect(
      clearRecoveredWalletContractUnavailableAction(
        {
          status: "error",
          label: "Ship production failed: The game contract rejected this transaction.",
        },
        true,
      ),
    ).toEqual({
      status: "error",
      label: "Ship production failed: The game contract rejected this transaction.",
    });
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(
      infrastructureActionNoticeFor({
        status: "error",
        label: "Building upgrade transaction failed.",
      }),
    ).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(
      infrastructureActionNoticeFor({
        status: "success",
        label: "Building upgrade confirmed on-chain.",
      }),
    ).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("translates transient building finish state-read failures into recovery copy", () => {
    expect(buildingFinishActionErrorLabel(new Error("The wallet could not read the current game contract state. Retry in a moment while the app checks whether the game API or RPC recovered."))).toBe(
      buildingFinishStateReadFailureLabel,
    );

    expect(buildingFinishActionErrorLabel(new Error("Internal JSON-RPC error."))).toBe(buildingFinishStateReadFailureLabel);
  });

  test("keeps actionable building finish errors specific", () => {
    expect(buildingFinishActionErrorLabel(new Error("No active building upgrade is waiting to be finished. Refresh infrastructure state and retry."))).toBe(
      "No active building upgrade is waiting to be finished. Refresh infrastructure state and retry.",
    );
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

    expect(
      topBarEnergyFor({
        infrastructureChainState,
        isWalletConnected: true,
      }),
    ).toMatchObject({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("keeps loaded top bar energy independent from background refresh errors", () => {
    expect(
      topBarEnergyFor({
        infrastructureChainState: infrastructureState({
          energyBalance: {
            produced: "100",
            required: "40",
            scaleBps: "10000",
          },
        }),
        isWalletConnected: true,
      }),
    ).toMatchObject({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("does not invent top bar energy when the backend energy balance is unavailable (VEY-KANEO-465)", () => {
    // VEY-KANEO-465: the frontend displays backend-derived energy only; it no
    // longer recomputes the balance from indexed building levels when the backend
    // omits it.
    expect(
      topBarEnergyFor({
        infrastructureChainState: infrastructureState({
          energyBalance: null,
          source: "contract-state-indexer",
          stale: true,
        }),
        isWalletConnected: true,
      }),
    ).toBeUndefined();
  });

  test("does not invent top bar energy when chain state is missing", () => {
    expect(
      topBarEnergyFor({
        infrastructureChainState: null,
        isWalletConnected: true,
      }),
    ).toBeUndefined();
  });

  test("names research start confirmations with technology label and target level", () => {
    expect(
      researchStartTransactionLabel(0, "energy", {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        resources: { metal: "1000", crystal: "2000", deuterium: "1000" },
        researchLabLevel: 1,
        researchNetworkLabLevels: [],
        technologyLevels: { "0": 1 },
        technologies: [
          {
            id: 0,
            level: 1,
            cost: { metal: "0", crystal: "1600", deuterium: "800" },
          },
        ],
        queue: null,
      }),
    ).toBe("Energy Technology level 2 research");
  });

  test("starts research against the selected research planet before falling back to home planet", () => {
    expect(
      researchStartPlanetIdFor({
        activePlanetId: "8",
        researchState: researchState({ homePlanetId: "7", planetId: "9" }),
      }),
    ).toBe("9");

    expect(
      researchStartPlanetIdFor({
        activePlanetId: "8",
        researchState: researchState({ homePlanetId: "7" }),
      }),
    ).toBe("8");

    expect(
      researchStartPlanetIdFor({
        activePlanetId: undefined,
        researchState: researchState({ homePlanetId: "7" }),
      }),
    ).toBe("7");
  });

  test("uses backend-accrued wallet resources without adding local pending deltas", () => {
    const resources = { metal: 1_240, crystal: 930, deuterium: 410 };

    expect(
      walletSpendableResourcesFor({
        isWalletConnected: true,
        onChainResources: resources,
      }),
    ).toBe(resources);

    expect(
      walletSpendableResourcesFor({
        isWalletConnected: false,
        onChainResources: resources,
      }),
    ).toBeUndefined();
  });

  test("prefers settlement current resources over stale infrastructure top-bar resources (VEY-KANEO-517)", () => {
    expect(
      walletCurrentResourcesFor({
        settlementResources: {
          metal: "5000",
          crystal: "2824",
          deuterium: "1359",
        },
        infrastructureResourcesAsOfNow: {
          metal: "2022",
          crystal: "1005",
          deuterium: "1259",
        },
        infrastructureResources: {
          metal: "1900",
          crystal: "900",
          deuterium: "1200",
        },
      }),
    ).toEqual({ metal: 5000, crystal: 2824, deuterium: 1359 });

    expect(
      walletCurrentResourcesFor({
        settlementResources: null,
        infrastructureResourcesAsOfNow: {
          metal: "2022",
          crystal: "1005",
          deuterium: "1259",
        },
        infrastructureResources: {
          metal: "1900",
          crystal: "900",
          deuterium: "1200",
        },
      }),
    ).toEqual({ metal: 2022, crystal: 1005, deuterium: 1259 });
  });

  test("schedules building completion auto-refresh at the ready boundary", () => {
    expect(
      buildingCompletionAutoRefreshDelayMs(
        {
          ...readyBuildingQueue(),
          readyAt: "1700000000",
        },
        1_699_999_999_000,
      ),
    ).toBe(2_500);

    expect(
      buildingCompletionAutoRefreshDelayMs(
        {
          ...readyBuildingQueue(),
          readyAt: "1700000000",
        },
        1_700_000_002_000,
      ),
    ).toBe(0);

    expect(buildingCompletionAutoRefreshDelayMs(null, 1_700_000_000_000)).toBeUndefined();
    expect(
      buildingCompletionAutoRefreshDelayMs(
        {
          ...readyBuildingQueue(),
          readyAt: "not-a-date",
        },
        1_700_000_000_000,
      ),
    ).toBeUndefined();
  });

  test("mission origin resources track the canonical spendable balance, not the lagging backend snapshot", () => {
    // VEY-KANEO-453: the backend wallet-planet snapshot lags the real on-chain balance, so the
    // mission fuel gate must read the same canonical spendable balance the top bar shows. Here the
    // player actually holds 3,062 deuterium while the stale snapshot still reports 100 — the gate
    // must not falsely block Confirm.
    expect(
      missionOriginResources({
        isWalletConnected: true,
        spendableResources: { metal: 12_000, crystal: 8_000, deuterium: 3_062 },
        planetResources: { metal: "5000", crystal: "4000", deuterium: "100" },
      }),
    ).toEqual({ metal: 12_000, crystal: 8_000, deuterium: 3_062 });
  });

  test("mission origin resources resolve to the canonical balance even when the wallet-planet snapshot is absent", () => {
    // VEY-KANEO-453 (sharpened root cause): the original block fired when `walletPlanets` was empty
    // or not yet hydrated, leaving `selectedManagedPlanet === undefined` and therefore no backend
    // planet snapshot. The gate must NOT depend on that snapshot (or the planet selector) being
    // present — it falls back to the same authoritative balance the header uses, so Confirm is enabled
    // whenever the real deuterium covers the fuel cost.
    expect(
      missionOriginResources({
        isWalletConnected: true,
        spendableResources: { metal: 12_000, crystal: 8_000, deuterium: 3_062 },
        planetResources: undefined,
      }),
    ).toEqual({ metal: 12_000, crystal: 8_000, deuterium: 3_062 });
  });

  test("mission origin resources fall back to the backend snapshot when no wallet spendable balance is available", () => {
    // No wallet connected: there is no on-chain spendable read, so the validated backend snapshot
    // (string-valued) is the only available source.
    expect(
      missionOriginResources({
        isWalletConnected: false,
        spendableResources: undefined,
        planetResources: { metal: "5000", crystal: "4000", deuterium: "1200" },
      }),
    ).toEqual({ metal: 5_000, crystal: 4_000, deuterium: 1_200 });

    // Wallet connected but the canonical balance has not been read yet — fall back rather than
    // returning undefined and dropping the gate to zero.
    expect(
      missionOriginResources({
        isWalletConnected: true,
        spendableResources: undefined,
        planetResources: { metal: "5000", crystal: "4000", deuterium: "1200" },
      }),
    ).toEqual({ metal: 5_000, crystal: 4_000, deuterium: 1_200 });

    // No source at all yields undefined, leaving the caller to treat the balance as unknown.
    expect(
      missionOriginResources({
        isWalletConnected: false,
        spendableResources: undefined,
        planetResources: undefined,
      }),
    ).toBeUndefined();
  });

  test("carries Raid Finder target intel into attack mission public state", () => {
    const target = raidTargetPlanetForMission(
      raidTarget({
        planetId: "50",
        name: "Border Foundry",
        coordinates: { galaxy: 7, system: 41, position: 6 },
        currentResources: { metal: "2440", crystal: "920", deuterium: "260" },
        raidableResources: { metal: "1200", crystal: "450", deuterium: "125" },
        loot: 1775,
        shipUnits: [{ id: 4, count: 3, power: 900 }],
        defenseUnits: [{ id: 0, count: 12, power: 1200 }],
        combatPower: 2100,
        combatTechLevels: { weapons: 3, shielding: 2, armor: 1 },
      }),
    );

    expect(target.id).toBe("50");
    expect(target.name).toBe("Border Foundry");
    expect(target.publicState?.resources).toEqual({
      metal: "2440",
      crystal: "920",
      deuterium: "260",
    });
    expect(target.resources).toMatchObject({
      metal: 2440,
      crystal: 920,
      deuterium: 260,
    });
    expect(target.publicState?.fleet).toEqual([{ id: 4, count: 3 }]);
    expect(target.publicState?.defenses).toEqual([{ id: 0, count: 12 }]);
    expect(target.publicState?.research).toEqual([
      { id: 5, level: 3 },
      { id: 6, level: 2 },
      { id: 7, level: 1 },
    ]);
    expect(target.publicState?.stationedDefenderForecastTimeline).toEqual([]);
    expect(target.publicState?.stationedDefenderTimelineComplete).toBe(true);

    const forecast = publicTargetBattleForecast({ ...emptyMissionShips(), lightFighter: 1 }, target);
    expect(forecast.kind).not.toBe("uncertain");
    expect(forecast.defenderPower).toBeGreaterThan(0);
    expect(forecast.sampleReport).toBeDefined();
  });

  test("carries Rankings target defenses, fleet, and combat techs into attack mission public state", () => {
    const planet: HighscorePlanet = {
      planetId: "24",
      name: "Shalex",
      coordinates: { galaxy: 5, system: 314, position: 5 },
      archetype: "temperate-ocean",
      hasMoon: true,
      stationedDefenderForecastTimeline: [],
      stationedDefenderTimelineComplete: true,
      tactical: {
        currentResources: { metal: "1000", crystal: "2000", deuterium: "3000" },
        raidableResources: { metal: "500", crystal: "1000", deuterium: "1500" },
        raidableResourceTotal: "3000",
        ships: {
          count: 57,
          power: "1561000",
          units: [{ id: 5, count: 57, power: "1561000" }],
        },
        defenses: {
          count: 135,
          power: "443000",
          units: [
            { id: 0, count: 10, power: "20000" },
            { id: 1, count: 104, power: "208000" },
            { id: 2, count: 11, power: "88000" },
            { id: 4, count: 1, power: "35000" },
            { id: 5, count: 1, power: "8000" },
            { id: 6, count: 5, power: "75000" },
            { id: 8, count: 3, power: "9000" },
          ],
        },
        combatTechLevels: { weapons: 7, shielding: 6, armor: 6 },
        combatPower: "2004000",
      },
    };
    const entry: HighscoreEntry = {
      rank: 1,
      wallet: "0xdefender",
      displayName: "Shalex Commander",
      homePlanetId: "24",
      homePlanet: planet,
      planets: [planet],
      planetCount: 1,
      score: {
        total: "1",
        economy: "1",
        research: "1",
        researchLevels: "1",
        fleet: "1",
        fleetCount: "1",
        defense: "1",
      },
    };

    const target = highscorePlanetForMission(planet, entry);

    expect(target.publicState?.fleet).toEqual([{ id: 5, count: 57 }]);
    expect(target.publicState?.defenses?.reduce((sum, row) => sum + row.count, 0)).toBe(135);
    expect(target.publicState?.research).toEqual([
      { id: 5, level: 7 },
      { id: 6, level: 6 },
      { id: 7, level: 6 },
    ]);

    const composition = missionTargetCompositionUnits(target);
    const forecast = publicTargetBattleForecast({ ...emptyMissionShips(), lightFighter: 1 }, target);
    const intel = AttackIntelPanel({
      battleForecast: forecast,
      coords: planet.coordinates,
      lootableAtArrival: { metal: 500, crystal: 1000, deuterium: 1500 },
      maxLootForecast: { metal: 0, crystal: 0, deuterium: 0 },
      target,
      resourceIntel: targetResourceIntel(target, 0),
      stationedDefenderUnits: [],
      targetDefenseUnits: composition.defenses,
      targetFleetUnits: composition.fleet,
    });
    const renderedText = collectRenderedText(intel).join(" ");

    expect(composition.defenses.reduce((sum, unit) => sum + unit.count, 0)).toBe(135);
    expect(composition.fleet).toEqual([expect.objectContaining({ label: "Heavy Fighter", count: 57 })]);
    expect(forecast.kind).not.toBe("uncertain");
    expect(forecast.defenderPower).toBeGreaterThan(0);
    expect(forecast.sampleReport).toBeDefined();
    expect(forecast.defenderTechLevels).toEqual({
      weapons: 7,
      shielding: 6,
      armor: 6,
    });
    expect(renderedText).toContain("Heavy Fighter");
    expect(renderedText).toContain("Rocket Launcher");
    expect(renderedText).toContain("Plasma Turret");

    expect(missionTargetCompositionUnits(target, true)).toEqual({
      fleet: [],
      defenses: [],
    });
    expect(publicTargetBattleForecast({ ...emptyMissionShips(), lightFighter: 1 }, target, undefined, true).defenderPower).toBeNull();
  });

  test("does not invent full attack target resources from Raid Finder loot", () => {
    const target = raidTargetPlanetForMission(
      raidTarget({
        currentResources: null,
        raidableResources: { metal: "1200", crystal: "450", deuterium: "125" },
        loot: 1775,
      }),
    );

    expect(target.publicState?.resources).toBeNull();
    expect(target.resources).toMatchObject({
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
  });

  test("carries Raid Finder moon resources into attack mission public moon state", () => {
    const target = raidTargetPlanetForMission(
      raidTarget({
        currentResources: {
          metal: "100000",
          crystal: "80000",
          deuterium: "60000",
        },
        hasMoon: true,
        moonResources: { metal: "7386", crystal: "2472", deuterium: "1335" },
      }),
    );

    expect(target.publicState?.resources).toEqual({
      metal: "100000",
      crystal: "80000",
      deuterium: "60000",
    });
    expect(target.publicMoonState?.resources).toEqual({
      metal: "7386",
      crystal: "2472",
      deuterium: "1335",
    });
    expect(target.publicMoonState?.resources).not.toEqual(target.publicState?.resources);
  });

  test("blocks research completion transactions until the active queue is ready", () => {
    expect(
      researchCompletionUnavailableReasonFor({
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
      }),
    ).toBe("Research is not ready to complete yet.");

    expect(
      researchCompletionUnavailableReasonFor({
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
      }),
    ).toBeUndefined();
  });

  test("allows research completion with normalized millisecond readyAt values", () => {
    expect(
      researchCompletionUnavailableReasonFor({
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
      }),
    ).toBeUndefined();

    expect(
      researchCompletionUnavailableReasonFor({
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
      }),
    ).toBe("Research is not ready to complete yet.");
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
    expect(calls).toEqual([["https://api.test", "0x2222222222222222222222222222222222222222", "7"]]);
  });

  test("preserves a recently known active research queue when a refresh returns empty queue data", () => {
    const knownQueue = activeResearchQueue();
    const next = researchState({ queue: null });

    expect(
      researchStateWithPreservedActiveQueue({
        knownResearchQueue: knownQueue,
        next,
      }).queue,
    ).toBe(knownQueue);

    expect(
      researchStartUnavailableReasonFor({
        canTransact: true,
        knownResearchQueue: knownQueue,
        researchState: next,
      }),
    ).toBe("Another research is already active. Finish or refresh the active research before starting a new one.");
  });

  test("blocks research start when live wallet queues still report active research", async () => {
    const latestResearch = researchState({ queue: null });
    const latestQueues = walletQueues({
      research: activeResearchQueue({ itemId: 1, targetLevel: 4 }),
    });
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
      ["research", "https://api.test", "0x2222222222222222222222222222222222222222", "7"],
      ["queues", "https://api.test", "0x2222222222222222222222222222222222222222", "7"],
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

  test("blocks Shielding Technology level 1 before wallet submission when Energy Technology is below level 3", async () => {
    const latestResearch = researchState({
      technologyLevels: { "0": 2, "6": 0 },
      technologies: [
        {
          id: 0,
          level: 2,
          cost: { metal: "0", crystal: "3200", deuterium: "1600" },
        },
        {
          id: 6,
          level: 0,
          cost: { metal: "200", crystal: "600", deuterium: "0" },
        },
      ],
      researchLabLevel: 6,
    });

    const result = await researchStartUnavailableReasonAfterLiveRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: researchState(),
      selectedResearchKey: "shielding",
      selectedTechnologyId: 6,
      loadResearchState: (() => Promise.resolve(latestResearch)) as never,
      loadWalletQueues: (() => Promise.resolve(walletQueues({ research: null }))) as never,
    });

    expect(result.unavailableReason).toBe("Energy Technology 3 is required before starting Shielding Technology.");
  });

  test("allows Shielding Technology level 1 preflight when Research Lab 6, Energy 3, and resources are present", () => {
    expect(
      selectedResearchStartBlocker(
        researchState({
          technologyLevels: { "0": 3, "6": 0 },
          technologies: [
            {
              id: 0,
              level: 3,
              cost: { metal: "0", crystal: "6400", deuterium: "3200" },
            },
            {
              id: 6,
              level: 0,
              cost: { metal: "200", crystal: "600", deuterium: "0" },
            },
          ],
          researchLabLevel: 6,
        }),
        "shielding",
        6,
      ),
    ).toBeUndefined();
  });

  test("blocks Shielding Technology level 1 wallet submission while indexed research state is stale", async () => {
    const staleResearch = researchState({
      technologyLevels: { "0": 3, "6": 0 },
      technologies: [
        {
          id: 0,
          level: 3,
          cost: { metal: "0", crystal: "6400", deuterium: "3200" },
        },
        {
          id: 6,
          level: 0,
          cost: { metal: "200", crystal: "600", deuterium: "0" },
        },
      ],
      researchLabLevel: 6,
      stale: true,
    });

    const result = await researchStartUnavailableReasonAfterLiveRevalidation({
      account: "0x2222222222222222222222222222222222222222",
      activePlanetId: "7",
      apiBaseUrl: "https://api.test",
      fallback: researchState(),
      selectedResearchKey: "shielding",
      selectedTechnologyId: 6,
      loadResearchState: (() => Promise.resolve(staleResearch)) as never,
      loadWalletQueues: (() => Promise.resolve(walletQueues({ research: null }))) as never,
    });

    expect(result.unavailableReason).toBe("Research state is still syncing. Refresh research state and retry before starting research.");
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

    expect(
      overviewResearchCompletionUnavailableReasonFor({
        canTransact: true,
        now: 1_700_000_000_000,
        overviewQueue: readyOverviewQueue,
        researchState: null,
      }),
    ).toBeUndefined();

    expect(
      overviewResearchCompletionUnavailableReasonFor({
        canTransact: true,
        now: 1_699_999_000_000,
        overviewQueue: readyOverviewQueue,
        researchState: null,
      }),
    ).toBe("No active research queue is available to complete.");
  });

  test("lets Overview defense completion use the selected wallet queue planet before Defenses state is loaded", () => {
    expect(
      defenseCompletionPlanetIdFor({
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
      }),
    ).toBe("9");
  });

  test("falls back to wallet queue home planet for Overview defense completion when page state is absent", () => {
    expect(
      defenseCompletionPlanetIdFor({
        activePlanetId: undefined,
        defenseState: null,
        walletQueues: playerQueues({ homePlanetId: "7" }),
      }),
    ).toBe("7");
  });

  test("keeps loaded defense state as a defense completion fallback", () => {
    expect(
      defenseCompletionPlanetIdFor({
        activePlanetId: undefined,
        defenseState: defenseState({ homePlanetId: "11" }),
        walletQueues: undefined,
      }),
    ).toBe("11");
  });

  test("lets Overview Shipyard completion use the selected wallet queue planet before Shipyard state is loaded", () => {
    expect(
      shipCompletionPlanetIdFor({
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
      }),
    ).toBe("9");
  });

  test("falls back to wallet queue home planet for Overview Shipyard completion when page state is absent", () => {
    expect(
      shipCompletionPlanetIdFor({
        activePlanetId: undefined,
        shipyardState: null,
        walletQueues: playerQueues({ homePlanetId: "7" }),
      }),
    ).toBe("7");
  });

  test("keeps loaded Shipyard state as a Shipyard completion fallback", () => {
    expect(
      shipCompletionPlanetIdFor({
        activePlanetId: undefined,
        shipyardState: shipyardState({ homePlanetId: "11", planetId: "12" }),
        walletQueues: undefined,
      }),
    ).toBe("12");
  });

  test("preserves active research queues when a background wallet poll returns an empty research queue", () => {
    const activeResearch = activeResearchQueue();
    const currentQueues = playerQueues({ research: activeResearch });
    const emptyPollQueues = playerQueues({ research: null });

    expect(preserveActiveResearchQueue(currentQueues, emptyPollQueues).research).toEqual(activeResearch);
  });

  test("clears preserved research queues when a due completion poll returns no active queue", () => {
    const activeResearch = activeResearchQueue({ targetLevel: 2 });
    const currentQueues = playerQueues({ research: activeResearch });
    const emptyPollQueues = playerQueues({ research: null });

    expect(
      preserveActiveResearchQueue(currentQueues, emptyPollQueues, {
        now: 1_700_006_000_000,
      }).research,
    ).toBeNull();
  });

  test("schedules the soonest future production queue completion only", () => {
    expect(
      nextProductionQueueCompletionEventMs(
        [buildingQueue({ kind: "building", readyAt: "1700000020" }), buildingQueue({ kind: "defense", readyAt: "1700000010" }), buildingQueue({ kind: "ship", readyAt: "1699999990" }), null],
        1_700_000_000_000,
      ),
    ).toBe(1_700_000_010_000);

    expect(
      nextProductionQueueCompletionEventMs([buildingQueue({ kind: "building", readyAt: "1699999990" }), buildingQueue({ kind: "research", readyAt: "not-a-timestamp" })], 1_700_000_000_000),
    ).toBeUndefined();
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
        {
          id: 0,
          level: 2,
          cost: { metal: "0", crystal: "3200", deuterium: "1600" },
        },
      ],
    });

    expect(preserveActiveResearchState(currentState, completedRefresh).queue).toBeNull();
  });

  test("uses a preserved wallet research queue to keep new research starts disabled", () => {
    const activeResearch = activeResearchQueue({ itemId: 0, targetLevel: 2 });
    const loadedResearch = researchState({ queue: null });
    const effectiveResearchState = researchStateWithFallbackQueue(loadedResearch, activeResearch);

    expect(effectiveResearchState?.queue).toEqual(activeResearch);
    expect(
      researchCompletionUnavailableReasonFor({
        canTransact: true,
        now: 1_699_999_000_000,
        researchState: effectiveResearchState,
      }),
    ).toBe("Research is not ready to complete yet.");
  });

  test("lets Overview derive building readiness from the displayed active queue", () => {
    expect(
      overviewBuildingReadyToFinishFlag({
        activeBuildingQueue: null,
        isBuildingReadyToFinish: false,
        now: 1_700_000_000_000,
      }),
    ).toBeUndefined();

    expect(
      overviewBuildingReadyToFinishFlag({
        activeBuildingQueue: buildingQueue({
          readyAt: "1700000600",
        }),
        isBuildingReadyToFinish: false,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);

    expect(
      overviewBuildingReadyToFinishFlag({
        activeBuildingQueue: buildingQueue({
          readyAt: "1700000000",
        }),
        isBuildingReadyToFinish: false,
        now: 1_700_000_000_000,
      }),
    ).toBe(true);

    expect(
      overviewBuildingReadyToFinishFlag({
        activeBuildingQueue: buildingQueue({
          readyAt: "1700000600",
        }),
        isBuildingReadyToFinish: true,
        now: 1_700_000_000_000,
      }),
    ).toBe(true);
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
    expect(
      buildingCompletionReadyToFinishFlag({
        infrastructureState: unverifiedInfrastructure,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      overviewBuildingReadyToFinishFlag({
        activeBuildingQueue: readyWalletQueue,
        isBuildingReadyToFinish: buildingCompletionReadyToFinishFlag({
          infrastructureState: unverifiedInfrastructure,
          now: 1_700_000_000_000,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(true);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        fallbackBuildingQueue: readyWalletQueue,
        infrastructureState: unverifiedInfrastructure,
        now: 1_700_000_000_000,
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    const canonicalInfrastructure = infrastructureState({
      queue: readyWalletQueue,
      source: "contract-state-indexer",
      stale: false,
    });
    expect(canonicalInfrastructureBuildingCompletionQueue(canonicalInfrastructure)).toBe(readyWalletQueue);
    expect(
      buildingCompletionReadyToFinishFlag({
        infrastructureState: canonicalInfrastructure,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      buildingCompletionReadyToFinishFlag({
        infrastructureState: canonicalInfrastructure,
        now: 1_700_000_030_000,
      }),
    ).toBe(true);
  });

  test("uses effective infrastructure resources for next building actions after completed queues apply", () => {
    const completedEffectiveState = infrastructureState({
      buildings: [
        {
          id: 1,
          level: 6,
          cost: { metal: "1000", crystal: "500", deuterium: "0" },
        },
      ],
      queue: null,
      resources: { metal: "10", crystal: "10", deuterium: "0" },
      resourcesAsOfNow: { metal: "5000", crystal: "4000", deuterium: "1000" },
    });

    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
        buildingKey: "metalMine",
        gameContract: "0xgame",
        homePlanetId: "7",
        infrastructureChainState: completedEffectiveState,
        isWalletConnected: true,
        runtimeConfigStatus: "ready",
      }),
    ).toBeUndefined();
  });

  test("blocks stale building completion transactions when backend infrastructure has no active queue", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({ queue: null }),
        now: 1_700_000_000_000,
      }),
    ).toBe("No active building upgrade is waiting to be finished. Refresh infrastructure state and retry.");
  });

  test("blocks stale building completion transactions when the backend queue is not ready", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
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
      }),
    ).toBe("Building upgrade is not ready to finish yet.");
  });

  test("blocks building completion transactions when backend infrastructure state is missing", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: null,
        now: 1_700_000_000_000,
      }),
    ).toBe(buildingFinishLiveStateRequiredLabel);
  });

  test("allows ready indexed building completion from warm stale metadata", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBeUndefined();

    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          stale: true,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    const readyQueue = readyBuildingQueue();
    expect(
      buildingCompletionReadyToFinishFlag({
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBe(true);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBeUndefined();

    expect(
      buildingCompletionReadyToFinishFlag({
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
      }),
    ).toBe(true);
    expect(
      buildingCompletionUnavailableReasonFor({
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
      }),
    ).toBeUndefined();
  });

  test("allows indexed ready building queues after backend revalidation without readonly preflight gating", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "contract-state-indexer",
          stale: false,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBeUndefined();
  });

  test("blocks indexed ready building queues while infrastructure detail state is still loading", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      buildingCompletionReadyToFinishFlag({
        fallbackBuildingQueue: readyQueue,
        infrastructureState: null,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        fallbackBuildingQueue: readyQueue,
        infrastructureState: null,
        now: 1_700_000_000_000,
      }),
    ).toBe(buildingFinishLiveStateRequiredLabel);
    expect(
      buildingFinishUnavailableReasonForDisplay({
        activeBuildingQueue: readyQueue,
        canTransact: true,
        infrastructureState: null,
        isBuildingReadyToFinish: true,
        isDisplayedBuildingQueueReady: true,
        now: 1_700_000_000_000,
      }),
    ).toBe(buildingFinishLiveStateRequiredLabel);
  });

  test("keeps visible ready queues paused while indexed infrastructure is stale", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      buildingCompletionReadyToFinishFlag({
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          queue: null,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          queue: null,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("keeps degraded ready indexed building completion paused", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      buildingCompletionReadyToFinishFlag({
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          degraded: true,
          queue: null,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        fallbackBuildingQueue: readyQueue,
        infrastructureState: infrastructureState({
          degraded: true,
          queue: null,
          source: "contract-state-indexer",
          stale: true,
        }),
        now: 1_700_000_000_000,
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("keeps displayed building finish verification open only when backend indexed queue is ready", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBeUndefined();

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("routes degraded ready building finish actions to backend-unavailable copy", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      infrastructureBackendSyncPausedReasonFor({
        infrastructureChainState: infrastructureState({
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: false,
        }),
        infrastructureError: "Moon API could not be reached from this browser.",
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    expect(
      infrastructureBackendSyncPausedReasonFor({
        infrastructureChainState: infrastructureState({
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: true,
        }),
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    expect(
      infrastructureBackendSyncPausedReasonFor({
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
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    expect(
      infrastructureBackendSyncPausedReasonFor({
        infrastructureChainState: infrastructureState({
          degraded: true,
          queue: readyQueue,
          source: "contract-state-indexer",
          stale: true,
        }),
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBeUndefined();
    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBeUndefined();
    expect(infrastructureBackendSyncPausedLabel).toBe("Servers are unavailable. Retrying in 10 seconds. Building actions are paused until current game state is available.");
    expect(infrastructureBackendSyncPausedLabel).not.toMatch(/API|RPC|backend|wallet network|last game state/i);
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

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBe("Wallet or game contract is unavailable.");
  });

  test("blocks duplicate finish attempts while a submitted building completion is still visible", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      completedBuildingFinishSyncReasonFor({
        activeBuildingQueue: readyQueue,
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toContain("Waiting for backend state to clear this completed queue");

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toContain("Waiting for backend state to clear this completed queue");
  });

  test("clears duplicate finish blocking when the active building queue changes", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      completedBuildingFinishSyncReasonFor({
        activeBuildingQueue: {
          ...readyQueue,
          targetLevel: 3,
        },
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toBeUndefined();
    expect(
      completedBuildingFinishSyncReasonFor({
        activeBuildingQueue: null,
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toBeUndefined();
  });

  test("keeps failed finish attempts recoverable after backend revalidation catches up", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      failedBuildingFinishSyncReasonFor({
        activeBuildingQueue: readyQueue,
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toContain("Building completion failed for this ready queue");

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBeUndefined();

    expect(
      buildingFinishUnavailableReasonForDisplay({
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
      }),
    ).toBeUndefined();
  });

  test("clears failed finish blocking when the active building queue changes", () => {
    const readyQueue = readyBuildingQueue();

    expect(
      failedBuildingFinishSyncReasonFor({
        activeBuildingQueue: {
          ...readyQueue,
          targetLevel: 3,
        },
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toBeUndefined();
    expect(
      failedBuildingFinishSyncReasonFor({
        activeBuildingQueue: null,
        expectation: {
          itemId: readyQueue.itemId,
          targetLevel: readyQueue.targetLevel,
        },
      }),
    ).toBeUndefined();
  });

  test("allows building completion wallet submission after backend ready queue revalidation", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "live-rpc",
          stale: false,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBeUndefined();
  });

  test("blocks building completion during the client-clock safety window", () => {
    expect(
      buildingCompletionReadyToFinishFlag({
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "live-rpc",
          stale: false,
        }),
        now: 1_700_000_029_000,
      }),
    ).toBe(false);
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "live-rpc",
          stale: false,
        }),
        now: 1_700_000_029_000,
      }),
    ).toBe("Building upgrade is not ready to finish yet.");
    expect(
      buildingCompletionUnavailableReasonFor({
        canTransact: true,
        infrastructureState: infrastructureState({
          queue: readyBuildingQueue(),
          source: "live-rpc",
          stale: false,
        }),
        now: 1_700_000_030_000,
      }),
    ).toBeUndefined();
  });

  test("allows building completion revalidation with normalized millisecond readyAt values", () => {
    expect(
      buildingCompletionUnavailableReasonFor({
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
      }),
    ).toBeUndefined();

    expect(
      buildingCompletionUnavailableReasonFor({
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
      }),
    ).toBe("Building upgrade is not ready to finish yet.");
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
    expect(calls).toEqual([["https://api.test", "0x2222222222222222222222222222222222222222", "7"]]);
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
    expect(calls).toEqual([["https://api.test", "0x2222222222222222222222222222222222222222", "7"]]);
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
    expect(calls).toEqual([["https://api.test", "0x2222222222222222222222222222222222222222", "7"]]);
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
    expect(calls).toEqual([["https://api.test", "0x2222222222222222222222222222222222222222", "7"]]);
  });

  test("keeps loaded infrastructure usable while a background refresh is pending", () => {
    expect(
      infrastructureUnavailableReasonFor({
        buildingAction: { status: "idle" },
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: infrastructureState(),
        infrastructureLoading: true,
        isWalletConnected: true,
        onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
        onChainStatus: "loading",
        runtimeConfigStatus: "ready",
      }),
    ).toBeUndefined();
  });

  test("pauses infrastructure actions while loaded backend state is refresh-degraded", () => {
    expect(
      infrastructureUnavailableReasonFor({
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
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);

    expect(
      infrastructureUnavailableReasonFor({
        buildingAction: { status: "idle" },
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: infrastructureState({
          degraded: true,
          stale: true,
        }),
        infrastructureLoading: false,
        isWalletConnected: true,
        onChainResources: { metal: 500, crystal: 400, deuterium: 300 },
        onChainStatus: "ready",
        runtimeConfigStatus: "ready",
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("uses infrastructure loading and error reasons before the first state arrives", () => {
    expect(
      infrastructureUnavailableReasonFor({
        buildingAction: { status: "idle" },
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: null,
        infrastructureLoading: true,
        isWalletConnected: true,
        onChainResources: undefined,
        onChainStatus: "loading",
        runtimeConfigStatus: "ready",
      }),
    ).toBe("Loading your wallet resources and building levels");

    expect(
      infrastructureUnavailableReasonFor({
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
      }),
    ).toBe("Game state unavailable; upgrades are disabled until your wallet resources and building levels load.");
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

    expect(
      infrastructureLoadErrorFor({
        activeBuildingQueue: activeBuilding,
        infrastructureChainState: null,
        infrastructureError: "Infrastructure request failed with 503.",
        isWalletConnected: true,
      }),
    ).toBe("Infrastructure request failed with 503.");

    expect(
      infrastructureLoadErrorFor({
        activeBuildingQueue: null,
        infrastructureChainState: null,
        infrastructureError: "Infrastructure request failed with 503.",
        isWalletConnected: true,
      }),
    ).toBe("Infrastructure request failed with 503.");

    expect(
      infrastructureLoadErrorFor({
        activeBuildingQueue: null,
        infrastructureChainState: infrastructureState(),
        infrastructureError: "Infrastructure request failed with 503.",
        isWalletConnected: true,
      }),
    ).toBe("Infrastructure request failed with 503.");

    expect(
      hasInfrastructureDisplayState({
        activeBuildingQueue: activeBuilding,
        homePlanetId: "7",
        infrastructureChainState: null,
        onChainResources: { metal: 500, crystal: 300, deuterium: 100 },
      }),
    ).toBe(true);

    expect(
      hasInfrastructureDisplayState({
        activeBuildingQueue: null,
        homePlanetId: "7",
        infrastructureChainState: null,
        onChainResources: { metal: 500, crystal: 300, deuterium: 100 },
      }),
    ).toBe(false);
  });

  test("allows building transactions from refreshed backend infrastructure resources", () => {
    expect(
      refreshedInfrastructureUnavailableReasonFor({
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: infrastructureState(),
        isWalletConnected: true,
        onChainResources: undefined,
        runtimeConfigStatus: "ready",
      }),
    ).toBeUndefined();
  });

  test("blocks building transactions when refreshed infrastructure is unavailable", () => {
    expect(
      refreshedInfrastructureUnavailableReasonFor({
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
      }),
    ).toBe("Infrastructure is unavailable on this deployment.");
  });

  test("blocks building transactions when refreshed backend resources cannot afford the upgrade", () => {
    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
        buildingKey: "solarPlant",
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: infrastructureState({
          resources: { metal: "0", crystal: "0", deuterium: "0" },
        }),
        isWalletConnected: true,
        onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
        runtimeConfigStatus: "ready",
      }),
    ).toContain("Requires");
  });

  test("applies starter mine prerequisites during refreshed home-planet building preflight only", () => {
    const starterState = infrastructureState({
      resources: { metal: "10000", crystal: "10000", deuterium: "10000" },
    });

    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
        buildingKey: "deuteriumSynthesizer",
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "7",
        infrastructureChainState: starterState,
        isWalletConnected: true,
        onChainResources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
        runtimeConfigStatus: "ready",
        starterPlanet: true,
      }),
    ).toBe("Requires Metal Mine level 1");

    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
        buildingKey: "deuteriumSynthesizer",
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "8",
        infrastructureChainState: starterState,
        isWalletConnected: true,
        onChainResources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
        runtimeConfigStatus: "ready",
        starterPlanet: false,
      }),
    ).toBeUndefined();
  });

  test("blocks Shipyard upgrades while refreshed backend infrastructure is stale", () => {
    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
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
      }),
    ).toBe(infrastructureBackendSyncPausedLabel);
  });

  test("blocks infrastructure upgrades with mission-resolution copy before wallet signing", () => {
    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
        buildingKey: "solarPlant",
        gameContract: "0x3333333333333333333333333333333333333333",
        homePlanetId: "188",
        infrastructureChainState: infrastructureState({
          actionBlocker: {
            kind: "mission_resolution_pending",
            detail: "Mission resolution is pending for this planet (mission 1737).",
            missionIds: ["1737"],
            earliestArrivalAt: "1781805853",
          },
          infrastructureAvailable: false,
          stale: true,
          unavailableReason: "Mission resolution is pending for this planet (mission 1737).",
        }),
        isWalletConnected: true,
        onChainResources: { metal: 500, crystal: 500, deuterium: 0 },
        runtimeConfigStatus: "ready",
      }),
    ).toBe(infrastructureMissionResolutionPendingLabel);
  });

  test("keeps Shipyard upgrade backend read failures out of wallet reconnect copy", () => {
    const label = buildingUpgradeActionErrorLabel(new Error("Infrastructure API failed: 400: RPC 3: execution reverted"));

    expect(label).toBe(infrastructureBackendSyncPausedLabel);
    expect(label).not.toContain("wallet");
    expect(label).not.toContain("Base Sepolia");
  });

  test("blocks building transactions with ready-to-finish copy when refreshed backend infrastructure has a ready active queue", () => {
    expect(
      refreshedInfrastructureUpgradeUnavailableReasonFor({
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
      }),
    ).toContain("ready to finish");
  });

  test("hydrates indexed planet state before requesting canonical settlement state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];
    const activeMission = fleetMission({
      missionId: "42",
      owner: wallet,
      originPlanetId: "7",
      targetPlanetId: "9",
    });

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/overview")) {
        return Promise.resolve(
          Response.json(
            walletOverviewSnapshot(wallet, {
              fleetVisibility: {
                wallet,
                homePlanetId: "7",
                incoming: [],
                outgoing: [activeMission],
                returning: [],
                joinableAttacks: [],
                completedMissions: [],
                battleReports: [],
              },
            }),
          ),
        );
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
      expect(requestedPaths).toEqual([`/wallet/${wallet}/overview`]);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/queues`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not start a pending settlement read before showing indexed planet state", async () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      undefined,
      {},
      {
        fetchWalletOverviewSnapshot: async () => {
          requestedPaths.push(`/wallet/${wallet}/overview`);
          return walletOverviewSnapshot(wallet) as any;
        },
        fetchWalletSettlement: async () => new Promise(() => undefined) as never,
      },
    );

    expect(snapshot.settlement.homePlanetId).toBe("7");
    expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
    expect(snapshot.planetsResponse.planets).toHaveLength(1);
    expect(requestedPaths).toEqual([`/wallet/${wallet}/overview`]);
  });

  test("does not fall back to multi-read hydration when the Overview snapshot endpoint is present but unavailable", async () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    await expect(
      loadWalletPlanetSyncSnapshot(
        "https://api.test",
        wallet,
        undefined,
        {},
        {
          fetchWalletOverviewSnapshot: async () => {
            requestedPaths.push(`/wallet/${wallet}/overview`);
            throw new Error("Overview snapshot API failed: 503: indexed_read_not_ready");
          },
          fetchWalletPlanets: async () => {
            throw new Error("Overview should not fan out after an unavailable combined snapshot response");
          },
        },
      ),
    ).rejects.toThrow("Overview snapshot API failed: 503: indexed_read_not_ready");
    expect(requestedPaths).toEqual([`/wallet/${wallet}/overview`]);
  });

  test("keeps indexed active building queues in the reload snapshot", async () => {
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

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      undefined,
      {},
      {
        fetchWalletOverviewSnapshot: async () =>
          walletOverviewSnapshot(wallet, {
            planetsResponse: {
              wallet,
              homePlanetId: "7",
              queues: { research: null },
              planets: [
                {
                  ...indexedPlanet(wallet),
                  queues: {
                    building: activeBuilding,
                    defense: null,
                    ship: null,
                  },
                },
              ],
            },
          }) as any,
      },
    );

    expect(snapshot.queues.building).toEqual(activeBuilding);
  });

  test("keeps indexed active research queues in the reload snapshot", async () => {
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

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      undefined,
      {},
      {
        fetchWalletOverviewSnapshot: async () => {
          requestedPaths.push(`/wallet/${wallet}/overview`);
          return walletOverviewSnapshot(wallet, {
            planetsResponse: {
              wallet,
              homePlanetId: "7",
              queues: {
                research: activeResearch,
              },
              planets: [indexedPlanet(wallet)],
            },
          }) as any;
        },
      },
    );

    expect(snapshot.queues.research).toEqual(activeResearch);
    expect(requestedPaths).toEqual([`/wallet/${wallet}/overview`]);
  });

  test("fetches active research queues when indexed planets omit the global queue snapshot", async () => {
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

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      undefined,
      {},
      {
        fetchWalletOverviewSnapshot: async () => {
          requestedPaths.push(`/wallet/${wallet}/overview`);
          return walletOverviewSnapshot(wallet, {
            queues: {
              wallet,
              homePlanetId: "7",
              building: null,
              defense: null,
              ship: null,
              research: activeResearch,
            },
          }) as any;
        },
      },
    );

    expect(snapshot.queues.research).toEqual(activeResearch);
    expect(requestedPaths).toEqual([`/wallet/${wallet}/overview`]);
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

      if (url.pathname.endsWith("/overview")) {
        return Promise.resolve(
          Response.json(
            walletOverviewSnapshot(wallet, {
              planetsResponse: {
                wallet,
                homePlanetId: "7",
                planets: [
                  {
                    ...indexedPlanet(wallet),
                    queues: {
                      building: homeBuilding,
                      defense: null,
                      ship: null,
                    },
                  },
                  {
                    ...indexedPlanet(wallet),
                    planetId: "8",
                    isHomePlanet: false,
                    coordinates: "2:44:10",
                    queues: {
                      building: colonyBuilding,
                      defense: null,
                      ship: null,
                    },
                  },
                ],
              },
              queues: {
                wallet,
                homePlanetId: "8",
                building: colonyBuilding,
                defense: null,
                ship: null,
                research: null,
              },
            }),
          ),
        );
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
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    const snapshot = await loadWalletPlanetSyncSnapshot(
      "https://api.test",
      wallet,
      undefined,
      {},
      {
        fetchWalletOverviewSnapshot: async () => {
          requestedPaths.push(`/wallet/${wallet}/overview`);
          throw new Error("Overview snapshot API failed: 404: missing");
        },
        fetchWalletPlanets: async () => {
          requestedPaths.push(`/wallet/${wallet}/planets`);
          return {
            wallet,
            homePlanetId: null,
            planets: [],
          } as any;
        },
        fetchWalletSettlement: async () => {
          requestedPaths.push(`/wallet/${wallet}/settlement`);
          return {
            wallet,
            hasFirstPlanet: true,
            homePlanetId: "7",
            planet: indexedPlanet(wallet),
          } as any;
        },
        fetchWalletQueues: async () => {
          requestedPaths.push(`/wallet/${wallet}/queues`);
          return {
            wallet,
            homePlanetId: "7",
            building: null,
            defense: null,
            ship: null,
            research: null,
          } as any;
        },
        fetchFleetMissionVisibility: async () => {
          requestedPaths.push(`/wallet/${wallet}/fleet-visibility?archive=none`);
          return {
            wallet,
            homePlanetId: "7",
            incoming: [],
            outgoing: [],
            returning: [],
            joinableAttacks: [],
            completedMissions: [],
            battleReports: [],
          } as any;
        },
      },
    );

    expect(snapshot.settlement.homePlanetId).toBe("7");
    expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
    expect(requestedPaths[0]).toBe(`/wallet/${wallet}/overview`);
    expect(requestedPaths).toContain(`/wallet/${wallet}/planets`);
    expect(requestedPaths).toContain(`/wallet/${wallet}/settlement`);
    expect(requestedPaths).toContain(`/wallet/${wallet}/queues`);
    // Fleet visibility is fetched without archived missions during hydration (?archive=none).
    expect(requestedPaths).toContain(`/wallet/${wallet}/fleet-visibility?archive=none`);
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
  actionBlocker,
  buildings,
  degraded,
  energyBalance,
  indexer,
  infrastructureAvailable,
  queue,
  resources,
  resourcesAsOfNow,
  source,
  stale,
  unavailableReason,
}: Partial<
  Pick<
    ChainInfrastructureState,
    "actionBlocker" | "buildings" | "degraded" | "energyBalance" | "indexer" | "infrastructureAvailable" | "queue" | "resources" | "resourcesAsOfNow" | "source" | "stale" | "unavailableReason"
  >
> = {}): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    actionBlocker,
    degraded,
    indexer,
    source,
    stale,
    infrastructureAvailable: infrastructureAvailable ?? true,
    unavailableReason,
    resources: resources ?? { metal: "500", crystal: "500", deuterium: "0" },
    resourcesAsOfNow,
    productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
    energyBalance,
    storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
    buildings: buildings ?? [],
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

function activeResearchQueue({ itemId = 0, targetLevel = 2 }: Partial<Pick<QueueStateResponse, "itemId" | "targetLevel">> = {}): QueueStateResponse {
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

function playerQueues({ defense, homePlanetId, research, ship }: Partial<Pick<PlayerQueuesResponse, "defense" | "homePlanetId" | "research" | "ship">> = {}): PlayerQueuesResponse {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: homePlanetId ?? "7",
    building: null,
    defense: defense ?? null,
    ship: ship ?? null,
    research: research ?? null,
  };
}

function defenseState({ homePlanetId }: Partial<Pick<ChainDefenseState, "homePlanetId">> = {}): ChainDefenseState {
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

function shipyardState({ homePlanetId, planetId }: Partial<Pick<ChainShipyardState, "homePlanetId" | "planetId">> = {}): ChainShipyardState {
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
  indexer,
  planetId,
  stale,
  researchLabLevel,
  technologyLevels,
  technologies,
}: Partial<Pick<ChainResearchState, "indexer" | "planetId" | "queue" | "researchLabLevel" | "stale" | "technologies" | "technologyLevels">> = {}): ChainResearchState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    planetId,
    indexer,
    stale,
    researchAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    researchLabLevel: researchLabLevel ?? 1,
    researchNetworkLabLevels: [],
    technologyLevels: technologyLevels ?? { "0": 1 },
    technologies: technologies ?? [
      {
        id: 0,
        level: 1,
        cost: { metal: "0", crystal: "1600", deuterium: "800" },
      },
    ],
    queue: queue ?? null,
  };
}

function activeResearchQueue({ itemId = 0, targetLevel = 2 }: Partial<Pick<QueueStateResponse, "itemId" | "targetLevel">> = {}): QueueStateResponse {
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

function walletQueues({ research }: { research: QueueStateResponse | null }) {
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

function raidTarget(overrides: Partial<RaidTarget> = {}): RaidTarget {
  return {
    planetId: "9",
    name: "Raid target",
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    owner: "0x3333333333333333333333333333333333333333",
    ownerDisplayName: "Raider",
    alliance: null,
    hasMoon: false,
    moonResources: null,
    distance: 42,
    loot: 0,
    grossLoot: 0,
    raidableResources: null,
    combatPower: 0,
    combatTechLevels: null,
    shipPower: 0,
    shipCount: 0,
    shipUnits: [],
    combatShipUnits: [],
    defensePower: 0,
    defenseCount: 0,
    defenseUnits: [],
    stationedDefenderForecastTimeline: [],
    stationedDefenderTimelineComplete: true,
    protection: {
      isProtected: false,
      isSameAlliance: false,
      blockedReason: "none",
      blockedReasonLabel: null,
      scoreComparison: null,
      defenderInactive: false,
    },
    inbound: { count: 0, nextArrivalAtMs: null },
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

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function walletSettlementResponse(wallet: string): WalletSettlementResponse {
  return {
    wallet,
    hasFirstPlanet: true,
    homePlanetId: "7",
    planet: indexedPlanet(wallet),
  };
}

function walletPlanetsResponse(wallet: string, planets: ReturnType<typeof indexedPlanet>[]): WalletPlanetsResponse {
  return {
    wallet,
    homePlanetId: planets.find((planet) => planet.isHomePlanet)?.planetId ?? planets[0]?.planetId ?? null,
    planets,
    queues: {
      research: null,
    },
  };
}

function walletOverviewSnapshot(
  wallet: string,
  overrides: Partial<{
    fleetVisibility: ReturnType<typeof emptyFleetVisibilityFixture>;
    planetsResponse: {
      wallet: string;
      homePlanetId: string | null;
      queues?: { research: unknown };
      planets: Array<ReturnType<typeof indexedPlanet>>;
    };
    queues: {
      wallet: string;
      homePlanetId: string | null;
      building: unknown;
      defense: unknown;
      ship: unknown;
      research: unknown;
    };
    settlement: {
      wallet: string;
      hasFirstPlanet: boolean;
      homePlanetId: string | null;
      planet: ReturnType<typeof indexedPlanet> | null;
    };
  }> = {},
) {
  const planet = indexedPlanet(wallet);
  const planetsResponse = overrides.planetsResponse ?? {
    wallet,
    homePlanetId: "7",
    queues: { research: null },
    planets: [planet],
  };

  return {
    settlement: overrides.settlement ?? {
      wallet,
      hasFirstPlanet: true,
      homePlanetId: planetsResponse.homePlanetId,
      planet: planetsResponse.planets[0] ?? planet,
    },
    planetsResponse,
    queues: overrides.queues ?? {
      wallet,
      homePlanetId: planetsResponse.homePlanetId,
      building: planetsResponse.planets[0]?.queues.building ?? null,
      defense: planetsResponse.planets[0]?.queues.defense ?? null,
      ship: planetsResponse.planets[0]?.queues.ship ?? null,
      research: planetsResponse.queues?.research ?? null,
    },
    fleetVisibility: overrides.fleetVisibility ?? emptyFleetVisibilityFixture(wallet, planetsResponse.homePlanetId),
  };
}

function emptyFleetVisibilityFixture(wallet: string, homePlanetId: string | null = "7") {
  return {
    wallet,
    homePlanetId,
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };
}
