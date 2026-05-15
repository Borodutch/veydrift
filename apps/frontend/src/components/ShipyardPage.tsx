import type { PlayableState, ShipKey, Resources } from "../playableMvp";
import { shipCatalog, canAfford } from "../playableMvp";
import { ResponsiveGameImage } from "./ResponsiveGameImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface ShipyardPageProps {
  state: PlayableState;
  settledState: PlayableState;
  onBuild: (key: ShipKey, quantity: number) => void;
}

export function ShipyardPage({
  state,
  settledState,
  onBuild,
}: ShipyardPageProps) {
  const shipyardLevel = settledState.buildings.shipyard;
  const hasShipyard = shipyardLevel > 0;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Shipyard</h2>
          <p className="text-xs text-slate-400">
            {hasShipyard
              ? `Shipyard Level ${shipyardLevel} — Production active`
              : "Requires Shipyard Level 1"}
          </p>
        </div>
        {settledState.queue && (
          <span className="rounded bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300">
            Building: {settledState.queue.label}
          </span>
        )}
      </div>

      {!hasShipyard && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-4">
          <p className="text-sm text-amber-200">
            Build a Shipyard in Infrastructure to unlock ship production.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {shipCatalog.map((ship) => {
          const affordable = canAfford(settledState.resources, ship.baseCost);
          const owned = settledState.ships[ship.key];

          return (
            <ShipTile
              actionLabel="Build 1"
              asset={ship.asset}
              cost={ship.baseCost}
              disabled={
                Boolean(settledState.queue) || !hasShipyard || !affordable
              }
              key={ship.key}
              label={ship.label}
              owned={owned}
              onClick={() => onBuild(ship.key, 1)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ShipTile({
  actionLabel,
  asset,
  cost,
  disabled,
  label,
  owned,
  onClick,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  disabled: boolean;
  label: string;
  owned: number;
  onClick: () => void;
}) {
  return (
    <article className="flex gap-4 overflow-hidden rounded-lg border border-white/10 bg-[#101624] p-4">
      <ResponsiveGameImage
        alt=""
        className="h-20 w-32 shrink-0 rounded object-cover sm:h-24 sm:w-40"
        decoding="async"
        loading="lazy"
        sizes="(min-width: 640px) 160px, 128px"
        src={asset}
        widths={[160, 320]}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">{label}</h3>
              <p className="text-sm text-slate-400">{owned} owned</p>
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
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {formatCost(cost)}
          </p>
        </div>
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
