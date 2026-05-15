import type { PlayableState, Resources, QueueItem } from "../playableMvp";
import type { PlanetSummary, PlayerQueuesResponse, WalletSettlementResponse } from "../walletFlow";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

interface OverviewPageProps {
  state: PlayableState;
  settledState: PlayableState;
  rates: Resources;
  caps: Resources;
  queueProgress: number;
  researchProgress: number;
  now: number;
  planet?: PlanetSummary | undefined;
  isWalletConnected: boolean;
  onCollect: () => void;
  onNavigate: (page: "infrastructure" | "research" | "shipyard") => void;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
}

export function OverviewPage({
  state,
  settledState,
  rates,
  caps,
  queueProgress,
  researchProgress,
  now,
  planet,
  isWalletConnected,
  onCollect,
  onNavigate,
  onChainSettlement,
  onChainQueues,
}: OverviewPageProps) {
  return (
    <div className="grid gap-4">
      {/* Planet hero */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className="relative min-h-[220px] sm:min-h-[260px]">
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            src="/assets/game/planets/lush-temperate.webp"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.2),rgba(7,9,19,0.9))]" />
          <div className="relative flex min-h-[220px] flex-col justify-end p-4 sm:min-h-[260px] sm:p-5">
            <p className="text-sm font-medium text-slate-300">Home planet</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              {isWalletConnected && planet?.coordinates
                ? `Planet ${planet.coordinates}`
                : "Eos Relay"}
            </h2>
            <dl className="mt-4 grid max-w-md grid-cols-3 gap-2 text-sm sm:gap-3">
              <Metric
                label="Fields"
                value={onChainSettlement?.planet?.fields !== undefined
                  ? String(onChainSettlement.planet.fields)
                  : (planet?.fields ?? "—")}
              />
              <Metric
                label="Temp"
                value={onChainSettlement?.planet?.temperature !== undefined
                  ? `${onChainSettlement.planet.temperature}°C`
                  : (planet?.temperature ?? "—")}
              />
              <Metric
                label="Queue"
                value={onChainQueues?.building?.active || onChainQueues?.research?.active
                  ? "Active"
                  : settledState.queue || settledState.researchQueue
                    ? "Active (local)"
                    : "Ready"}
              />
            </dl>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Active queue */}
        <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Active Queue</h2>
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              {onChainQueues?.building?.active ? "On-chain" : "MVP timer"}
            </span>
          </div>

          {onChainQueues?.building?.active ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-semibold text-white">
                  {onChainQueues.building.kind === "building" ? "Building" : onChainQueues.building.kind} level {onChainQueues.building.targetLevel}
                </p>
                <p className="text-sm text-slate-300">
                  {onChainQueues.building.readyAt
                    ? `${Math.max(0, Math.ceil((Number(onChainQueues.building.readyAt) * 1000 - now) / 1_000))}s`
                    : "Pending"}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-signal transition-[width]"
                  style={{ width: `${queueProgress * 100}%` }}
                />
              </div>
              {isWalletConnected && (
                <button
                  className="mt-3 w-full rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onCollect}
                  type="button"
                >
                  Collect Completed
                </button>
              )}
            </div>
          ) : settledState.queue ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-semibold text-white">{settledState.queue.label}</p>
                <p className="text-sm text-slate-300">
                  {Math.max(0, Math.ceil((settledState.queue.readyAt - now) / 1_000))}s
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-signal transition-[width]"
                  style={{ width: `${queueProgress * 100}%` }}
                />
              </div>
              {isWalletConnected && (
                <button
                  className="mt-3 w-full rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onCollect}
                  type="button"
                >
                  Collect Completed
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm leading-6 text-slate-300">
                No active construction queue. Start a building or ship order.
              </p>
              <div className="mt-3 flex gap-2">
                <QuickLink onClick={() => onNavigate("infrastructure")}>
                  Build Infrastructure
                </QuickLink>
                <QuickLink onClick={() => onNavigate("shipyard")}>
                  Open Shipyard
                </QuickLink>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Research Queue</h2>
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              {onChainQueues?.research?.active ? "On-chain" : "Science"}
            </span>
          </div>

          {onChainQueues?.research?.active ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-semibold text-white">
                  {onChainQueues.research.kind === "research" ? "Research" : onChainQueues.research.kind} level {onChainQueues.research.targetLevel}
                </p>
                <p className="text-sm text-slate-300">
                  {onChainQueues.research.readyAt
                    ? `${Math.max(0, Math.ceil((Number(onChainQueues.research.readyAt) * 1000 - now) / 1_000))}s`
                    : "Pending"}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-[width]"
                  style={{ width: `${researchProgress * 100}%` }}
                />
              </div>
              {isWalletConnected && (
                <button
                  className="mt-3 w-full rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onCollect}
                  type="button"
                >
                  Collect Completed
                </button>
              )}
            </div>
          ) : settledState.researchQueue ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-semibold text-white">{settledState.researchQueue.label}</p>
                <p className="text-sm text-slate-300">
                  {Math.max(0, Math.ceil((settledState.researchQueue.readyAt - now) / 1_000))}s
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-[width]"
                  style={{ width: `${researchProgress * 100}%` }}
                />
              </div>
              {isWalletConnected && (
                <button
                  className="mt-3 w-full rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                  onClick={onCollect}
                  type="button"
                >
                  Collect Completed
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm leading-6 text-slate-300">
                No active research. Research runs in its own MVP queue.
              </p>
              <div className="mt-3">
                <QuickLink onClick={() => onNavigate("research")}>
                  Open Research
                </QuickLink>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-2.5 backdrop-blur sm:p-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}

function QuickLink({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/12"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
