import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { Coordinates } from "./types";
import { GalaxyView } from "./components/GalaxyView";
import { PlanetDetail } from "./components/PlanetDetail";
import { TopBar } from "./components/TopBar";
import { NavBar, type Page } from "./components/NavBar";
import { OverviewPage } from "./components/OverviewPage";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { ResearchPage } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import {
  createInitialPlayableState,
  productionPerHour,
  progress,
  settleState,
  startBuildingUpgrade,
  startResearch,
  storageCaps,
  type BuildingKey,
  type PlayableState,
  type ResearchKey,
  type ShipKey,
} from "./playableMvp";
import { gameContractAddress, runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
import {
  safeResourceNumber,
  type ChainLoadStatus,
} from "./overviewData";
import {
  fetchShipyardState,
  fetchWalletQueues,
  fetchWalletSettlement,
  sendCollectResourcesTransaction,
  sendCollectShipsTransaction,
  sendFinishShipProductionTransaction,
  sendStartShipProductionTransaction,
  waitForReceipt,
  type ChainShipyardState,
  type Eip1193Provider,
  type PlanetSummary,
  type PlayerQueuesResponse,
  type WalletSettlementResponse,
} from "./walletFlow";

const PLAYABLE_STORAGE_KEY = "veydrift-playable-mvp-state";

interface PlayableMvpAppProps {
  provider?: Eip1193Provider | undefined;
  account?: string | undefined;
  planet?: PlanetSummary | undefined;
}

function loadPlayableState(): PlayableState | undefined {
  try {
    const raw = localStorage.getItem(PLAYABLE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PlayableState;
    if (!parsed.resources || !parsed.buildings || !parsed.ships) return undefined;
    const fallback = createInitialPlayableState();
    return {
      ...fallback,
      ...parsed,
      research: { ...fallback.research, ...parsed.research },
    };
  } catch {
    return undefined;
  }
}

function savePlayableState(state: PlayableState): void {
  try {
    localStorage.setItem(PLAYABLE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export function PlayableMvpApp({ provider, account, planet }: PlayableMvpAppProps = {}) {
  const isWalletConnected = Boolean(provider && account);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [state, setState] = useState<PlayableState>(() => {
    const saved = loadPlayableState();
    if (saved) return saved;
    return createInitialPlayableState(now);
  });
  const [page, setPage] = useState<Page>("overview");
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | undefined>();
  const [onChainSettlement, setOnChainSettlement] = useState<WalletSettlementResponse | undefined>();
  const [onChainQueues, setOnChainQueues] = useState<PlayerQueuesResponse | undefined>();
  const [onChainStatus, setOnChainStatus] = useState<ChainLoadStatus>("local");
  const [onChainError, setOnChainError] = useState<string | undefined>();
  const [shipyardState, setShipyardState] = useState<ChainShipyardState | null>(null);
  const [shipyardLoading, setShipyardLoading] = useState(false);
  const [shipyardError, setShipyardError] = useState<string | undefined>();
  const [shipyardAction, setShipyardAction] = useState<ShipyardActionState>({ status: "idle" });
  const [galaxyNav, setGalaxyNav] = useState<{ galaxy: number; system: number }>(() => {
    if (planet?.coordinates) {
      const [g, s] = planet.coordinates.split(":").map(Number);
      return { galaxy: g || 1, system: s || 1 };
    }
    return { galaxy: 1, system: 1 };
  });

  const homeCoords = useMemo<Coordinates | undefined>(() => {
    if (!planet?.coordinates) return undefined;
    const parts = planet.coordinates.split(":").map(Number);
    return {
      galaxy: parts[0] || 1,
      system: parts[1] || 1,
      position: parts[2] || 1,
    };
  }, [planet?.coordinates]);

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

  const gameContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? gameContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);

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
        setShipyardError(error instanceof Error ? error.message : "Shipyard state could not be loaded.");
      })
      .finally(() => {
        setShipyardLoading(false);
      });
  }, [account, apiBaseUrl]);

  useEffect(() => {
    if (planet?.coordinates) {
      const [g, s] = planet.coordinates.split(":").map(Number);
      setGalaxyNav({ galaxy: g || 1, system: s || 1 });
    }
  }, [planet?.coordinates]);

  useEffect(() => {
    if (!apiBaseUrl || !account) {
      setOnChainSettlement(undefined);
      setOnChainQueues(undefined);
      setOnChainError(undefined);
      setOnChainStatus(isWalletConnected ? "loading" : "local");
      return;
    }

    const load = async () => {
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
        setOnChainError(error instanceof Error ? error.message : "Failed to load on-chain state");
        setOnChainSettlement(undefined);
        setOnChainQueues(undefined);
        setOnChainStatus("error");
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [apiBaseUrl, account, isWalletConnected]);

  const settledState = useMemo(() => settleState(state, now), [state, now]);
  const rates = productionPerHour(settledState.buildings);
  const caps = storageCaps(settledState.buildings);
  const buildingQueue = settledState.queue?.kind === "building" ? settledState.queue : undefined;
  const shipQueue = settledState.queue?.kind === "ship" ? settledState.queue : undefined;
  const queueProgress = progress(buildingQueue, now);
  const researchProgress = progress(settledState.researchQueue, now);
  const shipProgress = progress(shipQueue, now);

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

  useEffect(() => {
    if ((!settledState.queue && state.queue) || (!settledState.researchQueue && state.researchQueue)) {
      setState(settledState);
    }
  }, [settledState, state.queue, state.researchQueue]);

  useEffect(() => {
    savePlayableState(state);
  }, [state]);

  const handleCollectAll = useCallback(() => {
    const currentNow = Date.now();
    setNow(currentNow);
    setState((prev) => settleState(prev, currentNow));
  }, []);

  const handleUpgrade = useCallback((key: BuildingKey) => {
    setState((prev) => {
      const currentNow = Date.now();
      const next = startBuildingUpgrade(prev, key, currentNow);
      setNow(currentNow);
      return next;
    });
  }, []);

  const handleResearch = useCallback((key: ResearchKey) => {
    setState((prev) => {
      const currentNow = Date.now();
      const next = startResearch(prev, key, currentNow);
      setNow(currentNow);
      return next;
    });
  }, []);

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
    } catch (error) {
      console.error(error);
      setShipyardAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [provider, refreshShipyardState]);

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
      account={account}
      caps={caps}
      coordinates={planet?.coordinates}
      isWalletConnected={isWalletConnected}
      queue={settledState.queue}
      rates={rates}
      resourceStatus={isWalletConnected ? onChainStatus : "local"}
      researchQueue={settledState.researchQueue}
      resources={isWalletConnected ? onChainResources : settledState.resources}
    />
  );

  const content = (() => {
    if (page === "galaxy") {
      return (
        <GalaxyView
          apiBaseUrl={apiBaseUrl}
          galaxy={galaxyNav.galaxy}
          homeCoords={homeCoords}
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
          onBack={() => setPage("galaxy")}
          onNavigateSystem={handleNavigateSystem}
        />
      );
    }

    if (page === "infrastructure") {
      return (
        <InfrastructurePage
          onUpgrade={handleUpgrade}
          settledState={settledState}
          state={state}
        />
      );
    }

    if (page === "research") {
      return (
        <ResearchPage
          onResearch={handleResearch}
          settledState={settledState}
          state={state}
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
        onCollect={isWalletConnected ? handleCollectResources : handleCollectAll}
        onNavigate={(target) => handleNavigate(target)}
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
          coordinates={planet?.coordinates}
          onNavigate={handleNavigate}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {content}
        </main>
      </div>
    </div>
  );
}
