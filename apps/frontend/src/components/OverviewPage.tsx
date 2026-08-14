import {
  defenseCatalog,
  queueProgress as queueProgressValue,
  researchCatalog,
  shipCatalog,
  type MainQueueItem,
  type PlayableState,
  type Resources,
} from "../playableMvp";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Info,
  Package,
  PackagePlus,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  Satellite,
  Shield,
  Swords,
  Trash2,
  X,
} from "lucide-preact";
import { researchQueueForDisplay } from "../chainState";
import {
  buildingQueueAsset,
  buildingQueueLabel,
  buildingQueuePreview,
  displayPlanetStats,
  overviewPlanetEffects,
  type OverviewPlanetEffectsDisplay,
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
  queueProgressBarState,
  queueProgressFillState,
  usedFieldsFromBuildings,
  type ChainLoadStatus,
} from "../overviewData";
import { overviewHeroImage } from "../overviewHeroImage";
import { isImageReady } from "../imageLoadState";
import { formatPlanetType, planetFromSettlementPlanet, planetsFromSystemResponse } from "../data/mockUniverse";
import type { Coordinates, Planet } from "../types";
import {
  decodeColonizationTargetId,
  type FleetMissionPlanetReference,
  type FleetMissionVisibilityResponse,
  type ManagedPlanetResponse,
  type PlanetSummary,
  type PlayerQueuesResponse,
  type WatchedPlanetsResponse,
  type WalletSettlementResponse
} from "../walletFlow";
import { constructionQueueForDisplay, type ConstructionProgress } from "../constructionProgress";
import type { GalaxyAction } from "../galaxyActions";
import { formatDurationUntil } from "../durationFormat";
import { timestampToMs, type TimestampInput } from "../timestampFormat";
import {
  actionNoticeForBuilding,
  buildingKeyForContractId,
  type InfrastructureActionNotice,
} from "../buildingActionNotice";
import { OptimizedImage } from "./OptimizedImage";
import { AnimatedProgressBar } from "./AnimatedProgressBar";
import { ProductionQueuePanel, productionQueueViewModel } from "./ProductionCatalog";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { PlanetMoonIndicator } from "./PlanetMoonIndicator";
import { InlineSyncIndicator } from "./VeydriftLoader";
import {
  formatGalaxyAllianceIdentityLabel,
  formatGalaxyCommanderLabel,
  formatCompactResource,
  formatGalaxyHeatLabel,
} from "./GalaxyView";
import { WatchablePlanetRow, type PlanetMetaItem } from "./WatchablePlanetRow";
import { watchedPlanetsPanelRange } from "../watchedPlanetsView";
import { missionTypeLabel } from "./MissionControlPage";
import { galaxyActionIcon } from "./GalaxyActionIcon";

export function compactOverviewLevelLabel(label: string): string {
  return label.replace(/\s+[Ll]evel\s+(\d+)$/, " $1");
}

export function compactOverviewResearchLabel(label: string): string {
  return label.replace(/\s+Technology(?=(?:\s+\d+)?$)/, "");
}

function queueRemaining(readyAt: string | null, now: number): string {
  if (!readyAt) return "Pending";
  return formatDurationUntil(Number(readyAt) * 1_000, now);
}

type BuildingQueueItem = Extract<MainQueueItem, { kind: "building" }>;

export type PlanetRenameActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type PlanetManagementActionState = PlanetRenameActionState;
type OverviewResearchActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type OverviewMyPlanetActionGroup = {
  planet: ManagedPlanetResponse;
  actions: GalaxyAction[];
  moonActions?: GalaxyAction[] | undefined;
};

interface OverviewPageProps {
  state: PlayableState;
  settledState: PlayableState;
  rates: Resources;
  caps: Resources;
  constructionProgress?: Partial<Record<"building" | "defense" | "research" | "ship", ConstructionProgress | undefined>> | undefined;
  queueProgress: number;
  researchProgress: number;
  shipProgress: number;
  now: number;
  buildingQueue?: BuildingQueueItem | undefined;
  planet?: PlanetSummary | undefined;
  homePlanet?: Planet | undefined;
  isWalletConnected: boolean;
  buildingActionNotice?: InfrastructureActionNotice | undefined;
  buildingActionPendingLabel?: string | undefined;
  researchAction?: OverviewResearchActionState | undefined;
  onNavigate: (page: "infrastructure" | "defenses" | "research" | "shipyard" | "mission-control") => void;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectMoon?: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlanet?: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  // Fast planet switching from the My planets list: tapping one of the player's own planets (or its
  // moon) makes it the selected body — the mobile equivalent of the desktop planet rail — instead of
  // navigating away to the inspect screen.
  onSwitchPlanet?: ((planetId: string, bodyKind: "planet" | "moon") => void) | undefined;
  onToggleWatchPlanet?: ((planetId: string, watched: boolean) => void) | undefined;
  onRenamePlanet?: ((name: string) => void) | undefined;
  onChainError?: string | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
  onChainStatus: ChainLoadStatus;
  planetRenameAction?: PlanetRenameActionState | undefined;
  canRenamePlanet?: boolean | undefined;
  planetManagementAction?: PlanetManagementActionState | undefined;
  canAbandonPlanet?: boolean | undefined;
  onAbandonPlanet?: (() => void) | undefined;
  usedFields?: number | undefined;
  watchedPlanets?: WatchedPlanetsResponse | undefined;
  watchedPlanetsError?: string | undefined;
  watchedPlanetsLoading?: boolean | undefined;
  watchedPlanetsPage?: number | undefined;
  onWatchedPlanetsPageChange?: ((page: number) => void) | undefined;
  onRefreshWatchedPlanets?: (() => void) | undefined;
  watchedPlanetActionsForPlanet?: ((planet: Planet) => GalaxyAction[]) | undefined;
  watchedMoonActionsForPlanet?: ((planet: Planet) => GalaxyAction[]) | undefined;
  onWatchedPlanetAction?: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onWatchedMoonAction?: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  watchBusyPlanetId?: string | undefined;
  myPlanets?: readonly OverviewMyPlanetActionGroup[] | undefined;
  currentCommanderLabel?: string | undefined;
  selectedPlanetId?: string | undefined;
  onMyPlanetAction?: ((action: GalaxyAction, planet: ManagedPlanetResponse) => void) | undefined;
  onSupplyPlanet?: ((planet: ManagedPlanetResponse) => void) | undefined;
}

export function OverviewPage({
  settledState,
  rates,
  caps,
  constructionProgress,
  queueProgress,
  researchProgress,
  shipProgress,
  now,
  buildingQueue: activeBuildingQueue,
  planet,
  homePlanet,
  isWalletConnected,
  buildingActionNotice,
  buildingActionPendingLabel,
  researchAction = { status: "idle" },
  onNavigate,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlanet,
  onSelectPlayer,
  onSwitchPlanet,
  onToggleWatchPlanet,
  onRenamePlanet,
  onChainError,
  fleetVisibility,
  onChainSettlement,
  onChainQueues,
  onChainStatus,
  planetRenameAction = { status: "idle" },
  canRenamePlanet = false,
  planetManagementAction = { status: "idle" },
  canAbandonPlanet = false,
  onAbandonPlanet,
  usedFields: selectedPlanetUsedFields,
  watchedPlanets,
  watchedPlanetsError,
  watchedPlanetsLoading = false,
  watchedPlanetsPage = 1,
  onWatchedPlanetsPageChange,
  onRefreshWatchedPlanets,
  watchedPlanetActionsForPlanet,
  watchedMoonActionsForPlanet,
  onWatchedPlanetAction,
  onWatchedMoonAction,
  watchBusyPlanetId,
  myPlanets = [],
  currentCommanderLabel,
  selectedPlanetId,
  onMyPlanetAction,
  onSupplyPlanet,
}: OverviewPageProps) {
  const usedFields = selectedPlanetUsedFields ?? usedFieldsFromBuildings(settledState.buildings);
  const stats = displayPlanetStats(onChainSettlement, onChainQueues, usedFields, isWalletConnected ? onChainStatus : "local");
  const planetEffects = overviewPlanetEffects({
    buildings: settledState.buildings,
    energyTechnologyLevel: settledState.research.energy,
    productionRates: rates,
    settlement: onChainSettlement,
    solarSatelliteCount: settledState.ships.solarSatellite,
    usedFields,
  });
  const buildingQueue = activeBuildingQueue ?? (settledState.queue?.kind === "building" ? settledState.queue : undefined);
  const buildingPreview = buildingQueuePreview(onChainQueues?.building);
  const onChainBuildingQueue = buildingQueue
    ? {
      asset: buildingQueueAsset(buildingQueue.key),
      label: compactOverviewLevelLabel(buildingQueueLabel(buildingQueue.label, buildingQueue.targetLevel)),
    }
    : {
      ...buildingPreview,
      label: compactOverviewLevelLabel(buildingPreview.label),
    };
  const localBuildingAsset = buildingQueue ? buildingQueueAsset(buildingQueue.key) : undefined;
  const localBuildingLabel = buildingQueue
    ? compactOverviewLevelLabel(buildingQueueLabel(buildingQueue.label, buildingQueue.targetLevel))
    : settledState.queue?.label;
  const onChainResearchQueue = researchQueueForDisplay(onChainQueues?.research ?? null, now, {
    buildings: settledState.buildings,
    research: settledState.research,
  });
  const onChainResearchAsset = onChainResearchQueue
    ? researchCatalog.find((research) => research.key === onChainResearchQueue.key)?.asset
    : onChainQueues?.research?.itemId === undefined
      ? undefined
      : researchCatalog.find((research) => research.id === onChainQueues.research?.itemId)?.asset;
  const settledResearchAsset = settledState.researchQueue
    ? researchCatalog.find((research) => research.key === settledState.researchQueue?.key)?.asset
    : undefined;
  const activeResearchProgress = constructionProgress?.research?.progress
    ?? (onChainResearchQueue ? queueProgressValue(onChainResearchQueue, now) : researchProgress);
  const onChainDefenseQueue = productionQueueViewModel(onChainQueues?.defense, defenseCatalog);
  const onChainShipQueue = productionQueueViewModel(onChainQueues?.ship, shipCatalog);
  const buildingNoticeKey = buildingQueue?.key ?? buildingKeyForContractId(onChainQueues?.building?.itemId);
  const scopedBuildingNotice = overviewBuildingActionNoticeFor(buildingActionNotice, buildingNoticeKey);
  const pendingBuildingNotice = buildingActionPendingLabel
    ? {
        buildingKey: buildingQueue?.key ?? buildingKeyForContractId(onChainQueues?.building?.itemId),
        label: buildingActionPendingLabel,
        tone: "pending" as const,
      }
    : undefined;
  const overviewBuildingNoticeToRender = overviewBuildingActionNoticeFor(
    scopedBuildingNotice ?? pendingBuildingNotice,
    buildingNoticeKey,
  );
  const shouldShowFleetsSummary = Boolean(isWalletConnected && fleetVisibility);
  const watchedPlanetRows = useMemo(() =>
    watchedPlanets
      ? planetsFromSystemResponse({
          galaxy: 0,
          system: 0,
          planets: watchedPlanets.planets,
        })
      : [],
    [watchedPlanets]
  );
  const fleetPlanetNames = useMemo(() => {
    const names = new Map<string, string>();
    const remember = (planetId: string | null | undefined, coordinates: string, name: string | null | undefined) => {
      const trimmedName = name?.trim();
      if (!trimmedName) return;
      if (planetId) names.set(`id:${planetId}`, trimmedName);
      names.set(`coords:${coordinates}`, trimmedName);
    };

    for (const group of myPlanets) {
      remember(group.planet.planetId, group.planet.coordinates, group.planet.name);
    }
    for (const watched of watchedPlanets?.planets ?? []) {
      remember(
        watched.occupiedBy?.planetId,
        `${watched.galaxy}:${watched.system}:${watched.position}`,
        watched.name,
      );
    }
    return names;
  }, [myPlanets, watchedPlanets]);

  // Only ever derive the planet name from real data: the loaded home planet's name, or a
  // coordinate-derived label once coordinates hydrate. Never fall back to a hardcoded fake planet
  // name; the hero renders a skeleton until a real name exists, and the disconnected state shows a
  // connect-wallet card instead of a fabricated home planet (VEY-KANEO-458).
  const livePlanetName = overviewPlanetDisplayName(homePlanet, planet);
  const planetName = livePlanetName ?? "";
  const [renameDraft, setRenameDraft] = useState(planetName);
  const [renamePanelOpen, setRenamePanelOpen] = useState(false);
  const [renameValidation, setRenameValidation] = useState<string | undefined>(undefined);
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false);
  const planetSubhead = homePlanet
    ? `${formatPlanetType(homePlanet.type)} · ${homePlanet.galaxy}:${homePlanet.system}:${homePlanet.position}`
    : "Home planet";
  const currentPlanetKey = homePlanet
    ? planetKeyFromCoordinates(homePlanet)
    : onChainSettlement?.planet
      ? planetKeyFromCoordinates(onChainSettlement.planet)
      : planet?.coordinates;
  const [lastKnownHeroImage, setLastKnownHeroImage] = useState<
    { image: string; planetKey: string } | undefined
  >(
    homePlanet?.image && currentPlanetKey
      ? { image: homePlanet.image, planetKey: currentPlanetKey }
      : undefined
  );
  const [heroImageLoaded, setHeroImageLoaded] = useState(false);
  const heroImageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (homePlanet?.image && currentPlanetKey) {
      setLastKnownHeroImage({ image: homePlanet.image, planetKey: currentPlanetKey });
    }
  }, [currentPlanetKey, homePlanet?.image]);

  const heroImage = overviewHeroImage(homePlanet, lastKnownHeroImage, currentPlanetKey);

  useLayoutEffect(() => {
    setHeroImageLoaded(isImageReady(heroImageRef.current));
  }, [heroImage]);

  useEffect(() => {
    if (!renamePanelOpen) {
      setRenameDraft(planetName);
      setRenameValidation(undefined);
    }
  }, [planetName, renamePanelOpen]);

  useEffect(() => {
    if (planetRenameAction.status === "success") {
      setRenamePanelOpen(false);
    }
  }, [planetRenameAction.status]);

  const canShowRename = Boolean(isWalletConnected && onRenamePlanet);
  const renameBusy = planetRenameAction.status === "pending";
  const renameStatusTone = planetRenameAction.status === "error"
    ? "text-amber-200"
    : planetRenameAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const renameStatusLabel = planetRenameAction.status === "idle" ? undefined : planetRenameAction.label;
  const managementStatusTone = planetManagementAction.status === "error"
    ? "text-amber-200"
    : planetManagementAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const showAbandonAction = Boolean(canAbandonPlanet && onAbandonPlanet);
  const handleRenameSubmit = (event: Event) => {
    event.preventDefault();
    const name = renameDraft.trim();
    if (!name) {
      setRenameValidation("Enter a planet name.");
      return;
    }
    setRenameValidation(undefined);
    onRenamePlanet?.(name);
  };

  useEffect(() => {
    if (!renamePanelOpen && !effectsPanelOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!renameBusy) setRenamePanelOpen(false);
      setEffectsPanelOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectsPanelOpen, renameBusy, renamePanelOpen]);

  return (
    <div className="grid gap-3">
      <div className={shouldShowFleetsSummary ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.82fr)] lg:items-stretch" : "grid gap-3"}>
      {/* Planet hero — compact, no wasted space. When the wallet is disconnected we show a clear
          connect-wallet card instead of a fabricated home planet (VEY-KANEO-458). */}
      {!isWalletConnected ? (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Home planet</p>
          <h2 className="mt-1 text-base font-semibold text-white">Connect your wallet</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-slate-300">
            Connect your wallet to load your home planet, resources, and live game state. No planet
            data is shown until your wallet is connected.
          </p>
        </div>
      ) : (
      <div className="relative min-h-[8.75rem] overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        {(!heroImage || !heroImageLoaded) && (
          <PlanetImageSkeleton className="absolute inset-0" />
        )}
        {heroImage ? (
          <OptimizedImage
            key={heroImage}
            alt="Planet hero background"
            className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-200 ${heroImageLoaded ? "opacity-95" : "opacity-0"}`}
            imageRef={heroImageRef}
            loading="eager"
            onLoad={(event) => {
              if (isImageReady(event.currentTarget)) setHeroImageLoaded(true);
            }}
            sizes="(min-width: 1024px) 40rem, 100vw"
            src={heroImage}
          />
        ) : null}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#101624]/80 via-[#101624]/45 to-[#101624]/10" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#101624]/70 via-[#101624]/10 to-transparent" />
        {homePlanet?.hasMoon ? (
          <PlanetMoonIndicator
            className="right-3 top-3"
            label={`Open ${homePlanet.moonName ?? "Moon"}`}
            onClick={onSelectMoon ? () => onSelectMoon({ galaxy: homePlanet.galaxy, system: homePlanet.system, position: homePlanet.position }) : undefined}
            overviewHero
            planetType={homePlanet.type}
            title={`Open ${homePlanet.moonName ?? "Moon"} at [${homePlanet.galaxy}:${homePlanet.system}:${homePlanet.position}]`}
          />
        ) : null}
        <div className="relative grid min-h-[8.75rem] content-end gap-3 p-3 sm:min-h-[9.5rem] sm:p-4">
          <div className="grid max-w-[36rem] min-w-0 gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-slate-200/95 drop-shadow">{planetSubhead}</p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="m-0 min-w-0 break-words text-2xl font-semibold leading-none text-white drop-shadow sm:text-3xl">
                  {livePlanetName ?? (
                    <span
                      aria-label="Loading planet name"
                      className="inline-block h-7 w-40 animate-pulse rounded bg-white/10 align-middle sm:h-8"
                    />
                  )}
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    aria-controls="overview-planet-effects"
                    aria-expanded={effectsPanelOpen}
                    aria-haspopup="dialog"
                    aria-label="Show planet stats and effects"
                    className="inline-grid h-10 w-10 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 sm:h-6 sm:w-6"
                    onClick={() => {
                      setRenamePanelOpen(false);
                      setEffectsPanelOpen(true);
                    }}
                    title="Planet stats and effects"
                    type="button"
                  >
                    <Info aria-hidden="true" size={13} strokeWidth={2} />
                  </button>
                  {canShowRename && (
                    <button
                      aria-controls="overview-planet-name-editor"
                      aria-expanded={renamePanelOpen}
                      aria-haspopup="dialog"
                      aria-label="Rename planet"
                      className="relative inline-grid h-10 w-10 translate-y-px place-items-center self-center rounded text-slate-200/80 transition after:absolute after:-inset-1.5 after:content-[''] hover:bg-cyan-200/10 hover:text-cyan-100 focus:outline-none focus:ring-1 focus:ring-cyan-300/70 disabled:cursor-not-allowed disabled:text-slate-500 sm:h-5 sm:w-5"
                      disabled={renameBusy}
                      onClick={() => {
                        setEffectsPanelOpen(false);
                        setRenamePanelOpen(true);
                        setRenameDraft(planetName);
                        setRenameValidation(undefined);
                      }}
                      title="Rename planet"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={11} strokeWidth={2} />
                    </button>
                  )}
                  {showAbandonAction && (
                    <button
                      aria-label="Abandon planet"
                      className="inline-flex h-10 items-center gap-1 rounded border border-red-300/25 bg-red-300/10 px-2.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20 focus:outline-none focus:ring-2 focus:ring-red-300/50 sm:h-8"
                      onClick={() => onAbandonPlanet?.()}
                      title="Abandon planet"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={13} strokeWidth={2} />
                      Abandon
                    </button>
                  )}
                </div>
              </div>
              {canShowRename && planetRenameAction.status !== "idle" && !renamePanelOpen && (
                <p className={`mt-1 max-w-full truncate text-xs ${renameStatusTone}`}>
                  {planetRenameAction.label}
                </p>
              )}
              {planetManagementAction.status !== "idle" && (
                <p className={`mt-1 max-w-full truncate text-xs ${managementStatusTone}`}>
                  {planetManagementAction.label}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {shouldShowFleetsSummary && fleetVisibility ? (
        <FleetsSummary
          fleetVisibility={fleetVisibility}
          planetContextKey={selectedPlanetId}
          planetNames={fleetPlanetNames}
          now={now}
          onOpenMissionControl={() => onNavigate("mission-control")}
        />
      ) : null}
      </div>

      {canShowRename && renamePanelOpen ? (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !renameBusy) setRenamePanelOpen(false);
          }}
        >
          <form
            aria-labelledby="overview-planet-name-editor-title"
            aria-modal="true"
            className="modal-panel-enter grid max-h-[calc(100dvh-1.5rem)] w-full max-w-sm gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 shadow-2xl shadow-black/45"
            id="overview-planet-name-editor"
            onSubmit={handleRenameSubmit}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Planet</p>
                <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-white" id="overview-planet-name-editor-title">
                  Edit name
                </h2>
              </div>
              <button
                aria-label="Cancel planet name edit"
                className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                onClick={() => setRenamePanelOpen(false)}
                title="Cancel"
                type="button"
              >
                <X aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            </div>
            <label className="grid gap-1 text-xs font-medium text-slate-200">
              New planet name
              <input
                className="h-9 rounded border border-white/10 bg-[#050b14]/95 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                maxLength={64}
                onInput={(event) => {
                  setRenameDraft(event.currentTarget.value);
                  setRenameValidation(undefined);
                }}
                placeholder="Enter planet name"
                value={renameDraft}
              />
            </label>
            <p className="text-[11px] leading-4 text-slate-300">
              Renaming this planet is an onchain transaction. Your wallet will ask for confirmation, and gas may be required.
            </p>
            {(renameValidation || renameStatusLabel) && (
              <p className={`break-words text-[11px] leading-4 ${renameValidation ? "text-amber-200" : renameStatusTone}`}>
                {renameValidation ?? renameStatusLabel}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                aria-label="Cancel planet name edit"
                className="inline-grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                onClick={() => setRenamePanelOpen(false)}
                title="Cancel"
                type="button"
              >
                <X aria-hidden="true" size={14} strokeWidth={2} />
              </button>
              <button
                aria-label="Rename planet onchain"
                className="inline-grid h-8 w-8 place-items-center rounded border border-cyan-300/40 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!canRenamePlanet || renameBusy}
                title={renameBusy ? "Confirming" : "Rename onchain"}
                type="submit"
              >
                <Check aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {effectsPanelOpen ? (
        <PlanetEffectsPanel
          effects={planetEffects}
          id="overview-planet-effects"
          onClose={() => setEffectsPanelOpen(false)}
          stats={stats}
        />
      ) : null}

      {isWalletConnected && onChainStatus === "error" && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 sm:p-4">
          Planet data is unavailable right now. Overview stats and resources are hidden until the game API responds with live values.
          {onChainError ? <span className="block truncate text-amber-200/70">{onChainError}</span> : null}
        </div>
      )}

      {/* Contract production queues */}
      <div className="grid min-w-0 auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Building queue */}
        <QueuePanel label="Buildings">
          {onChainQueues?.building?.active ? (
            <QueuePanelContent>
              {buildingQueue ? (
                <QueueItemDisplay
                  color="bg-amber-300"
                  label={onChainBuildingQueue.label}
                  remaining={formatDurationUntil(buildingQueue.readyAt, now)}
                  progress={queueProgress}
                  readyAt={buildingQueue.readyAt}
                  startedAt={buildingQueue.startedAt}
                  thumbnailSrc={onChainBuildingQueue.asset}
                  now={now}
                  progressState={constructionProgress?.building}
                />
              ) : (
                <QueueItemDisplay
                  color="bg-amber-300"
                  label={onChainBuildingQueue.label}
                  remaining={queueRemaining(onChainQueues.building.readyAt, now)}
                  thumbnailSrc={onChainBuildingQueue.asset}
                  indeterminate
                />
              )}
              <OverviewBuildingActionNotice notice={overviewBuildingNoticeToRender} />
            </QueuePanelContent>
          ) : (
            <OverviewQueueFallback
              progressState={constructionProgress?.building}
              queue={buildingQueue}
              renderEmpty={() => (
                <EmptyQueue actionLabel="Build" onAction={() => onNavigate("infrastructure")}>
                  No active construction.
                </EmptyQueue>
              )}
              renderQueue={(fallbackBuildingQueue) => (
                <QueuePanelContent>
                  <QueueItemDisplay
                    color="bg-amber-300"
                    label={localBuildingLabel ?? fallbackBuildingQueue.label}
                    remaining={formatDurationUntil(fallbackBuildingQueue.readyAt, now)}
                    progress={queueProgress}
                    readyAt={fallbackBuildingQueue.readyAt}
                    startedAt={fallbackBuildingQueue.startedAt}
                    thumbnailSrc={localBuildingAsset}
                    now={now}
                    progressState={constructionProgress?.building}
                  />
                  <OverviewBuildingActionNotice notice={overviewBuildingNoticeToRender} />
                </QueuePanelContent>
              )}
            />
          )}
        </QueuePanel>

        {/* Defense queue */}
        <QueuePanel label="Defenses">
          {onChainDefenseQueue ? (
            <QueuePanelContent>
              <ProductionQueuePanel
                embedded
                now={now}
                progressState={constructionProgress?.defense}
                queue={onChainDefenseQueue}
                showBacklogEta={false}
                tone="rose"
              />
            </QueuePanelContent>
          ) : (
            <EmptyQueue actionLabel="Defenses" onAction={() => onNavigate("defenses")}>
              No active defense production.
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Research queue */}
        <QueuePanel label="Research">
          {onChainResearchQueue ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={`${compactOverviewResearchLabel(onChainResearchQueue.label)} ${onChainResearchQueue.targetLevel}`}
                remaining={formatDurationUntil(onChainResearchQueue.readyAt, now)}
                progress={activeResearchProgress}
                readyAt={onChainResearchQueue.readyAt}
                startedAt={onChainResearchQueue.startedAt}
                thumbnailSrc={onChainResearchAsset}
                color="bg-violet-300"
                now={now}
                progressState={constructionProgress?.research}
              />
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          ) : onChainQueues?.research?.active ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={`${onChainQueues.research.kind === "research" ? "Research" : onChainQueues.research.kind} ${onChainQueues.research.targetLevel}`}
                remaining={queueRemaining(onChainQueues.research.readyAt, now)}
                indeterminate
                thumbnailSrc={onChainResearchAsset}
                color="bg-violet-300"
              />
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          ) : (
            <OverviewQueueFallback
              progressState={constructionProgress?.research}
              queue={settledState.researchQueue}
              renderEmpty={() => (
                <QueuePanelContent>
                  <EmptyQueue actionLabel="Research" onAction={() => onNavigate("research")}>
                    No active research.
                  </EmptyQueue>
                  <OverviewResearchActionNotice actionState={researchAction} />
                </QueuePanelContent>
              )}
              renderQueue={(fallbackResearchQueue) => (
                <QueuePanelContent>
                  <QueueItemDisplay
                    label={compactOverviewResearchLabel(fallbackResearchQueue.label)}
                    remaining={formatDurationUntil(fallbackResearchQueue.readyAt, now)}
                    progress={activeResearchProgress}
                    readyAt={fallbackResearchQueue.readyAt}
                    startedAt={fallbackResearchQueue.startedAt}
                    thumbnailSrc={settledResearchAsset}
                    color="bg-violet-300"
                    now={now}
                    progressState={constructionProgress?.research}
                  />
                  <OverviewResearchActionNotice actionState={researchAction} />
                </QueuePanelContent>
              )}
            />
          )}
        </QueuePanel>

        {/* Shipyard queue */}
        <QueuePanel label="Shipyard">
          {onChainShipQueue ? (
            <QueuePanelContent>
              <ProductionQueuePanel
                embedded
                now={now}
                progressState={constructionProgress?.ship}
                queue={onChainShipQueue}
                showBacklogEta={false}
                tone="sky"
              />
            </QueuePanelContent>
          ) : (
            <OverviewQueueFallback
              progressState={constructionProgress?.ship}
              queue={settledState.queue?.kind === "ship" ? settledState.queue : undefined}
              renderEmpty={() => (
                <EmptyQueue actionLabel="Shipyard" onAction={() => onNavigate("shipyard")}>
                  No active ship production.
                </EmptyQueue>
              )}
              renderQueue={(fallbackShipQueue) => (
                <QueuePanelContent>
                  <QueueItemDisplay
                    label={fallbackShipQueue.label}
                    remaining={formatDurationUntil(fallbackShipQueue.readyAt, now)}
                    progress={shipProgress}
                    readyAt={fallbackShipQueue.readyAt}
                    startedAt={fallbackShipQueue.startedAt}
                    color="bg-sky-300"
                    now={now}
                    progressState={constructionProgress?.ship}
                  />
                </QueuePanelContent>
              )}
            />
          )}
        </QueuePanel>
      </div>

      {isWalletConnected && myPlanets.length > 0 ? (
        <MyPlanetsPanel
          commanderLabel={currentCommanderLabel?.trim() || "You"}
          myPlanets={myPlanets}
          onAction={onMyPlanetAction}
          onSupplyPlanet={onSupplyPlanet}
          onSelectMoon={onSelectMoon}
          onSelectPlanet={onSelectPlanet}
          onSwitchPlanet={onSwitchPlanet}
          selectedPlanetId={selectedPlanetId ?? onChainSettlement?.homePlanetId ?? onChainSettlement?.planet?.planetId}
        />
      ) : null}

      {shouldRenderWatchedPlanetsPanel({
        error: watchedPlanetsError,
        isWalletConnected,
        loading: watchedPlanetsLoading,
        planetCount: watchedPlanetRows.length,
      }) ? (
        <WatchedPlanetsPanel
          loading={watchedPlanetsLoading}
          onPageChange={onWatchedPlanetsPageChange}
          onRefresh={onRefreshWatchedPlanets}
          planetActionsForPlanet={watchedPlanetActionsForPlanet}
          moonActionsForPlanet={watchedMoonActionsForPlanet}
          onPlanetAction={onWatchedPlanetAction}
          onMoonAction={onWatchedMoonAction}
          onSelectAlliance={onSelectAlliance}
          onSelectMoon={onSelectMoon}
          onSelectPlanet={onSelectPlanet}
          onSelectPlayer={onSelectPlayer}
          onToggleWatchPlanet={onToggleWatchPlanet}
          page={watchedPlanetsPage}
          pageSize={watchedPlanets?.pagination.pageSize ?? 25}
          planets={watchedPlanetRows}
          total={watchedPlanets?.pagination.total ?? watchedPlanetRows.length}
          totalPages={watchedPlanets?.pagination.totalPages ?? 1}
          watchBusyPlanetId={watchBusyPlanetId}
          watchedPlanetIds={watchedPlanets?.watchedPlanetIds ?? []}
          error={watchedPlanetsError}
        />
      ) : null}

      {/* Resource values live in the persistent top bar; keep Overview focused on planet state and actions. */}
      {isWalletConnected && onChainStatus === "loading" && (
        <InlineSyncIndicator label="Refreshing resources" />
      )}

    </div>
  );
}

function MyPlanetsPanel({
  commanderLabel,
  myPlanets,
  onAction,
  onSupplyPlanet,
  onSelectMoon,
  onSelectPlanet,
  onSwitchPlanet,
  selectedPlanetId,
}: {
  commanderLabel: string;
  myPlanets: readonly OverviewMyPlanetActionGroup[];
  onAction: ((action: GalaxyAction, planet: ManagedPlanetResponse) => void) | undefined;
  onSupplyPlanet: ((planet: ManagedPlanetResponse) => void) | undefined;
  onSelectMoon: ((coords: Coordinates) => void) | undefined;
  onSelectPlanet: ((coords: Coordinates) => void) | undefined;
  onSwitchPlanet: ((planetId: string, bodyKind: "planet" | "moon") => void) | undefined;
  selectedPlanetId: string | undefined;
}) {
  return (
    <section aria-label="My planets" className="grid gap-1 rounded-lg border border-white/10 bg-[#101624] p-2">
      <div className="grid gap-1">
        {myPlanets.map(({ actions, moonActions, planet }) => {
          const coords = { galaxy: planet.galaxy, system: planet.system, position: planet.position };
          const rowPlanet = overviewPlanetFromManagedPlanet(planet);
          const isSelected = planet.planetId === selectedPlanetId;
          return (
            <WatchablePlanetRow
              allianceLabel="No alliance"
              commanderLabel={commanderLabel}
              compact
              coords={coords}
              current={isSelected}
              isHome={planet.isHomePlanet}
              key={planet.planetId}
              meta={[]}
              mobileActionsInline
              // Tapping one of the player's own planets switches the overview to it (the mobile
              // planet rail); the inspect screen stays reachable from the hero and Galaxy.
              onInspect={onSwitchPlanet ? () => onSwitchPlanet(planet.planetId, "planet") : onSelectPlanet ?? (() => undefined)}
              onInspectMoon={onSwitchPlanet ? () => onSwitchPlanet(planet.planetId, "moon") : onSelectMoon}
              planet={rowPlanet}
              showIdentity={false}
              showMoonIndicator={false}
              actionSlot={actions.length > 0 || onSupplyPlanet ? (
                <MyPlanetActionButtons
                  actions={actions}
                  onAction={(action) => onAction?.(action, planet)}
                  onSupply={() => onSupplyPlanet?.(planet)}
                />
              ) : undefined}
              moonActionSlot={moonActions && moonActions.length > 0 ? (
                <OverviewMoonActionButtons
                  actions={moonActions}
                  onAction={(action) => onAction?.(action, planet)}
                />
              ) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

function MyPlanetActionButtons({
  actions,
  onAction,
  onSupply,
}: {
  actions: GalaxyAction[];
  onAction: (action: GalaxyAction) => void;
  onSupply?: (() => void) | undefined;
}) {
  const enabledActions = actions.filter((action) => action.enabled);
  if (enabledActions.length === 0 && !onSupply) return null;

  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {enabledActions.map((action) => {
        const Icon = galaxyActionIcon(action.kind);
        return (
          <button
            aria-label={action.label}
            className="inline-flex h-11 w-11 items-center justify-center rounded border border-signal/30 bg-signal/10 text-signal transition hover:bg-signal/20 sm:h-8 sm:w-8"
            key={action.kind}
            onClick={() => onAction(action)}
            title={action.label}
            type="button"
          >
            <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
          </button>
        );
      })}
      {onSupply ? (
        <button
          aria-label="Supply this planet"
          className="inline-flex h-11 w-11 items-center justify-center rounded border border-signal/30 bg-signal/10 text-signal transition hover:bg-signal/20 sm:h-8 sm:w-8"
          onClick={onSupply}
          title="Supply this planet"
          type="button"
        >
          <PackagePlus aria-hidden="true" size={15} strokeWidth={1.9} />
        </button>
      ) : null}
    </span>
  );
}

// No standalone Inspect button: the moon subsection's name/art is the inspect control.
function OverviewMoonActionButtons({
  actions,
  onAction,
}: {
  actions: GalaxyAction[];
  onAction: (action: GalaxyAction) => void;
}) {
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      <MyPlanetActionButtons actions={actions} onAction={onAction} />
    </span>
  );
}

function overviewPlanetFromManagedPlanet(planet: ManagedPlanetResponse): Planet {
  const rowPlanet = planetFromSettlementPlanet(planet);
  return {
    ...rowPlanet,
    name: managedPlanetOverviewDisplayName(planet),
    occupiedBy: rowPlanet.occupiedBy
      ? {
          ...rowPlanet.occupiedBy,
          ownerDisplayName: null,
        }
      : rowPlanet.occupiedBy,
  };
}

export function managedPlanetOverviewDisplayName(planet: ManagedPlanetResponse): string {
  return planet.name?.trim() || `Planet ${planet.coordinates}`;
}

export function overviewBuildingActionNoticeFor(
  actionNotice: InfrastructureActionNotice | undefined,
  buildingKey: BuildingQueueItem["key"] | undefined,
): InfrastructureActionNotice | undefined {
  if (!buildingKey) return actionNotice;
  return actionNoticeForBuilding(actionNotice, buildingKey);
}

function WatchedPlanetsPanel({
  error,
  loading,
  moonActionsForPlanet,
  onPlanetAction,
  onMoonAction,
  onPageChange,
  onRefresh,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlanet,
  onSelectPlayer,
  onToggleWatchPlanet,
  planetActionsForPlanet,
  page,
  pageSize,
  planets,
  total,
  totalPages,
  watchBusyPlanetId,
  watchedPlanetIds,
}: {
  error: string | undefined;
  loading: boolean;
  moonActionsForPlanet: ((planet: Planet) => GalaxyAction[]) | undefined;
  onPlanetAction: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onMoonAction: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onPageChange: ((page: number) => void) | undefined;
  planetActionsForPlanet: ((planet: Planet) => GalaxyAction[]) | undefined;
  onRefresh: (() => void) | undefined;
  onSelectAlliance: ((allianceId: string) => void) | undefined;
  onSelectMoon: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlanet: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlayer: ((wallet: string) => void) | undefined;
  onToggleWatchPlanet: ((planetId: string, watched: boolean) => void) | undefined;
  page: number;
  pageSize: number;
  planets: Planet[];
  total: number;
  totalPages: number;
  watchBusyPlanetId: string | undefined;
  watchedPlanetIds: readonly string[];
}) {
  const { start, end } = watchedPlanetsPanelRange({ page, pageSize, total });

  return (
    <section className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Watched planets</h3>
          <p className="text-xs text-slate-500">
            {total > 0 ? `${start}-${end} of ${total}` : "Loading watched planets"}
          </p>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <button
              className="h-10 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600 sm:h-8"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange?.(Math.max(1, page - 1))}
              type="button"
            >
              Prev
            </button>
            <span className="min-w-16 text-center text-xs text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              className="h-10 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600 sm:h-8"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          <span>{error}</span>
          {onRefresh ? (
            <button
              className="inline-flex h-10 items-center gap-1.5 rounded border border-amber-200/30 bg-amber-200/10 px-2 font-semibold text-amber-50 transition hover:bg-amber-200/20 disabled:cursor-not-allowed disabled:opacity-60 sm:h-8"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <InlineSyncIndicator label="Refreshing watched planets" /> : null}

      <div className="grid gap-1.5">
        {planets.map((planet) => {
          const planetId = planet.occupiedBy?.planetId;
          const coords = { galaxy: planet.galaxy, system: planet.system, position: planet.position };
          const actions = planetActionsForPlanet?.(planet) ?? [];
          const moonActions = planet.hasMoon ? moonActionsForPlanet?.(planet) ?? [] : [];
          return (
            <WatchablePlanetRow
              actionSlot={actions.length > 0 ? (
                <MyPlanetActionButtons
                  actions={actions}
                  onAction={(action) => onPlanetAction?.(action, planet)}
                />
              ) : undefined}
              allianceLabel={formatGalaxyAllianceIdentityLabel(planet.alliance)}
              commanderLabel={formatGalaxyCommanderLabel(planet)}
              coords={coords}
              key={planetId ?? planet.id}
              meta={watchedPlanetMeta(planet)}
              moonActionSlot={moonActions.length > 0 ? (
                <OverviewMoonActionButtons
                  actions={moonActions}
                  onAction={(action) => onMoonAction?.(action, planet)}
                />
              ) : undefined}
              onInspect={onSelectPlanet ?? (() => undefined)}
              onInspectMoon={onSelectMoon}
              onSelectAlliance={onSelectAlliance}
              onSelectPlayer={onSelectPlayer}
              onToggleWatch={planetId ? () => onToggleWatchPlanet?.(planetId, watchedPlanetIds.includes(planetId)) : undefined}
              planet={planet}
              showMoonIndicator={false}
              watchBusy={watchBusyPlanetId === planetId}
              watched={Boolean(planetId && watchedPlanetIds.includes(planetId))}
            />
          );
        })}
      </div>
    </section>
  );
}

function watchedPlanetMeta(planet: Planet): PlanetMetaItem[] {
  const meta: PlanetMetaItem[] = [
    { label: `${planet.galaxy}:${planet.system}:${planet.position}` },
    { label: formatGalaxyHeatLabel(planet.temperature) },
    { label: `${planet.fields} fields` },
  ];
  if (planet.hasMoon) meta.push({ label: "Moon" });
  if (planet.debrisField) {
    meta.push({
      label: `${formatCompactResource(planet.debrisField.metal)} M / ${formatCompactResource(planet.debrisField.crystal)} C`,
      tone: "warning",
    });
  }
  return meta;
}

export function shouldRenderWatchedPlanetsPanel({
  error,
  isWalletConnected,
  loading,
  planetCount,
}: {
  error?: string | undefined;
  isWalletConnected: boolean;
  loading: boolean;
  planetCount: number;
}): boolean {
  return Boolean(isWalletConnected && (planetCount > 0 || loading || error));
}

// Research completions settle automatically on-chain (lazy reconcile), so there is no manual
// "complete" control. This predicate is still used to derive backend-state availability messaging.
export function isOverviewResearchReadyToFinish(
  queue: PlayerQueuesResponse["research"] | undefined,
  now: number,
): boolean {
  return Boolean(queue?.active && queue.readyAt && Number(queue.readyAt) * 1_000 <= now);
}

function OverviewBuildingActionNotice({
  notice,
}: {
  notice?: InfrastructureActionNotice | undefined;
}) {
  if (!notice) return null;
  const className = notice.tone === "error"
    ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
    : notice.tone === "pending"
      ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  const role = notice.tone === "error" ? "alert" : "status";

  return (
    <div className={`min-w-0 max-w-full overflow-hidden whitespace-normal break-words rounded-md border px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere] ${className}`} role={role}>
      {notice.label}
    </div>
  );
}

function OverviewResearchActionNotice({
  actionState,
}: {
  actionState: OverviewResearchActionState;
}) {
  const notice = overviewResearchActionNoticeFor(actionState);
  if (!notice) return null;
  const className = notice.tone === "error"
    ? "border-rose-300/20 bg-rose-300/5 text-rose-100"
    : "border-white/10 bg-white/5 text-slate-200";

  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${className}`}>
      {notice.label}
    </div>
  );
}

export function overviewPlanetDisplayName(
  homePlanet: Planet | undefined,
  planet: PlanetSummary | undefined,
): string | undefined {
  const name = homePlanet?.name.trim();
  if (name) return name;

  const coordinates = homePlanet
    ? `${homePlanet.galaxy}:${homePlanet.system}:${homePlanet.position}`
    : planet?.coordinates?.trim();
  return coordinates ? `Planet ${coordinates}` : undefined;
}

export function overviewResearchActionNoticeFor(
  actionState: OverviewResearchActionState,
): { label: string; tone: "error" | "pending" } | undefined {
  if (actionState.status === "idle" || actionState.status === "success") return undefined;
  return {
    label: actionState.label,
    tone: actionState.status === "error" ? "error" : "pending",
  };
}

export type FleetSummaryLine = {
  direction: "incoming" | "outgoing" | "returning";
  endpointLabel: string;
  eventAt: number | undefined;
  isAttack: boolean;
  key: string;
  missionType: string;
  text: string;
  relation: "friendly" | "hostile" | "self";
  routeLabel: string;
  state: string;
  timingLabel: string;
  timingValue: string;
  tone: "harvest" | "hostile" | "neutral";
};

export type FleetsSummaryData = {
  activeCount: number;
  attackLines: FleetSummaryLine[];
  hiddenCount: number;
  hiddenLines: FleetSummaryLine[];
  lines: FleetSummaryLine[];
  nonAttackLines: FleetSummaryLine[];
  visibleLines: FleetSummaryLine[];
};

export const OVERVIEW_NON_ATTACK_LIMIT = 4;

function missionEndpointLabel(
  ref: FleetMissionPlanetReference | null | undefined,
  fallbackPlanetId: string,
  planetNames?: ReadonlyMap<string, string>,
): string {
  if (ref) {
    const name = ref.name?.trim()
      || planetNames?.get(`id:${ref.planetId}`)
      || planetNames?.get(`coords:${ref.coordinates}`);
    const commander = ref.ownerDisplayName?.trim();
    const label = name && name.length > 0
      ? name
      : commander ? `${commander}'s planet` : "Planet";
    return `${label} [${ref.coordinates}]`;
  }
  const knownName = planetNames?.get(`id:${fallbackPlanetId}`);
  if (knownName) return knownName;
  const colonyTarget = decodeColonizationTargetId(fallbackPlanetId);
  if (colonyTarget) return `Uncharted [${colonyTarget.coordinates}]`;
  return `Planet #${fallbackPlanetId}`;
}

export function summarizeFleets(
  fleetVisibility: FleetMissionVisibilityResponse,
  now: number,
  planetNames?: ReadonlyMap<string, string>,
): FleetsSummaryData {
  const { incoming, outgoing, returning } = fleetVisibility;
  const lines: FleetSummaryLine[] = [];
  const seen = new Set<string>();
  const wallet = fleetVisibility.wallet.trim().toLowerCase();

  for (const mission of incoming) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const isReturning = mission.status === "Returning" || mission.status === "Recalled";
    const eventMs = timestampToMs(isReturning ? mission.returnAt : mission.arrivalAt);
    const self = mission.owner.trim().toLowerCase() === wallet;
    const hostile = !self && isOffensiveFleetMission(mission.missionType);
    const relation = self ? "self" : hostile ? "hostile" : "friendly";
    const endpoint = missionEndpointLabel(mission.originPlanet, mission.originPlanetId, planetNames);
    const state = overviewMissionStatus(mission);
    const timingLabel = isReturning ? "Lands" : "ETA";
    const timingValue = overviewMissionTimingValue(eventMs, now);
    const directionLabel = isReturning ? "Returning to" : "Inbound from";
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: isReturning ? "returning" : "incoming",
      endpointLabel: endpoint,
      eventAt: eventMs,
      isAttack,
      key: `in-${mission.missionId}`,
      missionType: mission.missionType,
      relation,
      routeLabel: directionLabel,
      state,
      text: `${missionTypeLabel(mission.missionType)} · ${directionLabel} ${endpoint} · ${state} · ${timingLabel} ${timingValue}`,
      timingLabel,
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  for (const mission of outgoing) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const arrivalMs = timestampToMs(mission.arrivalAt);
    const defenseHoldUntilMs = mission.missionType === "DefenseHold"
      ? timestampToMs(mission.defenseHoldUntil ?? mission.returnAt)
      : undefined;
    const isHolding = mission.missionType === "DefenseHold"
      && mission.asOfNow?.arrived === true
      && mission.asOfNow.returned !== true;
    const eventMs = isHolding ? defenseHoldUntilMs : arrivalMs;
    const state = overviewMissionStatus(mission);
    const timingLabel = isHolding ? "Ends" : "ETA";
    const timingValue = overviewMissionTimingValue(eventMs, now);
    const endpoint = missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId, planetNames);
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: "outgoing",
      endpointLabel: endpoint,
      eventAt: eventMs,
      isAttack,
      relation: "self",
      key: `out-${mission.missionId}`,
      missionType: mission.missionType,
      routeLabel: "Outbound to",
      state,
      text: `${missionTypeLabel(mission.missionType)} · Outbound to ${endpoint} · ${state} · ${timingLabel} ${timingValue}`,
      timingLabel,
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  for (const mission of returning) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const returnMs = timestampToMs(mission.returnAt);
    const state = overviewMissionStatus(mission);
    const timingValue = overviewMissionTimingValue(returnMs, now);
    const endpoint = missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId, planetNames);
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: "returning",
      endpointLabel: endpoint,
      eventAt: returnMs,
      isAttack,
      relation: "self",
      key: `ret-${mission.missionId}`,
      missionType: mission.missionType,
      routeLabel: "Returning from",
      state,
      text: `${missionTypeLabel(mission.missionType)} · Returning from ${endpoint} · ${state} · Lands ${timingValue}`,
      timingLabel: "Lands",
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  const attackLines = lines.filter((line) => line.isAttack).sort(compareOverviewFleetLines);
  const nonAttackLines = lines.filter((line) => !line.isAttack).sort(compareOverviewFleetLines);
  const visibleNonAttackLines = nonAttackLines.slice(0, OVERVIEW_NON_ATTACK_LIMIT);
  const hiddenLines = nonAttackLines.slice(OVERVIEW_NON_ATTACK_LIMIT);
  return {
    activeCount: lines.length,
    attackLines,
    hiddenCount: hiddenLines.length,
    hiddenLines,
    lines: [...attackLines, ...nonAttackLines],
    nonAttackLines,
    visibleLines: [...attackLines, ...visibleNonAttackLines],
  };
}

const OFFENSIVE_FLEET_MISSIONS = new Set(["Attack", "AcsAttack", "MissileAttack"]);

function isOffensiveFleetMission(missionType: string): boolean {
  return OFFENSIVE_FLEET_MISSIONS.has(missionType);
}

function overviewMissionStatus(
  mission: FleetMissionVisibilityResponse["outgoing"][number],
): string {
  if (mission.resolutionBlocker === "randomness_pending") return "Awaiting randomness";
  if (mission.needsResolution === true) return "Resolving";
  if (
    mission.missionType === "DefenseHold"
    && mission.status === "Outbound"
    && mission.asOfNow?.arrived === true
    && mission.asOfNow.returned !== true
  ) {
    return "Stationed";
  }
  if ((mission.status === "Returning" || mission.status === "Recalled") && mission.asOfNow?.returned === true) {
    return "Resolving";
  }
  return mission.status;
}

function overviewMissionTimingValue(eventMs: number | undefined, now: number): string {
  if (eventMs === undefined) return "Unknown";
  if (eventMs <= now) return "Now";
  return formatDurationUntil(eventMs, now);
}

function compareOverviewFleetLines(left: FleetSummaryLine, right: FleetSummaryLine): number {
  const leftEvent = left.eventAt ?? Number.POSITIVE_INFINITY;
  const rightEvent = right.eventAt ?? Number.POSITIVE_INFINITY;
  return leftEvent - rightEvent || left.key.localeCompare(right.key);
}

export function FleetsSummary({
  fleetVisibility,
  now,
  onOpenMissionControl,
  planetContextKey,
  planetNames,
}: {
  fleetVisibility: FleetMissionVisibilityResponse;
  now: number;
  onOpenMissionControl: () => void;
  planetContextKey?: string | undefined;
  planetNames?: ReadonlyMap<string, string> | undefined;
}) {
  const summary = summarizeFleets(fleetVisibility, now, planetNames);
  return (
    <section aria-label="Fleets" className="flex h-full min-w-0 flex-col rounded-lg border border-white/10 bg-white/[0.04] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex h-5 min-w-0 items-center text-xs font-semibold uppercase leading-none tracking-[0.14em] text-slate-400">Fleets</h2>
        <button
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/45"
          onClick={onOpenMissionControl}
          type="button"
        >
          <span>Open Mission Control</span>
          <ArrowRight aria-hidden="true" className="shrink-0" size={13} strokeWidth={2} />
        </button>
      </div>

      {summary.activeCount === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No active fleets for this planet.</p>
      ) : (
        <div className="mt-3 min-w-0">
          <ul className="grid gap-1" data-fleet-visible-count={summary.visibleLines.length}>
            {summary.visibleLines.map((line) => <FleetSummaryRow key={line.key} line={line} />)}
          </ul>
          {summary.hiddenCount > 0 ? (
            <details
              className="group/fleet-overflow mt-1.5"
              data-hidden-count={summary.hiddenCount}
              key={planetContextKey}
            >
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/15 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.06] hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 [&::-webkit-details-marker]:hidden">
                <span className="group-open/fleet-overflow:hidden">+{summary.hiddenCount} more</span>
                <span className="hidden group-open/fleet-overflow:inline">Show fewer</span>
                <ChevronDown aria-hidden="true" className="shrink-0 transition-transform group-open/fleet-overflow:rotate-180" size={13} strokeWidth={2} />
              </summary>
              <ul className="mt-1 grid gap-1" data-fleet-hidden-count={summary.hiddenCount}>
                {summary.hiddenLines.map((line) => <FleetSummaryRow key={line.key} line={line} />)}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FleetSummaryRow({ line }: { line: FleetSummaryLine }) {
  return (
    <li
      aria-label={line.text}
      className={`grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] leading-4 ${
        line.tone === "hostile"
          ? "border-red-400/35 bg-red-500/[0.11] text-red-50"
          : line.tone === "harvest"
            ? "border-amber-300/25 bg-amber-300/[0.08] text-amber-50"
            : line.relation === "friendly"
              ? "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-50"
              : "border-white/10 bg-black/20 text-slate-200"
      }`}
      data-attack-priority={line.isAttack ? "true" : undefined}
      data-direction={line.direction}
      title={line.text}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${overviewMissionTypeTone(line)}`}>
        <OverviewMissionTypeIcon missionType={line.missionType} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-current">{missionTypeLabel(line.missionType)}</span>
          {line.isAttack ? <span className="shrink-0 rounded bg-red-400/15 px-1 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-red-200">Priority</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400">
          <OverviewMissionDirectionIcon direction={line.direction} />
          <span className="shrink-0">{line.routeLabel}</span>
          <span className="truncate" title={line.endpointLabel}>{line.endpointLabel}</span>
        </span>
      </span>
      <span className="ml-auto flex min-w-0 flex-col items-end text-right tabular-nums">
        <span className={`max-w-[5.75rem] truncate text-[10px] font-medium ${line.isAttack ? "text-red-200" : "text-slate-300"}`} title={line.state}>{line.state}</span>
        <span className="whitespace-nowrap text-[10px] text-slate-500"><span className="hidden sm:inline">{line.timingLabel} </span>{line.timingValue}</span>
      </span>
    </li>
  );
}

function OverviewMissionTypeIcon({ missionType }: { missionType: string }) {
  const props = { "aria-hidden": true, size: 14, strokeWidth: 2 } as const;
  if (isOffensiveFleetMission(missionType)) return <Swords {...props} />;
  if (missionType === "Transport") return <Package {...props} />;
  if (missionType === "Deploy") return <Rocket {...props} />;
  if (missionType === "Harvest") return <RefreshCw {...props} />;
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(missionType)) return <Shield {...props} />;
  return <Satellite {...props} />;
}

function OverviewMissionDirectionIcon({ direction }: { direction: FleetSummaryLine["direction"] }) {
  const props = { "aria-hidden": true, className: "shrink-0", size: 11, strokeWidth: 2 } as const;
  if (direction === "incoming") return <ArrowDownLeft {...props} />;
  if (direction === "outgoing") return <ArrowUpRight {...props} />;
  return <RotateCcw {...props} />;
}

function overviewMissionTypeTone(line: FleetSummaryLine): string {
  if (line.isAttack) return "border-red-300/30 bg-red-400/15 text-red-100";
  if (line.missionType === "Transport") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (line.missionType === "Deploy") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (line.missionType === "Harvest") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(line.missionType)) return "border-violet-300/25 bg-violet-300/10 text-violet-100";
  return "border-slate-300/20 bg-slate-300/10 text-slate-100";
}

function planetKeyFromCoordinates(coordinates: { galaxy: number; system: number; position: number }): string {
  return `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`;
}

function PlanetEffectsPanel({
  effects,
  id,
  onClose,
  stats,
}: {
  effects: OverviewPlanetEffectsDisplay;
  id: string;
  onClose: () => void;
  stats: ReturnType<typeof displayPlanetStats>;
}) {
  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="modal-panel-enter grid max-h-[calc(100dvh-1.5rem)] w-full max-w-lg gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 text-xs leading-5 text-slate-200 shadow-2xl shadow-black/45"
        id={id}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Planet</p>
            <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-white" id={`${id}-title`}>
              Stats and effects
            </h2>
          </div>
          <button
            aria-label="Close planet effects"
            className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>

        <p className="text-slate-300">
          Fields are the planet development budget: each building level consumes one field, and Terraformer expands the limit.
        </p>
        <p className="text-slate-400">
          Temperature changes deuterium production and Solar Satellite energy output, so colder and hotter planets favor different builds.
        </p>

        <dl className="grid gap-2 sm:grid-cols-3">
          <EffectMetric label="Fields" value={stats.fields} />
          <EffectMetric label="Temperature" value={stats.temperature} />
          <EffectMetric label="Diameter" value={stats.diameter} />
          <EffectMetric label="Terraformer" value={effects.terraformer} />
          <EffectMetric label="Deuterium multiplier" value={effects.deuteriumMultiplier} />
          <EffectMetric
            label="Solar Satellite"
            nowrap
            value={effects.solarSatelliteEnergy === undefined ? "Unavailable" : `${effects.solarSatelliteEnergy.toLocaleString()} E each`}
          />
        </dl>
      </section>
    </div>
  );
}

function EffectMetric({ label, value, nowrap = false }: { label: string; value: string; nowrap?: boolean }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-xs font-semibold text-slate-100 ${nowrap ? "truncate whitespace-nowrap" : "break-words"}`} title={nowrap ? value : undefined}>{value}</dd>
    </div>
  );
}

function QueuePanel({
  label,
  children,
}: {
  label: string;
  children: preact.ComponentChildren;
}) {
  return (
    <section
      aria-label={label}
      className="flex w-full min-w-0 flex-col rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4"
    >
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function QueuePanelContent({ children }: { children: preact.ComponentChildren }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">{children}</div>
  );
}

export function OverviewQueueFallback<T>({
  progressState,
  queue,
  renderEmpty,
  renderQueue,
}: {
  progressState?: ConstructionProgress | undefined;
  queue: T | undefined;
  renderEmpty: () => preact.ComponentChild;
  renderQueue: (queue: T) => preact.ComponentChild;
}): preact.ComponentChild {
  const displayedQueue = constructionQueueForDisplay(queue, progressState);
  return displayedQueue === undefined ? renderEmpty() : renderQueue(displayedQueue);
}

function QueueItemDisplay({
  detail,
  label,
  remaining,
  progress,
  progressState,
  readyAt,
  indeterminate,
  color = "bg-signal",
  thumbnailSrc,
  now,
  startedAt,
}: {
  detail?: string | undefined;
  label: string;
  remaining: string;
  progress?: number | undefined;
  progressState?: ConstructionProgress | undefined;
  readyAt?: number | undefined;
  indeterminate?: boolean | undefined;
  color?: string;
  thumbnailSrc?: string | undefined;
  now?: number | undefined;
  startedAt?: number | undefined;
}) {
  const hasCanonicalTimeline =
    typeof readyAt === "number" && typeof startedAt === "number" && startedAt < readyAt;
  const resolvedProgress = progressState?.progress ?? progress;
  const resolvedRemaining = progressState?.remaining ?? remaining;
  const shouldIndeterminate = progressState?.indeterminate ?? indeterminate ?? (!hasCanonicalTimeline && resolvedProgress === undefined);
  const progressBar = queueProgressBarState({
    indeterminate: shouldIndeterminate,
    progress: resolvedProgress,
    remaining: resolvedRemaining,
  });
  const progressFill = progressState
    ? { animated: false, durationMs: 0, elapsedMs: 0, progress: progressState.progress }
    : queueProgressFillState({
      indeterminate: shouldIndeterminate,
      now: now ?? Date.now(),
      progress: resolvedProgress,
      readyAt,
      remaining: resolvedRemaining,
      startedAt,
    });
  return (
    <div className={thumbnailSrc ? "flex min-w-0 items-center gap-3" : undefined}>
      {thumbnailSrc ? (
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5">
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            sizes="icon"
            src={thumbnailSrc}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="grid min-w-0 gap-1">
          <p className={overviewQueueItemLabelClassName}>{label}</p>
          <p className={overviewQueueItemRemainingClassName}>{resolvedRemaining}</p>
          {detail ? <p className="truncate text-[11px] text-slate-400">{detail}</p> : null}
        </div>
        <AnimatedProgressBar
          className="mt-2 h-1.5 bg-white/10"
          fillClassName={color}
          indeterminate={progressBar.indeterminate}
          label={`${label} progress`}
          value={progressFill.progress}
        />
      </div>
    </div>
  );
}

export function EmptyQueue({
  actionLabel,
  children,
  onAction,
}: {
  actionLabel: string;
  children: preact.ComponentChildren;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-xs leading-5 text-slate-400">
      <p className="min-w-0 break-words">{children}</p>
      <QuickLink onClick={onAction}>{actionLabel}</QuickLink>
    </div>
  );
}

function QuickLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      className="mt-auto flex min-h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold leading-4 text-slate-200 transition hover:border-cyan-300/40 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/45"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ArrowRight aria-hidden="true" className="shrink-0" size={13} strokeWidth={2} />
    </button>
  );
}
