import type { BuildingEffectMetrics, BuildingKey, PlayableState, Resources } from "../playableMvp";
import { buildingCatalog, buildingCost, buildingEffectMetrics, canAfford } from "../playableMvp";
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const shortResourceLabels: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deut.",
};

interface InfrastructurePageProps {
  state: PlayableState;
  settledState: PlayableState;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  settledState,
  onUpgrade,
}: InfrastructurePageProps) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Infrastructure</h2>
          <p className="text-xs text-slate-400">
            Production, capacity, and unlocks from the current game model.
          </p>
        </div>
        {settledState.queue && (
          <span className="rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300">
            Building: {settledState.queue.label}
          </span>
        )}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {buildingCatalog.map((building) => {
          const cost = buildingCost(settledState.buildings, building.key);
          const affordable = canAfford(settledState.resources, cost);
          const currentLevel = settledState.buildings[building.key];
          const effect = buildingEffectMetrics(settledState.buildings, building.key);

          return (
            <BuildingTile
              actionLabel={`Upgrade ${building.label} to Level ${currentLevel + 1}`}
              asset={building.asset}
              cost={cost}
              currentLevel={currentLevel}
              disabled={Boolean(settledState.queue) || !affordable}
              effect={effect}
              key={building.key}
              label={building.label}
              onClick={() => onUpgrade(building.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function BuildingTile({
  actionLabel,
  asset,
  cost,
  currentLevel,
  disabled,
  effect,
  label,
  onClick,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  currentLevel: number;
  disabled: boolean;
  effect: BuildingEffectMetrics;
  label: string;
  onClick: () => void;
}) {
  const effectView = formatEffect(effect);

  return (
    <article className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-[#101624] p-3 sm:grid-cols-[5.75rem_minmax(0,1fr)]">
      <OptimizedImage alt="" className="h-20 w-20 rounded-md object-cover sm:h-[5.75rem] sm:w-[5.75rem]" sizes="buildingCard" src={asset} width={92} height={92} />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">{label}</h3>
            <p className="mt-0.5 text-xs text-slate-400">Level {currentLevel}</p>
          </div>
          <button
            aria-label={actionLabel}
            className="h-8 shrink-0 whitespace-nowrap rounded-md border border-signal/40 bg-signal/10 px-2.5 text-xs font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={disabled}
            onClick={onClick}
            type="button"
          >
            Upgrade
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Metric label={effectView.currentLabel} value={effectView.currentValue} />
          <Metric label={effectView.nextLabel} value={effectView.nextValue} accent />
        </dl>
        <p className="mt-2 truncate border-t border-white/10 pt-2 text-xs text-slate-400">
          Cost {formatCost(cost)}
        </p>
      </div>
    </article>
  );
}

function Metric({
  accent = false,
  label,
  value,
}: {
  accent?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <dt className="truncate text-[0.65rem] uppercase text-slate-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-xs font-semibold ${accent ? "text-signal" : "text-slate-200"}`}>
        {value}
      </dd>
    </div>
  );
}

function formatEffect(effect: BuildingEffectMetrics): {
  currentLabel: string;
  currentValue: string;
  nextLabel: string;
  nextValue: string;
} {
  if (effect.kind === "production") {
    return {
      currentLabel: `${shortResourceLabels[effect.resource]}/h`,
      currentValue: format(effect.currentPerHour),
      nextLabel: "Next",
      nextValue: signed(effect.deltaPerHour),
    };
  }

  if (effect.kind === "energy") {
    return {
      currentLabel: "Energy",
      currentValue: `${format(effect.currentProduced)} / ${format(effect.required)}`,
      nextLabel: "Next",
      nextValue: signed(effect.deltaProduced),
    };
  }

  if (effect.kind === "storage") {
    return {
      currentLabel: `${shortResourceLabels[effect.resource]} cap`,
      currentValue: format(effect.currentCapacity),
      nextLabel: "Next",
      nextValue: signed(effect.deltaCapacity),
    };
  }

  if (effect.kind === "constructionSpeed") {
    return {
      currentLabel: "Build spd",
      currentValue: `x${format(effect.currentFactor)}`,
      nextLabel: "Next",
      nextValue: `x${format(effect.nextFactor)}`,
    };
  }

  if (effect.kind === "shipyard") {
    return {
      currentLabel: "Shipyard",
      currentValue: effect.unlocked ? "Active" : "Locked",
      nextLabel: "Next",
      nextValue: effect.nextUnlocked && !effect.unlocked ? "Unlocks" : `x${format(effect.nextFactor)}`,
    };
  }

  return {
    currentLabel: "Research spd",
    currentValue: `x${format(effect.currentFactor)}`,
    nextLabel: "Next",
    nextValue: `x${format(effect.nextFactor)}`,
  };
}

function formatCost(cost: Resources): string {
  const parts: Array<[string, number]> = [
    ["M", cost.metal],
    ["C", cost.crystal],
    ["D", cost.deuterium],
  ];
  return parts
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `${label} ${format(v)}`)
    .join(" / ");
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function signed(value: number): string {
  const rounded = Math.floor(value);

  if (rounded > 0) {
    return `+${format(rounded)}`;
  }

  return format(rounded);
}
