import { queueProgress as queueProgressValue, researchCatalog, type MainQueueItem, type PlayableState, type Resources } from "../playableMvp";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, ArrowRight, Check, Info, Pencil, RefreshCw, Trash2, X } from "lucide-preact";
import { researchQueueForDisplay } from "../chainState";
import {
  buildingQueueAsset,
  buildingQueueLabel,
  buildingQueuePreview,
  defenseQueuePreview,
  displayPlanetStats,
  overviewPlanetEffects,
  type OverviewPlanetEffectsDisplay,
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
  queueProgressBarState,
  queueProgressFillState,
  shipQueuePreview,
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
  type QueueStateResponse,
  type WatchedPlanetsResponse,
  type WalletSettlementResponse
} from "../walletFlow";
import type { GalaxyAction } from "../galaxyActions";
import { formatDurationUntil } from "../durationFormat";
import { timestampToMs, type TimestampInput } from "../timestampFormat";
import {
  actionNoticeForBuilding,
  buildingKeyForContractId,
  type InfrastructureActionNotice,
} from "../buildingActionNotice";
import { OptimizedImage } from "./OptimizedImage";
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
};

interface OverviewPageProps {
  state: PlayableState;
  settledState: PlayableState;
  rates: Resources;
  caps: Resources;
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
  onSelectPlanet?: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
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
  watchBusyPlanetId?: string | undefined;
  myPlanets?: readonly OverviewMyPlanetActionGroup[] | undefined;
  currentCommanderLabel?: string | undefined;
  selectedPlanetId?: string | undefined;
  onMyPlanetAction?: ((action: GalaxyAction, planet: ManagedPlanetResponse) => void) | undefined;
}

export function OverviewPage({
  settledState,
  rates,
  caps,
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
  onSelectPlanet,
  onSelectPlayer,
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
  watchBusyPlanetId,
  myPlanets = [],
  currentCommanderLabel,
  selectedPlanetId,
  onMyPlanetAction,
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
  const onChainBuildingQueue = buildingQueue
    ? {
      asset: buildingQueueAsset(buildingQueue.key),
      label: buildingQueueLabel(buildingQueue.label, buildingQueue.targetLevel),
    }
    : buildingQueuePreview(onChainQueues?.building);
  const localBuildingAsset = buildingQueue ? buildingQueueAsset(buildingQueue.key) : undefined;
  const localBuildingLabel = buildingQueue
    ? buildingQueueLabel(buildingQueue.label, buildingQueue.targetLevel)
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
  const activeResearchProgress = onChainResearchQueue ? queueProgressValue(onChainResearchQueue, now) : researchProgress;
  const onChainDefenseQueue = defenseQueuePreview(onChainQueues?.defense);
  const onChainDefenseBacklog = onChainQueues?.defense?.backlog
    ?.filter((queue) => queue.active)
    .map((queue) => defenseQueuePreview(queue)) ?? [];
  const defenseReadyAt = queueTimestampMs(onChainQueues?.defense?.readyAt);
  const defenseStartedAt = queueTimestampMs(onChainQueues?.defense?.startedAt);
  const onChainShipQueue = shipQueuePreview(onChainQueues?.ship);
  const onChainShipBacklog = onChainQueues?.ship?.backlog
    ?.filter((queue) => queue.active)
    .map((queue) => shipQueuePreview(queue)) ?? [];
  const shipReadyAt = queueTimestampMs(onChainQueues?.ship?.readyAt);
  const shipStartedAt = queueTimestampMs(onChainQueues?.ship?.startedAt);
  const shipHasCanonicalTimeline =
    shipReadyAt !== undefined && shipStartedAt !== undefined && shipStartedAt < shipReadyAt;
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
        {homePlanet?.hasMoon ? <PlanetMoonIndicator className="right-3 top-3" planetType={homePlanet.type} /> : null}
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
                    aria-label="Show planet stats and effects"
                    className="inline-grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
                    onClick={() => setEffectsPanelOpen((open) => !open)}
                    title="Planet stats and effects"
                    type="button"
                  >
                    <Info aria-hidden="true" size={13} strokeWidth={2} />
                  </button>
                  {canShowRename && (
                    <button
                      aria-expanded={renamePanelOpen}
                      aria-label="Rename planet"
                      className="relative inline-grid h-5 w-5 translate-y-px place-items-center self-center rounded text-slate-200/80 transition after:absolute after:-inset-1.5 after:content-[''] hover:bg-cyan-200/10 hover:text-cyan-100 focus:outline-none focus:ring-1 focus:ring-cyan-300/70 disabled:cursor-not-allowed disabled:text-slate-500"
                      disabled={renameBusy}
                      onClick={() => {
                        setRenamePanelOpen((open) => !open);
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
                      className="inline-flex h-8 items-center gap-1 rounded border border-red-300/25 bg-red-300/10 px-2.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20 focus:outline-none focus:ring-2 focus:ring-red-300/50"
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
            {canShowRename && renamePanelOpen && (
              <form
                className="grid gap-2 rounded border border-white/10 bg-black/25 p-3"
                onSubmit={handleRenameSubmit}
              >
                <label className="grid gap-1 text-xs font-medium text-slate-200">
                  New planet name
                  <input
                    className="h-9 rounded border border-white/10 bg-[#080d18]/95 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
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
                  <p className={`text-xs ${renameValidation ? "text-amber-200" : renameStatusTone}`}>
                    {renameValidation ?? renameStatusLabel}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                    disabled={renameBusy}
                    onClick={() => setRenamePanelOpen(false)}
                    type="button"
                  >
                    <X aria-hidden="true" size={13} strokeWidth={2} />
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded border border-cyan-300/40 bg-cyan-300/10 px-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                    disabled={!canRenamePlanet || renameBusy}
                    type="submit"
                  >
                    <Check aria-hidden="true" size={13} strokeWidth={2} />
                    {renameBusy ? "Confirming" : "Rename onchain"}
                  </button>
                </div>
              </form>
            )}
          </div>
          {effectsPanelOpen ? (
            <div>
              <PlanetEffectsPanel
                effects={planetEffects}
                id="overview-planet-effects"
                onClose={() => setEffectsPanelOpen(false)}
                stats={stats}
              />
            </div>
          ) : null}
        </div>
      </div>
      )}

      {shouldShowFleetsSummary && fleetVisibility ? (
        <FleetsSummary
          fleetVisibility={fleetVisibility}
          now={now}
          onOpenMissionControl={() => onNavigate("mission-control")}
        />
      ) : null}
      </div>

      {isWalletConnected && onChainStatus === "error" && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 sm:p-4">
          Planet data is unavailable right now. Overview stats and resources are hidden until the game API responds with live values.
          {onChainError ? <span className="block truncate text-amber-200/70">{onChainError}</span> : null}
        </div>
      )}

      {/* Contract production queues */}
      <div className="grid min-w-0 auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Building queue */}
        <QueuePanel
          label="Buildings"
          tag={onChainQueues?.building?.active ? "Active" : undefined}
        >
          {onChainQueues?.building?.active ? (
            <QueuePanelContent>
              {buildingQueue ? (
                <QueueItemDisplay
                  label={onChainBuildingQueue.label}
                  remaining={formatDurationUntil(buildingQueue.readyAt, now)}
                  progress={queueProgress}
                  readyAt={buildingQueue.readyAt}
                  startedAt={buildingQueue.startedAt}
                  thumbnailSrc={onChainBuildingQueue.asset}
                  now={now}
                />
              ) : (
                <QueueItemDisplay
                  label={onChainBuildingQueue.label}
                  remaining={queueRemaining(onChainQueues.building.readyAt, now)}
                  thumbnailSrc={onChainBuildingQueue.asset}
                  indeterminate
                />
              )}
              <OverviewBuildingActionNotice notice={overviewBuildingNoticeToRender} />
            </QueuePanelContent>
          ) : buildingQueue ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={localBuildingLabel ?? buildingQueue.label}
                remaining={formatDurationUntil(buildingQueue.readyAt, now)}
                progress={queueProgress}
                readyAt={buildingQueue.readyAt}
                startedAt={buildingQueue.startedAt}
                thumbnailSrc={localBuildingAsset}
                now={now}
              />
              <OverviewBuildingActionNotice notice={overviewBuildingNoticeToRender} />
            </QueuePanelContent>
          ) : (
            <EmptyQueue actionLabel="Build" onAction={() => onNavigate("infrastructure")}>
              No active construction.
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Defense queue */}
        <QueuePanel
          label="Defenses"
          tag={onChainQueues?.defense?.active ? "Active" : undefined}
        >
          {onChainQueues?.defense?.active ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={onChainDefenseQueue.label}
                remaining={queueRemaining(onChainQueues.defense.readyAt, now)}
                readyAt={defenseReadyAt}
                startedAt={defenseStartedAt}
                thumbnailSrc={onChainDefenseQueue.asset}
                color="bg-rose-300"
                now={now}
              />
              {onChainDefenseBacklog.length > 0 ? (
                <div className="grid gap-1 border-t border-white/10 pt-2 text-xs text-slate-400">
                  <span className="font-semibold uppercase tracking-[0.14em] text-slate-500">Queued next</span>
                  {onChainDefenseBacklog.map((queue, index) => (
                    <span className="truncate" key={`${queue.label}-${index}`}>{queue.label}</span>
                  ))}
                </div>
              ) : null}
            </QueuePanelContent>
          ) : (
            <EmptyQueue actionLabel="Defenses" onAction={() => onNavigate("defenses")}>
              No active defense production.
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Research queue */}
        <QueuePanel
          label="Research"
          tag={onChainQueues?.research?.active ? "Active" : undefined}
        >
          {onChainResearchQueue ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={`${onChainResearchQueue.label} Level ${onChainResearchQueue.targetLevel}`}
                remaining={formatDurationUntil(onChainResearchQueue.readyAt, now)}
                progress={activeResearchProgress}
                readyAt={onChainResearchQueue.readyAt}
                startedAt={onChainResearchQueue.startedAt}
                thumbnailSrc={onChainResearchAsset}
                color="bg-cyan-300"
                now={now}
              />
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          ) : onChainQueues?.research?.active ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={`${onChainQueues.research.kind === "research" ? "Research" : onChainQueues.research.kind} level ${onChainQueues.research.targetLevel}`}
                remaining={queueRemaining(onChainQueues.research.readyAt, now)}
                indeterminate
                thumbnailSrc={onChainResearchAsset}
                color="bg-cyan-300"
              />
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          ) : settledState.researchQueue ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={settledState.researchQueue.label}
                remaining={formatDurationUntil(settledState.researchQueue.readyAt, now)}
                progress={activeResearchProgress}
                readyAt={settledState.researchQueue.readyAt}
                startedAt={settledState.researchQueue.startedAt}
                thumbnailSrc={settledResearchAsset}
                color="bg-cyan-300"
                now={now}
              />
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          ) : (
            <QueuePanelContent>
              <EmptyQueue actionLabel="Research" onAction={() => onNavigate("research")}>
                No active research.
              </EmptyQueue>
              <OverviewResearchActionNotice actionState={researchAction} />
            </QueuePanelContent>
          )}
        </QueuePanel>

        {/* Shipyard queue */}
        <QueuePanel
          label="Shipyard"
          tag={onChainQueues?.ship?.active ? "Active" : undefined}
        >
          {onChainQueues?.ship?.active ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={onChainShipQueue.label}
                remaining={queueRemaining(onChainQueues.ship.readyAt, now)}
                progress={shipHasCanonicalTimeline ? 0 : undefined}
                readyAt={shipReadyAt}
                startedAt={shipHasCanonicalTimeline ? shipStartedAt : undefined}
                thumbnailSrc={onChainShipQueue.asset}
                color="bg-emerald-300"
                now={now}
              />
              {onChainShipBacklog.length > 0 ? (
                <div className="grid gap-1 border-t border-white/10 pt-2 text-xs text-slate-400">
                  <span className="font-semibold uppercase tracking-[0.14em] text-slate-500">Queued next</span>
                  {onChainShipBacklog.map((queue, index) => (
                    <span className="truncate" key={`${queue.label}-${index}`}>{queue.label}</span>
                  ))}
                </div>
              ) : null}
            </QueuePanelContent>
          ) : settledState.queue?.kind === "ship" ? (
            <QueuePanelContent>
              <QueueItemDisplay
                label={settledState.queue.label}
                remaining={formatDurationUntil(settledState.queue.readyAt, now)}
                progress={shipProgress}
                readyAt={settledState.queue.readyAt}
                startedAt={settledState.queue.startedAt}
                color="bg-emerald-300"
                now={now}
              />
            </QueuePanelContent>
          ) : (
            <EmptyQueue actionLabel="Shipyard" onAction={() => onNavigate("shipyard")}>
              No active ship production.
            </EmptyQueue>
          )}
        </QueuePanel>
      </div>

      {isWalletConnected && myPlanets.length > 0 ? (
        <MyPlanetsPanel
          commanderLabel={currentCommanderLabel?.trim() || "You"}
          myPlanets={myPlanets}
          onAction={onMyPlanetAction}
          onSelectPlanet={onSelectPlanet}
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
          onSelectAlliance={onSelectAlliance}
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
  onSelectPlanet,
  selectedPlanetId,
}: {
  commanderLabel: string;
  myPlanets: readonly OverviewMyPlanetActionGroup[];
  onAction: ((action: GalaxyAction, planet: ManagedPlanetResponse) => void) | undefined;
  onSelectPlanet: ((coords: Coordinates) => void) | undefined;
  selectedPlanetId: string | undefined;
}) {
  return (
    <section className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-3">
      <div>
        <h3 className="text-sm font-semibold text-white">My planets</h3>
      </div>
      <div className="grid gap-1.5">
        {myPlanets.map(({ actions, planet }) => {
          const coords = { galaxy: planet.galaxy, system: planet.system, position: planet.position };
          const rowPlanet = overviewPlanetFromManagedPlanet(planet);
          const isSelected = planet.planetId === selectedPlanetId;
          return (
            <WatchablePlanetRow
              allianceLabel="No alliance"
              commanderLabel={commanderLabel}
              coords={coords}
              current={isSelected}
              isHome={planet.isHomePlanet}
              key={planet.planetId}
              meta={myPlanetMeta(planet)}
              onInspect={onSelectPlanet ?? (() => undefined)}
              planet={rowPlanet}
              showIdentity={false}
              showMoonIndicator={false}
              actionSlot={(
                <MyPlanetActionButtons
                  actions={actions}
                  onAction={(action) => onAction?.(action, planet)}
                />
              )}
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
}: {
  actions: GalaxyAction[];
  onAction: (action: GalaxyAction) => void;
}) {
  return (
    <>
      {actions.map((action) => (
        <button
          className={`rounded border px-2 py-1 text-xs font-medium transition ${
            action.enabled
              ? "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
              : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
          }`}
          disabled={!action.enabled}
          key={action.kind}
          onClick={() => {
            if (action.enabled) onAction(action);
          }}
          title={action.enabled ? action.label : action.reason}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </>
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

function myPlanetMeta(planet: ManagedPlanetResponse): PlanetMetaItem[] {
  const meta: PlanetMetaItem[] = [
    { label: planet.coordinates },
    { label: formatGalaxyHeatLabel({ min: planet.temperature - 20, max: planet.temperature + 20 }) },
    { label: `${planet.fieldsUsed}/${planet.fieldsCapacity} fields` },
  ];
  if (planet.moon?.exists) meta.push({ label: "Moon", tone: "info" });
  return meta;
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
  onPageChange,
  onRefresh,
  onSelectAlliance,
  onSelectPlanet,
  onSelectPlayer,
  onToggleWatchPlanet,
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
  onPageChange: ((page: number) => void) | undefined;
  onRefresh: (() => void) | undefined;
  onSelectAlliance: ((allianceId: string) => void) | undefined;
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
              className="h-8 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
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
              className="h-8 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
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
              className="inline-flex h-8 items-center gap-1.5 rounded border border-amber-200/30 bg-amber-200/10 px-2 font-semibold text-amber-50 transition hover:bg-amber-200/20 disabled:cursor-not-allowed disabled:opacity-60"
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
          return (
            <WatchablePlanetRow
              allianceLabel={formatGalaxyAllianceIdentityLabel(planet.alliance)}
              commanderLabel={formatGalaxyCommanderLabel(planet)}
              coords={coords}
              key={planetId ?? planet.id}
              meta={watchedPlanetMeta(planet)}
              onInspect={onSelectPlanet ?? (() => undefined)}
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
  key: string;
  text: string;
  hostile: boolean;
};

export type FleetsSummaryData = {
  activeCount: number;
  lines: FleetSummaryLine[];
  underAttack: { count: number; soonestLabel: string } | null;
};

function missionEndpointLabel(
  ref: FleetMissionPlanetReference | null | undefined,
  fallbackPlanetId: string,
): string {
  if (ref) {
    const name = ref.name?.trim();
    return `${name && name.length > 0 ? name : "Planet"} [${ref.coordinates}]`;
  }
  const colonyTarget = decodeColonizationTargetId(fallbackPlanetId);
  if (colonyTarget) return `Uncharted [${colonyTarget.coordinates}]`;
  return `Planet #${fallbackPlanetId}`;
}

export function summarizeFleets(fleetVisibility: FleetMissionVisibilityResponse, now: number): FleetsSummaryData {
  const { incoming, outgoing, returning } = fleetVisibility;
  const activeCount = incoming.length + outgoing.length + returning.length;
  const lines: FleetSummaryLine[] = [];

  for (const mission of incoming) {
    const arrivalMs = timestampToMs(mission.arrivalAt);
    const timing = arrivalMs === undefined
      ? "ETA unknown"
      : arrivalMs > now ? `hits in ${formatDurationUntil(arrivalMs, now)}` : "arriving now";
    lines.push({
      hostile: true,
      key: `in-${mission.missionId}`,
      text: `${mission.missionType} from ${missionEndpointLabel(mission.originPlanet, mission.originPlanetId)} · ${timing}`,
    });
  }

  for (const mission of outgoing) {
    const arrivalMs = timestampToMs(mission.arrivalAt);
    const timing = arrivalMs === undefined
      ? "ETA unknown"
      // Lazy on-chain reconciliation (VEY-KANEO-468): once the arrival time passes, the mission is
      // settled lazily on the next mutating call (combat is resolved by the battle keeper), so until
      // the chain reflects it the honest state is "resolving", not a finished "arrived".
      : arrivalMs > now ? `arrives in ${formatDurationUntil(arrivalMs, now)}` : "resolving";
    lines.push({
      hostile: false,
      key: `out-${mission.missionId}`,
      text: `${mission.missionType} → ${missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId)} · ${timing}`,
    });
  }

  for (const mission of returning) {
    const returnMs = timestampToMs(mission.returnAt);
    const timing = returnMs === undefined
      ? "ETA unknown"
      // VEY-KANEO-468: a returned-by-time leg settles lazily on the next mutating call, so show
      // "resolving" until the chain lands it rather than a misleading "ready to land" (no manual land).
      : returnMs > now ? `lands in ${formatDurationUntil(returnMs, now)}` : "resolving";
    lines.push({
      hostile: false,
      key: `ret-${mission.missionId}`,
      text: `${mission.missionType} returning from ${missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId)} · ${timing}`,
    });
  }

  const hostileIncoming = incoming.filter((mission) => mission.missionType === "Attack");
  let underAttack: FleetsSummaryData["underAttack"] = null;
  if (hostileIncoming.length > 0) {
    const soonestMs = hostileIncoming
      .map((mission) => timestampToMs(mission.arrivalAt))
      .filter((ms): ms is number => ms !== undefined)
      .reduce((min, ms) => (ms < min ? ms : min), Number.POSITIVE_INFINITY);
    const soonestLabel = !Number.isFinite(soonestMs)
      ? "soon"
      : soonestMs > now ? `in ${formatDurationUntil(soonestMs, now)}` : "now";
    underAttack = { count: hostileIncoming.length, soonestLabel };
  }

  return { activeCount, lines, underAttack };
}

export function FleetsSummary({
  fleetVisibility,
  now,
  onOpenMissionControl,
}: {
  fleetVisibility: FleetMissionVisibilityResponse;
  now: number;
  onOpenMissionControl: () => void;
}) {
  const summary = summarizeFleets(fleetVisibility, now);
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

      {summary.underAttack ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/15 p-2.5 text-[11px] leading-5 text-red-100"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-red-300" size={14} strokeWidth={2} />
          <p className="min-w-0">
            <span className="font-semibold uppercase tracking-wide">Under attack</span>
            {` — ${summary.underAttack.count} hostile ${summary.underAttack.count === 1 ? "fleet" : "fleets"} inbound · soonest ${summary.underAttack.soonestLabel}`}
          </p>
        </div>
      ) : null}

      {summary.activeCount === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No fleets in flight.</p>
      ) : (
        <ul className="mt-3 grid gap-1.5">
          {summary.lines.map((line) => (
            <li
              key={line.key}
              className={`min-w-0 truncate rounded-md border px-2.5 py-1.5 text-[11px] ${
                line.hostile
                  ? "border-red-400/25 bg-red-500/10 text-red-100"
                  : "border-white/10 bg-black/20 text-slate-300"
              }`}
              title={line.text}
            >
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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
    <section
      aria-label="Planet effects"
      className="grid gap-3 rounded-md border border-cyan-300/20 bg-[#09111f]/95 p-3 text-xs leading-5 text-slate-200 shadow-lg shadow-black/20"
      id={id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100">Planet effects</p>
          <p className="mt-1 text-slate-300">
            Fields are the planet development budget: each building level consumes one field, and Terraformer expands the limit.
          </p>
          <p className="mt-1 text-slate-400">
            Temperature changes deuterium production and Solar Satellite energy output, so colder and hotter planets favor different builds.
          </p>
        </div>
        <button
          aria-label="Close planet effects"
          className="inline-grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      </div>

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
  tag,
  children,
}: {
  label: string;
  tag?: string | undefined;
  children: preact.ComponentChildren;
}) {
  return (
    <div className="flex min-h-[8.5rem] w-full min-w-0 flex-col rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        {tag && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{tag}</span>
        )}
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function QueuePanelContent({ children }: { children: preact.ComponentChildren }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">{children}</div>
  );
}

function QueueItemDisplay({
  label,
  remaining,
  progress,
  readyAt,
  indeterminate,
  color = "bg-signal",
  thumbnailSrc,
  now,
  startedAt,
}: {
  label: string;
  remaining: string;
  progress?: number | undefined;
  readyAt?: number | undefined;
  indeterminate?: boolean | undefined;
  color?: string;
  thumbnailSrc?: string | undefined;
  now?: number | undefined;
  startedAt?: number | undefined;
}) {
  const hasCanonicalTimeline =
    typeof readyAt === "number" && typeof startedAt === "number" && startedAt < readyAt;
  const shouldIndeterminate = indeterminate ?? (!hasCanonicalTimeline && progress === undefined);
  const progressBar = queueProgressBarState({
    indeterminate: shouldIndeterminate,
    progress,
    remaining,
  });
  const progressFill = queueProgressFillState({
    indeterminate: shouldIndeterminate,
    now: now ?? Date.now(),
    progress,
    readyAt,
    remaining,
    startedAt,
  });
  const progressStyle = { width: `${progressFill.progress * 100}%` };

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
          <p className={overviewQueueItemRemainingClassName}>{remaining}</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          {progressBar.indeterminate ? (
            <div className={`h-full w-2/3 rounded-full ${color} animate-pulse`} />
          ) : (
            <div
              className={`h-full rounded-full ${color} transition-[width]`}
              style={progressStyle}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function queueTimestampMs(timestamp: string | null | undefined): number | undefined {
  if (!timestamp) return undefined;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return undefined;
  return seconds * 1_000;
}

function EmptyQueue({
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
