import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { Coordinates, Planet } from "./types";
import { GalaxyView, type GalaxyActionState } from "./components/GalaxyView";
import { PlanetDetail } from "./components/PlanetDetail";
import { TopBar } from "./components/TopBar";
import { NavBar, type Page } from "./components/NavBar";
import { OverviewPage, type PlanetRenameActionState } from "./components/OverviewPage";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { DefensePage } from "./components/DefensePage";
import { AlliancePage } from "./components/AlliancePage";
import { ResearchPage, type ResearchActionState } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import { RiftPage } from "./components/RiftPage";
import { MoonPage } from "./components/MoonPage";
import { MissionControlPage } from "./components/MissionControlPage";
import { RankingsPage } from "./components/RankingsPage";
import {
  buildingKeyForContractId,
  infrastructureActionNoticeFor,
  type BuildingActionState,
} from "./buildingActionNotice";

export { infrastructureActionNoticeFor } from "./buildingActionNotice";
import {
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetImageForType,
  planetsFromSystemResponse,
  planetTypeFromTemperature,
} from "./data/mockUniverse";
import {
  buildingContractIds,
  collectibleResourceDeltas,
  energyBalance,
  hasCollectableResources,
  productionPerHour,
  progress,
  storageCaps,
  type BuildingKey,
  type DefenseKey,
  type PlanetProductionProfile,
  type PlayableState,
  type ResearchKey,
  type ShipKey,
} from "./playableMvp";
import { allianceContractAddress, gameContractAddress, moonContractAddress, runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
import {
  buildingQueueItemForDisplay,
  buildingCosts,
  energyBalanceFromChain,
  infrastructurePlayableState,
} from "./chainState";
import {
  isWalletPlanetHydrated,
  safeResourceNumber,
  usedFieldsFromBuildings,
  type ChainLoadStatus,
} from "./overviewData";
import {
  waitForFinishedBuildingState,
  waitForHydratedWalletPlanet,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingExpectation,
} from "./postTransactionRefresh";
import {
  emptyMissionShips,
  missionTypeId,
  type GalaxyAction,
  type MissionShips,
} from "./galaxyActions";
import {
  type FleetDriveLevels,
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
} from "./fleetMissionRules";
import {
  fetchInfrastructureState,
  fetchMoonState,
  fetchDefenseState,
  fetchShipyardState,
  fetchResearchState,
  fetchRiftState,
  fetchWalletPlanets,
  fetchFleetMissionVisibility,
  fetchAllianceState,
  sendFinishDefenseProductionTransaction,
  fetchWalletQueues,
  fetchWalletSettlement,
  parseRiftTokenAmount,
  sendApproveResourceTokenTransaction,
  sendCollectResourcesTransaction,
  sendFinishBuildingUpgradeTransaction,
  sendCompleteFleetMissionReturnTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendFinishShipProductionTransaction,
  sendFinishResearchTransaction,
  sendAbandonPlanetTransaction,
  sendCreateColonyTransaction,
  sendJoinAttackMissionTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchFleetMissionTransaction,
  sendFinishMoonBuildingUpgradeTransaction,
  sendJumpGateJumpTransaction,
  sendMoonScanTransaction,
  sendRecallFleetMissionTransaction,
  sendResolveFleetMissionTransaction,
  sendDepositResourceTransaction,
  sendRenamePlanetTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartMoonBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendAcceptAllianceInviteTransaction,
  sendAllianceJoinRequestTransaction,
  sendAllianceKickTransaction,
  sendAllianceInviteTransaction,
  sendAllianceProfileTransaction,
  sendAllianceRoleTransaction,
  sendApproveAllianceJoinRequestTransaction,
  sendCancelAllianceJoinRequestTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  sendCreateAllianceTransaction,
  waitForReceipt,
  type ChainDefenseState,
  type ChainAllianceState,
  type ChainInfrastructureState,
  type ChainMoonState,
  type ChainResearchState,
  type ChainRiftState,
  type ChainShipyardState,
  type Eip1193Provider,
  type FleetMissionVisibilityResponse,
  type OnChainResources,
  type PendingWithdrawal,
  type ManagedPlanetResponse,
  type PlanetSummary,
  type RiftResourceState,
  type PlayerQueuesResponse,
  type WalletSettlementResponse,
} from "./walletFlow";

interface PlayableMvpAppProps {
  provider?: Eip1193Provider | undefined;
  account?: string | undefined;
  planet?: PlanetSummary | undefined;
}

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type DefenseActionState = ShipyardActionState;
type AllianceActionState = ShipyardActionState;
type RiftActionState = ShipyardActionState;
export type PlanetActionState = ShipyardActionState;
type PlanetManagementActionState = PlanetActionState;
type MissionActionState = ShipyardActionState;
type MoonActionState = ShipyardActionState;

export function displayHomeCoordinates(
  homePlanet: Coordinates | undefined,
  homeCoords: Coordinates | undefined,
  fallbackCoordinates: string | undefined
): string | undefined {
  const coordinates = homePlanet ?? homeCoords;
  if (!coordinates) return fallbackCoordinates;

  return `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`;
}

function resourceAmountIsZero(value: string): boolean {
  try {
    return BigInt(value) === 0n;
  } catch {
    return value === "0";
  }
}

export function abandonPlanetUnavailableLabel(
  planet: ManagedPlanetResponse,
  canTransact: boolean,
  action: PlanetActionState
): string | undefined {
  if (action.status === "pending") return undefined;
  if (!canTransact) return undefined;
  if (planet.isHomePlanet) return "Home planets cannot be abandoned.";
  if (planet.queues.building?.active || planet.queues.defense?.active || planet.queues.ship?.active) {
    return "Finish active queues before abandoning this colony.";
  }
  if (
    !resourceAmountIsZero(planet.resources.metal)
    || !resourceAmountIsZero(planet.resources.crystal)
    || !resourceAmountIsZero(planet.resources.deuterium)
  ) {
    return "Empty colony resources before abandoning.";
  }

  return undefined;
}

export function shouldShowAbandonPlanetButton(
  planet: ManagedPlanetResponse,
  canTransact: boolean,
  action: PlanetActionState
): boolean {
  return canTransact && action.status !== "pending" && abandonPlanetUnavailableLabel(planet, canTransact, action) === undefined;
}

const counterplayShipPriority = [
  "battlecruiser",
  "reaper",
  "destroyer",
  "battleship",
  "cruiser",
  "heavyFighter",
  "lightFighter",
  "pathfinder",
  "smallCargo",
] as const satisfies ReadonlyArray<keyof MissionShips>;

type CounterplayShipKey = (typeof counterplayShipPriority)[number];

const counterplayShipIds: Record<CounterplayShipKey, number> = {
  smallCargo: 0,
  lightFighter: 1,
  heavyFighter: 5,
  cruiser: 6,
  battleship: 7,
  destroyer: 10,
  battlecruiser: 12,
  reaper: 13,
  pathfinder: 14,
};

function selectCounterplayShips(shipyardState: ChainShipyardState | null): MissionShips | null {
  const selected = emptyMissionShips();
  for (const key of counterplayShipPriority) {
    const ship = shipyardState?.ships.find((candidate) => candidate.id === counterplayShipIds[key]);
    if (ship && ship.count > 0) {
      selected[key] = 1;
      return selected;
    }
  }
  return null;
}

function transportCargoForSelectedPlanet(
  planet: ManagedPlanetResponse | undefined,
  ships: MissionShips,
  target: Coordinates,
  driveLevels: FleetDriveLevels = {},
  speedPercent = 100,
): Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined {
  if (!planet?.resources) return undefined;

  const distance = fleetMissionDistance(planet, target);
  const fuelCost = fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  let remaining = fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  if (remaining <= 0) return undefined;

  const metal = Math.min(safeResourceNumber(planet.resources.metal) ?? 0, remaining);
  remaining -= metal;
  const crystal = Math.min(safeResourceNumber(planet.resources.crystal) ?? 0, remaining);
  remaining -= crystal;

  const deuteriumAvailable = Math.max(0, (safeResourceNumber(planet.resources.deuterium) ?? 0) - fuelCost);
  const deuterium = Math.min(deuteriumAvailable, remaining);

  if (metal === 0 && crystal === 0 && deuterium === 0) return undefined;
  return {
    metal: String(metal),
    crystal: String(crystal),
    deuterium: String(deuterium),
  };
}

function driveLevelsFromTechnologyLevels(levels: Record<string, number> | undefined): FleetDriveLevels {
  return {
    combustionDrive: levels?.["3"] ?? 0,
    impulseDrive: levels?.["9"] ?? 0,
    hyperspaceDrive: levels?.["10"] ?? 0,
  };
}

async function loadWalletPlanetSyncSnapshot(
  apiBaseUrl: string,
  account: string,
  activePlanetId: string | undefined,
): Promise<WalletPlanetSyncSnapshot> {
  const settlement = await fetchWalletSettlement(apiBaseUrl, account);
  const [planetsResult, queuesResult, visibilityResult] = await Promise.allSettled([
    fetchWalletPlanets(apiBaseUrl, account),
    fetchWalletQueues(apiBaseUrl, account, activePlanetId),
    fetchFleetMissionVisibility(apiBaseUrl, account),
  ]);

  const planetsResponse = planetsResult.status === "fulfilled"
    ? planetsResult.value
    : {
        wallet: account,
        homePlanetId: settlement.homePlanetId,
        planets: [],
      };
  const queues = queuesResult.status === "fulfilled"
    ? queuesResult.value
    : emptyPlayerQueues(account, settlement.homePlanetId);
  const fleetVisibility = visibilityResult.status === "fulfilled"
    ? visibilityResult.value
    : emptyFleetVisibility(account, settlement.homePlanetId);

  return {
    fleetVisibility,
    planetsResponse,
    queues,
    settlement,
  };
}

function emptyPlayerQueues(wallet: string, homePlanetId: string | null): PlayerQueuesResponse {
  return {
    wallet,
    homePlanetId,
    building: null,
    defense: null,
    ship: null,
    research: null,
  };
}

function emptyFleetVisibility(wallet: string, homePlanetId: string | null): FleetMissionVisibilityResponse {
  return {
    wallet,
    homePlanetId,
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
  };
}

export function PlayableMvpApp({ provider, account, planet }: PlayableMvpAppProps = {}) {
  const isWalletConnected = Boolean(provider && account);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [page, setPage] = useState<Page>("overview");
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | undefined>();
  const [onChainSettlement, setOnChainSettlement] = useState<WalletSettlementResponse | undefined>();
  const [walletPlanets, setWalletPlanets] = useState<ManagedPlanetResponse[]>([]);
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | undefined>();
  const [onChainQueues, setOnChainQueues] = useState<PlayerQueuesResponse | undefined>();
  const [fleetVisibility, setFleetVisibility] = useState<FleetMissionVisibilityResponse | undefined>();
  const [onChainStatus, setOnChainStatus] = useState<ChainLoadStatus>("local");
  const [onChainError, setOnChainError] = useState<string | undefined>();
  const [chainSyncHealthy, setChainSyncHealthy] = useState(false);
  const [infrastructureChainState, setInfrastructureChainState] = useState<ChainInfrastructureState | null>(null);
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState<string | undefined>();
  const [moonState, setMoonState] = useState<ChainMoonState | null>(null);
  const [moonLoading, setMoonLoading] = useState(false);
  const [moonError, setMoonError] = useState<string | undefined>();
  const [defenseState, setDefenseState] = useState<ChainDefenseState | null>(null);
  const [defenseLoading, setDefenseLoading] = useState(false);
  const [defenseError, setDefenseError] = useState<string | undefined>();
  const [defenseAction, setDefenseAction] = useState<DefenseActionState>({ status: "idle" });
  const [allianceState, setAllianceState] = useState<ChainAllianceState | null>(null);
  const [allianceLoading, setAllianceLoading] = useState(false);
  const [allianceError, setAllianceError] = useState<string | undefined>();
  const [allianceAction, setAllianceAction] = useState<AllianceActionState>({ status: "idle" });
  const [shipyardState, setShipyardState] = useState<ChainShipyardState | null>(null);
  const [shipyardLoading, setShipyardLoading] = useState(false);
  const [shipyardError, setShipyardError] = useState<string | undefined>();
  const [shipyardAction, setShipyardAction] = useState<ShipyardActionState>({ status: "idle" });
  const [galaxyAction, setGalaxyAction] = useState<GalaxyActionState>({ status: "idle" });
  const [researchState, setResearchState] = useState<ChainResearchState | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | undefined>();
  const [researchAction, setResearchAction] = useState<ResearchActionState>({ status: "idle" });
  const [riftState, setRiftState] = useState<ChainRiftState | null>(null);
  const [riftLoading, setRiftLoading] = useState(false);
  const [riftError, setRiftError] = useState<string | undefined>();
  const [riftAction, setRiftAction] = useState<RiftActionState>({ status: "idle" });
  const [buildingAction, setBuildingAction] = useState<BuildingActionState>({ status: "idle" });
  const [planetManagementAction, setPlanetManagementAction] = useState<PlanetManagementActionState>({ status: "idle" });
  const [planetRenameAction, setPlanetRenameAction] = useState<PlanetRenameActionState>({ status: "idle" });
  const [missionAction, setMissionAction] = useState<MissionActionState>({ status: "idle" });
  const [moonAction, setMoonAction] = useState<MoonActionState>({ status: "idle" });
  const [homePlanetIdentity, setHomePlanetIdentity] = useState<Planet | undefined>();
  const [galaxyNav, setGalaxyNav] = useState<{ galaxy: number; system: number }>(() => {
    if (planet?.coordinates) {
      const [g, s] = planet.coordinates.split(":").map(Number);
      return { galaxy: g || 1, system: s || 1 };
    }
    return { galaxy: 1, system: 1 };
  });

  const fallbackHomeCoords = useMemo<Coordinates | undefined>(() => {
    if (!planet?.coordinates) return undefined;
    const parts = planet.coordinates.split(":").map(Number);
    return {
      galaxy: parts[0] || 1,
      system: parts[1] || 1,
      position: parts[2] || 1,
    };
  }, [planet?.coordinates]);

  const homeCoords = useMemo<Coordinates | undefined>(() => {
    if (onChainSettlement?.planet) {
      return {
        galaxy: onChainSettlement.planet.galaxy,
        system: onChainSettlement.planet.system,
        position: onChainSettlement.planet.position,
      };
    }

    return fallbackHomeCoords;
  }, [fallbackHomeCoords, onChainSettlement?.planet]);
  const selectedManagedPlanet = useMemo(
    () => walletPlanets.find((item) => item.planetId === (selectedPlanetId ?? onChainSettlement?.homePlanetId))
      ?? walletPlanets[0],
    [onChainSettlement?.homePlanetId, selectedPlanetId, walletPlanets]
  );
  const activePlanetId = selectedManagedPlanet?.planetId ?? onChainSettlement?.homePlanetId ?? undefined;
  const activePlanetCoords = selectedManagedPlanet
    ? {
        galaxy: selectedManagedPlanet.galaxy,
        system: selectedManagedPlanet.system,
        position: selectedManagedPlanet.position,
      }
    : homeCoords;
  const homeCoordinateLabel = useMemo(
    () => displayHomeCoordinates(homePlanetIdentity, homeCoords, planet?.coordinates),
    [
      homeCoords?.galaxy,
      homeCoords?.position,
      homeCoords?.system,
      homePlanetIdentity?.galaxy,
      homePlanetIdentity?.position,
      homePlanetIdentity?.system,
      planet?.coordinates,
    ]
  );
  const apiBaseUrl = useMemo(() => {
    return runtimeConfig.status === "ready" ? runtimeConfig.config.apiUrl : undefined;
  }, [runtimeConfig]);

  const onChainResources = useMemo(() => {
    if (!onChainSettlement?.planet) return undefined;
    const metal = safeResourceNumber(onChainSettlement.planet.resources.metal);
    const crystal = safeResourceNumber(onChainSettlement.planet.resources.crystal);
    const deuterium = safeResourceNumber(onChainSettlement.planet.resources.deuterium);
    if (metal === undefined || crystal === undefined || deuterium === undefined) return undefined;

    return {
      metal,
      crystal,
      deuterium,
    };
  }, [onChainSettlement]);
  const walletPlanetHydrated = isWalletPlanetHydrated({
    homeCoords,
    isWalletConnected,
    resources: onChainResources,
    settlement: onChainSettlement,
    status: onChainStatus,
  });

  const gameContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? gameContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const allianceContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? allianceContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const moonContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? moonContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);

  const isBuildingReadyToFinish = useMemo(() => {
    if (!onChainQueues?.building?.active || !onChainQueues.building.readyAt) return false;
    return Number(onChainQueues.building.readyAt) * 1_000 <= now;
  }, [onChainQueues?.building, now]);

  const refreshInfrastructureState = useCallback(async () => {
    if (!apiBaseUrl || !account) {
      setInfrastructureChainState(null);
      setMoonState(null);
      return;
    }

    setInfrastructureLoading(true);
    setMoonLoading(true);
    setInfrastructureError(undefined);
    setMoonError(undefined);
    try {
      const [nextInfrastructure, nextMoon] = await Promise.all([
        fetchInfrastructureState(apiBaseUrl, account, activePlanetId),
        fetchMoonState(apiBaseUrl, account, activePlanetId),
      ]);
      setInfrastructureChainState(nextInfrastructure);
      setMoonState(nextMoon);
    } catch (error) {
      console.error(error);
      setInfrastructureChainState(null);
      setMoonState(null);
      setInfrastructureError(error instanceof Error ? error.message : "Infrastructure state could not be loaded.");
      setMoonError(error instanceof Error ? error.message : "Moon state could not be loaded.");
    } finally {
      setInfrastructureLoading(false);
      setMoonLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshDefenseState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setDefenseState(null);
      return;
    }

    setDefenseLoading(true);
    setDefenseError(undefined);
    fetchDefenseState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setDefenseState(next);
      })
      .catch((error) => {
        console.error(error);
        setDefenseState(null);
        setDefenseError(error instanceof Error ? error.message : "Defense state could not be loaded.");
      })
      .finally(() => {
        setDefenseLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshAllianceState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setAllianceState(null);
      return;
    }

    setAllianceLoading(true);
    setAllianceError(undefined);
    fetchAllianceState(apiBaseUrl, account)
      .then((next) => {
        setAllianceState(next);
      })
      .catch((error) => {
        console.error(error);
        setAllianceState(null);
        setAllianceError(error instanceof Error ? error.message : "Alliance state could not be loaded.");
      })
      .finally(() => {
        setAllianceLoading(false);
      });
  }, [account, apiBaseUrl]);

  const refreshShipyardState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setShipyardState(null);
      return;
    }

    setShipyardLoading(true);
    setShipyardError(undefined);
    fetchShipyardState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setShipyardState(next);
      })
      .catch((error) => {
        console.error(error);
        setShipyardState(null);
        setShipyardError(error instanceof Error ? error.message : "Shipyard state could not be loaded.");
      })
      .finally(() => {
        setShipyardLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshResearchState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setResearchState(null);
      return;
    }

    setResearchLoading(true);
    setResearchError(undefined);
    fetchResearchState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setResearchState(next);
      })
      .catch((error) => {
        console.error(error);
        setResearchState(null);
        setResearchError(error instanceof Error ? error.message : "Research state could not be loaded.");
      })
      .finally(() => {
        setResearchLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshRiftState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setRiftState(null);
      return;
    }

    setRiftLoading(true);
    setRiftError(undefined);
    fetchRiftState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setRiftState(next);
      })
      .catch((error) => {
        console.error(error);
        setRiftState(null);
        setRiftError(error instanceof Error ? error.message : "Rift state could not be loaded.");
      })
      .finally(() => {
        setRiftLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshOnChainState = useCallback(async () => {
    if (!apiBaseUrl || !account) {
      setOnChainSettlement(undefined);
      setWalletPlanets([]);
      setOnChainQueues(undefined);
      setFleetVisibility(undefined);
      setOnChainError(undefined);
      setOnChainStatus(isWalletConnected ? "loading" : "local");
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    try {
      const snapshot = await waitForHydratedWalletPlanet(
        () => loadWalletPlanetSyncSnapshot(apiBaseUrl, account, activePlanetId),
        activePlanetId,
      );
      const { planetsResponse, queues, settlement, selectedPlanet, fleetVisibility } = snapshot;
      const planets = planetsResponse.planets;
      setWalletPlanets(planets);
      if (!selectedPlanetId && selectedPlanet?.planetId) {
        setSelectedPlanetId(selectedPlanet.planetId);
      }
      setOnChainSettlement(selectedPlanet
        ? {
            ...settlement,
            homePlanetId: selectedPlanet.planetId,
            planet: selectedPlanet,
          }
        : settlement);
      setOnChainQueues(queues);
      setFleetVisibility(fleetVisibility);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      setOnChainError(error instanceof Error ? error.message : "Failed to load live game state");
      setOnChainSettlement(undefined);
      setWalletPlanets([]);
      setOnChainQueues(undefined);
      setFleetVisibility(undefined);
      setOnChainStatus("error");
    }
  }, [account, activePlanetId, apiBaseUrl, isWalletConnected, selectedPlanetId]);

  const refreshFinishedBuildingState = useCallback(async (expectation: FinishedBuildingExpectation) => {
    if (!apiBaseUrl || !account) {
      await refreshOnChainState();
      await refreshInfrastructureState();
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    setInfrastructureLoading(true);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForFinishedBuildingState(
        async () => {
          const [settlement, queues, infrastructure] = await Promise.all([
            fetchWalletSettlement(apiBaseUrl, account),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
            fetchInfrastructureState(apiBaseUrl, account, activePlanetId),
          ]);

          return { settlement, queues, infrastructure };
        },
        expectation,
      );

      setOnChainSettlement(snapshot.settlement);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
      setInfrastructureChainState(snapshot.infrastructure);
      setInfrastructureError(undefined);
      setWalletPlanets((current) => current.map((planet) => {
        if (planet.planetId !== (activePlanetId ?? snapshot.infrastructure.homePlanetId)) return planet;

        return {
          ...planet,
          fieldsUsed: usedFieldsFromBuildings(infrastructurePlayableState(snapshot.infrastructure).buildings),
          fieldsCapacity: snapshot.settlement.planet?.planetId === planet.planetId
            ? snapshot.settlement.planet.fields
            : planet.fieldsCapacity,
        };
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load completed building state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setInfrastructureChainState(null);
      setInfrastructureError(message);
      throw error;
    } finally {
      setInfrastructureLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, refreshInfrastructureState, refreshOnChainState]);

  useEffect(() => {
    if (homeCoords) {
      setGalaxyNav({ galaxy: homeCoords.galaxy, system: homeCoords.system });
    }
  }, [homeCoords]);

  useEffect(() => {
    const settlementPlanet = onChainSettlement?.planet;

    if (!homeCoords) {
      setHomePlanetIdentity(undefined);
      return;
    }

    if (!apiBaseUrl) {
      setHomePlanetIdentity(namedSettlementPlanet(settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined, settlementPlanet?.name));
      return;
    }

    const abortController = new AbortController();
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${homeCoords.galaxy}/systems/${homeCoords.system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe system failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const systemPlanet = planetsFromSystemResponse(payload)
          .find((item) => item.position === homeCoords.position);
        const basePlanet = systemPlanet ?? (settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined);
        const mergedPlanet = basePlanet && settlementPlanet
          ? mergePlanetWithSettlement(basePlanet, settlementPlanet)
          : basePlanet;
        setHomePlanetIdentity(namedSettlementPlanet(mergedPlanet, settlementPlanet?.name));
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setHomePlanetIdentity(namedSettlementPlanet(
            settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined,
            settlementPlanet?.name,
          ));
        }
      });

    return () => abortController.abort();
  }, [apiBaseUrl, homeCoords, onChainSettlement?.planet]);

  useEffect(() => {
    void refreshOnChainState();
    refreshInfrastructureState();
  }, [refreshInfrastructureState, refreshOnChainState]);

  useEffect(() => {
    if (!apiBaseUrl || !account || typeof window.EventSource === "undefined") {
      setChainSyncHealthy(false);
      return;
    }

    const events = new window.EventSource(`${apiBaseUrl.replace(/\/+$/, "")}/chain/events`);
    const refreshFromChainEvent = () => {
      void refreshOnChainState();
      refreshInfrastructureState();
      if (page === "shipyard" || page === "galaxy") refreshShipyardState();
      if (page === "defenses" || page === "galaxy") refreshDefenseState();
      if (page === "alliance") refreshAllianceState();
      if (page === "research") refreshResearchState();
      if (page === "rift") refreshRiftState();
      if (page === "moon") refreshInfrastructureState();
    };
    const updateSyncStatus = (event: MessageEvent) => {
      try {
        const snapshot = JSON.parse(event.data) as { connected?: boolean; subscribedToLogs?: boolean };
        setChainSyncHealthy(Boolean(snapshot.connected && snapshot.subscribedToLogs));
      } catch {
        setChainSyncHealthy(false);
      }
    };

    events.addEventListener("chain-event", refreshFromChainEvent);
    events.addEventListener("sync-status", updateSyncStatus);
    events.onerror = () => setChainSyncHealthy(false);

    return () => events.close();
  }, [
    account,
    apiBaseUrl,
    page,
    refreshDefenseState,
    refreshAllianceState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
  ]);

  useEffect(() => {
    if (chainSyncHealthy) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshOnChainState();
      refreshInfrastructureState();
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [chainSyncHealthy, refreshInfrastructureState, refreshOnChainState]);

  const state = useMemo<PlayableState>(() => infrastructurePlayableState(infrastructureChainState, now), [infrastructureChainState, now]);
  const settledState = state;
  const planetProductionProfile = useMemo<PlanetProductionProfile | undefined>(() => {
    const planetState = onChainSettlement?.planet;
    if (!planetState) return undefined;

    return {
      metalMultiplierBps: planetState.metalMultiplierBps,
      crystalMultiplierBps: planetState.crystalMultiplierBps,
      deuteriumMultiplierBps: planetState.deuteriumMultiplierBps,
    };
  }, [
    onChainSettlement?.planet?.crystalMultiplierBps,
    onChainSettlement?.planet?.deuteriumMultiplierBps,
    onChainSettlement?.planet?.metalMultiplierBps,
  ]);
  const rates = useMemo(() => {
    const production = infrastructureChainState?.productionPerHour;
    if (!production) {
      return productionPerHour(settledState.buildings, planetProductionProfile, settledState.research.energy);
    }
    return {
      metal: Number(production.metal),
      crystal: Number(production.crystal),
      deuterium: Number(production.deuterium),
    };
  }, [
    infrastructureChainState?.productionPerHour,
    planetProductionProfile,
    settledState.buildings,
    settledState.research.energy,
  ]);
  const caps = useMemo(() => {
    const nextCaps = infrastructureChainState?.storageCaps;
    if (!nextCaps) return storageCaps(settledState.buildings);
    return {
      metal: Number(nextCaps.metal),
      crystal: Number(nextCaps.crystal),
      deuterium: Number(nextCaps.deuterium),
    };
  }, [infrastructureChainState?.storageCaps, settledState.buildings]);
  const collectibleDeltas = useMemo(() => {
    if (!isWalletConnected || !onChainResources || !onChainSettlement?.planet?.lastSettledAt) return undefined;
    return collectibleResourceDeltas(rates, Number(onChainSettlement.planet.lastSettledAt), now, onChainResources, caps);
  }, [caps, isWalletConnected, now, onChainResources, onChainSettlement?.planet?.lastSettledAt, rates]);
  const isCollectReady = useMemo(() => {
    if (collectibleDeltas) {
      return collectibleDeltas.metal > 0
        || collectibleDeltas.crystal > 0
        || collectibleDeltas.deuterium > 0;
    }

    if (!isWalletConnected || !onChainSettlement?.planet?.lastSettledAt) return false;
    return hasCollectableResources(rates, Number(onChainSettlement.planet.lastSettledAt), now);
  }, [collectibleDeltas, isWalletConnected, onChainSettlement?.planet?.lastSettledAt, rates, now]);
  const buildingQueue = useMemo(() => {
    if (onChainQueues?.building?.active) {
      return buildingQueueItemForDisplay(onChainQueues.building, settledState.buildings, now);
    }

    return settledState.queue?.kind === "building" ? settledState.queue : undefined;
  }, [now, onChainQueues?.building, settledState.buildings, settledState.queue]);
  const shipQueue = settledState.queue?.kind === "ship" ? settledState.queue : undefined;
  const queueProgress = progress(buildingQueue, now);
  const researchProgress = progress(settledState.researchQueue, now);
  const shipProgress = progress(shipQueue, now);
  const infrastructureState = useMemo<PlayableState>(() => {
    if (!isWalletConnected || !onChainResources) {
      return settledState;
    }

    return {
      ...settledState,
      queue: buildingQueue,
      resources: onChainResources,
    };
  }, [buildingQueue, isWalletConnected, onChainResources, settledState]);
  const chainBuildingCosts = useMemo(() => buildingCosts(infrastructureChainState), [infrastructureChainState]);
  const infrastructureUnavailableReason = useMemo(() => {
    if (!isWalletConnected) return "Connect a wallet to load your infrastructure.";
    if (buildingAction.status === "pending") return buildingAction.label;
    if (runtimeConfig.status === "loading" || onChainStatus === "loading" || infrastructureLoading) {
      return "Loading your wallet resources and building levels";
    }
    if (runtimeConfig.status === "error" || onChainStatus === "error" || infrastructureError || !onChainResources) {
      return "Game state unavailable; upgrades are disabled until your wallet resources and building levels load.";
    }
    if (!gameContract) return "Game contract unavailable; upgrades are disabled.";
    if (!onChainSettlement?.homePlanetId) return "No home planet found for this wallet.";
    if (infrastructureChainState?.infrastructureAvailable === false) {
      return infrastructureChainState.unavailableReason ?? "Infrastructure is unavailable on this deployment.";
    }
    if (!infrastructureChainState) return "Infrastructure state unavailable.";
    return undefined;
  }, [
    buildingAction,
    gameContract,
    infrastructureChainState,
    infrastructureError,
    infrastructureLoading,
    isWalletConnected,
    onChainResources,
    onChainSettlement?.homePlanetId,
    onChainStatus,
    runtimeConfig.status,
  ]);
  const infrastructureActionNotice = infrastructureActionNoticeFor(buildingAction);
  const topBarEnergy = useMemo(() => {
    if (!isWalletConnected || !infrastructureChainState || infrastructureLoading || infrastructureError) {
      return undefined;
    }

    return energyBalanceFromChain(infrastructureChainState.energyBalance)
      ?? energyBalance(settledState.buildings, settledState.research.energy);
  }, [
    infrastructureChainState,
    infrastructureError,
    infrastructureLoading,
    isWalletConnected,
    settledState.buildings,
    settledState.research.energy,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page === "shipyard" || page === "galaxy") {
      refreshShipyardState();
    }
  }, [page, refreshShipyardState]);

  useEffect(() => {
    if (page === "defenses" || page === "galaxy") {
      refreshDefenseState();
    }
  }, [page, refreshDefenseState]);

  useEffect(() => {
    if (page === "alliance") {
      refreshAllianceState();
    }
  }, [page, refreshAllianceState]);

  useEffect(() => {
    if (page === "research") {
      refreshResearchState();
    }
  }, [page, refreshResearchState]);

  useEffect(() => {
    if (page === "rift") {
      refreshRiftState();
    }
  }, [page, refreshRiftState]);

  useEffect(() => {
    if (page === "moon") {
      refreshInfrastructureState();
    }
  }, [page, refreshInfrastructureState]);

  useEffect(() => {
    const abortController = new AbortController();
    fetch(runtimeConfigUrl(), {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
        return response.json();
      })
      .then((config) => setRuntimeConfig({ config, status: "ready" }))
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setRuntimeConfig({ status: "error" });
        }
      });
    return () => abortController.abort();
  }, []);

  const runBuildingTransaction = useCallback(async (key: BuildingKey) => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId || infrastructureUnavailableReason) {
      setBuildingAction({
        status: "error",
        buildingKey: key,
        label: infrastructureUnavailableReason ?? "Wallet, game contract, or home planet is unavailable.",
      });
      return;
    }

    const building = buildingContractIds[key];
    setBuildingAction({ status: "pending", buildingKey: key, label: "Waiting for wallet confirmation" });

    try {
      const txHash = await sendStartBuildingUpgradeTransaction(
        provider,
        account,
        gameContract,
        onChainSettlement.homePlanetId,
        building,
      );
      setBuildingAction({
        status: "pending",
        buildingKey: key,
        label: `Waiting for transaction confirmation ${txHash.slice(0, 10)}...`,
      });
      await waitForReceipt(provider, txHash);
      await refreshOnChainState();
      await refreshInfrastructureState();
      setBuildingAction({ status: "success", buildingKey: key, label: "Building upgrade started." });
    } catch (error) {
      console.error(error);
      setBuildingAction({
        status: "error",
        buildingKey: key,
        label: error instanceof Error ? error.message : "Building upgrade transaction failed.",
      });
    }
  }, [
    account,
    gameContract,
    infrastructureUnavailableReason,
    onChainSettlement?.homePlanetId,
    provider,
    refreshInfrastructureState,
    refreshOnChainState,
  ]);

  const handleUpgrade = useCallback((key: BuildingKey) => {
    void runBuildingTransaction(key);
  }, [runBuildingTransaction]);

  const handleFinishBuildingUpgrade = useCallback(async () => {
    const buildingKey = buildingKeyForContractId(onChainQueues?.building?.itemId) ?? buildingQueue?.key;

    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setBuildingAction({
        status: "error",
        buildingKey,
        label: "Wallet, game contract, or home planet is unavailable.",
      });
      return;
    }
    if (!isBuildingReadyToFinish) {
      setBuildingAction({
        status: "error",
        buildingKey,
        label: "Building upgrade is not ready to finish yet.",
      });
      return;
    }

    setBuildingAction({ status: "pending", buildingKey, label: "Waiting for wallet confirmation" });
    const expectation = {
      itemId: onChainQueues?.building?.itemId,
      targetLevel: onChainQueues?.building?.targetLevel,
    };

    try {
      const txHash = await sendFinishBuildingUpgradeTransaction(
        provider,
        account,
        gameContract,
        onChainSettlement.homePlanetId,
      );
      setBuildingAction({
        status: "pending",
        buildingKey,
        label: `Waiting for transaction confirmation ${txHash.slice(0, 10)}...`,
      });
      await waitForReceipt(provider, txHash);
      setBuildingAction({ status: "pending", buildingKey, label: "Syncing completed building state..." });
      await refreshFinishedBuildingState(expectation);
      setBuildingAction({ status: "success", buildingKey, label: "Building upgrade finished." });
    } catch (error) {
      console.error(error);
      setBuildingAction({
        status: "error",
        buildingKey,
        label: error instanceof Error ? error.message : "Finish building upgrade transaction failed.",
      });
    }
  }, [
    account,
    gameContract,
    isBuildingReadyToFinish,
    buildingQueue?.key,
    onChainSettlement?.homePlanetId,
    onChainQueues?.building?.itemId,
    onChainQueues?.building?.targetLevel,
    provider,
    refreshFinishedBuildingState,
  ]);

  const runShipyardTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setShipyardAction({ status: "pending", label });

    try {
      const txHash = await send();
      setShipyardAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setShipyardAction({ status: "success", label: `${label} confirmed.` });
      refreshShipyardState();
      void refreshOnChainState();
      refreshInfrastructureState();
    } catch (error) {
      console.error(error);
      setShipyardAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshInfrastructureState, refreshOnChainState, refreshShipyardState]);

  const runDefenseTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setDefenseAction({ status: "pending", label });

    try {
      const txHash = await send();
      setDefenseAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setDefenseAction({ status: "success", label: `${label} confirmed.` });
      refreshDefenseState();
      void refreshOnChainState();
      refreshInfrastructureState();
    } catch (error) {
      console.error(error);
      setDefenseAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshDefenseState, refreshInfrastructureState, refreshOnChainState]);

  const runAllianceTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setAllianceAction({ status: "pending", label });

    try {
      const txHash = await send();
      setAllianceAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setAllianceAction({ status: "success", label: `${label} confirmed.` });
      refreshAllianceState();
    } catch (error) {
      console.error(error);
      setAllianceAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshAllianceState]);

  const runResearchTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setResearchAction({ status: "pending", label });

    try {
      const txHash = await send();
      setResearchAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setResearchAction({ status: "success", label: `${label} confirmed.` });
      refreshResearchState();
      void refreshOnChainState();
      refreshInfrastructureState();
    } catch (error) {
      console.error(error);
      setResearchAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshInfrastructureState, refreshOnChainState, refreshResearchState]);

  const runRiftTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setRiftAction({ status: "pending", label });

    try {
      const txHash = await send();
      setRiftAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setRiftAction({ status: "success", label: `${label} confirmed.` });
      refreshRiftState();
      void refreshOnChainState();
      refreshInfrastructureState();
    } catch (error) {
      console.error(error);
      setRiftAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshInfrastructureState, refreshOnChainState, refreshRiftState]);

  const runGalaxyTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setGalaxyAction({ status: "pending", label });

    try {
      const txHash = await send();
      setGalaxyAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setGalaxyAction({ status: "success", label: `${label} confirmed.` });
      refreshShipyardState();
      refreshDefenseState();
      void refreshOnChainState();
      refreshInfrastructureState();
    } catch (error) {
      console.error(error);
      setGalaxyAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, refreshShipyardState]);

  const runMoonTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setMoonAction({ status: "pending", label });

    try {
      const txHash = await send();
      setMoonAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
      if (provider) {
        await waitForReceipt(provider, txHash);
      }
      setMoonAction({ status: "success", label: `${label} confirmed.` });
      await refreshInfrastructureState();
      void refreshOnChainState();
    } catch (error) {
      console.error(error);
      setMoonAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshInfrastructureState, refreshOnChainState]);

  const handleCollectResources = useCallback(() => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      return;
    }

    void runShipyardTransaction("Resource collection", () => sendCollectResourcesTransaction(
      provider,
      account,
      gameContract,
      onChainSettlement.homePlanetId ?? "0",
    ));
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider, runShipyardTransaction]);

  const handleBuildShip = useCallback((shipId: number, _key: ShipKey, quantity: number) => {
    if (!provider || !account || !gameContract || !shipyardState?.homePlanetId) {
      setShipyardAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runShipyardTransaction("Ship production", () => sendStartShipProductionTransaction(
      provider,
      account,
      gameContract,
      shipyardState.homePlanetId ?? "0",
      shipId,
      quantity,
    ));
  }, [account, gameContract, provider, runShipyardTransaction, shipyardState?.homePlanetId]);

  const handleFinishShipProduction = useCallback(() => {
    if (!provider || !account || !gameContract || !shipyardState?.homePlanetId) {
      setShipyardAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runShipyardTransaction("Ship completion", () => sendFinishShipProductionTransaction(
      provider,
      account,
      gameContract,
      shipyardState.homePlanetId ?? "0",
    ));
  }, [account, gameContract, provider, runShipyardTransaction, shipyardState?.homePlanetId]);

  const handleBuildDefense = useCallback((defenseId: number, _key: DefenseKey, quantity: number) => {
    if (!provider || !account || !gameContract || !defenseState?.homePlanetId) {
      setDefenseAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runDefenseTransaction("Defense production", () => sendStartDefenseProductionTransaction(
      provider,
      account,
      gameContract,
      defenseState.homePlanetId ?? "0",
      defenseId,
      quantity,
    ));
  }, [account, defenseState?.homePlanetId, gameContract, provider, runDefenseTransaction]);

  const handleFinishDefenseProduction = useCallback(() => {
    if (!provider || !account || !gameContract || !defenseState?.homePlanetId) {
      setDefenseAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runDefenseTransaction("Defense completion", () => sendFinishDefenseProductionTransaction(
      provider,
      account,
      gameContract,
      defenseState.homePlanetId ?? "0",
    ));
  }, [account, defenseState?.homePlanetId, gameContract, provider, runDefenseTransaction]);

  const handleCreateAlliance = useCallback((tag: string, name: string, description: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance creation", () => sendCreateAllianceTransaction(
      provider,
      account,
      allianceContract,
      tag,
      name,
      description,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleInviteAllianceMember = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance invite", () => sendAllianceInviteTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleUpdateAllianceProfile = useCallback((tag: string, name: string, description: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance profile update", () => sendAllianceProfileTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      tag,
      name,
      description,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleAcceptAllianceInvite = useCallback((allianceId: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance invite acceptance", () => sendAcceptAllianceInviteTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleRequestAllianceJoin = useCallback((allianceId: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance join request", () => sendAllianceJoinRequestTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleCancelAllianceJoinRequest = useCallback((allianceId: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance join request cancellation", () => sendCancelAllianceJoinRequestTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleApproveAllianceJoinRequest = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance join approval", () => sendApproveAllianceJoinRequestTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleKickAllianceMember = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance roster removal", () => sendAllianceKickTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleSetAllianceRole = useCallback((playerAddress: string, role: "member" | "officer") => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance role update", () => sendAllianceRoleTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
      role,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleResearch = useCallback((technologyId: number, _key: ResearchKey) => {
    if (!provider || !account || !gameContract || !researchState?.homePlanetId) {
      setResearchAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runResearchTransaction("Research", () => sendStartResearchTransaction(
      provider,
      account,
      gameContract,
      researchState.homePlanetId ?? "0",
      technologyId,
    ));
  }, [account, gameContract, provider, researchState?.homePlanetId, runResearchTransaction]);

  const handleFinishResearch = useCallback(() => {
    if (!provider || !account || !gameContract) {
      setResearchAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    void runResearchTransaction("Research completion", () => sendFinishResearchTransaction(
      provider,
      account,
      gameContract,
    ));
  }, [account, gameContract, provider, runResearchTransaction]);

  const handleApproveRiftResource = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !resource.tokenAddress) {
      setRiftAction({ status: "error", label: "Wallet, game contract, or resource token is unavailable." });
      return;
    }

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid approval amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} approval`, () => sendApproveResourceTokenTransaction(
      provider,
      account,
      resource.tokenAddress ?? "",
      gameContract,
      parsed,
    ));
  }, [account, gameContract, provider, runRiftTransaction]);

  const handleDepositRiftResource = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !riftState?.riftAvailable || !riftState.homePlanetId) {
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift bridge is unavailable." });
      return;
    }
    const homePlanetId = riftState.homePlanetId;

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid deposit amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} deposit`, () => sendDepositResourceTransaction(
      provider,
      account,
      gameContract,
      homePlanetId,
      resource.resourceId,
      parsed,
    ));
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.riftAvailable, riftState?.unavailableReason, runRiftTransaction]);

  const handleRequestRiftWithdrawal = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !riftState?.riftAvailable || !riftState.homePlanetId) {
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift bridge is unavailable." });
      return;
    }
    const homePlanetId = riftState.homePlanetId;

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid withdrawal amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} withdrawal request`, () => sendRequestResourceWithdrawalTransaction(
      provider,
      account,
      gameContract,
      homePlanetId,
      resource.resourceId,
      parsed,
    ));
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.riftAvailable, riftState?.unavailableReason, runRiftTransaction]);

  const handleFinishRiftWithdrawal = useCallback((withdrawal: PendingWithdrawal) => {
    const resource = riftState?.resources.find((item) => item.key === withdrawal.resource);
    if (!provider || !account || !gameContract || !resource) {
      setRiftAction({ status: "error", label: "Wallet, game contract, or withdrawal resource is unavailable." });
      return;
    }

    void runRiftTransaction(`${resource.label} withdrawal finish`, () => sendFinishResourceWithdrawalTransaction(
      provider,
      account,
      gameContract,
      resource.resourceId,
    ));
  }, [account, gameContract, provider, riftState?.resources, runRiftTransaction]);

  const handleSelectManagedPlanet = useCallback((planetId: string) => {
    setSelectedPlanetId(planetId);
    setPlanetManagementAction({ status: "idle" });
    setPlanetRenameAction({ status: "idle" });
  }, []);

  const handleRenamePlanet = useCallback((name: string) => {
    if (!provider || !account || !gameContract || !activePlanetId) {
      setPlanetRenameAction({ status: "error", label: "Wallet, game contract, or planet is unavailable." });
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setPlanetRenameAction({ status: "pending", label: "Waiting for wallet confirmation" });
    void sendRenamePlanetTransaction(provider, account, gameContract, activePlanetId, trimmedName)
      .then(async (txHash) => {
        setPlanetRenameAction({ status: "pending", label: `Waiting for confirmation ${txHash.slice(0, 10)}...` });
        await waitForReceipt(provider, txHash);
        await refreshOnChainState();
        setPlanetRenameAction({ status: "success", label: "Planet renamed." });
      })
      .catch((error) => {
        console.error(error);
        setPlanetRenameAction({
          status: "error",
          label: error instanceof Error ? error.message : "Rename transaction failed.",
        });
      });
  }, [account, activePlanetId, gameContract, provider, refreshOnChainState]);

  const handleAbandonPlanet = useCallback(() => {
    if (!provider || !account || !gameContract || !activePlanetId || selectedManagedPlanet?.isHomePlanet) {
      setPlanetManagementAction({ status: "error", label: "Only non-home colonies can be abandoned." });
      return;
    }
    const label = selectedManagedPlanet?.name ?? `Planet ${selectedManagedPlanet?.coordinates ?? activePlanetId}`;
    if (!window.confirm(`Abandon ${label}? This requires an empty colony with no active queues or fleet missions.`)) return;

    setPlanetManagementAction({ status: "pending", label: "Waiting for wallet confirmation" });
    void sendAbandonPlanetTransaction(provider, account, gameContract, activePlanetId)
      .then(async (txHash) => {
        setPlanetManagementAction({ status: "pending", label: `Waiting for confirmation ${txHash.slice(0, 10)}...` });
        await waitForReceipt(provider, txHash);
        setSelectedPlanetId(undefined);
        await refreshOnChainState();
        setPlanetManagementAction({ status: "success", label: "Colony abandoned." });
      })
      .catch((error) => {
        console.error(error);
        setPlanetManagementAction({
          status: "error",
          label: error instanceof Error ? error.message : "Abandon transaction failed.",
        });
      });
  }, [account, activePlanetId, gameContract, provider, refreshOnChainState, selectedManagedPlanet]);

  const handleGalaxyAction = useCallback((action: GalaxyAction, target: Planet | undefined, coords: Coordinates, speedPercent = 100) => {
    if (!action.enabled) return;
    const originPlanetId = activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }

    if (action.mode === "colonize") {
      void runGalaxyTransaction("Colony mission", () => sendCreateColonyTransaction(
        provider,
        account,
        gameContract,
        originPlanetId,
        coords.galaxy,
        coords.system,
        coords.position,
        speedPercent,
      ));
      return;
    }

    const targetPlanetId = target?.occupiedBy?.planetId;
    if (!targetPlanetId) {
      setGalaxyAction({ status: "error", label: "Target planet is not contract-indexed yet." });
      return;
    }

    if (action.mode === "missile") {
      void runGalaxyTransaction("Missile attack", () => sendLaunchInterplanetaryMissileAttackTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId,
          targetPlanetId,
          primaryTargetId: action.primaryTargetId,
          quantity: action.quantity,
        },
      ));
      return;
    }

    void runGalaxyTransaction(`${action.label} mission`, () => sendLaunchFleetMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId,
        targetPlanetId,
        missionType: missionTypeId(action.mission),
        ships: action.ships,
        speedPercent,
        cargo: action.kind === "transport"
          ? transportCargoForSelectedPlanet(
              selectedManagedPlanet,
              action.ships,
              coords,
              driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels),
              speedPercent,
            )
          : undefined,
      },
    ));
  }, [account, activePlanetId, gameContract, onChainSettlement?.homePlanetId, provider, runGalaxyTransaction, selectedManagedPlanet, shipyardState?.technologyLevels]);

  const handleCounterplay = useCallback((hostileMissionId: string, mode: "acsDefend" | "intercept") => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const ships = selectCounterplayShips(shipyardState);
    if (!ships) {
      setGalaxyAction({ status: "error", label: "No ships available for counterplay." });
      return;
    }

    void runGalaxyTransaction(mode === "acsDefend" ? "ACS defend mission" : "Intercept mission", () => sendLaunchFleetMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId: onChainSettlement.homePlanetId ?? "0",
        targetPlanetId: hostileMissionId,
        missionType: missionTypeId(mode),
        ships,
      },
    ));
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider, runGalaxyTransaction, shipyardState]);

  const handleStartMoonBuilding = useCallback((buildingId: number, label: string) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Start ${label}`, () => sendStartMoonBuildingUpgradeTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      buildingId,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleFinishMoonBuilding = useCallback(() => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction("Finish moon building", () => sendFinishMoonBuildingUpgradeTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleMoonScan = useCallback((galaxy: number, system: number) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Scan ${galaxy}:${system}`, () => sendMoonScanTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      galaxy,
      system,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleJumpGate = useCallback((destinationPlanetId: string, ships: Partial<MissionShips>) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    const manifest = {
      ...emptyMissionShips(),
      ...ships,
    };
    void runMoonTransaction("Jump Gate transfer", () => sendJumpGateJumpTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      destinationPlanetId,
      manifest,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const runMissionTransaction = useCallback((label: string, request: () => Promise<string>) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    setMissionAction({ status: "pending", label: `${label}: waiting for wallet confirmation.` });
    request()
      .then(async (txHash) => {
        setMissionAction({ status: "pending", label: `${label}: waiting for confirmation ${txHash.slice(0, 10)}...` });
        await waitForReceipt(provider, txHash);
        await refreshOnChainState();
        setMissionAction({ status: "success", label: `${label} confirmed.` });
      })
      .catch((error) => {
        console.error(error);
        setMissionAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} transaction failed.`,
        });
      });
  }, [account, gameContract, provider, refreshOnChainState]);

  const handleRecallMission = useCallback((missionId: string) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    runMissionTransaction(`Recall mission #${missionId}`, () =>
      sendRecallFleetMissionTransaction(provider, account, gameContract, missionId)
    );
  }, [account, gameContract, provider, runMissionTransaction]);

  const handleResolveMission = useCallback((missionId: string) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    runMissionTransaction(`Resolve mission #${missionId}`, () =>
      sendResolveFleetMissionTransaction(provider, account, gameContract, missionId)
    );
  }, [account, gameContract, provider, runMissionTransaction]);

  const handleCompleteMissionReturn = useCallback((missionId: string) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    runMissionTransaction(`Complete return #${missionId}`, () =>
      sendCompleteFleetMissionReturnTransaction(provider, account, gameContract, missionId)
    );
  }, [account, gameContract, provider, runMissionTransaction]);

  const handleMissionCounterplay = useCallback((missionId: string, mode: "acsDefend" | "intercept") => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setMissionAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const ships = selectCounterplayShips(shipyardState);
    if (!ships) {
      setMissionAction({ status: "error", label: "No ships available for counterplay." });
      return;
    }

    runMissionTransaction(mode === "acsDefend" ? `ACS defend #${missionId}` : `Intercept #${missionId}`, () =>
      sendLaunchFleetMissionTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId: onChainSettlement.homePlanetId ?? "0",
          targetPlanetId: missionId,
          missionType: missionTypeId(mode),
          ships,
        },
      )
    );
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider, runMissionTransaction, shipyardState]);

  const handleJoinAttack = useCallback((attackMissionId: string, targetPlanetId: string) => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const ships = selectCounterplayShips(shipyardState);
    if (!ships) {
      setGalaxyAction({ status: "error", label: "No ships available to join the attack." });
      return;
    }

    void runGalaxyTransaction("ACS attack join", () => sendJoinAttackMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId: onChainSettlement.homePlanetId ?? "0",
        attackMissionId,
        targetPlanetId,
        ships,
      },
    ));
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider, runGalaxyTransaction, shipyardState]);

  const handleNavigate = useCallback((target: Page) => {
    setPage(target);
    setSelectedCoords(undefined);
  }, []);

  const handleSelectPlanet = useCallback((coords: Coordinates) => {
    setGalaxyNav({ galaxy: coords.galaxy, system: coords.system });
    setSelectedCoords(coords);
    setPage("planet");
  }, []);

  const handleNavigateSystem = useCallback((g: number, s: number) => {
    setGalaxyNav({ galaxy: g, system: s });
    setPage("galaxy");
  }, []);

  const topBar = (
    <TopBar
      canCollectResources={isCollectReady}
      caps={caps}
      energy={topBarEnergy}
      isWalletConnected={isWalletConnected}
      onCollectResources={handleCollectResources}
      queue={isWalletConnected ? undefined : settledState.queue}
      rates={rates}
      resourceStatus={isWalletConnected && !walletPlanetHydrated && onChainStatus !== "error" ? "loading" : isWalletConnected ? onChainStatus : "local"}
      researchQueue={isWalletConnected ? undefined : settledState.researchQueue}
      resources={isWalletConnected ? onChainResources : settledState.resources}
      resourceDeltas={collectibleDeltas}
      showCollectResources={isCollectReady}
    />
  );

  const mobilePlanetSelector = walletPlanets.length > 0 ? (
    <PlanetSelector
      layout="mobile"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  const planetSidebar = walletPlanets.length > 0 ? (
    <PlanetSelector
      layout="sidebar"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  const content = (() => {
    if (!walletPlanetHydrated) {
      return (
        <HydratingPlanetState
          error={onChainError}
          onRetry={() => void refreshOnChainState()}
          status={onChainStatus}
          txHash={planet?.txHash}
        />
      );
    }

    if (page === "galaxy") {
      return (
        <GalaxyView
          account={account}
          actionState={galaxyAction}
          apiBaseUrl={apiBaseUrl}
          galaxy={galaxyNav.galaxy}
          homeCoords={activePlanetCoords}
          homePlanetId={activePlanetId ?? onChainSettlement?.homePlanetId}
          homePlanet={homePlanetIdentity}
          defenseState={defenseState}
          shipyardState={shipyardState}
          onAction={handleGalaxyAction}
          onNavigate={(g, s) => setGalaxyNav({ galaxy: g, system: s })}
          onSelectPlanet={handleSelectPlanet}
          system={galaxyNav.system}
        />
      );
    }

    if (page === "planet" && selectedCoords) {
      return (
        <PlanetDetail
          apiBaseUrl={apiBaseUrl}
          coords={selectedCoords}
          homeCoords={homeCoords}
          homePlanet={homePlanetIdentity}
          onBack={() => setPage("galaxy")}
          onNavigateSystem={handleNavigateSystem}
        />
      );
    }

    if (page === "infrastructure") {
      return (
        <InfrastructurePage
          actionNotice={infrastructureActionNotice}
          actionUnavailableReason={infrastructureUnavailableReason}
          chainCosts={chainBuildingCosts}
          isBuildingReadyToFinish={isBuildingReadyToFinish}
          now={now}
          onFinishBuilding={handleFinishBuildingUpgrade}
          onUpgrade={handleUpgrade}
          planetProductionProfile={planetProductionProfile}
          settledState={infrastructureState}
          state={state}
        />
      );
    }

    if (page === "moon") {
      return (
        <MoonPage
          action={moonAction}
          canTransact={Boolean(provider && account && moonContract)}
          error={moonError}
          loading={moonLoading}
          moonState={moonState}
          onFinishBuilding={handleFinishMoonBuilding}
          onJumpGate={handleJumpGate}
          onRefresh={refreshInfrastructureState}
          onScan={handleMoonScan}
          onStartBuilding={handleStartMoonBuilding}
        />
      );
    }

    if (page === "mission-control") {
      return (
        <MissionControlPage
          actionState={missionAction}
          canTransact={Boolean(provider && account && gameContract)}
          fleetVisibility={fleetVisibility}
          loading={isWalletConnected && onChainStatus === "loading"}
          now={now}
          onCompleteReturn={handleCompleteMissionReturn}
          onCounterplay={handleMissionCounterplay}
          onNavigateGalaxy={() => handleNavigate("galaxy")}
          onRecall={handleRecallMission}
          onRefresh={() => void refreshOnChainState()}
          onResolve={handleResolveMission}
          protectedResources={infrastructureChainState?.protectedResources}
          raidableResources={infrastructureChainState?.raidableResources}
        />
      );
    }

    if (page === "research") {
      return (
        <ResearchPage
          actionState={researchAction}
          canTransact={Boolean(provider && account && gameContract)}
          error={researchError}
          loading={researchLoading}
          onFinish={handleFinishResearch}
          onRefresh={refreshResearchState}
          onResearch={handleResearch}
          researchState={researchState}
          settledState={settledState}
          state={state}
        />
      );
    }

    if (page === "defenses") {
      return (
        <DefensePage
          actionState={defenseAction}
          canTransact={Boolean(provider && account && gameContract)}
          defenseState={defenseState}
          error={defenseError}
          loading={defenseLoading}
          onBuild={handleBuildDefense}
          onFinish={handleFinishDefenseProduction}
          onRefresh={refreshDefenseState}
        />
      );
    }

    if (page === "alliance") {
      return (
        <AlliancePage
          actionState={allianceAction}
          allianceState={allianceState}
          canTransact={Boolean(provider && account && allianceContract)}
          error={allianceError}
          loading={allianceLoading}
          onAcceptInvite={handleAcceptAllianceInvite}
          onApproveJoinRequest={handleApproveAllianceJoinRequest}
          onCancelJoinRequest={handleCancelAllianceJoinRequest}
          onCreate={handleCreateAlliance}
          onJoinRequest={handleRequestAllianceJoin}
          onKick={handleKickAllianceMember}
          onInvite={handleInviteAllianceMember}
          onRefresh={refreshAllianceState}
          onSetRole={handleSetAllianceRole}
          onUpdateProfile={handleUpdateAllianceProfile}
        />
      );
    }

    if (page === "shipyard") {
      return (
        <ShipyardPage
          actionState={shipyardAction}
          canTransact={Boolean(provider && account && gameContract)}
          error={shipyardError}
          loading={shipyardLoading}
          onBuild={handleBuildShip}
          onCollect={refreshShipyardState}
          onFinish={handleFinishShipProduction}
          onRefresh={refreshShipyardState}
          shipyardState={shipyardState}
        />
      );
    }

    if (page === "rift") {
      return (
        <RiftPage
          actionState={riftAction}
          canTransact={Boolean(provider && account && gameContract)}
          error={riftError}
          loading={riftLoading}
          now={now}
          onApprove={handleApproveRiftResource}
          onDeposit={handleDepositRiftResource}
          onFinishWithdrawal={handleFinishRiftWithdrawal}
          onRefresh={refreshRiftState}
          onRequestWithdrawal={handleRequestRiftWithdrawal}
          riftState={riftState}
        />
      );
    }

    if (page === "rankings") {
      return (
        <RankingsPage apiBaseUrl={apiBaseUrl} onSelectPlanet={handleSelectPlanet} />
      );
    }

    return (
      <OverviewPage
        caps={caps}
        isWalletConnected={isWalletConnected}
        now={now}
        onChainError={onChainError}
        fleetVisibility={fleetVisibility}
        onChainQueues={onChainQueues}
        onChainSettlement={onChainSettlement}
        onChainStatus={isWalletConnected ? onChainStatus : "local"}
        onCounterplay={handleCounterplay}
        onJoinAttack={handleJoinAttack}
        onFinishBuilding={handleFinishBuildingUpgrade}
        onNavigate={(target) => handleNavigate(target)}
        onRenamePlanet={handleRenamePlanet}
        onResolveMission={handleResolveMission}
        homePlanet={homePlanetIdentity}
        buildingQueue={buildingQueue}
        planet={planet}
        queueProgress={queueProgress}
        rates={rates}
        researchProgress={researchProgress}
        settledState={settledState}
        shipProgress={shipProgress}
        state={state}
        canRenamePlanet={Boolean(provider && account && gameContract && activePlanetId)}
        planetRenameAction={planetRenameAction}
        canAbandonPlanet={selectedManagedPlanet
          ? shouldShowAbandonPlanetButton(selectedManagedPlanet, Boolean(provider && account && gameContract), planetManagementAction)
          : false}
        onAbandonPlanet={handleAbandonPlanet}
        planetManagementAction={planetManagementAction}
        usedFields={selectedManagedPlanet?.fieldsUsed}
      />
    );
  })();

  return (
    <div className="playable-starfield relative isolate min-h-dvh overflow-hidden bg-[#05070f] text-slate-100">
      {topBar}

      <div className="relative z-10 mx-auto flex max-w-[96rem] flex-col md:h-[calc(100dvh-52px)] md:flex-row md:overflow-hidden">
        <NavBar
          account={account}
          active={page}
          coordinates={homeCoordinateLabel}
          mobilePlanetSelector={walletPlanets.length > 1 ? mobilePlanetSelector : undefined}
          onNavigate={handleNavigate}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {content}
        </main>

        {planetSidebar}
      </div>
    </div>
  );
}

function PlanetSelector({
  layout,
  onSelect,
  planets,
  selectedPlanetId,
}: {
  layout: "mobile" | "sidebar";
  onSelect: (planetId: string) => void;
  planets: ManagedPlanetResponse[];
  selectedPlanetId: string | undefined;
}) {
  const selectedPlanet = planets.find((planet) => planet.planetId === selectedPlanetId) ?? planets[0];
  if (!selectedPlanet) return null;

  if (layout === "mobile") {
    if (planets.length < 2) return null;

    return (
      <section aria-label="Select planet" className="overflow-x-auto">
        <div className="flex min-w-max gap-2 pb-1">
          {planets.map((planet) => {
            const selected = planet.planetId === selectedPlanet.planetId;
            return (
              <PlanetSelectorButton
                key={planet.planetId}
                onSelect={onSelect}
                planet={planet}
                selected={selected}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <aside aria-label="Select planet" className="hidden w-28 shrink-0 border-l border-white/10 bg-[#07111d]/92 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {planets.map((planet) => {
          const selected = planet.planetId === selectedPlanet.planetId;
          return (
            <PlanetSelectorButton
              key={planet.planetId}
              onSelect={onSelect}
              planet={planet}
              selected={selected}
            />
          );
        })}
      </div>
    </aside>
  );
}

function PlanetSelectorButton({
  onSelect,
  planet,
  selected,
}: {
  onSelect: (planetId: string) => void;
  planet: ManagedPlanetResponse;
  selected: boolean;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={`Select ${planetDisplayName(planet)} at ${planet.coordinates}`}
      className={`group grid w-20 shrink-0 justify-items-center gap-1 rounded border p-1.5 text-center transition focus:outline-none focus:ring-2 focus:ring-cyan-300/60 ${
        selected
          ? "border-cyan-300/70 bg-cyan-300/12 shadow-lg shadow-cyan-950/25"
          : "border-white/10 bg-white/[0.045] hover:border-cyan-200/40 hover:bg-white/[0.075]"
      }`}
      onClick={() => onSelect(planet.planetId)}
      type="button"
    >
      <span className="h-14 w-14 overflow-hidden rounded bg-black/30">
        <img
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          src={planetImage(planet)}
        />
      </span>
      <span className="block max-w-full truncate text-[0.68rem] font-medium leading-4 text-slate-200">
        {planetDisplayName(planet)}
      </span>
    </button>
  );
}

function planetDisplayName(planet: ManagedPlanetResponse): string {
  return planet.name?.trim() || `Planet ${planet.coordinates}`;
}

function planetImage(planet: ManagedPlanetResponse): string {
  return planetImageForType(planetTypeFromTemperature(planet.temperature));
}

function namedSettlementPlanet(planet: Planet | undefined, name: string | null | undefined): Planet | undefined {
  const trimmedName = name?.trim();
  return planet && trimmedName ? { ...planet, name: trimmedName } : planet;
}

function HydratingPlanetState({
  error,
  onRetry,
  status,
  txHash,
}: {
  error: string | undefined;
  onRetry: () => void;
  status: ChainLoadStatus;
  txHash: string | undefined;
}) {
  const failed = status === "error";

  return (
    <div className="grid min-h-[52vh] place-items-center">
      <div className="max-w-md rounded-lg border border-white/10 bg-[#101624] p-5 text-center shadow-2xl shadow-black/20">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-cyan-200/20 bg-cyan-200/10" />
        <h1 className="text-base font-semibold text-white">
          {failed ? "Planet sync delayed" : "Syncing planetfall"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {failed
            ? "The settlement transaction is confirmed, but the game API has not returned complete planet resources yet."
            : "Reading the new home planet coordinates and starter resources before opening the overview."}
        </p>
        {failed && txHash ? <p className="mt-2 truncate text-xs text-slate-500">Tx: {txHash}</p> : null}
        {error ? <p className="mt-2 truncate text-xs text-amber-200/80">{error}</p> : null}
        {failed ? (
          <button
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-4 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
            onClick={onRetry}
            type="button"
          >
            Retry sync
          </button>
        ) : null}
      </div>
    </div>
  );
}
