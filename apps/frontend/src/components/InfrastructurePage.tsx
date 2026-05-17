import { useLayoutEffect, useRef, useState } from "preact/hooks";
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

const loadedDetailImageKeys = new Set<BuildingKey>();

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
  actionNotice?: { label: string; tone: "error" | "success" | "pending" } | undefined;
  actionUnavailableReason?: string | undefined;
  chainCosts?: Partial<Record<BuildingKey, Resources>> | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  state: PlayableState;
  settledState: PlayableState;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  actionNotice,
  actionUnavailableReason,
  chainCosts,
  isBuildingReadyToFinish,
  onFinishBuilding,
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
        {isBuildingReadyToFinish && onFinishBuilding ? (
          <button
            className="h-9 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
            onClick={onFinishBuilding}
            type="button"
          >
            Finish upgrade
          </button>
        ) : settledState.queue ? (
          <span className="rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300">
            Building: {settledState.queue.label}
          </span>
        ) : null}
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
            actionNotice={actionNotice}
            actionUnavailableReason={actionUnavailableReason}
            building={selectedBuilding}
            chainCost={chainCosts?.[selectedBuilding.key]}
            isBuildingReadyToFinish={isBuildingReadyToFinish}
            onFinishBuilding={onFinishBuilding}
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
  actionNotice,
  actionUnavailableReason,
  building,
  chainCost,
  isBuildingReadyToFinish,
  onFinishBuilding,
  onUpgrade,
  state,
}: {
  actionNotice?: { label: string; tone: "error" | "success" | "pending" } | undefined;
  actionUnavailableReason?: string | undefined;
  building: (typeof buildingCatalog)[number];
  chainCost?: Resources | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  onUpgrade: () => void;
  state: PlayableState;
}) {
  const currentLevel = state.buildings[building.key];
  const effect = buildingEffectMetrics(state.buildings, building.key);
  const energy = buildingEnergyDetail(state.buildings, building.key);
  const status = buildingUpgradeStatus(state, building.key, { actionUnavailableReason, chainCost });
  const effectRows = detailEffectRows(effect, energy);
  const actionVerb = currentLevel === 0 ? "Build" : "Upgrade";
  const actionLabel = `${actionVerb} Level ${status.targetLevel}`;
  const noticeClass = actionNotice?.tone === "error"
    ? "border-rose-300/20 bg-rose-300/10 text-rose-200"
    : actionNotice?.tone === "success"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
      : "border-signal/20 bg-signal/10 text-signal";

  return (
    <aside className="min-w-0 rounded-lg border border-white/10 bg-[#0f1624] p-3 xl:sticky xl:top-4">
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-1">
        <BuildingDetailImage
          asset={building.asset}
          imageKey={building.key}
          isUnbuilt={currentLevel === 0}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-white">{building.label}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {currentLevel === 0 ? `Build Level ${status.targetLevel}` : `Level ${currentLevel} to ${status.targetLevel}`}
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

      <dl className="mt-4 grid gap-2">
        {effectRows.map((row) => (
          <ComparisonMetric
            delta={row.delta}
            key={row.label}
            label={row.label}
            next={row.next}
            tone={row.tone}
            value={row.value}
          />
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

      {actionNotice && (
        <div className={`mt-2 rounded border px-3 py-2 text-sm font-semibold ${noticeClass}`}>
          {actionNotice.label}
        </div>
      )}

      {isBuildingReadyToFinish && onFinishBuilding && (
        <button
          className="mt-3 h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
          onClick={onFinishBuilding}
          type="button"
        >
          Finish upgrade
        </button>
      )}

      <button
        aria-label={`${actionVerb} ${building.label} to Level ${status.targetLevel}`}
        className="mt-3 h-10 w-full rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        disabled={status.disabled}
        onClick={onUpgrade}
        type="button"
      >
        {actionLabel}
      </button>
    </aside>
  );
}

function BuildingDetailImage({
  asset,
  imageKey,
  isUnbuilt,
}: {
  asset: string;
  imageKey: BuildingKey;
  isUnbuilt: boolean;
}) {
  const currentImageKeyRef = useRef(imageKey);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const [loadedImageKey, setLoadedImageKey] = useState<BuildingKey | null>(() => (
    loadedDetailImageKeys.has(imageKey) ? imageKey : null
  ));
  const isLoaded = loadedImageKey === imageKey;

  currentImageKeyRef.current = imageKey;

  useLayoutEffect(() => {
    const image = imageElementRef.current;
    const isCached = Boolean(image?.complete && image.naturalWidth > 0);

    if (loadedDetailImageKeys.has(imageKey) || isCached) {
      loadedDetailImageKeys.add(imageKey);
      setLoadedImageKey(imageKey);
      return;
    }

    setLoadedImageKey(null);
  }, [imageKey]);

  return (
    <div
      aria-busy={!isLoaded}
      className={`relative aspect-square overflow-hidden rounded-md border border-white/10 bg-black/20 ${
        isUnbuilt ? "opacity-70 grayscale" : ""
      }`}
    >
      {!isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/10 via-white/[0.04] to-white/[0.08]" />
      )}
      <OptimizedImage
        alt=""
        className={`h-full w-full object-cover transition-opacity duration-150 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        height={512}
        imageRef={imageElementRef}
        key={imageKey}
        loading="lazy"
        onLoad={() => {
          if (imageKey !== currentImageKeyRef.current) return;
          loadedDetailImageKeys.add(imageKey);
          setLoadedImageKey(imageKey);
        }}
        sizes="(min-width: 1280px) 400px, (min-width: 640px) 144px, 100vw"
        src={asset}
        width={512}
      />
    </div>
  );
}

function ComparisonMetric({
  delta,
  label,
  next,
  tone = "positive",
  value,
}: {
  delta?: string | undefined;
  label: string;
  next: string;
  tone?: "neutral" | "positive" | "warning" | undefined;
  value: string;
}) {
  const deltaClass = tone === "warning"
    ? "text-amber-200"
    : tone === "neutral"
      ? "text-slate-300"
      : "text-signal";

  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2 text-sm font-semibold">
        <span className="min-w-0 break-words text-slate-200">{value}</span>
        <span aria-hidden="true" className="text-slate-500">→</span>
        <span className="min-w-0 break-words text-signal">{next}</span>
      </dd>
      {delta && <dd className={`mt-1 text-xs font-medium ${deltaClass}`}>{delta}</dd>}
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
  const rows: Array<{
    delta?: string;
    label: string;
    next: string;
    tone?: "neutral" | "positive" | "warning";
    value: string;
  }> = [];

  if (effect.kind === "production") {
    rows.push({
      delta: `${formatSigned(effect.deltaPerHour)}/h`,
      label: "Production",
      next: `${formatNumber(effect.nextPerHour)} ${shortResourceLabels[effect.resource]}/h`,
      value: `${formatNumber(effect.currentPerHour)} ${shortResourceLabels[effect.resource]}/h`,
    });
  } else if (effect.kind === "energy") {
    rows.push({
      delta: `${formatSigned(effect.deltaProduced)} produced`,
      label: "Energy output",
      next: `${formatNumber(effect.nextProduced)} produced`,
      value: `${formatNumber(effect.currentProduced)} produced`,
    });
    return rows;
  } else if (effect.kind === "storage") {
    rows.push({
      delta: `${formatSigned(effect.deltaCapacity)} capacity`,
      label: "Storage capacity",
      next: `${formatNumber(effect.nextCapacity)} ${shortResourceLabels[effect.resource]}`,
      value: `${formatNumber(effect.currentCapacity)} ${shortResourceLabels[effect.resource]}`,
    });
  } else if (effect.kind === "constructionSpeed") {
    rows.push({
      label: "Construction speed",
      next: `x${formatNumber(effect.nextFactor)}`,
      value: `x${formatNumber(effect.currentFactor)}`,
    });
  } else if (effect.kind === "shipyard") {
    rows.push({
      label: "Shipyard speed",
      next: effect.nextUnlocked && !effect.unlocked ? "Unlocks orbital production" : `x${formatNumber(effect.nextFactor)}`,
      value: effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Not built",
    });
  } else {
    rows.push({
      label: "Research speed",
      next: `x${formatNumber(effect.nextFactor)}`,
      value: `x${formatNumber(effect.currentFactor)}`,
    });
  }

  if (energy.kind === "produces") {
    rows.push({
      delta: `${formatSigned(energy.delta)} produced`,
      label: "Energy",
      next: `${formatNumber(energy.next)} produced`,
      value: `${formatNumber(energy.current)} produced`,
    });
  } else if (energy.kind === "requires") {
    rows.push({
      delta: `${formatSigned(energy.delta)} required`,
      label: "Energy required",
      next: `${formatNumber(energy.next)} required`,
      tone: "warning",
      value: `${formatNumber(energy.current)} required`,
    });
  } else {
    rows.push({
      label: "Energy",
      next: "No direct change",
      tone: "neutral",
      value: "No direct use",
    });
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
