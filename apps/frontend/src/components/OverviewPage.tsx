import type { PlayableState, Resources } from "../playableMvp";
import type { PlanetSummary, PlayerQueuesResponse, WalletSettlementResponse } from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatInt(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatTemp(value: number): string {
  return `${Math.round(value)}°C`;
}

function queueRemaining(readyAt: string | null, now: number): string {
  if (!readyAt) return "Pending";
  const seconds = Math.max(0, Math.ceil((Number(readyAt) * 1000 - now) / 1_000));
  if (seconds <= 0) return "Ready";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
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
  isWalletConnected: boolean;
  onCollect: () => void;
  onNavigate: (page: "infrastructure" | "research" | "shipyard") => void;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
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
  isWalletConnected,
  onCollect,
  onNavigate,
  onChainSettlement,
  onChainQueues,
}: OverviewPageProps) {
  const usedFields = Object.values(settledState.buildings).filter((level) => level > 0).length;
  const totalFields = onChainSettlement?.planet?.fields ?? (planet?.fields ? Number(planet.fields) : undefined);

  const onChainResources = onChainSettlement?.planet?.resources;

  const anyQueueActive =
    onChainQueues?.building?.active ||
    onChainQueues?.research?.active ||
    onChainQueues?.ship?.active ||
    settledState.queue ||
    settledState.researchQueue;

  return (
    <div className="grid gap-3">
      {/* Planet hero — compact, no wasted space */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className="relative h-24 sm:h-28">
          <OptimizedImage
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            sizes="hero"
            src="/assets/game/planets/lush-temperate.webp"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.35),rgba(7,9,19,0.92))]" />
          <div className="relative flex h-full flex-col justify-end p-3 sm:p-4">
            <p className="text-[11px] font-medium text-slate-400">Home planet</p>
            <h2 className="text-base font-semibold text-white">
              {isWalletConnected && planet?.coordinates
                ? `Planet ${planet.coordinates}`
                : "Eos Relay"}
            </h2>
          </div>
        </div>

        {/* Stats strip — compact, never overflows */}
        <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-3 sm:grid-cols-4 sm:p-4">
          <StatPip
            label="Fields"
            value={
              totalFields !== undefined
                ? `${usedFields > 0 ? `${usedFields} / ` : ""}${formatInt(totalFields)}`
                : "—"
            }
          />
          <StatPip
            label="Temperature"
            value={
              onChainSettlement?.planet?.temperature !== undefined
                ? formatTemp(onChainSettlement.planet.temperature)
                : (planet?.temperature ?? "—")
            }
          />
          <StatPip
            label="Diameter"
            value={totalFields !== undefined ? `${formatInt(totalFields * 100)} km` : "—"}
          />
          <StatPip label="Status" value={anyQueueActive ? "Active" : "Idle"} />
        </div>
      </div>

      {/* Three queues — buildings, research, shipyard */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Building queue */}
        <QueuePanel
          label="Buildings"
          tag={onChainQueues?.building?.active ? "On-chain" : undefined}
        >
          {onChainQueues?.building?.active ? (
            <QueueItemDisplay
              label={`${onChainQueues.building.kind === "building" ? "Building" : onChainQueues.building.kind} level ${onChainQueues.building.targetLevel}`}
              remaining={queueRemaining(onChainQueues.building.readyAt, now)}
              indeterminate
            />
          ) : settledState.queue?.kind === "building" ? (
            <QueueItemDisplay
              label={settledState.queue.label}
              remaining={`${Math.max(0, Math.ceil((settledState.queue.readyAt - now) / 1_000))}s`}
              progress={queueProgress}
            />
          ) : (
            <EmptyQueue>
              No active construction.
              <QuickLink onClick={() => onNavigate("infrastructure")}>Build</QuickLink>
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
              remaining={`${Math.max(0, Math.ceil((settledState.researchQueue.readyAt - now) / 1_000))}s`}
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
              remaining={`${Math.max(0, Math.ceil((settledState.queue.readyAt - now) / 1_000))}s`}
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

      {/* Resources — only shown when backed by real on-chain state */}
      {isWalletConnected && onChainResources && (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">Resources</h3>
            <button
              className="rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
              onClick={onCollect}
              type="button"
            >
              Collect resources
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <ResourceStat
              label="Metal"
              value={Number(onChainResources.metal)}
              rate={rates.metal}
              cap={caps.metal}
              color="text-amber-300"
            />
            <ResourceStat
              label="Crystal"
              value={Number(onChainResources.crystal)}
              rate={rates.crystal}
              cap={caps.crystal}
              color="text-cyan-300"
            />
            <ResourceStat
              label="Deuterium"
              value={Number(onChainResources.deuterium)}
              rate={rates.deuterium}
              cap={caps.deuterium}
              color="text-emerald-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatPip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-xs font-semibold text-white">{value}</dd>
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

function ResourceStat({
  label,
  value,
  rate,
  cap,
  color,
}: {
  label: string;
  value: number;
  rate: number;
  cap: number;
  color: string;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-1">
        <span className={`text-[10px] font-semibold uppercase ${color}`}>{label}</span>
        {pct >= 90 && <span className="text-[9px] text-amber-400">{pct}%</span>}
      </div>
      <p className="mt-0.5 text-sm font-semibold text-white">{formatInt(value)}</p>
      <p className="text-[10px] text-slate-500">+{formatInt(rate)}/h</p>
    </div>
  );
}
