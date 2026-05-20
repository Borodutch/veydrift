import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { Coordinates, Planet } from "./types";
import { GalaxyView } from "./components/GalaxyView";
import { PlanetDetail } from "./components/PlanetDetail";
import { TopBar } from "./components/TopBar";
import { NavBar, type Page } from "./components/NavBar";
import { OverviewPage } from "./components/OverviewPage";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { DefensePage } from "./components/DefensePage";
import { ResearchPage, type ResearchActionState } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import {
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetsFromSystemResponse,
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
import { gameContractAddress, runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
import {
  buildingQueueItemForDisplay,
  buildingCosts,
  energyBalanceFromChain,
  infrastructurePlayableState,
} from "./chainState";
import {
  isWalletPlanetHydrated,
  safeResourceNumber,
  type ChainLoadStatus,
} from "./overviewData";
import {
  waitForFinishedBuildingState,
  type FinishedBuildingExpectation,
} from "./postTransactionRefresh";
import {
  fetchInfrastructureState,
  fetchDefenseState,
  fetchShipyardState,
  fetchResearchState,
  sendFinishDefenseProductionTransaction,
  fetchWalletQueues,
  fetchWalletSettlement,
  sendCollectResourcesTransaction,
  sendCollectShipsTransaction,
  sendFinishBuildingUpgradeTransaction,
  sendFinishShipProductionTransaction,
  sendFinishResearchTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  waitForReceipt,
  type ChainDefenseState,
  type ChainInfrastructureState,
  type ChainResearchState,
  type ChainShipyardState,
  type Eip1193Provider,
  type PlanetSummary,
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

type BuildingActionState = ShipyardActionState;
type DefenseActionState = ShipyardActionState;

export function infrastructureActionNoticeFor(
  action: BuildingActionState,
): { label: string; tone: "error" | "success" } | undefined {
  if (action.status === "idle" || action.status === "pending") {
    return undefined;
  }

  return {
    label: action.label,
    tone: action.status === "error" ? "error" : "success",
  };
}

export function displayHomeCoordinates(
  homePlanet: Coordinates | undefined,
  homeCoords: Coordinates | undefined,
  fallbackCoordinates: string | undefined
): string | undefined {
  const coordinates = homePlanet ?? homeCoords;
  if (!coordinates) return fallbackCoordinates;

  return `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`;
}

export function PlayableMvpApp({ provider, account, planet }: PlayableMvpAppProps = {}) {
  const isWalletConnected = Boolean(provider && account);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [page, setPage] = useState<Page>("overview");
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | undefined>();
  const [onChainSettlement, setOnChainSettlement] = useState<WalletSettlementResponse | undefined>();
  const [onChainQueues, setOnChainQueues] = useState<PlayerQueuesResponse | undefined>();
  const [onChainStatus, setOnChainStatus] = useState<ChainLoadStatus>("local");
  const [onChainError, setOnChainError] = useState<string | undefined>();
  const [infrastructureChainState, setInfrastructureChainState] = useState<ChainInfrastructureState | null>(null);
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState<string | undefined>();
  const [defenseState, setDefenseState] = useState<ChainDefenseState | null>(null);
  const [defenseLoading, setDefenseLoading] = useState(false);
  const [defenseError, setDefenseError] = useState<string | undefined>();
  const [defenseAction, setDefenseAction] = useState<DefenseActionState>({ status: "idle" });
  const [shipyardState, setShipyardState] = useState<ChainShipyardState | null>(null);
  const [shipyardLoading, setShipyardLoading] = useState(false);
  const [shipyardError, setShipyardError] = useState<string | undefined>();
  const [shipyardAction, setShipyardAction] = useState<ShipyardActionState>({ status: "idle" });
  const [researchState, setResearchState] = useState<ChainResearchState | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | undefined>();
  const [researchAction, setResearchAction] = useState<ResearchActionState>({ status: "idle" });
  const [buildingAction, setBuildingAction] = useState<BuildingActionState>({ status: "idle" });
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

  const isBuildingReadyToFinish = useMemo(() => {
    if (!onChainQueues?.building?.active || !onChainQueues.building.readyAt) return false;
    return Number(onChainQueues.building.readyAt) * 1_000 <= now;
  }, [onChainQueues?.building, now]);

  const refreshInfrastructureState = useCallback(async () => {
    if (!apiBaseUrl || !account) {
      setInfrastructureChainState(null);
      return;
    }

    setInfrastructureLoading(true);
    setInfrastructureError(undefined);
    try {
      const next = await fetchInfrastructureState(apiBaseUrl, account);
      setInfrastructureChainState(next);
    } catch (error) {
      console.error(error);
      setInfrastructureChainState(null);
      setInfrastructureError(error instanceof Error ? error.message : "Infrastructure state could not be loaded.");
    } finally {
      setInfrastructureLoading(false);
    }
  }, [account, apiBaseUrl]);

  const refreshDefenseState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setDefenseState(null);
      return;
    }

    setDefenseLoading(true);
    setDefenseError(undefined);
    fetchDefenseState(apiBaseUrl, account)
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
  }, [account, apiBaseUrl]);

  const refreshShipyardState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setShipyardState(null);
      return;
    }

    setShipyardLoading(true);
    setShipyardError(undefined);
    fetchShipyardState(apiBaseUrl, account)
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
  }, [account, apiBaseUrl]);

  const refreshResearchState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setResearchState(null);
      return;
    }

    setResearchLoading(true);
    setResearchError(undefined);
    fetchResearchState(apiBaseUrl, account)
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
  }, [account, apiBaseUrl]);

  const refreshOnChainState = useCallback(async () => {
    if (!apiBaseUrl || !account) {
      setOnChainSettlement(undefined);
      setOnChainQueues(undefined);
      setOnChainError(undefined);
      setOnChainStatus(isWalletConnected ? "loading" : "local");
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    try {
      const [settlement, queues] = await Promise.all([
        fetchWalletSettlement(apiBaseUrl, account),
        fetchWalletQueues(apiBaseUrl, account),
      ]);
      setOnChainSettlement(settlement);
      setOnChainQueues(queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      setOnChainError(error instanceof Error ? error.message : "Failed to load live game state");
      setOnChainSettlement(undefined);
      setOnChainQueues(undefined);
      setOnChainStatus("error");
    }
  }, [account, apiBaseUrl, isWalletConnected]);

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
            fetchWalletQueues(apiBaseUrl, account),
            fetchInfrastructureState(apiBaseUrl, account),
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
  }, [account, apiBaseUrl, refreshInfrastructureState, refreshOnChainState]);

  useEffect(() => {
    if (!isWalletConnected || walletPlanetHydrated) {
      return;
    }

    const interval = window.setInterval(() => void refreshOnChainState(), 2_500);
    return () => window.clearInterval(interval);
  }, [isWalletConnected, refreshOnChainState, walletPlanetHydrated]);

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
      setHomePlanetIdentity(settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined);
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
        setHomePlanetIdentity(basePlanet && settlementPlanet
          ? mergePlanetWithSettlement(basePlanet, settlementPlanet)
          : basePlanet);
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setHomePlanetIdentity(settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined);
        }
      });

    return () => abortController.abort();
  }, [apiBaseUrl, homeCoords, onChainSettlement?.planet]);

  useEffect(() => {
    void refreshOnChainState();
    const interval = window.setInterval(() => void refreshOnChainState(), 30_000);
    return () => window.clearInterval(interval);
  }, [refreshOnChainState]);

  useEffect(() => {
    refreshInfrastructureState();
    const interval = window.setInterval(() => void refreshInfrastructureState(), 30_000);
    return () => window.clearInterval(interval);
  }, [refreshInfrastructureState]);

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
    if (!production) return productionPerHour(settledState.buildings, planetProductionProfile);
    return {
      metal: Number(production.metal),
      crystal: Number(production.crystal),
      deuterium: Number(production.deuterium),
    };
  }, [infrastructureChainState?.productionPerHour, planetProductionProfile, settledState.buildings]);
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
      ?? energyBalance(settledState.buildings);
  }, [
    infrastructureChainState,
    infrastructureError,
    infrastructureLoading,
    isWalletConnected,
    settledState.buildings,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page === "shipyard") {
      refreshShipyardState();
    }
  }, [page, refreshShipyardState]);

  useEffect(() => {
    if (page === "defenses") {
      refreshDefenseState();
    }
  }, [page, refreshDefenseState]);

  useEffect(() => {
    if (page === "research") {
      refreshResearchState();
    }
  }, [page, refreshResearchState]);

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
        label: infrastructureUnavailableReason ?? "Wallet, game contract, or home planet is unavailable.",
      });
      return;
    }

    const building = buildingContractIds[key];
    setBuildingAction({ status: "pending", label: "Waiting for wallet confirmation" });

    try {
      const txHash = await sendStartBuildingUpgradeTransaction(
        provider,
        account,
        gameContract,
        onChainSettlement.homePlanetId,
        building,
      );
      setBuildingAction({ status: "pending", label: `Waiting for transaction confirmation ${txHash.slice(0, 10)}...` });
      await waitForReceipt(provider, txHash);
      await refreshOnChainState();
      await refreshInfrastructureState();
      setBuildingAction({ status: "success", label: "Building upgrade started." });
    } catch (error) {
      console.error(error);
      setBuildingAction({
        status: "error",
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
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setBuildingAction({
        status: "error",
        label: "Wallet, game contract, or home planet is unavailable.",
      });
      return;
    }
    if (!isBuildingReadyToFinish) {
      setBuildingAction({
        status: "error",
        label: "Building upgrade is not ready to finish yet.",
      });
      return;
    }

    setBuildingAction({ status: "pending", label: "Waiting for wallet confirmation" });
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
      setBuildingAction({ status: "pending", label: `Waiting for transaction confirmation ${txHash.slice(0, 10)}...` });
      await waitForReceipt(provider, txHash);
      setBuildingAction({ status: "pending", label: "Syncing completed building state..." });
      await refreshFinishedBuildingState(expectation);
      setBuildingAction({ status: "success", label: "Building upgrade finished." });
    } catch (error) {
      console.error(error);
      setBuildingAction({
        status: "error",
        label: error instanceof Error ? error.message : "Finish building upgrade transaction failed.",
      });
    }
  }, [
    account,
    gameContract,
    isBuildingReadyToFinish,
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

  const handleCollectShips = useCallback(() => {
    if (!provider || !account || !gameContract || !shipyardState?.homePlanetId) {
      setShipyardAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    void runShipyardTransaction("Shipyard refresh", () => sendCollectShipsTransaction(
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

  const handleNavigate = useCallback((target: Page) => {
    setPage(target);
    setSelectedCoords(undefined);
  }, []);

  const handleSelectPlanet = useCallback((coords: Coordinates) => {
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

  const content = (() => {
    if (!walletPlanetHydrated) {
      return (
        <HydratingPlanetState
          error={onChainError}
          onRetry={() => void refreshOnChainState()}
          status={onChainStatus}
        />
      );
    }

    if (page === "galaxy") {
      return (
        <GalaxyView
          apiBaseUrl={apiBaseUrl}
          galaxy={galaxyNav.galaxy}
          homeCoords={homeCoords}
          homePlanet={homePlanetIdentity}
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
          onFinishBuilding={handleFinishBuildingUpgrade}
          onUpgrade={handleUpgrade}
          planetProductionProfile={planetProductionProfile}
          settledState={infrastructureState}
          state={state}
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

    if (page === "shipyard") {
      return (
        <ShipyardPage
          actionState={shipyardAction}
          canTransact={Boolean(provider && account && gameContract)}
          error={shipyardError}
          loading={shipyardLoading}
          onBuild={handleBuildShip}
          onCollect={handleCollectShips}
          onFinish={handleFinishShipProduction}
          onRefresh={refreshShipyardState}
          shipyardState={shipyardState}
        />
      );
    }

    return (
      <OverviewPage
        caps={caps}
        isWalletConnected={isWalletConnected}
        now={now}
        onChainError={onChainError}
        onChainQueues={onChainQueues}
        onChainSettlement={onChainSettlement}
        onChainStatus={isWalletConnected ? onChainStatus : "local"}
        onFinishBuilding={handleFinishBuildingUpgrade}
        onNavigate={(target) => handleNavigate(target)}
        homePlanet={homePlanetIdentity}
        buildingQueue={buildingQueue}
        planet={planet}
        queueProgress={queueProgress}
        rates={rates}
        researchProgress={researchProgress}
        settledState={settledState}
        shipProgress={shipProgress}
        state={state}
      />
    );
  })();

  return (
    <div className="min-h-dvh bg-[#070913] text-slate-100">
      {topBar}

      <div className="mx-auto flex max-w-7xl flex-col md:h-[calc(100dvh-52px)] md:flex-row md:overflow-hidden">
        <NavBar
          account={account}
          active={page}
          coordinates={homeCoordinateLabel}
          onNavigate={handleNavigate}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {content}
        </main>
      </div>
    </div>
  );
}

function HydratingPlanetState({
  error,
  onRetry,
  status,
}: {
  error: string | undefined;
  onRetry: () => void;
  status: ChainLoadStatus;
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
