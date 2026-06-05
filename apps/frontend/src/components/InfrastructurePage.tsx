import { Hammer, Info, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
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
  buildingUpgradeStatus,
  formatCost,
  formatDuration,
  formatNumber,
  formatSigned,
  mineSolarPlantPrerequisiteFor,
} from "../buildingDetails";
import { buildingQueueLabel } from "../overviewData";
import { actionNoticeForBuilding, type InfrastructureActionNotice } from "../buildingActionNotice";
import {
  InspectCatalogTile,
  InspectDetailHero,
  InspectDetailImage,
  InspectDetailShell,
  InspectInfoBlock,
  InspectPageHeader,
  InspectTwoColumnLayout,
  SingleItemQueueProgress,
  useInspectDetailSelection,
} from "./InspectProgressLayout";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";

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

const solarPrerequisiteMineKeys = new Set<BuildingKey>([
  "metalMine",
  "crystalMine",
  "deuteriumSynthesizer",
]);
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
  allianceDepot: "Supplies deuterium from the defended planet to cover friendly ACS defense holding fuel.",
  missileSilo: "Stores anti-ballistic and interplanetary missiles and gates missile production.",
  interdimensionalRiftStabilizer: "Custom Veydrift facility for later resource-token withdrawal and rift mechanics.",
};

interface InfrastructurePageProps {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionPendingLabel?: string | undefined;
  actionUnavailableReason?: string | undefined;
  chainCosts?: Partial<Record<BuildingKey, Resources>> | undefined;
  finishUnavailableReason?: string | undefined;
  hasLoadedInfrastructureState?: boolean | undefined;
  isActionPending?: boolean | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  loadError?: string | undefined;
  onFinishBuilding?: (() => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onSelectBuilding?: ((key: BuildingKey) => void) | undefined;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  productionRates?: Resources | undefined;
  selectedBuildingKey?: BuildingKey | undefined;
  spendableResources?: Resources | undefined;
  state: PlayableState;
  settledState: PlayableState;
  now?: number | undefined;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  actionNotice,
  actionPendingLabel,
  actionUnavailableReason,
  chainCosts,
  finishUnavailableReason,
  hasLoadedInfrastructureState = false,
  isActionPending = false,
  isBuildingReadyToFinish,
  loadError,
  now = Date.now(),
  onFinishBuilding,
  onOpenRequirement,
  onSelectBuilding,
  planetProductionProfile,
  productionRates,
  selectedBuildingKey,
  spendableResources,
  settledState,
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
  const activeBuildingQueue = settledState.queue?.kind === "building" ? settledState.queue : undefined;
  const finishAction = infrastructureFinishAction({
    actionUnavailableReason: finishUnavailableReason ?? actionUnavailableReason ?? actionPendingLabel,
    isActionPending,
    isBuildingReadyToFinish,
    onFinishBuilding,
    queue: activeBuildingQueue,
  });
  const headerFinishAction = infrastructureHeaderFinishAction(finishAction);

  const { detailPanelRef, selectInspectItem: handleSelectBuilding } = useInspectDetailSelection<BuildingKey>((key) => {
    setLocalSelectedKey(key);
    onSelectBuilding?.(key);
  });

  if (initialLoadError) {
    return (
      <div className="grid gap-4">
        <InspectPageHeader
          description="Building levels and production are hidden until live infrastructure state loads."
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
          {headerFinishAction ? (
            <button
              aria-label={headerFinishAction.reason ?? "Finish building upgrade"}
              className="h-9 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={headerFinishAction.disabled}
              onClick={headerFinishAction.onFinish}
              title={headerFinishAction.reason ?? "Finish building upgrade"}
              type="button"
            >
              {headerFinishAction.label}
            </button>
          ) : null}
          </>
        )}
        description="Select a building to inspect real production, power, cost, and upgrade timing."
        title="Infrastructure"
      />

      {loadError ? <InfrastructureRefreshErrorPanel reason={loadError} /> : null}

      <InspectTwoColumnLayout
        catalog={buildingCatalog.map((building) => {
          const currentLevel = settledState.buildings[building.key];
          const effect = buildingEffectMetrics(settledState.buildings, building.key, planetProductionProfile);
          const isSelected = building.key === selectedBuilding.key;
          const missingRequirement = unmetBuildingRequirement(settledState, building.key);
          const solarPrerequisite = mineSolarPlantPrerequisiteFor(settledState, building.key);

          return (
            <InspectCatalogTile
              asset={building.asset}
              currentText={buildingStatusText(building.label, currentLevel)}
              isDimmed={currentLevel === 0}
              isSelected={isSelected}
              key={building.key}
              label={building.label}
              statusText={solarPrerequisite ? `Requires ${solarPrerequisite}` : missingRequirement ? "Locked" : compactEffect(effect)}
              statusTone={solarPrerequisite || missingRequirement ? "warning" : "accent"}
              onClick={() => handleSelectBuilding(building.key)}
            />
          );
        })}
        detail={(
          <BuildingDetailPanel
            actionNotice={actionNoticeForBuilding(actionNotice, selectedBuilding.key)}
            actionPendingLabel={actionPendingLabel}
            actionUnavailableReason={actionUnavailableReason}
            building={selectedBuilding}
            chainCost={chainCosts?.[selectedBuilding.key]}
            finishUnavailableReason={finishUnavailableReason}
            isActionPending={isActionPending}
            isBuildingReadyToFinish={isBuildingReadyToFinish}
            onFinishBuilding={onFinishBuilding}
            onOpenRequirement={onOpenRequirement}
            onUpgrade={() => onUpgrade(selectedBuilding.key)}
            now={now}
            planetProductionProfile={planetProductionProfile}
            productionRates={productionRates}
            spendableResources={spendableResources}
            state={settledState}
          />
        )}
        detailPanelRef={detailPanelRef}
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
  if (label === "Interdimensional Rift Stabilizer") {
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
  finishUnavailableReason,
  isActionPending,
  isBuildingReadyToFinish,
  onFinishBuilding,
  onOpenRequirement,
  onUpgrade,
  now,
  planetProductionProfile,
  productionRates,
  spendableResources,
  state,
}: {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionPendingLabel?: string | undefined;
  actionUnavailableReason?: string | undefined;
  building: (typeof buildingCatalog)[number];
  chainCost?: Resources | undefined;
  finishUnavailableReason?: string | undefined;
  isActionPending?: boolean | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  now: number;
  onFinishBuilding?: (() => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onUpgrade: () => void;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  productionRates?: Resources | undefined;
  spendableResources?: Resources | undefined;
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
    productionRates,
    spendableResources,
  });
  const effectRows = detailEffectRows(effect, energy);
  const levelInfoRows = buildingLevelInfoRows(
    state.buildings,
    building.key,
    planetProductionProfile,
    undefined,
    energyTechnologyLevel,
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
  const finishAction = infrastructureFinishAction({
    actionUnavailableReason: finishUnavailableReason ?? actionUnavailableReason ?? actionPendingLabel,
    binary,
    isActionPending,
    isBuildingReadyToFinish,
    onFinishBuilding,
    queue: activeBuildingQueue,
  });
  const isSelectedBuildingQueued = activeBuildingQueue?.key === building.key;
  const requirementStates = getBuildingRequirementStates(state, building.key);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const noticeClass = actionNotice?.tone === "error"
    ? "border-rose-300/20 bg-rose-300/10 text-rose-200"
    : actionNotice?.tone === "success"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
      : "border-signal/20 bg-signal/10 text-signal";

  return (
    <InspectDetailShell>
      <InspectDetailHero
        image={(
          <InspectDetailImage
            asset={building.asset}
            cacheKey={`building:${building.key}`}
            isDimmed={currentLevel === 0}
          />
        )}
      >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-white">{building.label}</h3>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-400">
                <span>{binary ? (built ? "Built on this planet" : "Build on this planet") : currentLevel === 0 ? `Build Level ${status.targetLevel}` : `Level ${currentLevel} to ${status.targetLevel}`}</span>
                {!binary && (
                  <BuildingLevelInfoButton
                    buildingLabel={building.label}
                    onClick={() => setIsInfoOpen(true)}
                  />
                )}
              </div>
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
      </InspectDetailHero>

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
        <InspectInfoBlock label="Requirements">
          <RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={requirementStates} />
        </InspectInfoBlock>
        {binary && built ? (
          <InspectInfoBlock label="Rift bridge" value="Built" />
        ) : (
          <>
            <InspectInfoBlock label={binary ? "Build cost" : "Upgrade cost"} value={formatCost(status.cost)} />
            <InspectInfoBlock label={binary ? "Build time" : "Upgrade time"} value={formatDuration(status.durationSeconds)} />
          </>
        )}
      </div>

      <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className={`text-sm font-semibold ${status.disabled ? "text-slate-400" : "text-emerald-200"}`}>
          {status.reason}
        </p>
      </div>

      {activeBuildingQueue && (
        <ActiveBuildingQueueDetail
          isSelectedBuilding={Boolean(isSelectedBuildingQueued)}
          now={now}
          queue={activeBuildingQueue}
        />
      )}

      {actionNotice && (
        <div className={`mt-2 rounded border px-3 py-2 text-sm font-semibold ${noticeClass}`}>
          {actionNotice.label}
        </div>
      )}

      {finishAction.visible && (
        <button
          aria-label={finishAction.reason ?? "Finish building upgrade"}
          className="mt-3 h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          disabled={finishAction.disabled}
          onClick={finishAction.onFinish}
          title={finishAction.reason ?? "Finish building upgrade"}
          type="button"
        >
          {finishAction.label}
        </button>
      )}

      {!isSelectedBuildingQueued && !(binary && built) && (
        <button
          aria-label={binary ? `${actionVerb} ${building.label}` : `${actionVerb} ${building.label} to Level ${status.targetLevel}`}
          className="mt-3 h-10 w-full rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          disabled={status.disabled}
          onClick={onUpgrade}
          type="button"
        >
          {actionLabel}
        </button>
      )}

      {isInfoOpen && (
        <BuildingLevelInfoModal
          buildingLabel={building.label}
          currentLevel={currentLevel}
          rows={levelInfoRows}
          onClose={() => setIsInfoOpen(false)}
        />
      )}
    </InspectDetailShell>
  );
}

export function infrastructureUpgradeButtonLabel({
  actionUnavailableReason,
  binary,
  defaultLabel,
  statusDisabled,
}: {
  actionUnavailableReason?: string | undefined;
  binary: boolean;
  defaultLabel: string;
  statusDisabled: boolean;
}): string {
  if (statusDisabled && actionUnavailableReason) {
    return actionUnavailableReason;
  }

  return binary ? "Build Rift Bridge" : defaultLabel;
}

export function infrastructureFinishButtonLabel(
  actionUnavailableReason: string | undefined,
  binary: boolean,
): string {
  return actionUnavailableReason ?? (binary ? "Finish build" : "Finish upgrade");
}

export function infrastructureFinishAction({
  actionUnavailableReason,
  binary = false,
  isActionPending,
  isBuildingReadyToFinish,
  onFinishBuilding,
  queue,
}: {
  actionUnavailableReason?: string | undefined;
  binary?: boolean | undefined;
  isActionPending?: boolean | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  queue?: BuildingQueueItem | undefined;
}): {
  disabled: boolean;
  label: string;
  onFinish?: (() => void) | undefined;
  reason?: string | undefined;
  visible: boolean;
} {
  const visible = Boolean(queue && onFinishBuilding);
  const reason = actionUnavailableReason
    ?? (isActionPending ? "Building transaction is already in progress." : undefined)
    ?? (isBuildingReadyToFinish ? undefined : "Building upgrade is not ready to finish yet.");

  return {
    disabled: Boolean(reason),
    label: reason ?? infrastructureFinishButtonLabel(undefined, binary),
    onFinish: visible && !reason ? onFinishBuilding : undefined,
    reason,
    visible,
  };
}

export function infrastructureHeaderFinishAction(action: ReturnType<typeof infrastructureFinishAction>) {
  if (!action.visible || action.disabled) return undefined;
  return action;
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
  return (
    <button
      aria-label={`Open ${buildingLabel} level table`}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-signal/40 hover:bg-signal/10 hover:text-signal"
      onClick={onClick}
      title="Level table"
      type="button"
    >
      <Info aria-hidden="true" size={15} strokeWidth={2.2} />
    </button>
  );
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
  const columns = buildingLevelInfoColumns(rows);

  return (
    <div
      aria-labelledby="building-level-info-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3"
      role="dialog"
    >
      <div className="max-h-[min(44rem,calc(100vh-1.5rem))] w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#0f1624] shadow-2xl shadow-black/40">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h3 id="building-level-info-title" className="break-words text-base font-semibold text-white">
              {buildingLabel} levels
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Current Level {currentLevel}
            </p>
          </div>
          <button
            aria-label="Close level table"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-8rem)] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#111827] text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <LevelInfoHeader className="min-w-24 whitespace-nowrap">Level</LevelInfoHeader>
                <LevelInfoHeader className="min-w-24 whitespace-nowrap">Status</LevelInfoHeader>
                <LevelInfoHeader className="min-w-52">Upgrade cost</LevelInfoHeader>
                <LevelInfoHeader className="min-w-32">Build time</LevelInfoHeader>
                {columns.production && <LevelInfoHeader className="min-w-40">Production</LevelInfoHeader>}
                {columns.storage && <LevelInfoHeader className="min-w-40">Storage</LevelInfoHeader>}
                {columns.effect && <LevelInfoHeader className="min-w-44">Effect</LevelInfoHeader>}
                {columns.energyRequired && <LevelInfoHeader className="min-w-36">Energy use</LevelInfoHeader>}
                {columns.energyProduced && <LevelInfoHeader className="min-w-40">Energy output</LevelInfoHeader>}
                {columns.deuteriumConsumed && <LevelInfoHeader className="min-w-44">Deuterium use</LevelInfoHeader>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className={`border-t border-white/10 ${
                    row.current
                      ? "bg-emerald-300/10"
                      : row.next
                        ? "bg-signal/10"
                        : "odd:bg-white/[0.015]"
                  }`}
                  key={row.level}
                >
                  <LevelInfoCell className="whitespace-nowrap">
                    <span className="font-semibold text-white">Level {row.level}</span>
                  </LevelInfoCell>
                  <LevelInfoCell className="min-w-24">
                    {row.current && <LevelPill tone="current">Current</LevelPill>}
                    {row.next && <LevelPill tone="next">Next</LevelPill>}
                  </LevelInfoCell>
                  <LevelInfoCell>{formatCost(row.cost)}</LevelInfoCell>
                  <LevelInfoCell>{formatDuration(row.durationSeconds)}</LevelInfoCell>
                  {columns.production && (
                    <LevelInfoCell>
                      {row.production
                        ? `${formatNumber(row.production.perHour)} ${fullResourceLabels[row.production.resource]}/h`
                        : "N/A"}
                    </LevelInfoCell>
                  )}
                  {columns.storage && (
                    <LevelInfoCell>
                      {row.storage
                        ? `${formatNumber(row.storage.capacity)} ${fullResourceLabels[row.storage.resource]}`
                        : "N/A"}
                    </LevelInfoCell>
                  )}
                  {columns.effect && <LevelInfoCell>{row.effect ?? "N/A"}</LevelInfoCell>}
                  {columns.energyRequired && (
                    <LevelInfoCell>
                      {row.energyRequired === undefined ? "N/A" : `${formatNumber(row.energyRequired)} required`}
                    </LevelInfoCell>
                  )}
                  {columns.energyProduced && (
                    <LevelInfoCell>
                      {row.energyProduced === undefined ? "N/A" : `${formatNumber(row.energyProduced)} produced`}
                    </LevelInfoCell>
                  )}
                  {columns.deuteriumConsumed && (
                    <LevelInfoCell>
                      {row.deuteriumConsumed === undefined
                        ? "N/A"
                        : `${formatNumber(row.deuteriumConsumed)} Deuterium/h`}
                    </LevelInfoCell>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LevelInfoHeader({
  children,
  className = "",
}: {
  children: ComponentChildren;
  className?: string | undefined;
}) {
  return (
    <th className={`border-b border-white/10 px-3 py-2 font-semibold ${className}`}>
      {children}
    </th>
  );
}

function LevelInfoCell({
  children,
  className = "",
}: {
  children: ComponentChildren;
  className?: string | undefined;
}) {
  return (
    <td className={`border-b border-white/10 px-3 py-2 align-top text-slate-200 ${className}`}>
      {children}
    </td>
  );
}

function LevelPill({ children, tone }: { children: string; tone: "current" | "next" }) {
  const className = tone === "current"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
    : "border-signal/30 bg-signal/10 text-signal";

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-normal ${className}`}>
      {children}
    </span>
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
): RequirementFlair[] {
  const frontendOnlyRequirements: RequirementFlair[] = solarPrerequisiteMineKeys.has(key)
    ? [{ label: "Solar Plant level 1", met: state.buildings.solarPlant >= 1, target: { kind: "building", key: "solarPlant" as const } }]
    : [];

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

export function detailEffectRows(effect: BuildingEffectMetrics, energy: ReturnType<typeof buildingEnergyDetail>) {
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
      label: "Production capacity",
      next: `${formatNumber(effect.nextPerHour)} ${shortResourceLabels[effect.resource]}/h`,
      value: `${formatNumber(effect.currentPerHour)} ${shortResourceLabels[effect.resource]}/h`,
    });
  } else if (effect.kind === "energy") {
    rows.push({
      ...(effect.deltaProduced !== 0
        ? { delta: formatSigned(effect.deltaProduced) }
        : {}),
      label: "Energy output",
      next: `${formatNumber(effect.nextProduced)} produced`,
      value: `${formatNumber(effect.currentProduced)} produced`,
    });
    if (effect.showsDeuteriumConsumption && (effect.nextDeuteriumConsumed > 0 || effect.currentDeuteriumConsumed > 0)) {
      rows.push({
        ...(effect.deltaDeuteriumConsumed !== 0
          ? { delta: `(${formatSigned(effect.deltaDeuteriumConsumed)}/h)` }
          : {}),
        label: "Deuterium consumed",
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
      label: "ACS support capacity",
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
      label: "Shipyard speed",
      next: effect.nextUnlocked && !effect.unlocked ? "Unlocks orbital production" : `x${formatNumber(effect.nextFactor)}`,
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
