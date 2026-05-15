import type { Resources, QueueItem } from "../playableMvp";
import type { ChainLoadStatus } from "../overviewData";
import { shortAddress } from "../walletFlow";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface TopBarProps {
  resources?: Resources | undefined;
  rates: Resources;
  caps: Resources;
  resourceStatus: ChainLoadStatus;
  queue?: QueueItem | undefined;
  researchQueue?: QueueItem | undefined;
  account?: string | undefined;
  coordinates?: string | undefined;
  isWalletConnected: boolean;
}

export function TopBar({
  resources,
  rates,
  caps,
  resourceStatus,
  queue,
  researchQueue,
  account,
  coordinates,
  isWalletConnected,
}: TopBarProps) {
  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-3 py-2 sm:flex-row sm:justify-between sm:gap-3 sm:px-4 lg:px-6">
        {/* Resources row */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {resourceStatus === "loading" ? (
            <span className="text-xs text-slate-400">Resources loading</span>
          ) : resourceStatus === "error" || !resources ? (
            <span className="text-xs text-amber-200">Resources unavailable</span>
          ) : (
            <>
              <ResourcePip
                cap={resourceStatus === "local" ? caps.metal : undefined}
                color="text-amber-300"
                label="Metal"
                rate={resourceStatus === "local" ? rates.metal : undefined}
                value={resources.metal}
              />
              <ResourcePip
                cap={resourceStatus === "local" ? caps.crystal : undefined}
                color="text-cyan-300"
                label="Crystal"
                rate={resourceStatus === "local" ? rates.crystal : undefined}
                value={resources.crystal}
              />
              <ResourcePip
                cap={resourceStatus === "local" ? caps.deuterium : undefined}
                color="text-emerald-300"
                label="Deuterium"
                rate={resourceStatus === "local" ? rates.deuterium : undefined}
                value={resources.deuterium}
              />
            </>
          )}
          {queue && (
            <span className="rounded bg-white/10 px-2 py-1 text-xs text-slate-300">
              {queue.label}
            </span>
          )}
          {researchQueue && (
            <span className="rounded bg-cyan-300/10 px-2 py-1 text-xs text-cyan-200">
              {researchQueue.label}
            </span>
          )}
        </div>

        {/* Wallet / Coords */}
        <div className="flex items-center gap-2 sm:gap-3">
          {coordinates && (
            <span className="hidden leading-tight text-xs text-slate-400 sm:inline">
              {coordinates}
            </span>
          )}
          {isWalletConnected && account && (
            <span className="font-mono leading-tight text-xs text-slate-400">
              {shortAddress(account)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResourcePip({
  label,
  value,
  rate,
  cap,
  color,
}: {
  label: string;
  value: number;
  rate?: number | undefined;
  cap?: number | undefined;
  color: string;
}) {
  const pct = cap && cap > 0 ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={`text-xs font-semibold ${color}`}>{label}</span>
      <span className="break-words text-xs text-white">{format(value)}</span>
      {rate !== undefined && <span className="text-[10px] text-slate-500">+{format(rate)}/h</span>}
      {pct >= 90 && (
        <span className="text-[10px] text-amber-400">{pct}%</span>
      )}
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}
