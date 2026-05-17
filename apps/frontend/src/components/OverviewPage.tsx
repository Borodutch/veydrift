import type { PlayableState, Resources } from "../playableMvp";
import {
  displayPlanetStats,
  type ChainLoadStatus,
} from "../overviewData";
import { formatPlanetType } from "../data/mockUniverse";
import type { Planet } from "../types";
import type { PlanetSummary, PlayerQueuesResponse, WalletSettlementResponse } from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { OptimizedImage } from "./OptimizedImage";

function queueRemaining(readyAt: string | null, now: number): string {
  if (!readyAt) return "Pending";
  return formatDurationUntil(Number(readyAt) * 1_000, now);
}

interface OverviewPageProps {
  state: PlayableState;
  settledState: PlayableState;
  rates: Resources;
  caps: Resources;
  queueProgress: number;
  researchProgress: number;
  shipProgress: number;
  now: number;
  planet?: PlanetSummary | undefined;
  homePlanet?: Planet | undefined;
  isWalletConnected: boolean;
  onFinishBuilding?: (() => void) | undefined;
  onNavigate: (page: "infrastructure" | "defenses" | "research" | "shipyard") => void;
  onChainError?: string | undefined;
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
  planet,
  homePlanet,
  isWalletConnected,
  onFinishBuilding,
  onNavigate,
  onChainError,
  onChainSettlement,
  onChainQueues,
  onChainStatus,
}: OverviewPageProps) {
  const usedFields = Object.values(settledState.buildings).filter((level) => level > 0).length;
  const stats = displayPlanetStats(onChainSettlement, onChainQueues, usedFields, isWalletConnected ? onChainStatus : "local");

  const planetName = homePlanet?.name
    ?? (isWalletConnected && planet?.coordinates ? `Planet ${planet.coordinates}` : "Eos Relay");
  const planetSubhead = homePlanet
    ? `${formatPlanetType(homePlanet.type)} · ${homePlanet.galaxy}:${homePlanet.system}:${homePlanet.position}`
    : "Home planet";
  const heroImage = homePlanet?.image ?? "/assets/game/style-pass/generated/planets/lush-temperate.webp";

  return (
    <div className="grid gap-3">
      {/* Planet hero — compact, no wasted space */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className="relative h-24 sm:h-28">
          <OptimizedImage
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            sizes="hero"
            src={heroImage}
          />
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
          On-chain planet data is unavailable right now. Overview stats and resources are hidden until the game API responds with real values.
          {onChainError ? <span className="block truncate text-amber-200/70">{onChainError}</span> : null}
        </div>
      )}

      {/* Contract production queues */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Building queue */}
        <QueuePanel
          label="Buildings"
          tag={onChainQueues?.building?.active ? "On-chain" : undefined}
        >
          {onChainQueues?.building?.active ? (
            <div className="grid gap-2">
              <QueueItemDisplay
                label={`${onChainQueues.building.kind === "building" ? "Building" : onChainQueues.building.kind} level ${onChainQueues.building.targetLevel}`}
                remaining={queueRemaining(onChainQueues.building.readyAt, now)}
                indeterminate
              />
              {queueRemaining(onChainQueues.building.readyAt, now) === "Ready" && onFinishBuilding && (
                <button
                  className="h-7 rounded border border-cyan-300/40 bg-cyan-300/10 px-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onFinishBuilding}
                  type="button"
                >
                  Finish upgrade
                </button>
              )}
            </div>
          ) : settledState.queue?.kind === "building" ? (
            <QueueItemDisplay
              label={settledState.queue.label}
              remaining={formatDurationUntil(settledState.queue.readyAt, now)}
              progress={queueProgress}
            />
          ) : (
            <EmptyQueue>
              No active construction.
              <QuickLink onClick={() => onNavigate("infrastructure")}>Build</QuickLink>
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Defense queue */}
        <QueuePanel
          label="Defenses"
          tag={onChainQueues?.defense?.active ? "On-chain" : undefined}
        >
          {onChainQueues?.defense?.active ? (
            <QueueItemDisplay
              label={`${onChainQueues.defense.kind === "defense" ? "Defense" : onChainQueues.defense.kind}${onChainQueues.defense.quantity ? ` ×${onChainQueues.defense.quantity}` : ""}`}
              remaining={queueRemaining(onChainQueues.defense.readyAt, now)}
              indeterminate
              color="bg-rose-300"
            />
          ) : (
            <EmptyQueue>
              No active defense production.
              <QuickLink onClick={() => onNavigate("defenses")}>Defenses</QuickLink>
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Research queue */}
        <QueuePanel
          label="Research"
          tag={onChainQueues?.research?.active ? "On-chain" : undefined}
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
              color="bg-cyan-300"
            />
          ) : (
            <EmptyQueue>
              No active research.
              <QuickLink onClick={() => onNavigate("research")}>Research</QuickLink>
            </EmptyQueue>
          )}
        </QueuePanel>

        {/* Shipyard queue */}
        <QueuePanel
          label="Shipyard"
          tag={onChainQueues?.ship?.active ? "On-chain" : undefined}
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
              color="bg-emerald-300"
            />
          ) : (
            <EmptyQueue>
              No active ship production.
              <QuickLink onClick={() => onNavigate("shipyard")}>Shipyard</QuickLink>
            </EmptyQueue>
          )}
        </QueuePanel>
      </div>

      {/* Resource values live in the persistent top bar; keep Overview focused on planet state and actions. */}
      {isWalletConnected && onChainStatus === "loading" && (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-3 text-sm text-slate-400 sm:p-4">
          Loading on-chain resources...
        </div>
      )}

    </div>
  );
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
    <div className="rounded-lg border border-white/10 bg-[#101624] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        {tag && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{tag}</span>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function QueueItemDisplay({
  label,
  remaining,
  progress,
  indeterminate,
  color = "bg-signal",
}: {
  label: string;
  remaining: string;
  progress?: number;
  indeterminate?: boolean;
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-semibold text-white">{label}</p>
        <p className="shrink-0 text-[10px] text-slate-400">{remaining}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        {indeterminate ? (
          <div className={`h-full w-2/3 rounded-full ${color} animate-pulse`} />
        ) : (
          <div
            className={`h-full rounded-full ${color} transition-[width]`}
            style={{ width: `${(progress ?? 0) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function EmptyQueue({ children }: { children: preact.ComponentChildren }) {
  return <div className="text-xs text-slate-400">{children}</div>;
}

function QuickLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      className="ml-2 inline rounded border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-medium text-slate-200 transition hover:bg-white/12"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
