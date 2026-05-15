import type { Resources, QueueItem } from "../playableMvp";
import { shortAddress } from "../walletFlow";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface TopBarProps {
  resources: Resources;
  rates: Resources;
  caps: Resources;
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
          <ResourcePip
            label="Metal"
            value={resources.metal}
            rate={rates.metal}
            cap={caps.metal}
            color="text-amber-300"
          />
          <ResourcePip
            label="Crystal"
            value={resources.crystal}
            rate={rates.crystal}
            cap={caps.crystal}
            color="text-cyan-300"
          />
          <ResourcePip
            label="Deuterium"
            value={resources.deuterium}
            rate={rates.deuterium}
            cap={caps.deuterium}
            color="text-emerald-300"
          />
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
  rate: number;
  cap: number;
  color: string;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs font-semibold ${color}`}>{label}</span>
      <span className="text-xs text-white">{format(value)}</span>
      <span className="text-[10px] text-slate-500">+{format(rate)}/h</span>
      {pct >= 90 && (
        <span className="text-[10px] text-amber-400">{pct}%</span>
      )}
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}
