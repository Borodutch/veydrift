import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Resources, ShipKey } from "../playableMvp";
import { canAfford, missingUnlockRequirements, shipCatalog, shipDurationEstimate } from "../playableMvp";
import type { ChainShipyardState } from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface ShipyardPageProps {
  actionState: ShipyardActionState;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  onBuild: (shipId: number, key: ShipKey, quantity: number) => void;
  onCollect: () => void;
  onFinish: () => void;
  onRefresh: () => void;
  shipyardState: ChainShipyardState | null;
}

const groupLabels = {
  civil: "Civil and economy",
  combat: "Combat ships",
  special: "Probes, satellites, specials",
} as const;

export function ShipyardPage({
  actionState,
  canTransact,
  error,
  loading,
  onBuild,
  onCollect,
  onFinish,
  onRefresh,
  shipyardState,
}: ShipyardPageProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const shipyardLevel = shipyardState?.shipyardLevel ?? 0;
  const resources = toResources(shipyardState?.resources);
  const queue = shipyardState?.queue?.active ? shipyardState.queue : undefined;
  const productionAvailable = shipyardState?.productionAvailable !== false;
  const queueReady =
    queue?.readyAt ? Number(queue.readyAt) <= Math.floor(Date.now() / 1_000) : false;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Shipyard</h2>
          <p className="mt-1 text-xs text-slate-400">
            {shipyardState?.homePlanetId
              ? `Planet #${shipyardState.homePlanetId} · Shipyard Level ${shipyardLevel}`
              : productionAvailable
                ? "On-chain VeydriftGame planet required for ship production"
                : "Ship production contract unavailable on this deployment"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue && (
            <button
              className="h-9 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={!canTransact || actionState.status === "pending"}
              onClick={queueReady ? onFinish : onCollect}
              type="button"
            >
              {queueReady ? "Complete queue" : "Refresh queue"}
            </button>
          )}
          <button
            className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      <StatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        queue={queue}
        queueReady={queueReady}
        shipyardState={shipyardState}
      />

      {(["civil", "combat", "special"] as const).map((group) => (
        <section className="grid gap-3" key={group}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {groupLabels[group]}
            </h3>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {shipCatalog
              .filter((ship) => ship.group === group)
              .map((ship) => {
                const chainShip = shipyardState?.ships.find((item) => item.id === ship.id);
                const owned = productionAvailable ? chainShip?.count : undefined;
                const baseCost = productionAvailable ? toResources(chainShip?.cost) : undefined;
                const quantity = quantities[ship.key] ?? 1;
                const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
                const durationSeconds = baseCost
                  ? shipDurationEstimate(shipyardLevel, shipyardState?.naniteLevel ?? 0, baseCost, quantity)
                  : undefined;
                const missing = getMissingRequirements(ship, shipyardState);
                const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
                const blockedReason = getBlockedReason({
                  affordable,
                  canTransact,
                  hasPlanet: Boolean(shipyardState?.homePlanetId),
                  missing,
                  queueActive: Boolean(queue),
                  resources,
                  shipyardState,
                });
                const disabled = Boolean(blockedReason) || actionState.status === "pending";

                return (
                  <ShipTile
                    blockedReason={blockedReason}
                    cost={totalCost}
                    disabled={disabled}
                    durationSeconds={durationSeconds}
                    key={ship.key}
                    missing={missing}
                    onBuild={() => onBuild(ship.id, ship.key, quantity)}
                    onQuantity={(next) => setQuantities((prev) => ({ ...prev, [ship.key]: next }))}
                    owned={owned}
                    quantity={quantity}
                    ship={ship}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusPanel({
  actionState,
  error,
  loading,
  queue,
  queueReady,
  shipyardState,
}: {
  actionState: ShipyardActionState;
  error: string | undefined;
  loading: boolean;
  queue: ChainShipyardState["queue"] | undefined;
  queueReady: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
}) {
  if (loading) {
    return <Notice tone="neutral">Reading on-chain shipyard state.</Notice>;
  }

  if (error) {
    return <Notice tone="danger">Shipyard state could not be loaded from the backend. Refresh or try again after deployment sync.</Notice>;
  }

  if (shipyardState?.productionAvailable === false) {
    return (
      <Notice tone="neutral">
        {shipyardState.unavailableReason ?? "Ship production is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!shipyardState?.homePlanetId) {
    return (
      <Notice tone="danger">
        No VeydriftGame home planet was found for this wallet. Ship counts and production are not shown from local state.
      </Notice>
    );
  }

  if (actionState.status !== "idle") {
    const tone = actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "neutral";
    return <Notice tone={tone}>{actionState.label}</Notice>;
  }

  if (queue) {
    const ship = shipCatalog.find((item) => item.id === queue.itemId);
    return (
      <Notice tone={queueReady ? "success" : "neutral"}>
        {ship?.label ?? "Ship"} production: {queue.quantity ?? 0} queued, ready {formatReady(queue.readyAt)}.
      </Notice>
    );
  }

  return null;
}

function ShipTile({
  blockedReason,
  cost,
  disabled,
  durationSeconds,
  missing,
  onBuild,
  onQuantity,
  owned,
  quantity,
  ship,
}: {
  blockedReason: string | undefined;
  cost: Resources | undefined;
  disabled: boolean;
  durationSeconds: number | undefined;
  missing: string[];
  onBuild: () => void;
  onQuantity: (quantity: number) => void;
  owned: number | undefined;
  quantity: number;
  ship: (typeof shipCatalog)[number];
}) {
  return (
    <article className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded border border-white/10 bg-[#101624] p-3 sm:grid-cols-[104px_minmax(0,1fr)]">
      <OptimizedImage
        alt=""
        className="aspect-square w-full rounded bg-black/20 object-contain p-1"
        sizes="shipThumbnail"
        src={ship.asset}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-white">{ship.label}</h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Owned: {owned === undefined ? "unavailable" : format(owned)}
            </p>
          </div>
          <span className={missing.length === 0 ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
            {missing.length === 0 ? "Ready" : "Locked"}
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label="Metal" value={cost ? format(cost.metal) : "-"} />
          <Stat label="Crystal" value={cost ? format(cost.crystal) : "-"} />
          <Stat label="Deut" value={cost ? format(cost.deuterium) : "-"} />
          <Stat label="Build time" value={durationSeconds === undefined ? "-" : formatDuration(durationSeconds)} />
        </dl>

        <div className="mt-3 min-h-10 text-xs leading-5 text-slate-400">
          {missing.length > 0 ? missing.join(" · ") : "Requirements met by on-chain state."}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            aria-label={`${ship.label} quantity`}
            className="h-9 w-20 rounded border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-signal/60"
            min={1}
            onInput={(event) => {
              const value = Number((event.currentTarget as HTMLInputElement).value);
              onQuantity(Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1);
            }}
            type="number"
            value={quantity}
          />
          <button
            className="h-9 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={disabled}
            onClick={onBuild}
            type="button"
          >
            Build
          </button>
          {blockedReason && <span className="text-xs text-slate-500">{blockedReason}</span>}
        </div>
      </div>
    </article>
  );
}

function Notice({
  children,
  tone,
}: {
  children: ComponentChildren;
  tone: "danger" | "neutral" | "success";
}) {
  const classes = {
    danger: "border-rose-300/20 bg-rose-300/5 text-rose-200",
    neutral: "border-sky-300/20 bg-sky-300/5 text-sky-200",
    success: "border-emerald-300/20 bg-emerald-300/5 text-emerald-200",
  } as const;

  return (
    <div className={`rounded border p-3 text-sm ${classes[tone]}`}>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value}</dd>
    </div>
  );
}

export function getMissingRequirements(
  ship: (typeof shipCatalog)[number],
  shipyardState?: ChainShipyardState | null | undefined,
): string[] {
  return missingUnlockRequirements(ship.requirements, {
    buildings: { shipyard: shipyardState?.shipyardLevel ?? 0 },
    research: technologyLevelsByKey(shipyardState?.technologyLevels),
  });
}

function getBlockedReason({
  affordable,
  canTransact,
  hasPlanet,
  missing,
  queueActive,
  resources,
  shipyardState,
}: {
  affordable: boolean;
  canTransact: boolean;
  hasPlanet: boolean;
  missing: string[];
  queueActive: boolean;
  resources: Resources | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
  if (!shipyardState) return "Waiting for chain state";
  if (shipyardState.productionAvailable === false) return "Ship production unavailable";
  if (!hasPlanet) return "No game planet";
  if (queueActive) return "Queue active";
  if (missing.length > 0) return missing[0];
  if (!resources) return "Resources unavailable";
  if (!affordable) return "Insufficient resources";
  return undefined;
}

function toResources(resources: ChainShipyardState["resources"] | ChainShipyardState["ships"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

function multiply(resources: Resources, quantity: number): Resources {
  return {
    metal: resources.metal * quantity,
    crystal: resources.crystal * quantity,
    deuterium: resources.deuterium * quantity,
  };
}

function formatReady(readyAt: string | null): string {
  if (!readyAt) return "unknown";
  const remaining = formatDurationUntil(Number(readyAt) * 1_000);
  return remaining === "Ready" ? "now" : `in ${remaining}`;
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatDuration(seconds: number): string {
  if (seconds < 3_600) {
    return `${Math.ceil(seconds / 60)}m`;
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h ${Math.ceil((seconds % 3_600) / 60)}m`;
  }

  return `${Math.floor(seconds / 86_400)}d ${Math.ceil((seconds % 86_400) / 3_600)}h`;
}

const technologyIdByKey: Partial<Record<string, number>> = {
  energy: 0,
  laser: 1,
  ion: 2,
  combustionDrive: 3,
  espionage: 4,
  computer: 5,
  weapons: 6,
  shielding: 7,
  armor: 8,
  hyperspace: 9,
  impulseDrive: 10,
  hyperspaceDrive: 11,
  plasma: 12,
  astrophysics: 13,
  intergalacticResearchNetwork: 14,
  graviton: 15,
};

function technologyLevelsByKey(levels: Record<string, number> | undefined) {
  return Object.fromEntries(
    Object.entries(technologyIdByKey).map(([key, id]) => [
      key,
      id === undefined ? 0 : levels?.[id.toString()] ?? 0,
    ]),
  );
}
