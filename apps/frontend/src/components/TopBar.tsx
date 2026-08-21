import type { EnergyBalance, Resources, QueueItem } from "../playableMvp";
import { shouldShowTopBarEnergy, type ChainLoadStatus } from "../overviewData";
import { energyExplanationTitle } from "../topBarEnergyInfo";
import { shortAddress } from "../walletFlow";
import { CircleHelp, FileText, Info } from "lucide-preact";
import { TELEGRAM_SUPPORT_URL, WHITEPAPER_URL } from "../supportLinks";
import { TelegramIcon } from "./TelegramIcon";
import { detailsCloseOutsideRef } from "./modalDismiss";
import { SoundToggle } from "./SoundToggle";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });
const BPS = 10_000;

// The shell layout sizes itself around the measured TopBar height via
// --topbar-h. Module-level singleton observer; the TopBar is only ever
// rendered once. Ref callback form keeps this component hook-free (tests
// invoke it as a plain function).
let topBarObserver: ResizeObserver | null = null;

function topBarHeightSyncRef(element: HTMLElement | null) {
  if (typeof ResizeObserver === "undefined") return;
  topBarObserver?.disconnect();
  topBarObserver = null;
  if (!element) return;
  const update = () => {
    document.documentElement.style.setProperty("--topbar-h", `${element.offsetHeight}px`);
  };
  update();
  topBarObserver = new ResizeObserver(update);
  topBarObserver.observe(element);
}

// Imperative count-up tween + direction flash for resource values. Reads the
// previous value from a data attribute so it works across renders without
// hooks/state; refs never run when tests call components as plain functions.
function tickValueRef(value: number, formatValue: (next: number) => string) {
  return (element: HTMLElement | null) => {
    if (!element) return;
    const previous = Number(element.dataset.tickValue);
    element.dataset.tickValue = String(value);
    if (!Number.isFinite(previous) || previous === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const flashClass = value > previous ? "resource-flash-up" : "resource-flash-down";
    element.classList.remove("resource-flash-up", "resource-flash-down");
    void element.offsetWidth;
    element.classList.add(flashClass);

    const start = performance.now();
    const duration = 500;
    const delta = value - previous;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 2;
      element.textContent = formatValue(previous + delta * eased);
      if (progress < 1 && element.isConnected) {
        requestAnimationFrame(step);
      } else {
        element.textContent = formatValue(value);
      }
    };
    requestAnimationFrame(step);
  };
}

interface TopBarProps {
  resources?: Resources | undefined;
  rates: Resources;
  caps: Resources;
  crawlerProduction?: CrawlerProductionInfo | null | undefined;
  inviteeProductionBoost?: { multiplierBps: string; expiresAt: string; active: boolean } | null | undefined;
  resourceStatus: ChainLoadStatus;
  queue?: QueueItem | undefined;
  researchQueue?: QueueItem | undefined;
  account?: string | undefined;
  isWalletConnected: boolean;
  energy?: EnergyBalance | undefined;
}

type CrawlerProductionInfo = {
  total: number;
  effective: number;
  maxEffective: number;
  boostBps: string;
  capped: boolean;
  productionIncreasePerHour: {
    metal: number | string;
    crystal: number | string;
    deuterium: number | string;
  };
};

export function TopBar({
  resources,
  rates,
  caps,
  crawlerProduction,
  inviteeProductionBoost,
  resourceStatus,
  queue,
  researchQueue,
  account,
  energy,
  isWalletConnected,
}: TopBarProps) {
  const showResourceDetails = Boolean(resources);

  return (
    <div className="sticky top-0 z-30" data-resource-status={resourceStatus} ref={topBarHeightSyncRef}>
      <div className="border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur">
        <div className="mx-auto flex min-h-10 max-w-[96rem] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 py-1 sm:min-h-11 sm:justify-between sm:px-4 sm:py-1.5 lg:px-6">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-start sm:gap-x-2.5 sm:gap-y-1.5">
          {/* Mobile: resources own a full-width row so values never truncate;
              icons + wallet live on the row below. sm:contents flattens both
              rows back into the single desktop flex line. */}
          <div className="flex min-w-0 items-stretch gap-1 sm:contents">
          {!isWalletConnected ? (
            <span className="text-xs text-slate-400">Connect wallet for resources</span>
          ) : resourceStatus === "loading" && !resources ? (
            <span className="text-xs text-slate-400">Resources loading</span>
          ) : !resources ? (
            <span className="text-xs text-amber-200">Resources unavailable</span>
          ) : (
            <>
              <ResourcePip
                abbr="M"
                cap={showResourceDetails ? caps.metal : undefined}
                color="text-amber-300"
                label="Metal"
                rate={showResourceDetails ? rates.metal : undefined}
                value={resources.metal}
              />
              <ResourcePip
                abbr="C"
                cap={showResourceDetails ? caps.crystal : undefined}
                color="text-cyan-300"
                label="Crystal"
                rate={showResourceDetails ? rates.crystal : undefined}
                value={resources.crystal}
              />
              <ResourcePip
                abbr="D"
                cap={showResourceDetails ? caps.deuterium : undefined}
                color="text-emerald-300"
                label="Deuterium"
                rate={showResourceDetails ? rates.deuterium : undefined}
                value={resources.deuterium}
              />
              {shouldShowTopBarEnergy(energy) && (
                <EnergyPip
                  context="Selected player planet"
                  produced={energy.produced}
                  rates={rates}
                  required={energy.required}
                  scaleBps={energy.scaleBps}
                  crawlerProduction={crawlerProduction}
                  sources={energy.sources}
                />
              )}
              {inviteeProductionBoost?.active && (
                <span
                  className="inline-flex items-center whitespace-nowrap rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-100"
                  title="Invitee production boost: resource production is doubled for your first seven days."
                >
                  2× production
                </span>
              )}
            </>
          )}
          </div>
          <div className="flex min-w-0 items-center gap-1 sm:contents">
          <a
            aria-label="Telegram support"
            className="grid h-10 min-w-0 flex-1 place-items-center rounded border border-signal/35 bg-signal/10 text-signal transition hover:bg-signal/20 sm:hidden"
            href={TELEGRAM_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Telegram support"
          >
            <TelegramIcon className="h-3.5 w-3.5" />
          </a>
          <a
            aria-label="Veydrift documentation"
            className="grid h-10 min-w-0 flex-1 place-items-center rounded border border-cyan-300/35 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 sm:hidden"
            href="/docs"
            title="Veydrift documentation"
          >
            <CircleHelp className="h-3.5 w-3.5" size={14} strokeWidth={2} />
          </a>
          <a
            aria-label="Veydrift whitepaper"
            className="grid h-10 min-w-0 flex-1 place-items-center rounded border border-amber-200/35 bg-amber-200/10 text-amber-100 transition hover:bg-amber-200/20 sm:hidden"
            href={WHITEPAPER_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Veydrift whitepaper"
          >
            <FileText className="h-3.5 w-3.5" size={14} strokeWidth={2} />
          </a>
          <SoundToggle className="grid h-10 min-w-0 flex-1 place-items-center rounded border border-white/15 bg-white/[0.06] text-slate-200 transition hover:bg-white/10 sm:hidden" />
          {isWalletConnected && account && (
            <span className="inline-flex h-10 max-w-[7.5rem] shrink-0 items-center truncate px-1 font-mono text-[11px] leading-none text-slate-400 sm:hidden">
              {shortAddress(account)}
            </span>
          )}
          </div>
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

        <div className="hidden min-w-0 max-w-full items-center gap-2 sm:flex sm:justify-end sm:gap-3">
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
          <a
            aria-label="Veydrift documentation"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/35 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 sm:inline-flex"
            href="/docs"
            title="Veydrift documentation"
          >
            <CircleHelp className="h-3.5 w-3.5" size={14} strokeWidth={2} />
          </a>
          <a
            aria-label="Veydrift whitepaper"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded border border-amber-200/35 bg-amber-200/10 text-[11px] font-semibold leading-none text-amber-100 transition hover:bg-amber-200/20 sm:inline-flex lg:w-auto lg:gap-1.5 lg:px-2"
            href={WHITEPAPER_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Veydrift whitepaper"
          >
            <FileText className="h-3.5 w-3.5" size={14} strokeWidth={2} />
            <span className="sr-only lg:not-sr-only">Whitepaper</span>
          </a>
          <SoundToggle className="hidden h-7 w-7 shrink-0 items-center justify-center rounded border border-white/15 bg-white/[0.06] text-slate-300 transition hover:bg-white/10 sm:inline-flex" />
          {isWalletConnected && account && (
            <span className="inline-flex h-6 max-w-[7.25rem] items-center truncate font-mono text-xs leading-none text-slate-400">
              {shortAddress(account)}
            </span>
          )}
        </div>

        </div>
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
}: {
  abbr: string;
  label: string;
  value: number;
  rate?: number | undefined;
  cap?: number | undefined;
  color: string;
}) {
  const pct = cap && cap > 0 ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <details
      className="group relative flex h-10 min-w-0 flex-1 items-center justify-center rounded border border-white/10 bg-white/[0.03] whitespace-nowrap sm:h-6 sm:flex-none sm:justify-start sm:rounded-none sm:border-0 sm:bg-transparent"
      data-close-outside
      ref={detailsCloseOutsideRef}
    >
      <summary
        className="flex h-full w-full cursor-pointer list-none items-center justify-center px-1 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 sm:justify-start sm:px-0 [&::-webkit-details-marker]:hidden"
        title={resourceTitle(label, value, rate, cap)}
      >
        <span className="inline-flex min-w-0 items-center gap-0.5 sm:gap-1.5">
          <span className={`text-[11px] font-semibold leading-none sm:text-xs ${color}`}>
            <span className="sm:hidden">{abbr}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          <span className={`min-w-0 truncate text-[11px] leading-none sm:text-xs ${pct >= 90 ? "resource-cap-warning text-amber-100" : "text-white"}`}>
            <span className="sm:hidden" ref={tickValueRef(value, formatCompact)}>{formatCompact(value)}</span>
            <span className="hidden sm:inline" ref={tickValueRef(value, format)}>{format(value)}</span>
          </span>
          {rate !== undefined && <span className="hidden text-[10px] leading-none text-slate-500 sm:inline">+{format(rate)}/h</span>}
          {pct >= 90 && (
            <span className="resource-cap-warning hidden text-[10px] leading-none text-amber-400 sm:inline">{pct}%</span>
          )}
        </span>
      </summary>
      <div className="fixed left-2 right-2 top-12 z-50 whitespace-normal rounded border border-cyan-300/25 bg-[#111827] p-3 text-left text-xs leading-5 text-slate-300 shadow-2xl shadow-black/50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-56">
        <div className={`font-semibold ${color}`}>{label}</div>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4">
          <dt className="text-slate-500">Stored</dt>
          <dd className="text-right font-semibold text-slate-100">{format(value)}</dd>
          {rate !== undefined && (
            <>
              <dt className="text-slate-500">Production</dt>
              <dd className="text-right font-semibold text-slate-100">+{format(rate)}/h</dd>
            </>
          )}
          {cap !== undefined && (
            <>
              <dt className="text-slate-500">Capacity</dt>
              <dd className="text-right font-semibold text-slate-100">
                {format(cap)}{pct > 0 ? ` (${pct}%)` : ""}
              </dd>
            </>
          )}
        </dl>
      </div>
    </details>
  );
}

function EnergyPip({
  context,
  produced,
  rates,
  required,
  scaleBps,
  crawlerProduction,
  sources,
}: {
  context: string;
  produced: number;
  rates: Resources;
  required: number;
  scaleBps: number;
  crawlerProduction?: CrawlerProductionInfo | null | undefined;
  sources?: EnergyBalance["sources"] | undefined;
}) {
  const current = produced - required;
  const tone = current < 0 ? "text-red-300" : "text-lime-300";
  const showShortageFactor = current < 0 && required > 0 && scaleBps < BPS;
  const productionPercent = Math.floor((scaleBps * 100) / BPS);
  const energyExplanation = energyExplanationTitle({ context, produced, required, scaleBps, sources });
  const popupExplanation = `${energyExplanation} ${crawlerExplanationTitle(crawlerProduction)}`;

  return (
    <div
      className="flex h-10 min-w-0 flex-[1.5] items-center justify-center rounded border border-white/10 bg-white/[0.03] px-1 whitespace-nowrap sm:h-6 sm:flex-none sm:justify-start sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0"
      title={showShortageFactor
        ? `${format(produced)} produced / ${format(required)} required; production reduced to ${productionPercent}%`
        : `${format(produced)} produced / ${format(required)} required`}
    >
      <span className="inline-flex min-w-0 items-center gap-0.5 sm:gap-1.5">
        <span className={`text-[11px] font-semibold leading-none sm:text-xs ${tone}`}>
          <span className="sm:hidden">E</span>
          <span className="hidden sm:inline">Energy</span>
        </span>
        <span className={`min-w-0 truncate text-[11px] leading-none sm:text-xs ${current < 0 ? "text-red-200" : "text-white"}`}>
          <span className="sm:hidden" ref={tickValueRef(current, formatCompact)}>{formatCompact(current)}</span>
          <span className="hidden sm:inline" ref={tickValueRef(current, format)}>{format(current)}</span>
        </span>
        {required > 0 && <span className="hidden text-[10px] leading-none text-slate-500 sm:inline">{format(produced)}/{format(required)}</span>}
        {showShortageFactor && (
          <span className="text-[9px] font-semibold leading-none text-red-200 sm:text-[10px]">
            <span className="sm:hidden">{productionPercent}%</span>
            <span className="hidden sm:inline">{productionPercent}% output</span>
          </span>
        )}
        <details className="group relative ml-0.5 inline-flex shrink-0 sm:ml-1" data-close-outside ref={detailsCloseOutsideRef}>
          <summary
            aria-label={popupExplanation}
            className="inline-grid h-8 w-8 cursor-pointer list-none place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-400 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 sm:h-5 sm:w-5 [&::-webkit-details-marker]:hidden"
            title="Resources explanation"
          >
            <Info aria-hidden="true" size={12} strokeWidth={2.25} />
          </summary>
          <div className="fixed left-2 right-2 top-12 z-50 whitespace-normal rounded border border-cyan-300/25 bg-[#111827] p-3 text-left text-xs leading-5 text-slate-300 shadow-2xl shadow-black/50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
            <div className="font-semibold text-cyan-100">Resources</div>
            <div className="mt-1 font-mono text-[11px] leading-4 text-cyan-200">{context}</div>
            <p className="mt-1">
              Mines produce resources. Energy powers mines, and crawlers can boost mine output.
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4">
              <dt className="text-slate-500">Metal production</dt>
              <dd className="text-right font-semibold text-slate-100">{formatRate(rates.metal)}</dd>
              <dt className="text-slate-500">Crystal production</dt>
              <dd className="text-right font-semibold text-slate-100">{formatRate(rates.crystal)}</dd>
              <dt className="text-slate-500">Deuterium production</dt>
              <dd className="text-right font-semibold text-slate-100">{formatRate(rates.deuterium)}</dd>
            </dl>
            <div className="mt-2 border-t border-white/10 pt-2 font-semibold text-cyan-100">Energy</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4">
              <dt className="text-slate-500">Produced</dt>
              <dd className="text-right font-semibold text-slate-100">{format(produced)}</dd>
              <dt className="text-slate-500">Consumed</dt>
              <dd className="text-right font-semibold text-slate-100">{format(required)}</dd>
              <dt className="text-slate-500">Balance</dt>
              <dd className={`text-right font-semibold ${current < 0 ? "text-red-200" : "text-lime-200"}`}>{format(current)}</dd>
            </dl>
            {sources && (
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[11px] leading-4">
                <dt className="text-slate-500">Production in total</dt>
                <dd className="text-right font-semibold text-slate-100">{format(produced)}</dd>
                <dt className="text-slate-500">Solar Plant</dt>
                <dd className="text-right font-semibold text-slate-100">{format(sources.solarPlant)}</dd>
                <dt className="text-slate-500">Fusion Generator</dt>
                <dd className="text-right font-semibold text-slate-100">{format(sources.fusionReactor)} from {format(sources.fusionReactorDeuteriumConsumed)} DEUT/h</dd>
                <dt className="text-slate-500">Solar Satellites</dt>
                <dd className="text-right font-semibold text-slate-100">
                  {format(sources.solarSatellites)} from {format(sources.solarSatelliteCount)} satellites ({format(sources.solarSatelliteEnergy)} E/Sat)
                </dd>
              </dl>
            )}
            <CrawlerProductionDetails crawlerProduction={crawlerProduction} />
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

function CrawlerProductionDetails({
  crawlerProduction,
}: {
  crawlerProduction?: CrawlerProductionInfo | null | undefined;
}) {
  if (!crawlerProduction) {
    return (
      <>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[11px] leading-4">
          <dt className="text-slate-500">Crawler boost</dt>
          <dd className="text-right font-semibold text-slate-100">Syncing</dd>
          <dt className="text-slate-500">Crawlers</dt>
          <dd className="text-right font-semibold text-slate-100">Waiting for production model</dd>
          <dt className="text-slate-500">Metal impact</dt>
          <dd className="text-right font-semibold text-slate-100">Syncing</dd>
          <dt className="text-slate-500">Crystal impact</dt>
          <dd className="text-right font-semibold text-slate-100">Syncing</dd>
          <dt className="text-slate-500">Deuterium impact</dt>
          <dd className="text-right font-semibold text-slate-100">Syncing</dd>
        </dl>
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          Crawler production details are syncing from the backend production model.
        </p>
      </>
    );
  }

  return (
    <>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[11px] leading-4">
        <dt className="text-slate-500">Crawler boost</dt>
        <dd className="text-right font-semibold text-slate-100">{formatCrawlerBoost(crawlerProduction.boostBps)}</dd>
        <dt className="text-slate-500">Crawlers</dt>
        <dd className="text-right font-semibold text-slate-100">
          {format(crawlerProduction.effective)} / {format(crawlerProduction.total)} effective
        </dd>
        <dt className="text-slate-500">Effective cap</dt>
        <dd className={crawlerProduction.capped ? "text-right font-semibold text-amber-200" : "text-right font-semibold text-slate-100"}>
          {format(crawlerProduction.maxEffective)}
        </dd>
        <dt className="text-slate-500">Metal impact</dt>
        <dd className="text-right font-semibold text-slate-100">{formatCrawlerImpact(crawlerProduction.productionIncreasePerHour.metal)}</dd>
        <dt className="text-slate-500">Crystal impact</dt>
        <dd className="text-right font-semibold text-slate-100">{formatCrawlerImpact(crawlerProduction.productionIncreasePerHour.crystal)}</dd>
        <dt className="text-slate-500">Deuterium impact</dt>
        <dd className="text-right font-semibold text-slate-100">{formatCrawlerImpact(crawlerProduction.productionIncreasePerHour.deuterium)}</dd>
      </dl>
      <p className={`mt-2 text-[11px] leading-4 ${crawlerProduction.capped ? "text-amber-200" : "text-slate-400"}`}>
        {crawlerProduction.total <= 0
          ? "No crawlers are boosting this planet yet."
          : crawlerProduction.capped
          ? "Extra crawlers above the effective cap are idle until mine levels increase."
          : "Only effective crawlers contribute to mine production."}
      </p>
    </>
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

function formatCrawlerBoost(boostBps: string): string {
  const bps = Number(boostBps);
  if (!Number.isFinite(bps) || bps <= 0) return "+0%";
  return `+${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatCrawlerImpact(value: number | string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0/h";
  return formatRate(numeric);
}

function formatRate(value: number): string {
  return `+${format(value)}/h`;
}

function crawlerExplanationTitle(crawler: CrawlerProductionInfo | null | undefined): string {
  if (!crawler) {
    return "Crawler production details are syncing from the backend production model.";
  }

  const details = [
    `Crawler boost ${formatCrawlerBoost(crawler.boostBps)}.`,
    `${format(crawler.effective)} of ${format(crawler.total)} crawlers effective.`,
    `Effective cap ${format(crawler.maxEffective)}.`,
    `Impact: ${formatCrawlerImpact(crawler.productionIncreasePerHour.metal)} metal, ${formatCrawlerImpact(crawler.productionIncreasePerHour.crystal)} crystal, ${formatCrawlerImpact(crawler.productionIncreasePerHour.deuterium)} deuterium.`,
  ];
  if (crawler.total <= 0) {
    details.push("No crawlers are boosting this planet yet.");
  } else if (crawler.capped) {
    details.push("Extra crawlers above the effective cap are idle until mine levels increase.");
  } else {
    details.push("Only effective crawlers contribute to mine production.");
  }
  return details.join(" ");
}

function resourceTitle(label: string, value: number, rate: number | undefined, cap: number | undefined): string {
  const details = [`${label}: ${format(value)}`];
  if (rate !== undefined) details.push(`+${format(rate)}/h`);
  if (cap !== undefined) details.push(`Cap ${format(cap)}`);
  return details.join(" / ");
}
