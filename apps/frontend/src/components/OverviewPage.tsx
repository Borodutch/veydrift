import { queueProgress as queueProgressValue, researchCatalog, type MainQueueItem, type PlayableState, type Resources } from "../playableMvp";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ArrowRight, Check, Info, Pencil, Trash2, X } from "lucide-preact";
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
import { formatPlanetType } from "../data/mockUniverse";
import type { Planet } from "../types";
import {
  playerDisplayLabel,
  validatePlayerDisplayName,
  type FleetMissionVisibilityResponse,
  type PlanetSummary,
  type PlayerProfile,
  type PlayerQueuesResponse,
  type QueueStateResponse,
  type WalletSettlementResponse
} from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs, type TimestampInput } from "../timestampFormat";
import {
  actionNoticeForBuilding,
  buildingKeyForContractId,
  type InfrastructureActionNotice,
} from "../buildingActionNotice";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { InlineSyncIndicator } from "./VeydriftLoader";

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
  isBuildingActionPending?: boolean | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  isDefenseActionPending?: boolean | undefined;
  onFinishDefense?: (() => void) | undefined;
  isShipyardActionPending?: boolean | undefined;
  onFinishShipProduction?: (() => void) | undefined;
  isResearchActionPending?: boolean | undefined;
  onFinishResearch?: (() => void) | undefined;
  researchAction?: OverviewResearchActionState | undefined;
  onNavigate: (page: "infrastructure" | "defenses" | "research" | "shipyard") => void;
  onCounterplay?: ((missionId: string, mode: "acsDefend" | "intercept") => void) | undefined;
  onJoinAttack?: ((missionId: string, targetPlanetId: string) => void) | undefined;
  onRenamePlanet?: ((name: string) => void) | undefined;
  onUpdatePlayerDisplayName?: ((name: string) => void) | undefined;
  onResolveMission?: ((missionId: string) => void) | undefined;
  onChainError?: string | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
  onChainStatus: ChainLoadStatus;
  planetRenameAction?: PlanetRenameActionState | undefined;
  canRenamePlanet?: boolean | undefined;
  playerProfile?: PlayerProfile | undefined;
  playerProfileAction?: PlanetRenameActionState | undefined;
  canEditPlayerProfile?: boolean | undefined;
  planetManagementAction?: PlanetManagementActionState | undefined;
  canAbandonPlanet?: boolean | undefined;
  onAbandonPlanet?: (() => void) | undefined;
  usedFields?: number | undefined;
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
  isBuildingActionPending = false,
  isBuildingReadyToFinish,
  onFinishBuilding,
  isDefenseActionPending = false,
  onFinishDefense,
  isShipyardActionPending = false,
  onFinishShipProduction,
  isResearchActionPending = false,
  onFinishResearch,
  researchAction = { status: "idle" },
  onNavigate,
  onCounterplay,
  onJoinAttack,
  onRenamePlanet,
  onUpdatePlayerDisplayName,
  onResolveMission,
  onChainError,
  fleetVisibility,
  onChainSettlement,
  onChainQueues,
  onChainStatus,
  planetRenameAction = { status: "idle" },
  canRenamePlanet = false,
  playerProfile,
  playerProfileAction = { status: "idle" },
  canEditPlayerProfile = false,
  planetManagementAction = { status: "idle" },
  canAbandonPlanet = false,
  onAbandonPlanet,
  usedFields: selectedPlanetUsedFields,
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
  const defenseFinishAction = overviewDefenseFinishAction({
    actionPending: isDefenseActionPending,
    now,
    onFinishDefense,
    queue: onChainQueues?.defense,
  });
  const onChainShipQueue = shipQueuePreview(onChainQueues?.ship);
  const onChainShipBacklog = onChainQueues?.ship?.backlog
    ?.filter((queue) => queue.active)
    .map((queue) => shipQueuePreview(queue)) ?? [];
  const shipReadyAt = queueTimestampMs(onChainQueues?.ship?.readyAt);
  const shipStartedAt = queueTimestampMs(onChainQueues?.ship?.startedAt);
  const shipHasCanonicalTimeline =
    shipReadyAt !== undefined && shipStartedAt !== undefined && shipStartedAt < shipReadyAt;
  const shipyardFinishAction = overviewShipyardFinishAction({
    actionPending: isShipyardActionPending,
    chainStatus: onChainStatus,
    now,
    onFinishShipProduction,
    queue: onChainQueues?.ship,
  });
  const researchFinishAction = overviewResearchFinishAction({
    actionPending: isResearchActionPending,
    now,
    onFinishResearch,
    queue: onChainQueues?.research,
  });
  const buildingNoticeKey = buildingQueue?.key ?? buildingKeyForContractId(onChainQueues?.building?.itemId);
  const scopedBuildingNotice = overviewBuildingActionNoticeFor(buildingActionNotice, buildingNoticeKey);
  const buildingFinishAction = overviewBuildingFinishAction({
    actionUnavailableReason: scopedBuildingNotice?.tone === "error" ? scopedBuildingNotice.label : undefined,
    actionPending: isBuildingActionPending,
    actionPendingLabel: buildingActionPendingLabel,
    isBuildingReadyToFinish,
    now,
    onFinishBuilding,
    queue: onChainQueues?.building ?? buildingQueue,
  });
  const pendingBuildingNotice = buildingActionPendingLabel
    ? {
        buildingKey: buildingQueue?.key ?? buildingKeyForContractId(onChainQueues?.building?.itemId),
        label: buildingActionPendingLabel,
        tone: "pending" as const,
      }
    : undefined;
  const overviewBuildingNotice = overviewBuildingActionNoticeFor(
    scopedBuildingNotice ?? pendingBuildingNotice,
    buildingNoticeKey,
  );
  const overviewBuildingNoticeToRender = overviewBuildingNoticeForFinishAction(
    overviewBuildingNoticeForReadyFinishAction(overviewBuildingNotice, buildingFinishAction),
    buildingFinishAction,
  );

  const planetName = homePlanet?.name
    ?? (isWalletConnected && planet?.coordinates ? `Planet ${planet.coordinates}` : "Eos Relay");
  const [renameDraft, setRenameDraft] = useState(planetName);
  const [renamePanelOpen, setRenamePanelOpen] = useState(false);
  const [renameValidation, setRenameValidation] = useState<string | undefined>(undefined);
  const playerLabel = playerDisplayLabel(playerProfile, onChainSettlement?.wallet);
  const [playerDraft, setPlayerDraft] = useState(playerProfile?.displayName ?? "");
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
  const [playerValidation, setPlayerValidation] = useState<string | undefined>(undefined);
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

  const heroImage = overviewHeroImage(homePlanet, isWalletConnected, lastKnownHeroImage, currentPlanetKey);

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

  useEffect(() => {
    if (!playerPanelOpen) {
      setPlayerDraft(playerProfile?.displayName ?? "");
      setPlayerValidation(undefined);
    }
  }, [playerPanelOpen, playerProfile?.displayName]);

  useEffect(() => {
    if (playerProfileAction.status === "success") {
      setPlayerPanelOpen(false);
    }
  }, [playerProfileAction.status]);

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
  const playerProfileBusy = playerProfileAction.status === "pending";
  const playerStatusTone = playerProfileAction.status === "error"
    ? "text-amber-200"
    : playerProfileAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const playerStatusLabel = playerProfileAction.status === "idle" ? undefined : playerProfileAction.label;
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
  const handlePlayerSubmit = (event: Event) => {
    event.preventDefault();
    const nextName = playerDraft.trim().replace(/ {2,}/g, " ");
    const validation = validatePlayerDisplayName(nextName);
    if (validation) {
      setPlayerValidation(validation);
      return;
    }
    setPlayerValidation(undefined);
    onUpdatePlayerDisplayName?.(nextName);
  };

  return (
    <div className="grid gap-3">
      {isWalletConnected && (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Commander</p>
              <p className="mt-1 break-words text-base font-semibold text-white">{playerLabel}</p>
              {playerProfile?.displayName ? (
                <p className="mt-1 text-xs text-slate-500">{playerProfile.fallbackName}</p>
              ) : null}
              {playerStatusLabel && !playerPanelOpen ? (
                <p className={`mt-1 text-xs ${playerStatusTone}`}>{playerStatusLabel}</p>
              ) : null}
            </div>
            {onUpdatePlayerDisplayName ? (
              <button
                aria-expanded={playerPanelOpen}
                aria-label="Edit player display name"
                className="inline-flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={playerProfileBusy}
                onClick={() => {
                  setPlayerPanelOpen((open) => !open);
                  setPlayerDraft(playerProfile?.displayName ?? "");
                  setPlayerValidation(undefined);
                }}
                type="button"
              >
                <Pencil aria-hidden="true" size={12} strokeWidth={2} />
                Edit
              </button>
            ) : null}
          </div>
          {onUpdatePlayerDisplayName && playerPanelOpen ? (
            <form className="mt-3 grid gap-2 rounded border border-white/10 bg-black/30 p-3" onSubmit={handlePlayerSubmit}>
              <label className="grid gap-1 text-xs font-medium text-slate-200">
                Display name
                <input
                  className="h-9 rounded border border-white/10 bg-[#080d18]/95 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
                  disabled={playerProfileBusy}
                  maxLength={32}
                  onInput={(event) => {
                    setPlayerDraft(event.currentTarget.value);
                    setPlayerValidation(undefined);
                  }}
                  placeholder="Enter display name"
                  value={playerDraft}
                />
              </label>
              <p className="text-[11px] leading-4 text-slate-300">
                Your wallet signs a free ownership proof; no transaction or gas is required.
              </p>
              {(playerValidation || playerStatusLabel) && (
                <p className={`text-xs ${playerValidation ? "text-amber-200" : playerStatusTone}`}>
                  {playerValidation ?? playerStatusLabel}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="inline-flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                  disabled={playerProfileBusy}
                  onClick={() => setPlayerPanelOpen(false)}
                  type="button"
                >
                  <X aria-hidden="true" size={13} strokeWidth={2} />
                  Cancel
                </button>
                <button
                  className="inline-flex h-8 items-center gap-1 rounded border border-cyan-300/40 bg-cyan-300/10 px-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                  disabled={!canEditPlayerProfile || playerProfileBusy}
                  type="submit"
                >
                  <Check aria-hidden="true" size={13} strokeWidth={2} />
                  {playerProfileBusy ? "Signing" : "Save name"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      )}

      {/* Planet hero — compact, no wasted space */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className={`relative ${renamePanelOpen ? "min-h-56" : "h-28 sm:h-32"}`}>
          {(!heroImage || !heroImageLoaded) && (
            <PlanetImageSkeleton className="absolute inset-0" />
          )}
          {heroImage ? (
            <OptimizedImage
              key={heroImage}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${heroImageLoaded ? "opacity-100" : "opacity-0"}`}
              imageRef={heroImageRef}
              loading="eager"
              onLoad={(event) => {
                if (isImageReady(event.currentTarget)) setHeroImageLoaded(true);
              }}
              sizes="hero"
              src={heroImage}
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.35),rgba(7,9,19,0.92))]" />
          <div className={`relative flex ${renamePanelOpen ? "min-h-56" : "h-full"} flex-col justify-end p-3 sm:p-4`}>
            <p className="text-[11px] font-medium text-slate-400">{planetSubhead}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 min-w-0 break-words text-base font-semibold text-white">
                {planetName}
              </h2>
              <div className="flex shrink-0 items-center gap-1.5">
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
            {canShowRename && renamePanelOpen && (
              <form
                className="mt-3 grid gap-2 rounded border border-white/10 bg-black/45 p-3 backdrop-blur"
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
        </div>

        {/* Stats strip — compact, never overflows */}
        <div className="grid gap-3 border-t border-white/10 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Planet stats</p>
            <button
              aria-controls="overview-planet-effects"
              aria-expanded={effectsPanelOpen}
              aria-label="Show planet effects"
              className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
              onClick={() => setEffectsPanelOpen((open) => !open)}
              title="Planet effects"
              type="button"
            >
              <Info aria-hidden="true" size={15} strokeWidth={2} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPip label="Fields" value={stats.fields} />
            <StatPip label="Temperature" value={stats.temperature} />
            <StatPip label="Diameter" value={stats.diameter} />
            <StatPip label="Status" value={stats.status} />
          </div>
          {effectsPanelOpen ? (
            <PlanetEffectsPanel
              effects={planetEffects}
              id="overview-planet-effects"
              onClose={() => setEffectsPanelOpen(false)}
            />
          ) : null}
        </div>
      </div>

      {isWalletConnected && onChainStatus === "error" && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 sm:p-4">
          Planet data is unavailable right now. Overview stats and resources are hidden until the game API responds with live values.
          {onChainError ? <span className="block truncate text-amber-200/70">{onChainError}</span> : null}
        </div>
      )}

      {isWalletConnected && fleetVisibility && (
        <div className="grid gap-3 lg:grid-cols-4">
          <MissionPanel
            label="Incoming"
            tone="danger"
            missions={fleetVisibility.incoming}
            now={now}
            onCounterplay={onCounterplay}
            onResolveMission={onResolveMission}
          />
          <MissionPanel label="Returning" tone="warning" missions={fleetVisibility.returning} now={now} onResolveMission={onResolveMission} />
          <MissionPanel label="Outbound" tone="neutral" missions={fleetVisibility.outgoing} now={now} onResolveMission={onResolveMission} />
          <MissionPanel
            label="Joinable"
            tone="neutral"
            missions={fleetVisibility.joinableAttacks}
            now={now}
            onJoinAttack={onJoinAttack}
            onResolveMission={onResolveMission}
          />
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
              <OverviewBuildingFinishButton
                action={buildingFinishAction}
              />
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
              <OverviewBuildingFinishButton
                action={buildingFinishAction}
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
              <OverviewDefenseFinishButton action={defenseFinishAction} />
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
              <OverviewResearchFinishButton action={researchFinishAction} />
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
              <OverviewResearchFinishButton action={researchFinishAction} />
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
              <OverviewShipyardFinishButton action={shipyardFinishAction} />
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

      {/* Resource values live in the persistent top bar; keep Overview focused on planet state and actions. */}
      {isWalletConnected && onChainStatus === "loading" && (
        <InlineSyncIndicator label="Refreshing resources" />
      )}

    </div>
  );
}

export function shouldShowOverviewBuildingFinishAction({
  isBuildingReadyToFinish,
  now = Date.now(),
  onFinishBuilding,
  queue,
}: {
  isBuildingReadyToFinish?: boolean | undefined;
  now?: number | undefined;
  onFinishBuilding?: (() => void) | undefined;
  queue?: OverviewBuildingFinishQueue | null | undefined;
}): boolean {
  if (!onFinishBuilding) return false;
  if (isBuildingReadyToFinish !== undefined) return isBuildingReadyToFinish;

  const readyAt = timestampToMs(queue?.readyAt);
  const active = queue && ("active" in queue ? queue.active : true);
  return Boolean(active && readyAt !== undefined && readyAt <= now);
}

type OverviewBuildingFinishQueue =
  | Pick<QueueStateResponse, "active" | "readyAt">
  | { readyAt: TimestampInput };

export function overviewBuildingFinishAction({
  actionUnavailableReason,
  actionPending,
  actionPendingLabel,
  isBuildingReadyToFinish,
  now = Date.now(),
  onFinishBuilding,
  queue,
}: {
  actionUnavailableReason?: string | undefined;
  actionPending?: boolean | undefined;
  actionPendingLabel?: string | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  now?: number | undefined;
  onFinishBuilding?: (() => void) | undefined;
  queue?: OverviewBuildingFinishQueue | null | undefined;
}): {
  disabled: boolean;
  label: string;
  onFinish?: (() => void) | undefined;
  reason?: string | undefined;
  reasonTone: InfrastructureActionNotice["tone"];
  visible: boolean;
} {
  const ready = shouldShowOverviewBuildingFinishAction({
    isBuildingReadyToFinish,
    now,
    onFinishBuilding,
    queue,
  });
  const visible = Boolean(queue && onFinishBuilding && (actionPending || ready));
  const reason = actionPending
    ? actionPendingLabel ?? "Building transaction is already in progress."
    : actionUnavailableReason;

  return {
    disabled: Boolean(reason),
    label: actionPending ? "Completing building" : "Complete building",
    onFinish: visible && !reason ? onFinishBuilding : undefined,
    reason,
    reasonTone: actionPending ? "pending" : "error",
    visible,
  };
}

export function overviewBuildingActionNoticeFor(
  actionNotice: InfrastructureActionNotice | undefined,
  buildingKey: BuildingQueueItem["key"] | undefined,
): InfrastructureActionNotice | undefined {
  if (!buildingKey) return actionNotice;
  return actionNoticeForBuilding(actionNotice, buildingKey);
}

export function overviewBuildingNoticeForFinishAction(
  notice: InfrastructureActionNotice | undefined,
  action: Pick<ReturnType<typeof overviewBuildingFinishAction>, "reason" | "reasonTone" | "visible">,
): InfrastructureActionNotice | undefined {
  if (notice || !action.visible || !action.reason) return notice;

  return {
    label: action.reason,
    tone: action.reasonTone,
  };
}

export function overviewBuildingNoticeForReadyFinishAction(
  notice: InfrastructureActionNotice | undefined,
  action: Pick<ReturnType<typeof overviewBuildingFinishAction>, "reason" | "visible">,
): InfrastructureActionNotice | undefined {
  if (action.visible && !action.reason && notice?.tone === "success") return undefined;
  return notice;
}

export function overviewDefenseFinishAction({
  actionPending,
  now,
  onFinishDefense,
  queue,
}: {
  actionPending?: boolean | undefined;
  now: number;
  onFinishDefense?: (() => void) | undefined;
  queue?: PlayerQueuesResponse["defense"] | undefined;
}): {
  disabled: boolean;
  onFinish?: (() => void) | undefined;
  visible: boolean;
} {
  const ready = Boolean(queue?.active && queue.readyAt && Number(queue.readyAt) * 1_000 <= now);
  const visible = Boolean(ready && onFinishDefense);
  return {
    disabled: Boolean(actionPending),
    onFinish: visible && !actionPending ? onFinishDefense : undefined,
    visible,
  };
}

export function overviewShipyardFinishAction({
  actionPending,
  chainStatus = "ready",
  now,
  onFinishShipProduction,
  queue,
}: {
  actionPending?: boolean | undefined;
  chainStatus?: ChainLoadStatus | undefined;
  now: number;
  onFinishShipProduction?: (() => void) | undefined;
  queue?: PlayerQueuesResponse["ship"] | undefined;
}): {
  disabled: boolean;
  onFinish?: (() => void) | undefined;
  reason?: string | undefined;
  visible: boolean;
} {
  const ready = Boolean(queue?.active && queue.readyAt && Number(queue.readyAt) * 1_000 <= now);
  const visible = Boolean(ready && onFinishShipProduction);
  const reason = visible && chainStatus !== "ready"
    ? "Shipyard state is syncing. Refresh and retry once backend state is ready."
    : undefined;
  const disabled = Boolean(actionPending || reason);
  return {
    disabled,
    onFinish: visible && !disabled ? onFinishShipProduction : undefined,
    reason,
    visible,
  };
}

export function isOverviewResearchReadyToFinish(
  queue: PlayerQueuesResponse["research"] | undefined,
  now: number,
): boolean {
  return Boolean(queue?.active && queue.readyAt && Number(queue.readyAt) * 1_000 <= now);
}

export function overviewResearchFinishAction({
  actionPending,
  now,
  onFinishResearch,
  queue,
}: {
  actionPending?: boolean | undefined;
  now: number;
  onFinishResearch?: (() => void) | undefined;
  queue?: PlayerQueuesResponse["research"] | undefined;
}): {
  disabled: boolean;
  onFinish?: (() => void) | undefined;
  visible: boolean;
} {
  const visible = Boolean(isOverviewResearchReadyToFinish(queue, now) && onFinishResearch);
  return {
    disabled: Boolean(actionPending),
    onFinish: visible && !actionPending ? onFinishResearch : undefined,
    visible,
  };
}

function OverviewBuildingFinishButton({
  action,
}: {
  action: ReturnType<typeof overviewBuildingFinishAction>;
}) {
  if (!action.visible) return null;

  return (
    <button
      aria-label={action.reason ?? "Finish building upgrade"}
      className="mt-auto flex min-h-9 w-full min-w-0 items-center justify-center whitespace-normal break-words rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-center text-xs font-semibold leading-4 text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={action.disabled}
      onClick={action.onFinish}
      title={action.reason ?? "Finish building upgrade"}
      type="button"
    >
      <span className="block min-w-0 max-w-full whitespace-normal break-words">
        {action.label}
      </span>
    </button>
  );
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
    <div className={`rounded-md border px-3 py-2 text-xs leading-5 break-words ${className}`} role={role}>
      {notice.label}
    </div>
  );
}

function OverviewDefenseFinishButton({
  action,
}: {
  action: ReturnType<typeof overviewDefenseFinishAction>;
}) {
  if (!action.visible) return null;

  return (
    <button
      className="mt-auto flex h-9 w-full items-center justify-center rounded-md border border-rose-300/40 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={action.disabled}
      onClick={action.onFinish}
      type="button"
    >
      Complete queue
    </button>
  );
}

function OverviewShipyardFinishButton({
  action,
}: {
  action: ReturnType<typeof overviewShipyardFinishAction>;
}) {
  if (!action.visible) return null;

  return (
    <button
      aria-label={action.reason ?? "Complete Shipyard queue"}
      className="mt-auto flex h-9 w-full items-center justify-center rounded-md border border-emerald-300/40 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={action.disabled}
      onClick={action.onFinish}
      title={action.reason ?? "Complete Shipyard queue"}
      type="button"
    >
      Complete queue
    </button>
  );
}

function OverviewResearchFinishButton({
  action,
}: {
  action: ReturnType<typeof overviewResearchFinishAction>;
}) {
  if (!action.visible) return null;

  return (
    <button
      className="mt-auto flex h-9 w-full items-center justify-center rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={action.disabled}
      onClick={action.onFinish}
      type="button"
    >
      Complete research
    </button>
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

export function overviewResearchActionNoticeFor(
  actionState: OverviewResearchActionState,
): { label: string; tone: "error" | "pending" } | undefined {
  if (actionState.status === "idle" || actionState.status === "success") return undefined;
  return {
    label: actionState.label,
    tone: actionState.status === "error" ? "error" : "pending",
  };
}

type MissionList = FleetMissionVisibilityResponse["incoming"];

function MissionPanel({
  label,
  missions,
  now,
  onCounterplay,
  onJoinAttack,
  onResolveMission,
  tone,
}: {
  label: string;
  missions: MissionList;
  now: number;
  onCounterplay?: ((missionId: string, mode: "acsDefend" | "intercept") => void) | undefined;
  onJoinAttack?: ((missionId: string, targetPlanetId: string) => void) | undefined;
  onResolveMission?: ((missionId: string) => void) | undefined;
  tone: "danger" | "neutral" | "warning";
}) {
  const border = tone === "danger"
    ? "border-red-300/25 bg-red-400/10"
    : tone === "warning"
      ? "border-amber-300/25 bg-amber-300/10"
      : "border-white/10 bg-white/[0.04]";
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${border}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">{label}</h3>
        <span className="text-xs tabular-nums text-slate-400">{missions.length}</span>
      </div>
      {missions.length === 0 ? (
        <p className="text-xs text-slate-500">No visible missions.</p>
      ) : (
        <div className="grid gap-2">
          {missions.slice(0, 3).map((mission) => (
            <div key={mission.missionId} className="min-w-0 rounded-md border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-200">{mission.missionType} #{mission.missionId}</span>
                <span className="text-slate-400">{mission.status}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                {mission.originPlanetId} {"->"} {mission.targetPlanetId}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Arrival {formatMissionSnapshotTime(mission.arrivalAt, now)} · Return {formatMissionSnapshotTime(mission.returnAt, now)}
              </p>
              {mission.attackGroupId ? (
                <p className="mt-1 text-[11px] text-cyan-100/70">
                  Group #{mission.attackGroupId}
                  {mission.joinedAttackMissionIds.length > 0 ? ` · ${mission.joinedAttackMissionIds.length} joined` : ""}
                </p>
              ) : null}
              {onCounterplay && mission.status === "Outbound" && mission.missionType === "Attack" ? (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button
                    className="rounded border border-cyan-200/20 bg-cyan-300/10 px-2 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-300/15"
                    onClick={() => onCounterplay(mission.missionId, "acsDefend")}
                    type="button"
                  >
                    Group defend
                  </button>
                  <button
                    className="rounded border border-amber-200/20 bg-amber-300/10 px-2 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-300/15"
                    onClick={() => onCounterplay(mission.missionId, "intercept")}
                    type="button"
                  >
                    Intercept
                  </button>
                </div>
              ) : null}
              {onJoinAttack && mission.status === "Outbound" && mission.missionType === "Attack" ? (
                <button
                  className="mt-2 w-full rounded border border-cyan-200/20 bg-cyan-300/10 px-2 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-300/15"
                  onClick={() => onJoinAttack(mission.missionId, mission.targetPlanetId)}
                  type="button"
                >
                  Join attack
                </button>
              ) : null}
              {onResolveMission && mission.needsResolution ? (
                <button
                  className="mt-2 w-full rounded border border-lime-200/25 bg-lime-300/10 px-2 py-1 text-[11px] font-medium text-lime-100 hover:bg-lime-300/15"
                  onClick={() => onResolveMission(mission.missionId)}
                  type="button"
                >
                  Resolve now
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function planetKeyFromCoordinates(coordinates: { galaxy: number; system: number; position: number }): string {
  return `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`;
}

function StatPip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-semibold leading-tight text-white">{value}</dd>
    </div>
  );
}

function PlanetEffectsPanel({
  effects,
  id,
  onClose,
}: {
  effects: OverviewPlanetEffectsDisplay;
  id: string;
  onClose: () => void;
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
          <p className="mt-1 text-slate-400">
            Fields limit construction slots. Temperature changes implemented production math for deuterium and Solar Satellite energy.
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

      <dl className="grid gap-2 sm:grid-cols-2">
        <EffectMetric label="Fields used" value={effects.fields} />
        <EffectMetric
          label="Fields available"
          value={effects.availableFields === undefined ? "Unavailable" : effects.availableFields.toLocaleString()}
        />
        <EffectMetric label="Terraformer" value={effects.terraformer} />
        <EffectMetric label="Field pressure" value={effects.fieldPressurePercent === undefined ? "Unavailable" : `${Math.round(effects.fieldPressurePercent)}%`} />
        <EffectMetric label="Temperature" value={effects.temperature} />
        <EffectMetric label="Deuterium multiplier" value={effects.deuteriumMultiplier} />
        <EffectMetric
          label="Deuterium output"
          value={effects.liveDeuteriumPerHour === undefined ? "Unavailable" : `${effects.liveDeuteriumPerHour.toLocaleString()}/h`}
        />
        <EffectMetric
          label="Deuterium capacity"
          value={effects.deuteriumCapacityPerHour === undefined ? "Unavailable" : `${effects.deuteriumCapacityPerHour.toLocaleString()}/h before power`}
        />
        <EffectMetric label="Mine power" value={effects.minePower} />
        <EffectMetric
          label="Solar Satellite"
          value={effects.solarSatelliteEnergy === undefined ? "Unavailable" : `${effects.solarSatelliteEnergy.toLocaleString()} energy each`}
        />
      </dl>
    </section>
  );
}

function EffectMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-semibold text-slate-100">{value}</dd>
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

function formatMissionSnapshotTime(value: string, now: number): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  return `${formatDurationUntil(timestamp, now)} (${formatUserTimestamp(timestamp)})`;
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
