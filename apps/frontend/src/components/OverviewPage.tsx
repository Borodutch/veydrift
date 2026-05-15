import {
  buildingCatalog,
  shipCatalog,
  type PlayableState,
  type Resources,
} from "../playableMvp";
import type {
  OnChainResources,
  PlanetSummary,
  PlayerQueuesResponse,
  QueueStateResponse,
  WalletSettlementResponse,
} from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const buildingLabels = buildingCatalog.map((item) => item.label);
const shipLabels = shipCatalog.map((item) => item.label);
const researchLabels = [
  "Energy Technology",
  "Laser Technology",
  "Ion Technology",
  "Combustion Drive",
  "Espionage Technology",
  "Computer Technology",
  "Weapons Technology",
  "Shielding Technology",
  "Armor Technology",
  "Hyperspace Technology",
  "Impulse Drive",
  "Hyperspace Drive",
  "Plasma Technology",
  "Astrophysics",
  "Intergalactic Research Network",
  "Graviton Technology",
];

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

interface OverviewPageProps {
  settledState: PlayableState;
  rates: Resources;
  caps: Resources;
  queueProgress: number;
  researchProgress: number;
  now: number;
  planet?: PlanetSummary | undefined;
  isWalletConnected: boolean;
  onNavigate: (page: "infrastructure" | "research" | "shipyard") => void;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
}

type QueueSummary = {
  label: string;
  detail: string;
  readyText: string;
  progress?: number | undefined;
  active: boolean;
};

export function OverviewPage({
  settledState,
  rates,
  caps,
  queueProgress,
  researchProgress,
  now,
  planet,
  isWalletConnected,
  onNavigate,
  onChainSettlement,
  onChainQueues,
}: OverviewPageProps) {
  const resources = onChainSettlement?.planet
    ? toResources(onChainSettlement.planet.resources)
    : settledState.resources;
  const resourceSource = onChainSettlement?.planet ? "On-chain" : "Local preview";
  const planetStats = buildPlanetStats(onChainSettlement, planet, settledState);
  const constructionQueue = buildConstructionQueue(onChainQueues?.building, settledState, now, queueProgress);
  const researchQueue = buildResearchQueue(onChainQueues?.research, settledState, now, researchProgress);
  const shipyardQueue = buildShipyardQueue(onChainQueues?.ship, settledState, now, queueProgress);

  return (
    <div className="grid gap-3 lg:gap-4">
      <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[180px] sm:min-h-[210px] lg:min-h-[240px]">
            <OptimizedImage
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              sizes="hero"
              src="/assets/game/planets/lush-temperate.webp"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.12),rgba(7,9,19,0.88))]" />
            <div className="relative flex min-h-[180px] flex-col justify-end p-4 sm:min-h-[210px] sm:p-5 lg:min-h-[240px]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/80">
                Home planet
              </p>
              <h2 className="mt-1 truncate text-2xl font-semibold text-white sm:text-3xl">
                {planetStats.title}
              </h2>
              <p className="mt-1 truncate font-mono text-xs text-slate-300">
                {planetStats.coordinates}
              </p>
            </div>
          </div>

          <div className="grid content-start gap-2 border-t border-white/10 p-3 sm:grid-cols-2 sm:p-4 lg:border-l lg:border-t-0">
            {planetStats.items.map((item) => (
              <Metric key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">Resources</h2>
          <span className="rounded bg-white/8 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
            {resourceSource}
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <ResourceStat label="Metal" value={resources.metal} rate={rates.metal} cap={caps.metal} color="text-amber-300" />
          <ResourceStat label="Crystal" value={resources.crystal} rate={rates.crystal} cap={caps.crystal} color="text-cyan-300" />
          <ResourceStat label="Deuterium" value={resources.deuterium} rate={rates.deuterium} cap={caps.deuterium} color="text-emerald-300" />
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101624] p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">Queues</h2>
          <span className="text-xs text-slate-400">
            {isWalletConnected ? "Wallet state" : "Connect wallet for chain state"}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <QueuePanel
            emptyAction="Build Infrastructure"
            emptyText="No active construction."
            onNavigate={() => onNavigate("infrastructure")}
            queue={constructionQueue}
            title="Buildings"
          />
          <QueuePanel
            emptyAction="Open Research"
            emptyText="No active research."
            onNavigate={() => onNavigate("research")}
            queue={researchQueue}
            title="Research"
          />
          <QueuePanel
            emptyAction="Open Shipyard"
            emptyText="No active ship production."
            onNavigate={() => onNavigate("shipyard")}
            queue={shipyardQueue}
            title="Shipyard"
          />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <dt className="truncate text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-white" title={value}>{value}</dd>
    </div>
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
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`truncate text-sm font-semibold ${color}`}>{label}</p>
        <p className="shrink-0 text-[11px] text-slate-500">{pct}% cap</p>
      </div>
      <p className="mt-1 truncate text-lg font-semibold text-white" title={format(value)}>
        {format(value)}
      </p>
      <p className="mt-1 truncate text-xs text-slate-400">
        +{format(rate)}/h · cap {format(cap)}
      </p>
    </div>
  );
}

function QueuePanel({
  title,
  queue,
  emptyText,
  emptyAction,
  onNavigate,
}: {
  title: string;
  queue: QueueSummary | undefined;
  emptyText: string;
  emptyAction: string;
  onNavigate: () => void;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
        <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
          queue?.active ? "bg-cyan-300/10 text-cyan-200" : "bg-white/8 text-slate-400"
        }`}>
          {queue?.active ? "Active" : "Idle"}
        </span>
      </div>

      {queue ? (
        <div className="mt-3">
          <p className="truncate text-sm font-semibold text-white" title={queue.label}>
            {queue.label}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400" title={queue.detail}>
            {queue.detail}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-300 transition-[width]"
              style={{ width: `${Math.round((queue.progress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-2 truncate text-xs text-slate-300">{queue.readyText}</p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm leading-6 text-slate-300">{emptyText}</p>
          <button
            className="mt-3 rounded-md border border-white/15 bg-white/8 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/12"
            onClick={onNavigate}
            type="button"
          >
            {emptyAction}
          </button>
        </div>
      )}
    </div>
  );
}

function buildPlanetStats(
  settlement: WalletSettlementResponse | undefined,
  planet: PlanetSummary | undefined,
  settledState: PlayableState,
): { title: string; coordinates: string; items: Array<{ label: string; value: string }> } {
  const chainPlanet = settlement?.planet;
  const coordinates = chainPlanet
    ? `${chainPlanet.galaxy}:${chainPlanet.system}:${chainPlanet.position}`
    : planet?.coordinates ?? "--:--:--";
  const fields = chainPlanet?.fields ?? parseInteger(planet?.fields);
  const temperature = chainPlanet?.temperature ?? parseTemperature(planet?.temperature);
  const usedFields = usedBuildingFields(settledState);

  return {
    title: coordinates !== "--:--:--" ? `Planet ${coordinates}` : "Eos Relay",
    coordinates,
    items: [
      { label: "Temperature", value: temperature === undefined ? "--" : `${format(temperature)}°C` },
      { label: "Diameter", value: fields === undefined ? "--" : `${format(planetDiameter(fields))} km` },
      {
        label: "Fields",
        value: fields === undefined
          ? "--"
          : `${Math.min(usedFields, fields)} / ${format(fields)} fields`,
      },
      { label: "Planet ID", value: chainPlanet?.planetId ?? "Pending chain state" },
    ],
  };
}

function buildConstructionQueue(
  queue: QueueStateResponse | null | undefined,
  settledState: PlayableState,
  now: number,
  localProgress: number,
): QueueSummary | undefined {
  if (queue?.active) {
    const label = labelById(buildingLabels, queue.itemId, "Building");
    return {
      active: true,
      label,
      detail: `Level ${queue.targetLevel ?? "--"} · cost ${formatCost(queue.cost)}`,
      readyText: readyTextFromSeconds(queue.readyAt, now),
    };
  }

  if (settledState.queue?.kind === "building") {
    return {
      active: true,
      label: settledState.queue.label,
      detail: `Level ${settledState.queue.targetLevel}`,
      readyText: readyTextFromMillis(settledState.queue.readyAt, now),
      progress: localProgress,
    };
  }

  return undefined;
}

function buildResearchQueue(
  queue: QueueStateResponse | null | undefined,
  settledState: PlayableState,
  now: number,
  localProgress: number,
): QueueSummary | undefined {
  if (queue?.active) {
    const label = labelById(researchLabels, queue.itemId, "Research");
    return {
      active: true,
      label,
      detail: `Level ${queue.targetLevel ?? "--"} · cost ${formatCost(queue.cost)}`,
      readyText: readyTextFromSeconds(queue.readyAt, now),
    };
  }

  if (settledState.researchQueue) {
    return {
      active: true,
      label: settledState.researchQueue.label,
      detail: `Level ${settledState.researchQueue.targetLevel}`,
      readyText: readyTextFromMillis(settledState.researchQueue.readyAt, now),
      progress: localProgress,
    };
  }

  return undefined;
}

function buildShipyardQueue(
  queue: QueueStateResponse | null | undefined,
  settledState: PlayableState,
  now: number,
  localProgress: number,
): QueueSummary | undefined {
  if (queue?.active) {
    const label = labelById(shipLabels, queue.itemId, "Ship");
    return {
      active: true,
      label,
      detail: `${format(queue.quantity ?? 0)} queued · cost ${formatCost(queue.cost)}`,
      readyText: readyTextFromSeconds(queue.readyAt, now),
    };
  }

  if (settledState.queue?.kind === "ship") {
    return {
      active: true,
      label: settledState.queue.label,
      detail: `${format(settledState.queue.quantity)} queued`,
      readyText: readyTextFromMillis(settledState.queue.readyAt, now),
      progress: localProgress,
    };
  }

  return undefined;
}

function readyTextFromSeconds(readyAt: string | null, now: number): string {
  if (!readyAt) return "Ready time pending";
  const seconds = Math.max(0, Math.ceil((Number(readyAt) * 1_000 - now) / 1_000));
  return seconds === 0 ? "Ready to complete" : `Ready in ${formatDuration(seconds)}`;
}

function readyTextFromMillis(readyAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((readyAt - now) / 1_000));
  return seconds === 0 ? "Ready to complete" : `Ready in ${formatDuration(seconds)}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function toResources(resources: OnChainResources): Resources {
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

function formatCost(resources: QueueStateResponse["cost"]): string {
  const parts = [
    ["M", resources.metal],
    ["C", resources.crystal],
    ["D", resources.deuterium],
  ]
    .map(([label, value]) => `${label} ${format(Number(value))}`);

  return parts.join(" / ");
}

function labelById(labels: readonly string[], id: number | undefined, fallback: string): string {
  return id === undefined ? fallback : labels[id] ?? `${fallback} #${id}`;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function parseTemperature(value: string | undefined): number | undefined {
  return parseInteger(value);
}

function planetDiameter(fields: number): number {
  return Math.round(Math.sqrt(Math.max(0, fields)) * 1_000);
}

function usedBuildingFields(state: PlayableState): number {
  return Object.values(state.buildings).reduce((sum, level) => sum + level, 0);
}
