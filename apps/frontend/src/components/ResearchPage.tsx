import type { PlayableState, ResearchKey, ResearchRequirement, Resources } from "../playableMvp";
import {
  buildingCatalog,
  canAfford,
  researchCatalog,
  researchCost,
  researchDurationEstimate,
  researchRequirementsFor,
  unmetResearchRequirement,
} from "../playableMvp";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const researchGroups = ["Basic", "Drive", "Advanced", "Combat"];

interface ResearchPageProps {
  state: PlayableState;
  settledState: PlayableState;
  onResearch: (key: ResearchKey) => void;
}

export function ResearchPage({
  settledState,
  onResearch,
}: ResearchPageProps) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Research</h2>
          <p className="text-xs text-slate-400">
            OGame-style technologies unlock when the lab and prerequisite levels are ready.
          </p>
        </div>
        {settledState.researchQueue && (
          <span className="w-fit rounded bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-200">
            Research: {settledState.researchQueue.label}
          </span>
        )}
      </div>

      {settledState.buildings.researchLab === 0 ? (
        <div className="border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          Research Lab 1 is required before any technology can be queued.
        </div>
      ) : null}

      <div className="grid gap-4">
        {researchGroups.map((group) => {
          const entries = researchCatalog.filter((research) => research.lane === group);
          return (
            <section className="grid gap-2" key={group}>
              <h3 className="text-sm font-semibold uppercase tracking-normal text-slate-400">{group}</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {entries.map((research) => {
                  const cost = researchCost(settledState.research, research.key);
                  const currentLevel = settledState.research[research.key];
                  const missingRequirement = unmetResearchRequirement(settledState, research.key);
                  const affordable = canAfford(settledState.resources, cost);
                  const active = settledState.researchQueue?.key === research.key;
                  const queueOccupied = Boolean(settledState.researchQueue) && !active;
                  const disabled = active || queueOccupied || Boolean(missingRequirement) || !affordable;
                  const reason = active
                    ? "In progress"
                    : queueOccupied
                      ? "Research queue occupied"
                      : missingRequirement
                        ? `Requires ${formatRequirement(missingRequirement)}`
                        : !affordable
                          ? "Insufficient resources"
                          : "Available";

                  return (
                    <ResearchTile
                      actionLabel={active ? "In progress" : `Research to ${currentLevel + 1}`}
                      asset={research.asset}
                      cost={cost}
                      currentLevel={currentLevel}
                      disabled={disabled}
                      durationSeconds={settledState.buildings.researchLab > 0
                        ? researchDurationEstimate(settledState.buildings, cost)
                        : undefined}
                      key={research.key}
                      label={research.label}
                      onClick={() => onResearch(research.key)}
                      reason={reason}
                      requirements={researchRequirementsFor(research.key)}
                      targetLevel={currentLevel + 1}
                    />
                  );
                })}
              </div>
            </section>
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
  durationSeconds,
  label,
  onClick,
  reason,
  requirements,
  targetLevel,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  currentLevel: number;
  disabled: boolean;
  durationSeconds: number | undefined;
  label: string;
  onClick: () => void;
  reason: string;
  requirements: ResearchRequirement[];
  targetLevel: number;
}) {
  return (
    <article className={`border bg-[#101624] p-3 ${disabled ? "border-white/10" : "border-cyan-300/40"}`}>
      <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3">
        <img alt="" className="h-16 w-16 border border-white/10 object-cover" src={asset} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="break-words text-sm font-semibold text-white">{label}</h4>
              <p className="mt-1 text-xs text-slate-400">
                Level {currentLevel} to {targetLevel}
              </p>
            </div>
            <span className={`max-w-32 shrink-0 whitespace-normal px-2 py-1 text-right text-[0.68rem] font-semibold leading-tight ${disabled ? "bg-white/5 text-slate-400" : "bg-emerald-300/10 text-emerald-200"}`}>
              {reason}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <p>
              <span className="text-slate-500">Cost</span>
              <br />
              <span className="text-slate-200">{formatCost(cost)}</span>
            </p>
            <p>
              <span className="text-slate-500">Duration</span>
              <br />
              <span className="text-slate-200">{durationSeconds ? formatDuration(durationSeconds) : "Requires lab"}</span>
            </p>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-400">
            <span className="text-slate-500">Requires </span>
            {requirements.map(formatRequirement).join(" / ")}
          </p>

          <button
            className="mt-3 h-9 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:w-auto"
            disabled={disabled}
            onClick={onClick}
            type="button"
          >
            {actionLabel}
          </button>
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
    .join(" / ") || "No resource cost";
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function formatRequirement(requirement: ResearchRequirement): string {
  if (requirement.type === "building") {
    const building = buildingCatalog.find((item) => item.key === requirement.key);
    return `${building?.label ?? requirement.key} ${requirement.level}`;
  }

  const research = researchCatalog.find((item) => item.key === requirement.key);
  return `${research?.label ?? requirement.key} ${requirement.level}`;
}
