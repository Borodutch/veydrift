import type { MainQueueItem, PlayableState, Resources } from "../playableMvp";
import { useEffect, useState } from "preact/hooks";
import {
  buildingQueueAsset,
  buildingQueueLabel,
  buildingQueuePreview,
  displayPlanetStats,
  queueProgressBarState,
  queueProgressFillState,
  type ChainLoadStatus,
} from "../overviewData";
import { overviewHeroImage } from "../overviewHeroImage";
import { formatPlanetType } from "../data/mockUniverse";
import type { Planet } from "../types";
import type { FleetMissionVisibilityResponse, PlanetSummary, PlayerQueuesResponse, WalletSettlementResponse } from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";

function queueRemaining(readyAt: string | null, now: number): string {
  if (!readyAt) return "Pending";
  return formatDurationUntil(Number(readyAt) * 1_000, now);
}

type BuildingQueueItem = Extract<MainQueueItem, { kind: "building" }>;

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
  onFinishBuilding?: (() => void) | undefined;
  onNavigate: (page: "infrastructure" | "defenses" | "research" | "shipyard") => void;
  onChainError?: string | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
  onChainStatus: ChainLoadStatus;
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
  onFinishBuilding,
  onNavigate,
  onChainError,
  fleetVisibility,
  onChainSettlement,
  onChainQueues,
  onChainStatus,
}: OverviewPageProps) {
  const usedFields = Object.values(settledState.buildings).filter((level) => level > 0).length;
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

  const planetName = homePlanet?.name
    ?? (isWalletConnected && planet?.coordinates ? `Planet ${planet.coordinates}` : "Eos Relay");
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

  useEffect(() => {
    if (homePlanet?.image && currentPlanetKey) {
      setLastKnownHeroImage({ image: homePlanet.image, planetKey: currentPlanetKey });
    }
  }, [currentPlanetKey, homePlanet?.image]);

  const heroImage = overviewHeroImage(homePlanet, isWalletConnected, lastKnownHeroImage, currentPlanetKey);

  useEffect(() => {
    setHeroImageLoaded(false);
  }, [heroImage]);

  return (
    <div className="grid gap-3">
      {/* Planet hero — compact, no wasted space */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className="relative h-24 sm:h-28">
          {(!heroImage || !heroImageLoaded) && (
            <PlanetImageSkeleton className="absolute inset-0" />
          )}
          {heroImage ? (
            <OptimizedImage
              key={heroImage}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${heroImageLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setHeroImageLoaded(true)}
              sizes="hero"
              src={heroImage}
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.35),rgba(7,9,19,0.92))]" />
          <div className="relative flex h-full flex-col justify-end p-3 sm:p-4">
            <p className="text-[11px] font-medium text-slate-400">{planetSubhead}</p>
            <h2 className="text-base font-semibold text-white">
              {planetName}
            </h2>
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
        <div className="grid gap-3 lg:grid-cols-3">
          <MissionPanel label="Incoming" tone="danger" missions={fleetVisibility.incoming} now={now} />
          <MissionPanel label="Returning" tone="warning" missions={fleetVisibility.returning} now={now} />
          <MissionPanel label="Outbound" tone="neutral" missions={fleetVisibility.outgoing} now={now} />
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
              {queueRemaining(onChainQueues.building.readyAt, now) === "Ready" && onFinishBuilding && (
                <button
                  className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onFinishBuilding}
                  type="button"
                >
                  Finish upgrade
                </button>
              )}
            </div>
          ) : buildingQueue ? (
            <QueueItemDisplay
              label={localBuildingLabel ?? buildingQueue.label}
              remaining={formatDurationUntil(buildingQueue.readyAt, now)}
              progress={queueProgress}
              readyAt={buildingQueue.readyAt}
              startedAt={buildingQueue.startedAt}
              thumbnailSrc={localBuildingAsset}
              now={now}
            />
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
            <QueueItemDisplay
              label={`${onChainQueues.defense.kind === "defense" ? "Defense" : onChainQueues.defense.kind}${onChainQueues.defense.quantity ? ` ×${onChainQueues.defense.quantity}` : ""}`}
              remaining={queueRemaining(onChainQueues.defense.readyAt, now)}
              indeterminate
              color="bg-rose-300"
            />
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
          {onChainQueues?.research?.active ? (
            <QueueItemDisplay
              label={`${onChainQueues.research.kind === "research" ? "Research" : onChainQueues.research.kind} level ${onChainQueues.research.targetLevel}`}
              remaining={queueRemaining(onChainQueues.research.readyAt, now)}
              indeterminate
              color="bg-cyan-300"
            />
          ) : settledState.researchQueue ? (
            <QueueItemDisplay
              label={settledState.researchQueue.label}
              remaining={formatDurationUntil(settledState.researchQueue.readyAt, now)}
              progress={researchProgress}
              readyAt={settledState.researchQueue.readyAt}
              startedAt={settledState.researchQueue.startedAt}
              color="bg-cyan-300"
              now={now}
            />
          ) : (
            <EmptyQueue action={<QuickLink onClick={() => onNavigate("research")}>Research</QuickLink>}>
              No active research.
            </EmptyQueue>
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
        <div className="rounded-lg border border-white/10 bg-[#101624] p-3 text-sm text-slate-400 sm:p-4">
          Loading wallet resources...
        </div>
      )}

    </div>
  );
}

type MissionList = FleetMissionVisibilityResponse["incoming"];

function MissionPanel({
  label,
  missions,
  now,
  tone,
}: {
  label: string;
  missions: MissionList;
  now: number;
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
                Arrival {formatDurationUntil(Number(mission.arrivalAt) * 1_000, now)} · Return {formatDurationUntil(Number(mission.returnAt) * 1_000, now)}
              </p>
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
  progress?: number;
  readyAt?: number | undefined;
  indeterminate?: boolean;
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
  const progressStyle = progressFill.animated
    ? {
      animationDelay: `-${progressFill.elapsedMs}ms`,
      animationDuration: `${progressFill.durationMs}ms`,
      animationFillMode: "both",
      animationName: "queue-progress-fill",
      animationTimingFunction: "linear",
      transformOrigin: "left",
      width: "100%",
    }
    : { width: `${progressFill.progress * 100}%` };

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
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-semibold text-white">{label}</p>
          <p className="shrink-0 text-[10px] text-slate-400">{remaining}</p>
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
