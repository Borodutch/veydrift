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
      <div className="mx-auto flex min-h-11 max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3 py-1.5 sm:justify-between sm:px-4 lg:px-6">
        <div className="grid w-full min-w-0 grid-cols-3 items-center gap-x-1.5 gap-y-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-start sm:gap-x-2.5">
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
            <span className="inline-flex h-6 max-w-40 items-center truncate rounded bg-white/10 px-2 text-xs leading-none text-slate-300">
              {queue.label}
            </span>
          )}
          {researchQueue && (
            <span className="inline-flex h-6 max-w-40 items-center truncate rounded bg-cyan-300/10 px-2 text-xs leading-none text-cyan-200">
              {researchQueue.label}
            </span>
          )}
        </div>

        <div className="flex min-w-0 max-w-full items-center justify-center gap-2 sm:justify-end sm:gap-3">
          {coordinates && (
            <span className="inline-flex h-6 items-center whitespace-nowrap font-mono text-xs leading-none text-slate-400">
              {coordinates}
            </span>
          )}
          {isWalletConnected && account && (
            <span className="inline-flex h-6 max-w-[7.25rem] items-center truncate font-mono text-xs leading-none text-slate-400">
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
    <div className="inline-flex h-6 items-center justify-center whitespace-nowrap sm:justify-start">
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`text-xs font-semibold leading-none ${color}`}>{label}</span>
        <span className="text-xs leading-none text-white">{format(value)}</span>
        <span className="text-[10px] leading-none text-slate-500">+{format(rate)}/h</span>
        {pct >= 90 && (
          <span className="text-[10px] leading-none text-amber-400">{pct}%</span>
        )}
      </span>
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}
