import type { PlayableState, ResearchKey, Resources } from "../playableMvp";
import { canAfford, researchCatalog, researchCost } from "../playableMvp";
import { ResponsiveGameImage } from "./ResponsiveGameImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface ResearchPageProps {
  state: PlayableState;
  settledState: PlayableState;
  onResearch: (key: ResearchKey) => void;
}

export function ResearchPage({
  state,
  settledState,
  onResearch,
}: ResearchPageProps) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Research</h2>
          <p className="text-xs text-slate-400">
            Start one research job in parallel with construction.
          </p>
        </div>
        {settledState.researchQueue && (
          <span className="rounded bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-200">
            Research: {settledState.researchQueue.label}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {researchCatalog.map((research) => {
          const cost = researchCost(settledState.research, research.key);
          const affordable = canAfford(settledState.resources, cost);
          const currentLevel = settledState.research[research.key];

          return (
            <ResearchTile
              actionLabel={`Research to ${currentLevel + 1}`}
              asset={research.asset}
              cost={cost}
              currentLevel={currentLevel}
              disabled={Boolean(settledState.researchQueue) || !affordable}
              key={research.key}
              label={research.label}
              lane={research.lane}
              onClick={() => onResearch(research.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ResearchTile({
  actionLabel,
  asset,
  cost,
  currentLevel,
  disabled,
  label,
  lane,
  onClick,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  currentLevel: number;
  disabled: boolean;
  label: string;
  lane: string;
  onClick: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <ResponsiveGameImage
        alt=""
        className="aspect-[16/9] w-full object-cover"
        decoding="async"
        loading="lazy"
        sizes="(min-width: 640px) 48vw, calc(100vw - 2rem)"
        src={asset}
        widths={[320, 640]}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">{label}</h3>
            <p className="mt-1 text-sm text-slate-400">
              Level {currentLevel} · {lane}
            </p>
          </div>
          <button
            className="h-9 shrink-0 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
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
