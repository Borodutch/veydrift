import { queueProgress as queueProgressValue, researchCatalog, type MainQueueItem, type PlayableState, type Resources } from "../playableMvp";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Check, Pencil, Trash2, X } from "lucide-preact";
import { researchQueueForDisplay } from "../chainState";
import {
  buildingQueueAsset,
  buildingQueueLabel,
  buildingQueuePreview,
  defenseQueuePreview,
  displayPlanetStats,
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
  queueProgressBarState,
  queueProgressFillState,
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
  type WalletSettlementResponse
} from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
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
  isBuildingActionPending?: boolean | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  isDefenseActionPending?: boolean | undefined;
  onFinishDefense?: (() => void) | undefined;
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
  isBuildingActionPending = false,
  isBuildingReadyToFinish,
  onFinishBuilding,
  isDefenseActionPending = false,
  onFinishDefense,
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
  const defenseReadyAt = queueTimestampMs(onChainQueues?.defense?.readyAt);
  const defenseStartedAt = queueTimestampMs(onChainQueues?.defense?.startedAt);
  const defenseHasCanonicalTimeline =
    defenseReadyAt !== undefined && defenseStartedAt !== undefined && defenseStartedAt < defenseReadyAt;
  const defenseFinishAction = overviewDefenseFinishAction({
    actionPending: isDefenseActionPending,
    now,
    onFinishDefense,
    queue: onChainQueues?.defense,
  });
  const researchFinishAction = overviewResearchFinishAction({
    actionPending: isResearchActionPending,
    now,
    onFinishResearch,
    queue: onChainQueues?.research,
  });
  const showBuildingFinishAction = shouldShowOverviewBuildingFinishAction({
    isBuildingReadyToFinish,
    onFinishBuilding,
  });
  const overviewBuildingNotice = overviewBuildingActionNoticeFor(
    buildingActionNotice,
    buildingQueue?.key ?? buildingKeyForContractId(onChainQueues?.building?.itemId),
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
              <h2 className="min-w-0 break-words text-base font-semibold text-white">
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
        <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-3 sm:grid-cols-4 sm:p-4">
          <StatPip label="Fields" value={stats.fields} />
          <StatPip label="Temperature" value={stats.temperature} />
          <StatPip label="Diameter" value={stats.diameter} />
          <StatPip label="Status" value={stats.status} />
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
            <div className="grid gap-2">
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
                disabled={isBuildingActionPending}
                onFinishBuilding={showBuildingFinishAction ? onFinishBuilding : undefined}
              />
              <OverviewBuildingActionNotice notice={overviewBuildingNotice} />
            </div>
          ) : buildingQueue ? (
            <div className="grid gap-2">
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
                disabled={isBuildingActionPending}
                onFinishBuilding={showBuildingFinishAction ? onFinishBuilding : undefined}
              />
              <OverviewBuildingActionNotice notice={overviewBuildingNotice} />
            </div>
          ) : (
            <EmptyQueue action={<QuickLink onClick={() => onNavigate("infrastructure")}>Build</QuickLink>}>
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
            <div className="grid gap-2">
              <QueueItemDisplay
                label={onChainDefenseQueue.label}
                remaining={queueRemaining(onChainQueues.defense.readyAt, now)}
                progress={defenseHasCanonicalTimeline ? 0 : undefined}
                readyAt={defenseReadyAt}
                startedAt={defenseHasCanonicalTimeline ? defenseStartedAt : undefined}
                thumbnailSrc={onChainDefenseQueue.asset}
                color="bg-rose-300"
                now={now}
              />
              <OverviewDefenseFinishButton action={defenseFinishAction} />
            </div>
          ) : (
            <EmptyQueue action={<QuickLink onClick={() => onNavigate("defenses")}>Defenses</QuickLink>}>
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
            <div className="grid gap-2">
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
            </div>
          ) : onChainQueues?.research?.active ? (
            <div className="grid gap-2">
              <QueueItemDisplay
                label={`${onChainQueues.research.kind === "research" ? "Research" : onChainQueues.research.kind} level ${onChainQueues.research.targetLevel}`}
                remaining={queueRemaining(onChainQueues.research.readyAt, now)}
                indeterminate
                thumbnailSrc={onChainResearchAsset}
                color="bg-cyan-300"
              />
              <OverviewResearchFinishButton action={researchFinishAction} />
              <OverviewResearchActionNotice actionState={researchAction} />
            </div>
          ) : settledState.researchQueue ? (
            <div className="grid gap-2">
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
            </div>
          ) : (
            <div className="grid gap-2">
              <EmptyQueue action={<QuickLink onClick={() => onNavigate("research")}>Research</QuickLink>}>
                No active research.
              </EmptyQueue>
              <OverviewResearchActionNotice actionState={researchAction} />
            </div>
          )}
        </QueuePanel>

        {/* Shipyard queue */}
        <QueuePanel
          label="Shipyard"
          tag={onChainQueues?.ship?.active ? "Active" : undefined}
        >
          {onChainQueues?.ship?.active ? (
            <QueueItemDisplay
              label={`${onChainQueues.ship.kind === "ship" ? "Ship" : onChainQueues.ship.kind}${onChainQueues.ship.quantity ? ` ×${onChainQueues.ship.quantity}` : ""}`}
              remaining={queueRemaining(onChainQueues.ship.readyAt, now)}
              indeterminate
              color="bg-emerald-300"
            />
          ) : settledState.queue?.kind === "ship" ? (
            <QueueItemDisplay
              label={settledState.queue.label}
              remaining={formatDurationUntil(settledState.queue.readyAt, now)}
              progress={shipProgress}
              readyAt={settledState.queue.readyAt}
              startedAt={settledState.queue.startedAt}
              color="bg-emerald-300"
              now={now}
            />
          ) : (
            <EmptyQueue action={<QuickLink onClick={() => onNavigate("shipyard")}>Shipyard</QuickLink>}>
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
  onFinishBuilding,
}: {
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
}): boolean {
  return Boolean(isBuildingReadyToFinish && onFinishBuilding);
}

export function overviewBuildingActionNoticeFor(
  actionNotice: InfrastructureActionNotice | undefined,
  buildingKey: BuildingQueueItem["key"] | undefined,
): InfrastructureActionNotice | undefined {
  if (!buildingKey) return actionNotice;
  return actionNoticeForBuilding(actionNotice, buildingKey);
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
  disabled = false,
  onFinishBuilding,
}: {
  disabled?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
}) {
  if (!onFinishBuilding) return null;

  return (
    <button
      className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={disabled}
      onClick={onFinishBuilding}
      type="button"
    >
      Finish upgrade
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
    : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  const role = notice.tone === "error" ? "alert" : "status";

  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-5 ${className}`} role={role}>
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
      className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-rose-300/40 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
      disabled={action.disabled}
      onClick={action.onFinish}
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
      className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
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
                    ACS defend
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
    <div className="flex min-h-32 w-full min-w-0 max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-white/10 bg-[#101624] p-3 sm:max-w-none sm:p-4">
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
  const progressBar = queueProgressBarState({ indeterminate, progress, remaining });
  const progressFill = queueProgressFillState({
    indeterminate,
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
  action,
  children,
}: {
  action: preact.ComponentChildren;
  children: preact.ComponentChildren;
}) {
  return (
    <div className="flex min-h-20 flex-1 flex-col justify-between gap-3 text-xs leading-5 text-slate-400">
      <p className="mb-0">{children}</p>
      {action}
    </div>
  );
}

function QuickLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      className="flex h-9 w-full items-center justify-center rounded-md border border-white/15 bg-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-white/20 hover:text-white"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
