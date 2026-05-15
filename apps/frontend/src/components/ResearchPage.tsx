import { useRef, useState } from "preact/hooks";
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
import { OptimizedImage } from "./OptimizedImage";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const researchGroups = ["Basic", "Drive", "Advanced", "Combat"];

const researchDescriptions: Partial<Record<ResearchKey, string>> = {
  energy: "Improves the science base for power systems and unlocks higher-energy technologies.",
  laser: "Develops directed-energy systems used by defenses, weapons, and later plasma research.",
  ion: "Studies ionized particle control for advanced weapons and shield-adjacent systems.",
  hyperspace: "Opens the theoretical foundation for hyperspace travel, drives, and long-range research.",
  plasma: "Combines high-energy physics with weaponized plasma applications.",
  combustionDrive: "Improves early engine efficiency for basic ship movement and logistics.",
  impulseDrive: "Unlocks stronger drive systems for faster military and utility ships.",
  hyperspaceDrive: "Enables the highest tier of interstellar ship propulsion.",
  espionage: "Improves scanning, intelligence, and future reconnaissance capabilities.",
  computer: "Increases command-and-control capacity for fleet and automation systems.",
  astrophysics: "Expands colonization and deep-space discovery capability.",
  intergalacticResearchNetwork: "Links laboratories so mature empires can coordinate advanced research.",
  graviton: "Studies extreme gravity fields required for endgame-scale technologies.",
  weapons: "Improves offensive weapon systems across combat ships and defenses.",
  shielding: "Improves defensive shield systems and related energy barriers.",
  armor: "Improves hull materials and structural resilience.",
};

interface ResearchPageProps {
  state: PlayableState;
  settledState: PlayableState;
  onResearch: (key: ResearchKey) => void;
}

export function ResearchPage({
  settledState,
  onResearch,
}: ResearchPageProps) {
  const [selectedKey, setSelectedKey] = useState<ResearchKey>("energy");
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectedResearch = researchCatalog.find((research) => research.key === selectedKey)
    ?? researchCatalog[0]!;

  function handleSelectResearch(key: ResearchKey) {
    setSelectedKey(key);

    if (window.matchMedia("(max-width: 1279px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 0);
    }
  }

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
          <span className="w-fit rounded border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-200">
            Research: {settledState.researchQueue.label}
          </span>
        )}
      </div>

      {settledState.buildings.researchLab === 0 ? (
        <div className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          Research Lab 1 is required before any technology can be queued.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:items-start">
        <div className="order-2 grid gap-4 xl:order-1">
          {researchGroups.map((group) => {
            const entries = researchCatalog.filter((research) => research.lane === group);
            return (
              <section className="grid gap-2" key={group}>
                <h3 className="text-sm font-semibold uppercase tracking-normal text-slate-400">{group}</h3>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4">
                  {entries.map((research) => {
                    const status = researchActionStatus(settledState, research.key);
                    return (
                      <ResearchSelectorTile
                        asset={research.asset}
                        currentLevel={status.currentLevel}
                        isSelected={research.key === selectedResearch.key}
                        isUnresearched={status.currentLevel === 0}
                        key={research.key}
                        label={research.label}
                        onClick={() => handleSelectResearch(research.key)}
                        status={status.tileStatus}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="order-1 xl:order-2" ref={detailPanelRef}>
          <ResearchDetailPanel
            onResearch={() => onResearch(selectedResearch.key)}
            research={selectedResearch}
            state={settledState}
          />
        </div>
      </div>
    </div>
  );
}

function ResearchSelectorTile({
  asset,
  currentLevel,
  isSelected,
  isUnresearched,
  label,
  onClick,
  status,
}: {
  asset: string;
  currentLevel: number;
  isSelected: boolean;
  isUnresearched: boolean;
  label: string;
  onClick: () => void;
  status: string;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={`group min-w-0 rounded-md border bg-[#101624] p-2 text-left transition hover:border-cyan-300/50 hover:bg-[#141d30] ${
        isSelected ? "border-cyan-300/70 ring-1 ring-cyan-300/40" : "border-white/10"
      } ${isUnresearched ? "opacity-60 grayscale" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="block aspect-square overflow-hidden rounded border border-white/10 bg-black/20">
        <OptimizedImage
          alt=""
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          height={256}
          loading="lazy"
          sizes="112px"
          src={asset}
          width={256}
        />
      </span>
      <span className="mt-2 block min-w-0">
        <span className="block truncate text-sm font-semibold text-white">{label}</span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-xs">
          <span className={isUnresearched ? "text-slate-500" : "text-slate-300"}>Level {currentLevel}</span>
          <span className="truncate text-right text-cyan-200">{status}</span>
        </span>
      </span>
    </button>
  );
}

function ResearchDetailPanel({
  onResearch,
  research,
  state,
}: {
  onResearch: () => void;
  research: (typeof researchCatalog)[number];
  state: PlayableState;
}) {
  const status = researchActionStatus(state, research.key);
  const requirements = researchRequirementsFor(research.key);

  return (
    <aside className="min-w-0 rounded-lg border border-white/10 bg-[#0f1624] p-3 xl:sticky xl:top-4">
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-1">
        <div className={`aspect-square overflow-hidden rounded-md border border-white/10 bg-black/20 ${status.currentLevel === 0 ? "opacity-70 grayscale" : ""}`}>
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            height={512}
            loading="lazy"
            sizes="(min-width: 1280px) 400px, (min-width: 640px) 144px, 100vw"
            src={research.asset}
            width={512}
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-white">{research.label}</h3>
              <p className="mt-1 text-sm text-slate-400">
                Level {status.currentLevel} → {status.targetLevel}
              </p>
            </div>
            <span className={`rounded px-2 py-1 text-xs font-semibold ${status.disabled ? "bg-white/5 text-slate-400" : "bg-emerald-300/10 text-emerald-200"}`}>
              {status.badge}
            </span>
          </div>

          <p className="mt-3 text-sm leading-6 text-slate-300">
            {researchDescriptions[research.key] ?? "Expands the empire research model for future technologies and unlock paths."}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-2">
        <ResearchInfoRow label="Category" value={research.lane} />
        <ResearchInfoRow label="Requirements" value={requirements.length > 0 ? requirements.map(formatRequirement).join(" / ") : "None"} />
        <ResearchInfoRow label="Research cost" value={formatCost(status.cost)} />
        <ResearchInfoRow label="Research time" value={status.durationSeconds ? formatDuration(status.durationSeconds) : "Requires Research Lab"} />
      </dl>

      <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className={`text-sm font-semibold ${status.disabled ? "text-slate-400" : "text-emerald-200"}`}>
          {status.reason}
        </p>
      </div>

      <button
        aria-label={`Research ${research.label} to Level ${status.targetLevel}`}
        className="mt-3 h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        disabled={status.disabled}
        onClick={onResearch}
        type="button"
      >
        {status.actionLabel}
      </button>
    </aside>
  );
}

function ResearchInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-200">{value}</dd>
    </div>
  );
}

function researchActionStatus(state: PlayableState, key: ResearchKey) {
  const cost = researchCost(state.research, key);
  const currentLevel = state.research[key];
  const targetLevel = currentLevel + 1;
  const missingRequirement = unmetResearchRequirement(state, key);
  const affordable = canAfford(state.resources, cost);
  const active = state.researchQueue?.key === key;
  const queueOccupied = Boolean(state.researchQueue) && !active;
  const labMissing = state.buildings.researchLab === 0;
  const durationSeconds = labMissing ? undefined : researchDurationEstimate(state.buildings, cost);
  const disabled = active || queueOccupied || labMissing || Boolean(missingRequirement) || !affordable;
  const reason = active
    ? `Research to Level ${state.researchQueue?.targetLevel ?? targetLevel} in progress`
    : queueOccupied
      ? `Research queue occupied by ${state.researchQueue?.label ?? "another technology"}`
      : labMissing
        ? "Requires Research Lab 1"
        : missingRequirement
          ? `Requires ${formatRequirement(missingRequirement)}`
          : !affordable
            ? "Insufficient resources"
            : `Ready for Level ${targetLevel}`;
  const badge = active ? "In progress" : disabled ? "Locked" : "Available";

  return {
    actionLabel: active ? "In progress" : `Research Level ${targetLevel}`,
    badge,
    cost,
    currentLevel,
    disabled,
    durationSeconds,
    reason,
    targetLevel,
    tileStatus: active ? "Active" : disabled ? "Locked" : "Ready",
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
