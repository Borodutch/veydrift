import type { PlayableState, BuildingKey, Resources } from "../playableMvp";
import { buildingCatalog, buildingCost, canAfford } from "../playableMvp";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface InfrastructurePageProps {
  state: PlayableState;
  settledState: PlayableState;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  state,
  settledState,
  onUpgrade,
}: InfrastructurePageProps) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Infrastructure</h2>
          <p className="text-xs text-slate-400">
            Upgrade buildings to increase production and unlock capabilities.
          </p>
        </div>
        {settledState.queue && (
          <span className="rounded bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300">
            Building: {settledState.queue.label}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {buildingCatalog.map((building) => {
          const cost = buildingCost(settledState.buildings, building.key);
          const affordable = canAfford(settledState.resources, cost);
          const currentLevel = settledState.buildings[building.key];

          return (
            <BuildingTile
              actionLabel={`Upgrade to ${currentLevel + 1}`}
              asset={building.asset}
              cost={cost}
              currentLevel={currentLevel}
              disabled={Boolean(settledState.queue) || !affordable}
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
  label,
  onClick,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  currentLevel: number;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <img alt="" className="aspect-[16/9] w-full object-cover" src={asset} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">{label}</h3>
            <p className="mt-1 text-sm text-slate-400">Level {currentLevel}</p>
          </div>
          <button
            className="h-9 shrink-0 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={disabled}
            onClick={onClick}
            type="button"
          >
            {actionLabel}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          {formatCost(cost)}
        </p>
      </div>
    </article>
  );
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
