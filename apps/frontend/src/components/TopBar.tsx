import type { EnergyBalance, Resources, QueueItem } from "../playableMvp";
import { shouldShowTopBarEnergy, type ChainLoadStatus } from "../overviewData";
import { shortAddress } from "../walletFlow";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface TopBarProps {
  resources?: Resources | undefined;
  rates: Resources;
  caps: Resources;
  resourceDeltas?: Resources | undefined;
  resourceStatus: ChainLoadStatus;
  queue?: QueueItem | undefined;
  researchQueue?: QueueItem | undefined;
  account?: string | undefined;
  coordinates?: string | undefined;
  isWalletConnected: boolean;
  canCollectResources?: boolean | undefined;
  energy?: EnergyBalance | undefined;
  onCollectResources?: (() => void) | undefined;
  showCollectResources?: boolean | undefined;
}

export function TopBar({
  resources,
  rates,
  caps,
  resourceDeltas,
  resourceStatus,
  queue,
  researchQueue,
  account,
  coordinates,
  energy,
  isWalletConnected,
  canCollectResources = false,
  onCollectResources,
  showCollectResources = false,
}: TopBarProps) {
  const showResourceDetails = resourceStatus === "local" || resourceStatus === "ready";
  const showCollectButton = isWalletConnected
    && showCollectResources
    && canCollectResources
    && resourceStatus === "ready"
    && Boolean(onCollectResources);

  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur">
      <div className="mx-auto flex min-h-11 max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3 py-1.5 sm:justify-between sm:px-4 lg:px-6">
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-x-1.5 gap-y-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-start sm:gap-x-2.5">
          {resourceStatus === "loading" ? (
            <span className="text-xs text-slate-400">Resources loading</span>
          ) : resourceStatus === "error" || !resources ? (
            <span className="text-xs text-amber-200">Resources unavailable</span>
          ) : (
            <>
              <ResourcePip
                cap={showResourceDetails ? caps.metal : undefined}
                color="text-amber-300"
                delta={resourceDeltas?.metal}
                label="Metal"
                rate={showResourceDetails ? rates.metal : undefined}
                value={resources.metal}
              />
              <ResourcePip
                cap={showResourceDetails ? caps.crystal : undefined}
                color="text-cyan-300"
                delta={resourceDeltas?.crystal}
                label="Crystal"
                rate={showResourceDetails ? rates.crystal : undefined}
                value={resources.crystal}
              />
              <ResourcePip
                cap={showResourceDetails ? caps.deuterium : undefined}
                color="text-emerald-300"
                delta={resourceDeltas?.deuterium}
                label="Deuterium"
                rate={showResourceDetails ? rates.deuterium : undefined}
                value={resources.deuterium}
              />
              {shouldShowTopBarEnergy(energy) && (
                <EnergyPip produced={energy.produced} required={energy.required} />
              )}
            </>
          )}
          {showCollectButton && (
            <button
              className="col-span-2 inline-flex h-7 items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 px-2.5 text-[11px] font-semibold leading-none text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:col-span-1"
              disabled={!canCollectResources}
              onClick={onCollectResources}
              title={collectResourcesTitle(resourceDeltas, canCollectResources)}
              type="button"
            >
              Collect
            </button>
          )}
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
  delta,
}: {
  label: string;
  value: number;
  rate?: number | undefined;
  cap?: number | undefined;
  color: string;
  delta?: number | undefined;
}) {
  const pct = cap && cap > 0 ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  const wholeDelta = Math.floor(Math.max(0, delta ?? 0));
  return (
    <div className="inline-flex h-6 items-center justify-center whitespace-nowrap sm:justify-start">
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`text-xs font-semibold leading-none ${color}`}>{label}</span>
        <span className="text-xs leading-none text-white">{format(value)}</span>
        {wholeDelta > 0 && <span className="text-[10px] font-semibold leading-none text-lime-300">+{format(wholeDelta)}</span>}
        {rate !== undefined && <span className="text-[10px] leading-none text-slate-500">+{format(rate)}/h</span>}
        {pct >= 90 && (
          <span className="text-[10px] leading-none text-amber-400">{pct}%</span>
        )}
      </span>
    </div>
  );
}

function EnergyPip({
  produced,
  required,
}: {
  produced: number;
  required: number;
}) {
  const current = produced - required;
  const tone = current < 0 ? "text-red-300" : "text-lime-300";

  return (
    <div
      className="inline-flex h-6 items-center justify-center whitespace-nowrap sm:justify-start"
      title={`${format(produced)} produced / ${format(required)} required`}
    >
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`text-xs font-semibold leading-none ${tone}`}>Energy</span>
        <span className={`text-xs leading-none ${current < 0 ? "text-red-200" : "text-white"}`}>{format(current)}</span>
        {required > 0 && <span className="text-[10px] leading-none text-slate-500">{format(produced)}/{format(required)}</span>}
      </span>
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function collectResourcesTitle(deltas: Resources | undefined, canCollect: boolean): string {
  if (!canCollect) return "Nothing to collect yet";
  if (!deltas) return "Collect accrued resources";

  const parts = [
    deltaLabel("Metal", deltas.metal),
    deltaLabel("Crystal", deltas.crystal),
    deltaLabel("Deuterium", deltas.deuterium),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `Collect accrued resources: ${parts.join(" / ")}` : "Collect accrued resources";
}

function deltaLabel(label: string, value: number): string | undefined {
  const whole = Math.floor(Math.max(0, value));
  return whole > 0 ? `${label} +${format(whole)}` : undefined;
}
