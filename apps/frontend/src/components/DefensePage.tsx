import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { DefenseKey, Resources } from "../playableMvp";
import { canAfford, defenseCatalog, missingUnlockRequirements } from "../playableMvp";
import type { ChainDefenseState } from "../walletFlow";
import { formatDurationUntil } from "../durationFormat";
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type DefenseActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface DefensePageProps {
  actionState: DefenseActionState;
  canTransact: boolean;
  defenseState: ChainDefenseState | null;
  error: string | undefined;
  loading: boolean;
  onBuild: (defenseId: number, key: DefenseKey, quantity: number) => void;
  onFinish: () => void;
  onRefresh: () => void;
}

const groupLabels = {
  kinetic: "Kinetic batteries",
  energy: "Energy weapons",
  shield: "Shield domes",
  missile: "Missiles",
} as const;

const missileThumbnailFrames: Partial<Record<DefenseKey, { transform: string }>> = {
  antiBallisticMissile: {
    transform: "translate(-6%, -5%) scale(1.25)",
  },
  interplanetaryMissile: {
    transform: "translate(4%, 5%) scale(0.98)",
  },
};

export function DefensePage({
  actionState,
  canTransact,
  defenseState,
  error,
  loading,
  onBuild,
  onFinish,
  onRefresh,
}: DefensePageProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const shipyardLevel = defenseState?.shipyardLevel ?? 0;
  const resources = toResources(defenseState?.resources);
  const queue = defenseState?.queue?.active ? defenseState.queue : undefined;
  const productionAvailable = defenseState?.productionAvailable !== false;
  const queueReady =
    queue?.readyAt ? Number(queue.readyAt) <= Math.floor(Date.now() / 1_000) : false;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Defenses</h2>
          <p className="mt-1 text-xs text-slate-400">
            {defenseState?.homePlanetId
              ? `Planet #${defenseState.homePlanetId} · Shipyard Level ${shipyardLevel}`
              : productionAvailable
                ? "On-chain VeydriftGame planet required for defense production"
                : "Defense production contract unavailable on this deployment"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue && (
            <button
              className="h-9 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={!canTransact || !queueReady || actionState.status === "pending"}
              onClick={onFinish}
              type="button"
            >
              Complete queue
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
        defenseState={defenseState}
        error={error}
        loading={loading}
        queue={queue}
        queueReady={queueReady}
      />

      {(["kinetic", "energy", "shield", "missile"] as const).map((group) => (
        <section className="grid gap-3" key={group}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {groupLabels[group]}
            </h3>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {defenseCatalog
              .filter((defense) => defense.group === group)
              .map((defense) => {
                const chainDefense = defenseState?.defenses.find((item) => item.id === defense.id);
                const owned = productionAvailable ? chainDefense?.count : undefined;
                const baseCost = productionAvailable ? toResources(chainDefense?.cost) : undefined;
                const quantity = quantities[defense.key] ?? 1;
                const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
                const missing = getMissingRequirements(defense, defenseState);
                const limitReason = getDefenseLimitReason(defense.key, quantity, defenseState);
                const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
                const blockedReason = getBlockedReason({
                  affordable,
                  canTransact,
                  defenseState,
                  hasPlanet: Boolean(defenseState?.homePlanetId),
                  limitReason,
                  missing,
                  queueActive: Boolean(queue),
                  resources,
                });
                const disabled = Boolean(blockedReason) || actionState.status === "pending";

                return (
                  <DefenseTile
                    blockedReason={blockedReason}
                    cost={totalCost}
                    defense={defense}
                    disabled={disabled}
                    key={defense.key}
                    missing={missing}
                    onBuild={() => onBuild(defense.id, defense.key, quantity)}
                    onQuantity={(next) => setQuantities((prev) => ({ ...prev, [defense.key]: next }))}
                    owned={owned}
                    quantity={quantity}
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
  defenseState,
  error,
  loading,
  queue,
  queueReady,
}: {
  actionState: DefenseActionState;
  defenseState?: ChainDefenseState | null | undefined;
  error: string | undefined;
  loading: boolean;
  queue: ChainDefenseState["queue"] | undefined;
  queueReady: boolean;
}) {
  if (loading) {
    return <Notice tone="neutral">Reading on-chain defense state.</Notice>;
  }

  if (error) {
    return <Notice tone="danger">Defense state could not be loaded from the backend. Refresh or try again after deployment sync.</Notice>;
  }

  if (defenseState?.productionAvailable === false) {
    return (
      <Notice tone="neutral">
        {defenseState.unavailableReason ?? "Defense production is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!defenseState?.homePlanetId) {
    return (
      <Notice tone="danger">
        No VeydriftGame home planet was found for this wallet. Defense counts and production are not shown from local state.
      </Notice>
    );
  }

  if (actionState.status !== "idle") {
    const tone = actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "neutral";
    return <Notice tone={tone}>{actionState.label}</Notice>;
  }

  if (queue) {
    const defense = defenseCatalog.find((item) => item.id === queue.itemId);
    return (
      <Notice tone={queueReady ? "success" : "neutral"}>
        {defense?.label ?? "Defense"} production: {queue.quantity ?? 0} queued, ready {formatReady(queue.readyAt)}.
      </Notice>
    );
  }

  return null;
}

function DefenseTile({
  blockedReason,
  cost,
  defense,
  disabled,
  missing,
  onBuild,
  onQuantity,
  owned,
  quantity,
}: {
  blockedReason: string | undefined;
  cost: Resources | undefined;
  defense: (typeof defenseCatalog)[number];
  disabled: boolean;
  missing: string[];
  onBuild: () => void;
  onQuantity: (quantity: number) => void;
  owned: number | undefined;
  quantity: number;
}) {
  const thumbnailFrame = missileThumbnailFrames[defense.key];

  return (
    <article className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded border border-white/10 bg-[#101624] p-3 sm:grid-cols-[104px_minmax(0,1fr)]">
      <div className="aspect-square w-full overflow-hidden rounded bg-black/20 p-1">
        <OptimizedImage
          alt=""
          className="h-full w-full object-contain"
          sizes="shipThumbnail"
          src={defense.asset}
          style={thumbnailFrame}
        />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-white">{defense.label}</h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Deployed: {owned === undefined ? "unavailable" : format(owned)}
            </p>
          </div>
          <span className={missing.length === 0 ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
            {missing.length === 0 ? "Ready" : "Locked"}
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Metal" value={cost ? format(cost.metal) : "-"} />
          <Stat label="Crystal" value={cost ? format(cost.crystal) : "-"} />
          <Stat label="Deut" value={cost ? format(cost.deuterium) : "-"} />
        </dl>

        <div className="mt-3 min-h-10 text-xs leading-5 text-slate-400">
          {missing.length > 0 ? missing.join(" · ") : "Requirements met by on-chain state."}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            aria-label={`${defense.label} quantity`}
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

export function getMissingDefenseRequirements(
  defense: (typeof defenseCatalog)[number],
  defenseState?: ChainDefenseState | null | undefined,
): string[] {
  return getMissingRequirements(defense, defenseState);
}

function getMissingRequirements(
  defense: (typeof defenseCatalog)[number],
  defenseState?: ChainDefenseState | null | undefined,
): string[] {
  return missingUnlockRequirements(defense.requirements, {
    buildings: {
      shipyard: defenseState?.shipyardLevel ?? 0,
      missileSilo: defenseState?.missileSiloLevel ?? 0,
    },
    research: technologyLevelsByKey(defenseState?.technologyLevels),
  });
}

function getDefenseLimitReason(
  key: DefenseKey,
  quantity: number,
  defenseState?: ChainDefenseState | null | undefined,
): string | undefined {
  if (!defenseState) return undefined;

  const count = defenseCount(defenseState, key);
  if ((key === "smallShieldDome" || key === "largeShieldDome") && count + quantity > 1) {
    return "One shield dome of this type per planet";
  }

  const slotsPerUnit = key === "antiBallisticMissile" ? 1 : key === "interplanetaryMissile" ? 2 : 0;
  if (slotsPerUnit === 0) return undefined;

  const usedSlots =
    defenseCount(defenseState, "antiBallisticMissile")
    + defenseCount(defenseState, "interplanetaryMissile") * 2;
  const capacity = (defenseState.missileSiloLevel ?? 0) * 10;
  return usedSlots + slotsPerUnit * quantity > capacity ? "Missile Silo capacity full" : undefined;
}

function getBlockedReason({
  affordable,
  canTransact,
  defenseState,
  hasPlanet,
  limitReason,
  missing,
  queueActive,
  resources,
}: {
  affordable: boolean;
  canTransact: boolean;
  defenseState?: ChainDefenseState | null | undefined;
  hasPlanet: boolean;
  limitReason?: string | undefined;
  missing: string[];
  queueActive: boolean;
  resources: Resources | undefined;
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
  if (!defenseState) return "Waiting for chain state";
  if (defenseState.productionAvailable === false) return "Defense production unavailable";
  if (!hasPlanet) return "No game planet";
  if (queueActive) return "Queue active";
  if (missing.length > 0) return missing[0];
  if (limitReason) return limitReason;
  if (!resources) return "Resources unavailable";
  if (!affordable) return "Insufficient resources";
  return undefined;
}

function defenseCount(defenseState: ChainDefenseState, key: DefenseKey): number {
  const defense = defenseCatalog.find((item) => item.key === key);
  if (!defense) return 0;
  return defenseState.defenses.find((item) => item.id === defense.id)?.count ?? 0;
}

function toResources(resources: ChainDefenseState["resources"] | ChainDefenseState["defenses"][number]["cost"] | null | undefined): Resources | undefined {
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

const technologyIdByKey: Partial<Record<string, number>> = {
  energy: 0,
  laser: 1,
  ion: 2,
  combustionDrive: 3,
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
