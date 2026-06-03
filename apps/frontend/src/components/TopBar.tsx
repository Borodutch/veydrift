import type { EnergyBalance, Resources, QueueItem } from "../playableMvp";
import { shouldShowTopBarEnergy, type ChainLoadStatus } from "../overviewData";
import { energyExplanationTitle } from "../topBarEnergyInfo";
import { shortAddress } from "../walletFlow";
import { Download, Info } from "lucide-preact";
import { TELEGRAM_SUPPORT_URL } from "../supportLinks";
import { TelegramIcon } from "./TelegramIcon";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });
const BPS = 10_000;

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
  collectResourcesActionLabel?: string | undefined;
  collectResourcesActionStatus?: "error" | "pending" | "success" | undefined;
  collectResourcesPending?: boolean | undefined;
  collectResourcesPendingLabel?: string | undefined;
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
  collectResourcesActionLabel,
  collectResourcesActionStatus,
  collectResourcesPending = false,
  collectResourcesPendingLabel,
  onCollectResources,
  showCollectResources = false,
}: TopBarProps) {
  const showResourceDetails = Boolean(resources);
  const showCollectButton = isWalletConnected
    && showCollectResources
    && (canCollectResources || collectResourcesPending)
    && resourceStatus === "ready"
    && Boolean(onCollectResources);
  const collectTitle = collectResourcesPending
    ? collectResourcesPendingLabel ?? "Resource collection pending"
    : collectResourcesTitle(resourceDeltas, canCollectResources);
  const collectFeedbackClass = collectResourcesActionStatus === "error"
    ? "text-rose-200"
    : collectResourcesActionStatus === "success"
      ? "text-emerald-200"
      : "text-cyan-100";

  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur">
      <div className="mx-auto flex min-h-10 max-w-[96rem] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 py-1 sm:min-h-11 sm:justify-between sm:px-4 sm:py-1.5 lg:px-6">
        <div className="grid w-full min-w-0 grid-cols-[repeat(3,minmax(0,1fr))_minmax(4.5rem,1.25fr)_1.75rem_1.75rem] items-center gap-0.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-start sm:gap-x-2.5 sm:gap-y-1.5">
          {resourceStatus === "loading" && !resources ? (
            <span className="text-xs text-slate-400">Resources loading</span>
          ) : !resources ? (
            <span className="text-xs text-amber-200">Resources unavailable</span>
          ) : (
            <>
              <ResourcePip
                abbr="M"
                cap={showResourceDetails ? caps.metal : undefined}
                color="text-amber-300"
                delta={resourceDeltas?.metal}
                label="Metal"
                rate={showResourceDetails ? rates.metal : undefined}
                value={resources.metal}
              />
              <ResourcePip
                abbr="C"
                cap={showResourceDetails ? caps.crystal : undefined}
                color="text-cyan-300"
                delta={resourceDeltas?.crystal}
                label="Crystal"
                rate={showResourceDetails ? rates.crystal : undefined}
                value={resources.crystal}
              />
              <ResourcePip
                abbr="D"
                cap={showResourceDetails ? caps.deuterium : undefined}
                color="text-emerald-300"
                delta={resourceDeltas?.deuterium}
                label="Deuterium"
                rate={showResourceDetails ? rates.deuterium : undefined}
                value={resources.deuterium}
              />
              {shouldShowTopBarEnergy(energy) && (
                <EnergyPip
                  produced={energy.produced}
                  required={energy.required}
                  scaleBps={energy.scaleBps}
                />
              )}
            </>
          )}
          <a
            aria-label="Telegram support"
            className="grid h-7 w-7 shrink-0 place-items-center rounded border border-signal/35 bg-signal/10 text-signal transition hover:bg-signal/20 sm:hidden"
            href={TELEGRAM_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Telegram support"
          >
            <TelegramIcon className="h-3.5 w-3.5" />
          </a>
          {showCollectButton && (
            <button
              aria-label={collectTitle}
              className="col-start-6 grid h-7 w-7 shrink-0 place-items-center rounded border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:col-start-auto lg:inline-flex lg:w-auto lg:gap-1.5 lg:px-2.5 lg:text-[11px] lg:font-semibold lg:leading-none"
              disabled={!canCollectResources || collectResourcesPending}
              onClick={onCollectResources}
              title={collectTitle}
              type="button"
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
              <span className="sr-only lg:not-sr-only">{collectResourcesPending ? "Pending" : "Collect"}</span>
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
          <a
            aria-label="Telegram support"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded border border-signal/35 bg-signal/10 text-[11px] font-semibold leading-none text-signal transition hover:bg-signal/20 sm:inline-flex lg:w-auto lg:gap-1.5 lg:px-2"
            href={TELEGRAM_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Telegram support"
          >
            <TelegramIcon className="h-3.5 w-3.5" />
            <span className="sr-only lg:not-sr-only">Telegram</span>
          </a>
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

        {collectResourcesActionLabel && (
          <p
            className={`w-full min-w-0 truncate text-center text-[11px] leading-4 sm:text-left ${collectFeedbackClass}`}
            role={collectResourcesActionStatus === "error" ? "alert" : "status"}
            title={collectResourcesActionLabel}
          >
            {collectResourcesActionLabel}
          </p>
        )}
      </div>
    </div>
  );
}

function ResourcePip({
  abbr,
  label,
  value,
  rate,
  cap,
  color,
  delta,
}: {
  abbr: string;
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
    <div
      className="flex h-7 min-w-0 items-center justify-center rounded border border-white/10 bg-white/[0.03] px-1 whitespace-nowrap sm:h-6 sm:flex-none sm:justify-start sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0"
      title={resourceTitle(label, value, rate, cap, wholeDelta)}
    >
      <span className="inline-flex min-w-0 items-baseline gap-0.5 sm:gap-1.5">
        <span className={`text-[10px] font-semibold leading-none sm:text-xs ${color}`}>
          <span className="sm:hidden">{abbr}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
        <span className={`min-w-0 truncate text-[10px] leading-none sm:text-xs ${pct >= 90 ? "text-amber-100" : "text-white"}`}>
          <span className="sm:hidden">{formatCompact(value)}</span>
          <span className="hidden sm:inline">{format(value)}</span>
        </span>
        {wholeDelta > 0 && (
          <span className="text-[10px] font-semibold leading-none text-lime-300">
            <span className="sm:hidden">(+{formatCompact(wholeDelta)})</span>
            <span className="hidden sm:inline">+{format(wholeDelta)}</span>
          </span>
        )}
        {rate !== undefined && <span className="hidden text-[10px] leading-none text-slate-500 sm:inline">+{format(rate)}/h</span>}
        {pct >= 90 && (
          <span className="hidden text-[10px] leading-none text-amber-400 sm:inline">{pct}%</span>
        )}
      </span>
    </div>
  );
}

function EnergyPip({
  produced,
  required,
  scaleBps,
}: {
  produced: number;
  required: number;
  scaleBps: number;
}) {
  const current = produced - required;
  const tone = current < 0 ? "text-red-300" : "text-lime-300";
  const showShortageFactor = current < 0 && required > 0 && scaleBps < BPS;
  const productionPercent = Math.floor((scaleBps * 100) / BPS);
  const energyExplanation = energyExplanationTitle({ produced, required, scaleBps });

  return (
    <div
      className="flex h-7 min-w-0 items-center justify-center rounded border border-white/10 bg-white/[0.03] px-1 whitespace-nowrap sm:h-6 sm:flex-none sm:justify-start sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0"
      title={showShortageFactor
        ? `${format(produced)} produced / ${format(required)} required; production reduced to ${productionPercent}%`
        : `${format(produced)} produced / ${format(required)} required`}
    >
      <span className="inline-flex min-w-0 items-baseline gap-0.5 sm:gap-1.5">
        <span className={`text-[10px] font-semibold leading-none sm:text-xs ${tone}`}>
          <span className="sm:hidden">E</span>
          <span className="hidden sm:inline">Energy</span>
        </span>
        <span className={`min-w-0 truncate text-[10px] leading-none sm:text-xs ${current < 0 ? "text-red-200" : "text-white"}`}>
          <span className="sm:hidden">{formatCompact(current)}</span>
          <span className="hidden sm:inline">{format(current)}</span>
        </span>
        {required > 0 && <span className="hidden text-[10px] leading-none text-slate-500 sm:inline">{format(produced)}/{format(required)}</span>}
        {showShortageFactor && (
          <span className="text-[9px] font-semibold leading-none text-red-200 sm:text-[10px]">
            <span className="sm:hidden">{productionPercent}%</span>
            <span className="hidden sm:inline">{productionPercent}% output</span>
          </span>
        )}
        <details className="group relative inline-flex shrink-0">
          <summary
            aria-label={energyExplanation}
            className="inline-grid h-5 w-5 cursor-pointer list-none place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-400 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 [&::-webkit-details-marker]:hidden"
            title="Energy explanation"
          >
            <Info aria-hidden="true" size={12} strokeWidth={2.25} />
          </summary>
          <div className="fixed left-2 right-2 top-12 z-50 whitespace-normal rounded border border-cyan-300/25 bg-[#111827] p-3 text-left text-xs leading-5 text-slate-300 shadow-2xl shadow-black/50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
            <div className="font-semibold text-cyan-100">Energy</div>
            <p className="mt-1">
              Energy powers mines. Solar Plant and Solar Satellites produce it; mines consume it.
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4">
              <dt className="text-slate-500">Produced</dt>
              <dd className="text-right font-semibold text-slate-100">{format(produced)}</dd>
              <dt className="text-slate-500">Consumed</dt>
              <dd className="text-right font-semibold text-slate-100">{format(required)}</dd>
              <dt className="text-slate-500">Balance</dt>
              <dd className={`text-right font-semibold ${current < 0 ? "text-red-200" : "text-lime-200"}`}>{format(current)}</dd>
            </dl>
            <p className={`mt-2 text-[11px] leading-4 ${showShortageFactor ? "text-red-200" : "text-slate-400"}`}>
              {showShortageFactor
                ? `Insufficient energy reduces mine output to ${productionPercent}% until you add more energy production or reduce consumption.`
                : "Mine output is fully powered."}
            </p>
          </div>
        </details>
      </span>
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatCompact(value: number): string {
  const rounded = Math.floor(value);
  if (Math.abs(rounded) < 10_000) return format(rounded);
  return compactFormatter.format(rounded);
}

function resourceTitle(label: string, value: number, rate: number | undefined, cap: number | undefined, delta: number): string {
  const details = [`${label}: ${format(value)}`];
  if (delta > 0) details.push(`Collectable +${format(delta)}`);
  if (rate !== undefined) details.push(`+${format(rate)}/h`);
  if (cap !== undefined) details.push(`Cap ${format(cap)}`);
  return details.join(" / ");
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
