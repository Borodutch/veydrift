import { Hammer } from "lucide-preact";
import { useState } from "preact/hooks";
import type { BuildingEffectMetrics, BuildingKey, BuildingRequirement, PlanetProductionProfile, PlayableState, Resources } from "../playableMvp";
import {
  buildingCatalog,
  buildingEffectMetrics,
  buildingRequirementsFor,
  isBinaryBuilding,
  researchCatalog,
  unmetBuildingRequirement,
} from "../playableMvp";
import {
  buildingEnergyDetail,
  buildingLevelInfoColumns,
  buildingLevelInfoRows,
  type BuildingUpgradeStatus,
  buildingUpgradeStatus,
  formatCost,
  formatDuration,
  formatFrontendOnlyBuildingRequirement,
  formatNumber,
  formatSigned,
  frontendOnlyBuildingRequirementsFor,
  missingFrontendOnlyBuildingRequirementFor,
} from "../buildingDetails";
import { buildingQueueLabel } from "../overviewData";
import { actionNoticeForBuilding, type InfrastructureActionNotice } from "../buildingActionNotice";
import {
  InspectInfoBlock,
  InspectPageHeader,
  SingleItemQueueProgress,
} from "./InspectProgressLayout";
import { RefreshButton, refreshButtonState } from "./PageHeader";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { LevelInfoButton, LevelInfoModal, type LevelInfoColumn, type LevelInfoRow } from "./LevelInfoModal";
import { StructureCatalog, StructureDetail, type StructureLevelInfo } from "./StructureCatalog";

const shortResourceLabels: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deut.",
};

const fullResourceLabels: Record<keyof Resources, string> = {
  metal: "Metal",
  crystal: "Crystal",
  deuterium: "Deuterium",
};

type BuildingQueueItem = Extract<NonNullable<PlayableState["queue"]>, { kind: "building" }>;

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
  fusionReactor: "Converts deuterium into supplemental power once the required energy research path is available.",
  naniteFactory: "Advanced automation for high-tier construction and later production-speed upgrades.",
  terraformer: "Expands usable planetary fields after nanite construction and high energy research are available.",
  allianceDepot: "Supplies deuterium from the defended planet to cover friendly group-defense holding fuel.",
  missileSilo: "Stores anti-ballistic and interplanetary missiles and gates missile production.",
  interdimensionalRiftStabilizer: "Custom Veydrift facility for later resource-token withdrawal and rift mechanics.",
};

interface InfrastructurePageProps {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionPendingLabel?: string | undefined;
  actionUnavailableReason?: string | undefined;
  chainCosts?: Partial<Record<BuildingKey, Resources>> | undefined;
  chainDurations?: Partial<Record<BuildingKey, number>> | undefined;
  hasLoadedInfrastructureState?: boolean | undefined;
  loading?: boolean | undefined;
  loadError?: string | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onSelectBuilding?: ((key: BuildingKey) => void) | undefined;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  productionRates?: Resources | undefined;
  selectedBuildingKey?: BuildingKey | undefined;
  spendableResources?: Resources | undefined;
  starterPlanet?: boolean | undefined;
  state: PlayableState;
  settledState: PlayableState;
  transactionUnavailableReason?: string | undefined;
  now?: number | undefined;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  actionNotice,
  actionPendingLabel,
  actionUnavailableReason,
  chainCosts,
  chainDurations,
  hasLoadedInfrastructureState = false,
  loading = false,
  loadError,
  now = Date.now(),
  onOpenRequirement,
  onRefresh,
  onSelectBuilding,
  planetProductionProfile,
  productionRates,
  selectedBuildingKey,
  spendableResources,
  starterPlanet = false,
  settledState,
  transactionUnavailableReason,
  onUpgrade,
}: InfrastructurePageProps) {
  const [localSelectedKey, setLocalSelectedKey] = useState<BuildingKey>("metalMine");
  const selectedKey = selectedBuildingKey ?? localSelectedKey;
  const selectedBuilding = buildingCatalog.find((building) => building.key === selectedKey)
    ?? buildingCatalog[0]!;
  const showInitialLoadError = shouldShowInfrastructureInitialLoadError({
    hasLoadedInfrastructureState,
    loadError,
  });
  const initialLoadError = showInitialLoadError ? loadError : undefined;
  const handleSelectBuilding = (key: BuildingKey) => {
    setLocalSelectedKey(key);
    onSelectBuilding?.(key);
  };

  if (initialLoadError) {
    return (
      <div className="grid gap-4">
        <InspectPageHeader
          actions={onRefresh ? (
            <RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh infrastructure state" />
          ) : undefined}
          title="Infrastructure"
        />
        <InfrastructureLoadErrorPanel reason={initialLoadError} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <InspectPageHeader
        actions={(
          <>
          {settledState.queue?.kind === "building" ? (
            <ActiveBuildingBadge
              label={buildingQueueLabel(settledState.queue.label, settledState.queue.targetLevel)}
            />
          ) : null}
          {onRefresh ? (
            <RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh infrastructure state" />
          ) : null}
          </>
        )}
        title="Infrastructure"
      />

      {loadError ? <InfrastructureRefreshErrorPanel reason={loadError} /> : null}

      <StructureCatalog
        items={buildingCatalog.map((building) => {
          const currentLevel = settledState.buildings[building.key];
          const missingRequirement = unmetBuildingRequirement(settledState, building.key);
          const starterPrerequisite = missingFrontendOnlyBuildingRequirementFor(settledState, building.key, { starterPlanet });
          const upgradeStatus = buildingUpgradeStatus(settledState, building.key, {
            chainCost: chainCosts?.[building.key],
            chainDurationSeconds: chainDurations?.[building.key],
            now,
            productionRates,
            spendableResources,
            starterPlanet,
          });

          return {
            asset: building.asset,
            currentText: buildingStatusText(building.label, currentLevel),
            isDimmed: currentLevel === 0,
            key: building.key,
            label: building.label,
            labelTone: infrastructureCatalogTitleTone(upgradeStatus),
            statusText: starterPrerequisite || missingRequirement ? "Locked" : infrastructureCatalogStatusText(settledState, building.key, planetProductionProfile, productionRates),
            statusTone: starterPrerequisite || missingRequirement ? "warning" as const : "accent" as const,
          };
        })}
        onSelect={handleSelectBuilding}
        selectedKey={selectedBuilding.key}
        detail={(
          <BuildingDetailPanel
            actionNotice={actionNoticeForBuilding(actionNotice, selectedBuilding.key)}
            actionPendingLabel={actionPendingLabel}
            actionUnavailableReason={transactionUnavailableReason ?? actionUnavailableReason}
            building={selectedBuilding}
            chainCost={chainCosts?.[selectedBuilding.key]}
            chainDuration={chainDurations?.[selectedBuilding.key]}
            onOpenRequirement={onOpenRequirement}
            onUpgrade={() => onUpgrade(selectedBuilding.key)}
            now={now}
            planetProductionProfile={planetProductionProfile}
            productionRates={productionRates}
            spendableResources={spendableResources}
            starterPlanet={starterPlanet}
            state={settledState}
          />
        )}
      />
    </div>
  );
}

export function shouldShowInfrastructureInitialLoadError({
  hasLoadedInfrastructureState,
  loadError,
}: {
  hasLoadedInfrastructureState: boolean;
  loadError?: string | undefined;
}): boolean {
  return Boolean(loadError && !hasLoadedInfrastructureState);
}

export function infrastructureRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

export function infrastructureCatalogTitleTone(
  status: Pick<BuildingUpgradeStatus, "disabled" | "reason">,
): "normal" | "muted" {
  return status.disabled && status.reason.startsWith("Requires ")
    ? "muted"
    : "normal";
}

export function InfrastructureLoadErrorPanel({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-rose-300/20 bg-rose-300/5 px-4 py-4 text-sm text-rose-100">
      <p className="font-semibold">Infrastructure state could not be loaded.</p>
      <p className="mt-1 text-rose-100/80">
        {reason}
      </p>
      <p className="mt-3 text-xs text-rose-100/70">
        Levels, costs, production effects, storage caps, and upgrade values are unavailable until the live state request succeeds.
      </p>
    </div>
  );
}

export function InfrastructureRefreshErrorPanel({ reason }: { reason: string }) {
  return (
    <div className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
      <p className="font-semibold">Infrastructure refresh failed.</p>
      <p className="mt-1 text-amber-100/80">
        Showing the last loaded building data. {reason}
      </p>
    </div>
  );
}

function ActiveBuildingBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1.5 text-xs font-semibold leading-5 text-amber-200">
      <Hammer aria-hidden="true" className="shrink-0" size={14} strokeWidth={2.2} />
      <span className="min-w-0 break-words">Building: {label}</span>
    </span>
  );
}

function buildingStatusText(label: string, currentLevel: number): string {
  if (label === "Rift Stabilizer") {
    return currentLevel > 0 ? "Built" : "Not built";
  }

  return `Level ${currentLevel}`;
}

function BuildingDetailPanel({
  actionNotice,
  actionPendingLabel,
  actionUnavailableReason,
  building,
  chainCost,
  chainDuration,
  onOpenRequirement,
  onUpgrade,
  now,
  planetProductionProfile,
  productionRates,
  spendableResources,
  starterPlanet,
  state,
}: {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionPendingLabel?: string | undefined;
  actionUnavailableReason?: string | undefined;
  building: (typeof buildingCatalog)[number];
  chainCost?: Resources | undefined;
  chainDuration?: number | undefined;
  now: number;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onUpgrade: () => void;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  productionRates?: Resources | undefined;
  spendableResources?: Resources | undefined;
  starterPlanet?: boolean | undefined;
  state: PlayableState;
}) {
  const currentLevel = state.buildings[building.key];
  const energyTechnologyLevel = state.research.energy;
  const effect = buildingEffectMetrics(
    state.buildings,
    building.key,
    planetProductionProfile,
    energyTechnologyLevel,
  );
  const energy = buildingEnergyDetail(state.buildings, building.key, energyTechnologyLevel);
  const status = buildingUpgradeStatus(state, building.key, {
    actionUnavailableReason: actionUnavailableReason ?? actionPendingLabel,
    chainCost,
    chainDurationSeconds: chainDuration,
    now,
    productionRates,
    spendableResources,
    starterPlanet,
  });
  const effectRows = detailEffectRows(
    effect,
    energy,
    buildingProductionUpgradeEffect(state, building.key, planetProductionProfile, productionRates),
  );
  const levelInfoRows = buildingLevelInfoRows(
    state.buildings,
    building.key,
    planetProductionProfile,
    undefined,
    energyTechnologyLevel,
    state.ships.solarSatellite,
  );
  const binary = isBinaryBuilding(building.key);
  const built = currentLevel > 0;
  const actionVerb = currentLevel === 0 || binary ? "Build" : "Upgrade";
  const actionLabel = infrastructureUpgradeButtonLabel({
    actionUnavailableReason,
    binary,
    defaultLabel: `${actionVerb} Level ${status.targetLevel}`,
    statusDisabled: status.disabled,
  });
  const activeBuildingQueue = state.queue?.kind === "building" ? state.queue : undefined;
  const dedupedActionNotice = deduplicatedInfrastructureActionNotice(actionNotice, [
    status.reason,
  ]);
  // Only surface failures. Success action banners are intentionally not rendered
  // so the panel does not flash a transient status banner on every action.
  const visibleActionNotice = dedupedActionNotice?.tone === "error" ? dedupedActionNotice : undefined;
  const isSelectedBuildingQueued = activeBuildingQueue?.key === building.key;
  const requirementStates = getBuildingRequirementStates(state, building.key, { starterPlanet });

  return (
    <StructureDetail
      action={!isSelectedBuildingQueued && !(binary && built) ? {
        ariaLabel: binary ? `${actionVerb} ${building.label}` : `${actionVerb} ${building.label} to Level ${status.targetLevel}`,
        disabled: status.disabled,
        label: actionLabel,
        onClick: onUpgrade,
      } : undefined}
      active={built}
      asset={building.asset}
      cacheKey={`building:${building.key}`}
      description={buildingDescriptions[building.key]}
      effectContent={<dl className="mt-4 grid gap-2">
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
      </dl>}
      infoContent={<>
        <InspectInfoBlock label="Requirements">
          <RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={requirementStates} />
        </InspectInfoBlock>
        {binary && built ? (
          <InspectInfoBlock label="Rift Stabilizer" value="Built" />
        ) : (
          <>
            <InspectInfoBlock label={binary ? "Build cost" : "Upgrade cost"} value={formatCost(status.cost)} />
            {status.durationSeconds !== undefined ? (
              <InspectInfoBlock label={binary ? "Build time" : "Upgrade time"} value={formatDuration(status.durationSeconds)} />
            ) : null}
          </>
        )}
      </>}
      isDimmed={!built}
      label={building.label}
      levelInfo={!binary ? buildingLevelInfoTable(currentLevel, levelInfoRows) : undefined}
      notice={visibleActionNotice ? { label: visibleActionNotice.label, tone: "error" } : undefined}
      queue={activeBuildingQueue ? {
        isPrimaryItem: Boolean(isSelectedBuildingQueued),
        label: `${buildingQueueLabel(activeBuildingQueue.label, activeBuildingQueue.targetLevel)} is upgrading.`,
        now,
        queue: activeBuildingQueue,
        title: { active: "Construction in progress", context: "Active construction" },
      } : undefined}
      statusReason={{ disabled: status.disabled, label: status.reason }}
      summary={binary ? (built ? "Built on this planet" : "Build on this planet") : currentLevel === 0 ? `Build Level ${status.targetLevel}` : `Level ${currentLevel} to ${status.targetLevel}`}
    />
  );
}

export function infrastructureUpgradeButtonLabel({
  binary,
  defaultLabel,
}: {
  actionUnavailableReason?: string | undefined;
  binary: boolean;
  defaultLabel: string;
  statusDisabled: boolean;
}): string {
  return binary ? "Build Rift Stabilizer" : defaultLabel;
}

export function deduplicatedInfrastructureActionNotice(
  actionNotice: InfrastructureActionNotice | undefined,
  displayedReasons: Array<string | undefined>,
): InfrastructureActionNotice | undefined {
  const normalizedActionLabel = normalizeInfrastructureNotice(actionNotice?.label);

  if (
    actionNotice?.tone === "error"
    && normalizedActionLabel
    && displayedReasons.some((reason) => {
      const normalizedReason = normalizeInfrastructureNotice(reason);
      return normalizedReason
        && (normalizedReason === normalizedActionLabel
          || normalizedReason.includes(normalizedActionLabel)
          || normalizedActionLabel.includes(normalizedReason));
    })
  ) {
    return undefined;
  }

  return actionNotice;
}

function normalizeInfrastructureNotice(label: string | undefined): string | undefined {
  const normalized = label?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || undefined;
}

export function ActiveBuildingQueueDetail({
  isSelectedBuilding,
  now,
  queue,
}: {
  isSelectedBuilding: boolean;
  now: number;
  queue: BuildingQueueItem;
}) {
  const queueLabel = buildingQueueLabel(queue.label, queue.targetLevel);

  return SingleItemQueueProgress({
    isPrimaryItem: isSelectedBuilding,
    label: `${queueLabel} is upgrading.`,
    now,
    queue,
    title: {
      active: "Construction in progress",
      context: "Active construction",
    },
  });
}

export function BuildingLevelInfoButton({
  buildingLabel,
  onClick,
}: {
  buildingLabel: string;
  onClick: () => void;
}) {
  return LevelInfoButton({ itemLabel: buildingLabel, onClick });
}

export function BuildingLevelInfoModal({
  buildingLabel,
  currentLevel,
  onClose,
  rows,
}: {
  buildingLabel: string;
  currentLevel: number;
  onClose: () => void;
  rows: ReturnType<typeof buildingLevelInfoRows>;
}) {
  const table = buildingLevelInfoTable(currentLevel, rows);
  return LevelInfoModal({
    ...table,
    itemLabel: buildingLabel,
    onClose,
  });
}

export function buildingLevelInfoTable(
  currentLevel: number,
  rows: ReturnType<typeof buildingLevelInfoRows>,
): StructureLevelInfo {
  const columns = buildingLevelInfoColumns(rows);
  const modalColumns: LevelInfoColumn[] = [
    { key: "cost", label: "Upgrade cost", headerClassName: "min-w-52" },
    ...(columns.constructionTime ? [{ key: "constructionTime", label: "Build time", headerClassName: "min-w-32" }] : []),
    ...(columns.storage ? [{ key: "storage", label: "Storage", headerClassName: "min-w-40" }] : []),
    ...(columns.effect ? [{ key: "effect", label: "Effect", headerClassName: "min-w-44" }] : []),
    ...(columns.production ? [{ key: "production", label: "Production output", headerClassName: "min-w-44" }] : []),
    ...(columns.energyRequired ? [{ key: "energyRequired", label: "Energy use", headerClassName: "min-w-36" }] : []),
    ...(columns.energyProduced ? [{ key: "energyProduced", label: "Energy output", headerClassName: "min-w-40" }] : []),
    ...(columns.deuteriumConsumed ? [{ key: "deuteriumConsumed", label: "Deuterium use", headerClassName: "min-w-44" }] : []),
  ];
  const modalRows: LevelInfoRow[] = rows.map((row) => ({
    cells: {
      cost: formatCost(row.cost),
      constructionTime: formatDuration(row.durationSeconds),
      storage: row.storage
        ? `${formatNumber(row.storage.capacity)} ${fullResourceLabels[row.storage.resource]}`
        : "N/A",
      effect: row.effect ?? "N/A",
      production: row.production
        ? `${formatNumber(row.production.value)} ${fullResourceLabels[row.production.resource]}/h${row.production.deltaFromPrevious !== 0 ? ` (${formatSigned(row.production.deltaFromPrevious)}/h)` : ""}`
        : "N/A",
      energyRequired: row.energyRequired === undefined ? "N/A" : `${formatNumber(row.energyRequired)} required`,
      energyProduced: row.energyProduced === undefined ? "N/A" : `${formatNumber(row.energyProduced)} produced`,
      deuteriumConsumed: row.deuteriumConsumed === undefined
        ? "N/A"
        : `${formatNumber(row.deuteriumConsumed)} Deuterium/h`,
    },
    key: row.level,
    level: row.level,
    status: row.current ? "current" : row.next ? "next" : "future",
  }));

  return {
    columns: modalColumns,
    currentLevel,
    rows: modalRows,
  };
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
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 text-sm font-semibold">
        <span className="min-w-0">
          <span className="break-words text-slate-200">{value}</span>
          {delta && <MetricDeltaSubtext tone={tone}>{delta}</MetricDeltaSubtext>}
        </span>
        <span aria-hidden="true" className="text-slate-500">→</span>
        <span className="min-w-0 break-words text-signal">{next}</span>
      </dd>
    </div>
  );
}

export function MetricDeltaSubtext({
  children,
  tone = "positive",
}: {
  children: string;
  tone?: "neutral" | "positive" | "warning" | undefined;
}) {
  const deltaClass = tone === "warning"
    ? "text-amber-200"
    : tone === "neutral"
      ? "text-slate-300"
      : "text-signal";

  return (
    <span className={`mt-0.5 block text-xs font-medium leading-4 ${deltaClass}`}>
      {children}
    </span>
  );
}

export function getBuildingRequirementStates(
  state: Pick<PlayableState, "buildings" | "research">,
  key: BuildingKey,
  options: {
    starterPlanet?: boolean | undefined;
  } = {},
): RequirementFlair[] {
  const frontendOnlyRequirements: RequirementFlair[] = frontendOnlyBuildingRequirementsFor(key, options)
    .map((requirement) => ({
      label: formatFrontendOnlyBuildingRequirement(requirement),
      met: state.buildings[requirement.key] >= requirement.level,
      target: { kind: "building" as const, key: requirement.key },
    }));

  return [
    ...frontendOnlyRequirements,
    ...buildingRequirementsFor(key).map((requirement) => ({
      label: formatRequirementFlair(requirement),
      met: requirement.type === "building"
        ? state.buildings[requirement.key] >= requirement.level
        : state.research[requirement.key] >= requirement.level,
      target: requirement.type === "building"
        ? { kind: "building" as const, key: requirement.key }
        : { kind: "research" as const, key: requirement.key },
    })),
  ];
}

function formatRequirementFlair(requirement: BuildingRequirement): string {
  const label = requirement.type === "building"
    ? buildingCatalog.find((item) => item.key === requirement.key)?.label
    : researchCatalog.find((item) => item.key === requirement.key)?.label;

  return `${label ?? requirement.key} ${requirement.level}`;
}

export type ProductionUpgradeEffect = {
  currentPerHour: number;
  deltaPerHour: number;
  nextPerHour: number;
  resource: keyof Resources;
};

export function detailEffectRows(
  effect: BuildingEffectMetrics,
  energy: ReturnType<typeof buildingEnergyDetail>,
  productionUpgrade?: ProductionUpgradeEffect | undefined,
) {
  const rows: Array<{
    delta?: string;
    label: string;
    next: string;
    tone?: "neutral" | "positive" | "warning";
    value: string;
  }> = [];

  if (effect.kind === "production") {
    if (productionUpgrade) {
      rows.push({
        ...(productionUpgrade.deltaPerHour !== 0
          ? { delta: `${formatSigned(productionUpgrade.deltaPerHour)}/h` }
          : {}),
        label: `${fullResourceLabels[productionUpgrade.resource]} output`,
        next: `${formatNumber(productionUpgrade.nextPerHour)}/h`,
        value: `${formatNumber(productionUpgrade.currentPerHour)}/h`,
      });
    }
  } else if (effect.kind === "energy") {
    const output = energy.kind === "produces"
      ? {
          current: energy.current,
          delta: energy.delta,
          next: energy.next,
        }
      : {
          current: effect.currentProduced,
          delta: effect.deltaProduced,
          next: effect.nextProduced,
        };

    rows.push({
      ...(output.delta !== 0
        ? { delta: formatSigned(output.delta) }
        : {}),
      label: "Energy output",
      next: `${formatNumber(output.next)} produced`,
      value: `${formatNumber(output.current)} produced`,
    });
    if (effect.showsDeuteriumConsumption && (effect.nextDeuteriumConsumed > 0 || effect.currentDeuteriumConsumed > 0)) {
      rows.push({
        ...(effect.deltaDeuteriumConsumed !== 0
          ? { delta: `${formatSigned(effect.deltaDeuteriumConsumed)}/h` }
          : {}),
        label: "Deuterium use",
        next: `${formatNumber(effect.nextDeuteriumConsumed)}/h`,
        tone: "warning",
        value: `${formatNumber(effect.currentDeuteriumConsumed)}/h`,
      });
    }
    return rows;
  } else if (effect.kind === "storage") {
    rows.push({
      delta: `${formatSigned(effect.deltaCapacity)} capacity`,
      label: "Storage capacity",
      next: `${formatNumber(effect.nextCapacity)} ${shortResourceLabels[effect.resource]}`,
      value: `${formatNumber(effect.currentCapacity)} ${shortResourceLabels[effect.resource]}`,
    });
  } else if (effect.kind === "missileSilo") {
    rows.push({
      delta: `${formatSigned(effect.deltaSlots)} slots`,
      label: "Missile capacity",
      next: `${formatNumber(effect.nextSlots)} slots`,
      value: `${formatNumber(effect.currentSlots)} slots`,
    });
  } else if (effect.kind === "allianceDepot") {
    rows.push({
      delta: `${formatSigned(effect.deltaSupport)} Deut.`,
      label: "Group-defense support",
      next: `${formatNumber(effect.nextSupport)} Deut.`,
      value: `${formatNumber(effect.currentSupport)} Deut.`,
    });
  } else if (effect.kind === "constructionSpeed") {
    rows.push({
      delta: `+${formatNumber(effect.relativeImprovementPercent)}% faster than current`,
      label: "Construction time divisor",
      next: `x${formatNumber(effect.nextFactor)}`,
      value: `x${formatNumber(effect.currentFactor)}`,
    });
  } else if (effect.kind === "shipyard") {
    rows.push({
      ...(effect.relativeImprovementPercent !== 0
        ? { delta: `+${formatNumber(effect.relativeImprovementPercent)}% faster` }
        : {}),
      label: "Ship production speed",
      next: `x${formatNumber(effect.nextFactor)}`,
      value: effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Not built",
    });
  } else if (effect.kind === "researchSpeed") {
    const fasterPercent = effect.unlocked
      ? Math.round(((effect.nextFactor / effect.currentFactor) - 1) * 100)
      : 0;

    const row = {
      label: effect.unlocked ? "Research speed" : "Research capacity",
      next: effect.nextUnlocked && !effect.unlocked
        ? "Unlocks research"
        : `x${formatNumber(effect.nextFactor)}`,
      value: effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Unavailable",
    };

    rows.push(fasterPercent > 0 ? { ...row, delta: `+${formatNumber(fasterPercent)}% faster` } : row);
  } else if (effect.kind === "terraformer") {
    rows.push({
      delta: `+${formatNumber(effect.deltaFields)} fields`,
      label: "Planet fields",
      next: `+${formatNumber(effect.nextFieldsAdded)} total fields`,
      value: effect.currentFieldsAdded > 0 ? `+${formatNumber(effect.currentFieldsAdded)} total fields` : "No expansion",
    });
  } else {
    if (effect.binary) {
      rows.push({
        label: effect.label,
        next: "Built",
        value: effect.currentLevel > 0 ? "Built" : "Not built",
      });
      return rows;
    }

    rows.push({
      label: effect.label,
      next: `Level ${effect.nextLevel}`,
      value: effect.currentLevel > 0 ? `Level ${effect.currentLevel}` : "Not built",
    });
  }

  if (energy.kind === "produces") {
    rows.push({
      label: "Energy",
      next: `${formatNumber(energy.next)} produced`,
      value: `${formatNumber(energy.current)} produced`,
    });
  } else if (energy.kind === "requires") {
    rows.push({
      ...(energy.delta !== 0 ? { delta: formatSigned(energy.delta) } : {}),
      label: "Energy required",
      next: `${formatNumber(energy.next)} required`,
      value: `${formatNumber(energy.current)} required`,
    });
  }

  return rows;
}

export function infrastructureCatalogStatusText(
  state: PlayableState,
  key: BuildingKey,
  profile?: PlanetProductionProfile | undefined,
  productionRates?: Resources | undefined,
): string {
  const effect = buildingEffectMetrics(
    state.buildings,
    key,
    profile,
    state.research.energy,
  );

  return compactEffect(
    effect,
    buildingProductionUpgradeEffect(state, key, profile, productionRates, effect),
  );
}

export function buildingProductionUpgradeEffect(
  state: PlayableState,
  key: BuildingKey,
  profile?: PlanetProductionProfile | undefined,
  _productionRates?: Resources | undefined,
  effect: BuildingEffectMetrics = buildingEffectMetrics(
    state.buildings,
    key,
    profile,
    state.research.energy,
  ),
): ProductionUpgradeEffect | undefined {
  if (effect.kind !== "production") return undefined;

  return {
    currentPerHour: effect.currentPerHour,
    deltaPerHour: effect.deltaPerHour,
    nextPerHour: effect.nextPerHour,
    resource: effect.resource,
  };
}

function compactEffect(
  effect: BuildingEffectMetrics,
  productionUpgrade?: ProductionUpgradeEffect | undefined,
): string {
  if (effect.kind === "production") {
    if (!productionUpgrade) return fullResourceLabels[effect.resource];

    return `${formatNumber(productionUpgrade.currentPerHour)}/h`;
  }

  if (effect.kind === "energy") {
    return `${formatNumber(effect.currentProduced)} energy`;
  }

  if (effect.kind === "storage") {
    return `${formatNumber(effect.currentCapacity)} cap`;
  }

  if (effect.kind === "missileSilo") {
    return `${formatNumber(effect.currentSlots)} slots`;
  }

  if (effect.kind === "allianceDepot") {
    return `${formatNumber(effect.currentSupport)} Deut.`;
  }

  if (effect.kind === "shipyard") {
    return effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Locked";
  }

  if (effect.kind === "researchSpeed") {
    return effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Locked";
  }

  if (effect.kind === "facility") {
    if (effect.binary) {
      return effect.currentLevel > 0 ? "Built" : "Not built";
    }

    return effect.currentLevel > 0 ? `Level ${effect.currentLevel}` : "Locked";
  }

  if (effect.kind === "terraformer") {
    return effect.currentFieldsAdded > 0 ? `+${formatNumber(effect.currentFieldsAdded)} fields` : "No expansion";
  }

  return `x${formatNumber(effect.currentFactor)}`;
}
