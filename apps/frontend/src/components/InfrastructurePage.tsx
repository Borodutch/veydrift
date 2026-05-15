import { useRef, useState } from "preact/hooks";
import type { BuildingEffectMetrics, BuildingKey, PlayableState, Resources } from "../playableMvp";
import { buildingCatalog, buildingEffectMetrics } from "../playableMvp";
import {
  buildingEnergyDetail,
  buildingUpgradeStatus,
  formatCost,
  formatDuration,
  formatNumber,
  formatSigned,
} from "../buildingDetails";
import { OptimizedImage } from "./OptimizedImage";

const shortResourceLabels: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deut.",
};

const buildingDescriptions: Record<BuildingKey, string> = {
  metalMine: "Extracts metal from the planet crust. Metal is the core material for construction and early ship production.",
  crystalMine: "Refines crystalline deposits used by electronics, labs, and advanced ship components.",
  deuteriumSynthesizer: "Condenses deuterium from deep atmospheric layers. Production depends on the planet model and power supply.",
  solarPlant: "Supplies solar energy to mines. Low energy reduces modeled resource output instead of inventing extra production.",
  roboticsFactory: "Improves construction logistics and shortens modeled building upgrade times.",
  shipyard: "Unlocks orbital manufacturing and improves ship production speed once built.",
  researchLab: "Enables technology research and improves modeled research speed.",
  metalStorage: "Raises the real metal storage cap for this planet.",
  crystalStorage: "Raises the real crystal storage cap for this planet.",
  deuteriumTank: "Raises the real deuterium storage cap for this planet.",
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
  const [selectedKey, setSelectedKey] = useState<BuildingKey>("metalMine");
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectedBuilding = buildingCatalog.find((building) => building.key === selectedKey)
    ?? buildingCatalog[0]!;

  function handleSelectBuilding(key: BuildingKey) {
    setSelectedKey(key);

    if (window.matchMedia("(max-width: 1279px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 0);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Infrastructure</h2>
          <p className="text-xs text-slate-400">
            Select a building to inspect real production, power, cost, and upgrade timing.
          </p>
        </div>
        {settledState.queue && (
          <span className="rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300">
            Building: {settledState.queue.label}
          </span>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:items-start">
        <div className="order-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:order-1 xl:grid-cols-3 2xl:grid-cols-4">
          {buildingCatalog.map((building) => {
            const currentLevel = settledState.buildings[building.key];
            const effect = buildingEffectMetrics(settledState.buildings, building.key);
            const isSelected = building.key === selectedBuilding.key;

            return (
              <BuildingSelectorTile
                asset={building.asset}
                currentLevel={currentLevel}
                effect={effect}
                isSelected={isSelected}
                isUnbuilt={currentLevel === 0}
                key={building.key}
                label={building.label}
                onClick={() => handleSelectBuilding(building.key)}
              />
            );
          })}
        </div>

        <div className="order-1 xl:order-2" ref={detailPanelRef}>
          <BuildingDetailPanel
            building={selectedBuilding}
            onUpgrade={() => onUpgrade(selectedBuilding.key)}
            state={settledState}
          />
        </div>
      </div>
    </div>
  );
}

function BuildingSelectorTile({
  asset,
  currentLevel,
  effect,
  isSelected,
  isUnbuilt,
  label,
  onClick,
}: {
  asset: string;
  currentLevel: number;
  effect: BuildingEffectMetrics;
  isSelected: boolean;
  isUnbuilt: boolean;
  label: string;
  onClick: () => void;
}) {
  const effectView = compactEffect(effect);

  return (
    <button
      aria-pressed={isSelected}
      className={`group min-w-0 rounded-md border bg-[#101624] p-2 text-left transition hover:border-signal/50 hover:bg-[#141d30] ${
        isSelected ? "border-signal/70 ring-1 ring-signal/40" : "border-white/10"
      } ${isUnbuilt ? "opacity-60 grayscale" : ""}`}
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
          <span className={isUnbuilt ? "text-slate-500" : "text-slate-300"}>Level {currentLevel}</span>
          <span className="truncate text-right text-signal">{effectView}</span>
        </span>
      </span>
    </button>
  );
}

function BuildingDetailPanel({
  building,
  onUpgrade,
  state,
}: {
  building: (typeof buildingCatalog)[number];
  onUpgrade: () => void;
  state: PlayableState;
}) {
  const currentLevel = state.buildings[building.key];
  const effect = buildingEffectMetrics(state.buildings, building.key);
  const energy = buildingEnergyDetail(state.buildings, building.key);
  const status = buildingUpgradeStatus(state, building.key);
  const effectRows = detailEffectRows(effect, energy);

  return (
    <aside className="min-w-0 rounded-lg border border-white/10 bg-[#0f1624] p-3 xl:sticky xl:top-4">
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-1">
        <div className={`aspect-square overflow-hidden rounded-md border border-white/10 bg-black/20 ${currentLevel === 0 ? "opacity-70 grayscale" : ""}`}>
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            height={512}
            loading="lazy"
            sizes="(min-width: 1280px) 400px, (min-width: 640px) 144px, 100vw"
            src={building.asset}
            width={512}
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-white">{building.label}</h3>
              <p className="mt-1 text-sm text-slate-400">
                Level {currentLevel} to {status.targetLevel}
              </p>
            </div>
            {currentLevel === 0 ? (
              <span className="rounded bg-white/5 px-2 py-1 text-xs font-semibold text-slate-400">
                Not built
              </span>
            ) : (
              <span className="rounded bg-emerald-300/10 px-2 py-1 text-xs font-semibold text-emerald-200">
                Active
              </span>
            )}
          </div>

          <p className="mt-3 text-sm leading-6 text-slate-300">
            {buildingDescriptions[building.key]}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {effectRows.map((row) => (
          <DetailMetric accent={row.accent ?? false} key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>

      <div className="mt-4 grid gap-2 border-t border-white/10 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <InfoBlock label="Upgrade cost" value={formatCost(status.cost)} />
        <InfoBlock label="Upgrade time" value={formatDuration(status.durationSeconds)} />
      </div>

      <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className={`text-sm font-semibold ${status.disabled ? "text-slate-400" : "text-emerald-200"}`}>
          {status.reason}
        </p>
      </div>

      <button
        aria-label={`Upgrade ${building.label} to Level ${status.targetLevel}`}
        className="mt-3 h-10 w-full rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        disabled={status.disabled}
        onClick={onUpgrade}
        type="button"
      >
        Upgrade to Level {status.targetLevel}
      </button>
    </aside>
  );
}

function DetailMetric({
  accent = false,
  label,
  value,
}: {
  accent?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-semibold ${accent ? "text-signal" : "text-slate-200"}`}>
        {value}
      </dd>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <p className="min-w-0">
      <span className="block text-xs uppercase tracking-normal text-slate-500">{label}</span>
      <span className="mt-1 block break-words text-sm font-semibold text-slate-200">{value}</span>
    </p>
  );
}

function detailEffectRows(effect: BuildingEffectMetrics, energy: ReturnType<typeof buildingEnergyDetail>) {
  const rows: Array<{ accent?: boolean; label: string; value: string }> = [];

  if (effect.kind === "production") {
    rows.push(
      {
        label: "Current production",
        value: `${formatNumber(effect.currentPerHour)} ${shortResourceLabels[effect.resource]}/h`,
      },
      {
        accent: true,
        label: "Next production",
        value: `${formatNumber(effect.nextPerHour)} ${shortResourceLabels[effect.resource]}/h (${formatSigned(effect.deltaPerHour)}/h)`,
      },
    );
  } else if (effect.kind === "energy") {
    rows.push(
      {
        label: "Current energy",
        value: `${formatNumber(effect.currentProduced)} produced / ${formatNumber(effect.required)} required`,
      },
      {
        accent: true,
        label: "Next energy",
        value: `${formatNumber(effect.nextProduced)} produced (${formatSigned(effect.deltaProduced)})`,
      },
    );
    return rows;
  } else if (effect.kind === "storage") {
    rows.push(
      {
        label: "Current capacity",
        value: `${formatNumber(effect.currentCapacity)} ${shortResourceLabels[effect.resource]}`,
      },
      {
        accent: true,
        label: "Next capacity",
        value: `${formatNumber(effect.nextCapacity)} ${shortResourceLabels[effect.resource]} (${formatSigned(effect.deltaCapacity)})`,
      },
    );
  } else if (effect.kind === "constructionSpeed") {
    rows.push(
      { label: "Current construction", value: `x${formatNumber(effect.currentFactor)}` },
      { accent: true, label: "Next construction", value: `x${formatNumber(effect.nextFactor)}` },
    );
  } else if (effect.kind === "shipyard") {
    rows.push(
      { label: "Current shipyard", value: effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Not built" },
      {
        accent: true,
        label: "Next shipyard",
        value: effect.nextUnlocked && !effect.unlocked ? "Unlocks orbital production" : `x${formatNumber(effect.nextFactor)}`,
      },
    );
  } else {
    rows.push(
      { label: "Current research speed", value: `x${formatNumber(effect.currentFactor)}` },
      { accent: true, label: "Next research speed", value: `x${formatNumber(effect.nextFactor)}` },
    );
  }

  if (energy.kind === "produces") {
    rows.push(
      { label: "Current energy", value: `${formatNumber(energy.current)} produced` },
      { accent: true, label: "Next energy", value: `${formatNumber(energy.next)} produced (${formatSigned(energy.delta)})` },
    );
  } else if (energy.kind === "requires") {
    rows.push(
      { label: "Current energy", value: `${formatNumber(energy.current)} required` },
      { accent: true, label: "Next energy", value: `${formatNumber(energy.next)} required (${formatSigned(-energy.delta)})` },
    );
  } else {
    rows.push(
      { label: "Current energy", value: "No direct energy use" },
      { label: "Next energy", value: "No direct energy change" },
    );
  }

  return rows;
}

function compactEffect(effect: BuildingEffectMetrics): string {
  if (effect.kind === "production") {
    return `${formatNumber(effect.currentPerHour)}/h`;
  }

  if (effect.kind === "energy") {
    return `${formatNumber(effect.currentProduced)} energy`;
  }

  if (effect.kind === "storage") {
    return `${formatNumber(effect.currentCapacity)} cap`;
  }

  if (effect.kind === "shipyard") {
    return effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Locked";
  }

  return `x${formatNumber(effect.currentFactor)}`;
}
