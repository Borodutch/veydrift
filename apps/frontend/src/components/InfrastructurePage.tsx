import { Info, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { BuildingEffectMetrics, BuildingKey, PlanetProductionProfile, PlayableState, Resources } from "../playableMvp";
import { buildingCatalog, buildingEffectMetrics, progress, unmetBuildingRequirement } from "../playableMvp";
import {
  buildingEnergyDetail,
  buildingLevelInfoColumns,
  buildingLevelInfoRows,
  buildingUpgradeStatus,
  formatBuildingRequirements,
  formatCost,
  formatDuration,
  formatNumber,
  formatSigned,
} from "../buildingDetails";
import { formatDurationUntil } from "../durationFormat";
import { buildingQueueAsset, buildingQueueLabel } from "../overviewData";
import { actionNoticeForBuilding, type InfrastructureActionNotice } from "../buildingActionNotice";
import { OptimizedImage } from "./OptimizedImage";

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

const loadedDetailImageKeys = new Set<BuildingKey>();

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
  allianceDepot: "A core OGame facility kept in catalog parity; alliance logistics behavior is not active in this MVP.",
  missileSilo: "Stores anti-ballistic and interplanetary missiles and gates missile production.",
  interdimensionalRiftStabilizer: "Custom Veydrift facility for later resource-token withdrawal and rift mechanics.",
};

interface InfrastructurePageProps {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionUnavailableReason?: string | undefined;
  chainCosts?: Partial<Record<BuildingKey, Resources>> | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  onFinishBuilding?: (() => void) | undefined;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  state: PlayableState;
  settledState: PlayableState;
  now?: number | undefined;
  onUpgrade: (key: BuildingKey) => void;
}

export function InfrastructurePage({
  actionNotice,
  actionUnavailableReason,
  chainCosts,
  isBuildingReadyToFinish,
  now = Date.now(),
  onFinishBuilding,
  planetProductionProfile,
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
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {settledState.queue?.kind === "building" ? (
            <ActiveBuildingBadge
              asset={buildingQueueAsset(settledState.queue.key)}
              label={buildingQueueLabel(settledState.queue.label, settledState.queue.targetLevel)}
            />
          ) : null}
          {isBuildingReadyToFinish && onFinishBuilding ? (
            <button
              className="h-9 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
              onClick={onFinishBuilding}
              type="button"
            >
              Finish upgrade
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:items-start">
        <div className="order-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:order-1 xl:grid-cols-3 2xl:grid-cols-4">
          {buildingCatalog.map((building) => {
            const currentLevel = settledState.buildings[building.key];
            const effect = buildingEffectMetrics(settledState.buildings, building.key, planetProductionProfile);
            const isSelected = building.key === selectedBuilding.key;
            const missingRequirement = unmetBuildingRequirement(settledState, building.key);

            return (
              <BuildingSelectorTile
                asset={building.asset}
                currentLevel={currentLevel}
                effect={effect}
                isSelected={isSelected}
                isUnbuilt={currentLevel === 0}
                key={building.key}
                label={building.label}
                statusText={missingRequirement ? "Locked" : undefined}
                onClick={() => handleSelectBuilding(building.key)}
              />
            );
          })}
        </div>

        <div className="order-1 xl:order-2" ref={detailPanelRef}>
          <BuildingDetailPanel
            actionNotice={actionNoticeForBuilding(actionNotice, selectedBuilding.key)}
            actionUnavailableReason={actionUnavailableReason}
            building={selectedBuilding}
            chainCost={chainCosts?.[selectedBuilding.key]}
            isBuildingReadyToFinish={isBuildingReadyToFinish}
            onFinishBuilding={onFinishBuilding}
            onUpgrade={() => onUpgrade(selectedBuilding.key)}
            now={now}
            planetProductionProfile={planetProductionProfile}
            state={settledState}
          />
        </div>
      </div>
    </div>
  );
}

function formatQueueReadyAt(readyAtMs: number): string {
  if (!Number.isFinite(readyAtMs)) return "Unknown";
  return new Date(readyAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActiveBuildingBadge({ asset, label }: { asset?: string | undefined; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded border border-amber-300/20 bg-amber-300/10 py-1 pl-1 pr-2.5 text-xs text-amber-300">
      {asset ? (
        <span className="h-7 w-7 shrink-0 overflow-hidden rounded border border-white/10 bg-white/5">
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            sizes="icon"
            src={asset}
          />
        </span>
      ) : null}
      <span className="min-w-0 truncate">Building: {label}</span>
    </span>
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
  statusText,
}: {
  asset: string;
  currentLevel: number;
  effect: BuildingEffectMetrics;
  isSelected: boolean;
  isUnbuilt: boolean;
  label: string;
  onClick: () => void;
  statusText?: string | undefined;
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
          <span className={`truncate text-right ${statusText ? "text-amber-300" : "text-signal"}`}>
            {statusText ?? effectView}
          </span>
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
  now,
  planetProductionProfile,
  state,
}: {
  actionNotice?: InfrastructureActionNotice | undefined;
  actionUnavailableReason?: string | undefined;
  building: (typeof buildingCatalog)[number];
  chainCost?: Resources | undefined;
  isBuildingReadyToFinish?: boolean | undefined;
  now: number;
  onFinishBuilding?: (() => void) | undefined;
  onUpgrade: () => void;
  planetProductionProfile?: PlanetProductionProfile | undefined;
  state: PlayableState;
}) {
  const currentLevel = state.buildings[building.key];
  const effect = buildingEffectMetrics(state.buildings, building.key, planetProductionProfile);
  const energy = buildingEnergyDetail(state.buildings, building.key);
  const status = buildingUpgradeStatus(state, building.key, { actionUnavailableReason, chainCost });
  const effectRows = detailEffectRows(effect, energy);
  const levelInfoRows = buildingLevelInfoRows(state.buildings, building.key, planetProductionProfile);
  const actionVerb = currentLevel === 0 ? "Build" : "Upgrade";
  const actionLabel = `${actionVerb} Level ${status.targetLevel}`;
  const activeBuildingQueue = state.queue?.kind === "building" ? state.queue : undefined;
  const isSelectedBuildingQueued = activeBuildingQueue?.key === building.key;
  const [isInfoOpen, setIsInfoOpen] = useState(false);
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
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-400">
                <span>{currentLevel === 0 ? `Build Level ${status.targetLevel}` : `Level ${currentLevel} to ${status.targetLevel}`}</span>
                <BuildingLevelInfoButton
                  buildingLabel={building.label}
                  onClick={() => setIsInfoOpen(true)}
                />
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
        <InfoBlock label="Requirements" value={formatBuildingRequirements(building.key)} />
        <InfoBlock label="Upgrade cost" value={formatCost(status.cost)} />
        <InfoBlock label="Upgrade time" value={formatDuration(status.durationSeconds)} />
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

      {isBuildingReadyToFinish && onFinishBuilding && (
        <button
          className="mt-3 h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
          onClick={onFinishBuilding}
          type="button"
        >
          Finish upgrade
        </button>
      )}

      {!isSelectedBuildingQueued && (
        <button
          aria-label={`${actionVerb} ${building.label} to Level ${status.targetLevel}`}
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
    </aside>
  );
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
  const remaining = formatDurationUntil(queue.readyAt, now);
  const percent = Math.round(progress(queue, now) * 100);

  return (
    <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">
            {isSelectedBuilding ? "Construction in progress" : "Active construction"}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-200/85">
            {queueLabel} is upgrading{isSelectedBuilding ? "." : "; the selected building is waiting for this queue."}
          </p>
        </div>
        <span className="shrink-0 rounded bg-black/20 px-2 py-1 text-xs font-semibold text-amber-100">
          {percent}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
        <div
          className="h-full rounded-full bg-amber-300 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-amber-100 sm:grid-cols-2">
        <p className="min-w-0">
          <span className="block uppercase tracking-normal text-amber-200/70">Time remaining</span>
          <span className="mt-1 block font-semibold">{remaining}</span>
        </p>
        <p className="min-w-0">
          <span className="block uppercase tracking-normal text-amber-200/70">Ready at</span>
          <span className="mt-1 block font-semibold">{formatQueueReadyAt(queue.readyAt)}</span>
        </p>
      </div>
    </div>
  );
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
                <LevelInfoHeader className="min-w-28">Level</LevelInfoHeader>
                <LevelInfoHeader className="min-w-52">Upgrade cost</LevelInfoHeader>
                {columns.production && <LevelInfoHeader className="min-w-40">Production</LevelInfoHeader>}
                {columns.storage && <LevelInfoHeader className="min-w-40">Storage</LevelInfoHeader>}
                {columns.effect && <LevelInfoHeader className="min-w-44">Effect</LevelInfoHeader>}
                {columns.energyRequired && <LevelInfoHeader className="min-w-36">Energy use</LevelInfoHeader>}
                {columns.energyProduced && <LevelInfoHeader className="min-w-40">Energy output</LevelInfoHeader>}
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
                  <LevelInfoCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold text-white">Level {row.level}</span>
                      {row.current && <LevelPill tone="current">Current</LevelPill>}
                      {row.next && <LevelPill tone="next">Next</LevelPill>}
                    </span>
                  </LevelInfoCell>
                  <LevelInfoCell>{formatCost(row.cost)}</LevelInfoCell>
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

function LevelInfoCell({ children }: { children: ComponentChildren }) {
  return (
    <td className="border-b border-white/10 px-3 py-2 align-top text-slate-200">
      {children}
    </td>
  );
}

function LevelPill({ children, tone }: { children: string; tone: "current" | "next" }) {
  const className = tone === "current"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
    : "border-signal/30 bg-signal/10 text-signal";

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-normal ${className}`}>
      {children}
    </span>
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
        ? `Unlocks research (x${formatNumber(effect.nextFactor)})`
        : `x${formatNumber(effect.nextFactor)}`,
      value: effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Unavailable",
    };

    rows.push(fasterPercent > 0 ? { ...row, delta: `+${formatNumber(fasterPercent)}% faster` } : row);
  } else {
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
      ...(energy.delta !== 0 ? { delta: `(${formatSigned(energy.delta)})` } : {}),
      label: "Energy required",
      next: `${formatNumber(energy.next)} required`,
      tone: "warning",
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

  if (effect.kind === "shipyard") {
    return effect.unlocked ? `x${formatNumber(effect.currentFactor)}` : "Locked";
  }

  if (effect.kind === "facility") {
    return effect.currentLevel > 0 ? `Level ${effect.currentLevel}` : "Locked";
  }

  return `x${formatNumber(effect.currentFactor)}`;
}
