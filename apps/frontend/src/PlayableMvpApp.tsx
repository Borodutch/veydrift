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
  startShipProduction,
  storageCaps,
  type BuildingKey,
  type PlayableState,
  type ResearchKey,
  type ShipKey,
} from "./playableMvp";
import { runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
import {
  fetchWalletQueues,
  fetchWalletSettlement,
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
  const [onChainError, setOnChainError] = useState<string | undefined>();
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
    return {
      metal: Number(onChainSettlement.planet.resources.metal),
      crystal: Number(onChainSettlement.planet.resources.crystal),
      deuterium: Number(onChainSettlement.planet.resources.deuterium),
    };
  }, [onChainSettlement]);

  useEffect(() => {
    if (planet?.coordinates) {
      const [g, s] = planet.coordinates.split(":").map(Number);
      setGalaxyNav({ galaxy: g || 1, system: s || 1 });
    }
  }, [planet?.coordinates]);

  useEffect(() => {
    if (!apiBaseUrl || !account) return;

    const load = async () => {
      try {
        const [settlement, queues] = await Promise.all([
          fetchWalletSettlement(apiBaseUrl, account),
          fetchWalletQueues(apiBaseUrl, account),
        ]);
        setOnChainSettlement(settlement);
        setOnChainQueues(queues);
        setOnChainError(undefined);
      } catch (error) {
        setOnChainError(error instanceof Error ? error.message : "Failed to load on-chain state");
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [apiBaseUrl, account]);

  const settledState = useMemo(() => settleState(state, now), [state, now]);
  const rates = productionPerHour(settledState.buildings);
  const caps = storageCaps(settledState.buildings);
  const queueProgress = progress(settledState.queue, now);
  const researchProgress = progress(settledState.researchQueue, now);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

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

  const handleBuildShip = useCallback((key: ShipKey, quantity: number) => {
    setState((prev) => {
      const currentNow = Date.now();
      const next = startShipProduction(prev, key, quantity, currentNow);
      setNow(currentNow);
      return next;
    });
  }, []);

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
      onCollect={handleCollectAll}
      queue={settledState.queue}
      rates={rates}
      researchQueue={settledState.researchQueue}
      resources={onChainResources ?? settledState.resources}
    />
  );

  if (page === "galaxy") {
    return (
      <div className="min-h-dvh bg-[#070913] text-slate-100">
        {topBar}
        <GalaxyView
          apiBaseUrl={apiBaseUrl}
          galaxy={galaxyNav.galaxy}
          homeCoords={homeCoords}
          onBack={() => setPage("overview")}
          onNavigate={(g, s) => setGalaxyNav({ galaxy: g, system: s })}
          onSelectPlanet={handleSelectPlanet}
          system={galaxyNav.system}
        />
      </div>
    );
  }

  if (page === "planet" && selectedCoords) {
    return (
      <div className="min-h-dvh bg-[#070913] text-slate-100">
        {topBar}
        <PlanetDetail
          apiBaseUrl={apiBaseUrl}
          coords={selectedCoords}
          homeCoords={homeCoords}
          onBack={() => setPage("galaxy")}
          onNavigateSystem={handleNavigateSystem}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#070913] text-slate-100">
      {topBar}

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <NavBar active={page} onNavigate={handleNavigate} />

        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
          {page === "overview" && (
            <OverviewPage
              caps={caps}
              isWalletConnected={isWalletConnected}
              now={now}
              onChainQueues={onChainQueues}
              onChainSettlement={onChainSettlement}
              onCollect={handleCollectAll}
              onNavigate={(target) => handleNavigate(target)}
              planet={planet}
              queueProgress={queueProgress}
              rates={rates}
              researchProgress={researchProgress}
              settledState={settledState}
              state={state}
            />
          )}

          {page === "infrastructure" && (
            <InfrastructurePage
              onUpgrade={handleUpgrade}
              settledState={settledState}
              state={state}
            />
          )}

          {page === "research" && (
            <ResearchPage
              onResearch={handleResearch}
              settledState={settledState}
              state={state}
            />
          )}

          {page === "shipyard" && (
            <ShipyardPage
              onBuild={handleBuildShip}
              settledState={settledState}
              state={state}
            />
          )}
        </main>
      </div>
    </div>
  );
}
