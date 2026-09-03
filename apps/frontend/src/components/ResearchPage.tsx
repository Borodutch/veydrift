import { Info, X } from "lucide-preact";
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { escapeCloseRef } from "./modalDismiss";
import type { PlayableState, ResearchKey, ResearchRequirement, Resources } from "../playableMvp";
import {
  buildingCatalog,
  canAfford,
  energyBalance,
  researchDurationEstimate,
  researchEffectRows,
  researchCatalog,
  researchCost,
  researchLabRequirementFor,
  researchRequirementsFor,
  researchUnlockRows,
  unmetResearchRequirement,
} from "../playableMvp";
import { walletRecoveryActionMessage, type ChainResearchState } from "../walletFlow";
import { researchQueueForDisplay as chainResearchQueueForDisplay } from "../chainState";
import { formatMissingResources } from "../buildingDetails";
import { formatDuration, formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import {
  InspectCatalogTile,
  InspectDetailHero,
  InspectDetailImage,
  InspectDetailShell,
  InspectInfoRow,
  InspectTwoColumnLayout,
  useInspectDetailSelection,
} from "./InspectProgressLayout";
import { refreshButtonState } from "./PageHeader";
import { QueueProgressPanel } from "./QueueProgressPanel";
import { constructionQueueForDisplay, type ConstructionProgress } from "../constructionProgress";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { CatalogSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { supplyResourceShortfall, type SupplyResources } from "../batchSupplyPlanner";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const researchGroups = ["Basic", "Drive", "Advanced", "Combat"];

export type ResearchActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

const researchDescriptions: Partial<Record<ResearchKey, string>> = {
  energy: "Improves the science base for power systems and unlocks higher-energy technologies.",
  laser: "Develops directed-energy systems used by defenses, weapons, and later plasma research.",
  ion: "Studies ionized particle control for advanced weapons and shield-adjacent systems.",
  hyperspace: "Opens the theoretical foundation for hyperspace travel, drives, and long-range research.",
  plasma: "Combines high-energy physics with weaponized plasma applications.",
  combustionDrive: "Improves early engine efficiency for basic ship movement and logistics.",
  impulseDrive: "Unlocks stronger drive systems for faster military and utility ships.",
  hyperspaceDrive: "Enables the highest tier of interstellar ship propulsion.",
  computer: "Increases command-and-control capacity for fleet and automation systems.",
  astrophysics: "Expands colonization and deep-space discovery capability.",
  intergalacticResearchNetwork: "Links laboratories so mature empires can coordinate advanced research.",
  graviton: "Studies extreme gravity fields required for endgame-scale technologies.",
  weapons: "Improves offensive weapon systems across combat ships and defenses.",
  shielding: "Improves defensive shield systems and related energy barriers.",
  armor: "Improves hull materials and structural resilience.",
};

export function researchRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

interface ResearchPageProps {
  actionState: ResearchActionState;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  now?: number | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onResearch: (technologyId: number, key: ResearchKey) => void;
  onSelectResearch?: ((key: ResearchKey) => void) | undefined;
  onSupply?: ((resources: SupplyResources) => void) | undefined;
  productionRates?: Resources | undefined;
  progressState?: ConstructionProgress | undefined;
  researchState: ChainResearchState | null;
  selectedResearchKey?: ResearchKey | undefined;
  spendableResources?: Resources | undefined;
  settledState: PlayableState;
  state: PlayableState;
  transactionUnavailableReason?: string | undefined;
  useLocalStateFallback?: boolean | undefined;
}

export function ResearchPage({
  actionState,
  canTransact,
  error,
  loading,
  now = Date.now(),
  onOpenRequirement,
  onResearch,
  onSelectResearch,
  onSupply,
  productionRates,
  progressState,
  researchState,
  selectedResearchKey,
  spendableResources,
  settledState,
  transactionUnavailableReason,
  useLocalStateFallback = false,
}: ResearchPageProps) {
  const [localSelectedKey, setLocalSelectedKey] = useState<ResearchKey>("energy");
  const selectedKey = selectedResearchKey ?? localSelectedKey;
  const selectedResearch = researchCatalog.find((research) => research.key === selectedKey)
    ?? researchCatalog[0]!;
  const hideLiveValues = shouldHideResearchValues({
    error,
    loading,
    researchState,
    useLocalStateFallback,
  });
  const viewState = researchViewState(settledState, researchState, useLocalStateFallback, now);
  const queue = constructionQueueForDisplay(
    hideLiveValues ? undefined : researchQueueForDisplay(researchState, viewState, now),
    progressState,
  );
  const { detailPanelRef, selectInspectItem: handleSelectResearch } = useInspectDetailSelection<ResearchKey>((key) => {
    setLocalSelectedKey(key);
    onSelectResearch?.(key);
  });

  return (
    <div className="grid gap-4">
      <ResearchStatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        researchState={researchState}
      />

      {hideLiveValues ? (
        <ResearchLoadErrorPanel
          loading={loading}
          reason={error}
        />
      ) : (
        <>
      {queue ? <ActiveResearchQueuePanel now={now} progressState={progressState} queue={queue} /> : null}

      {viewState.buildings.researchLab === 0 ? (
        <div className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          Research Lab 1 is required before any technology can be queued.
        </div>
      ) : null}

      <InspectTwoColumnLayout
        catalog={researchGroups.map((group) => {
          const entries = researchCatalog.filter((research) => research.lane === group);
          return (
            <section className="grid gap-2" key={group}>
              <h3 className="text-sm font-semibold uppercase tracking-normal text-slate-400">{group}</h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4">
                {entries.map((research) => {
                  const status = researchActionStatus({
                    actionPending: actionState.status === "pending",
                    canTransact,
                    chainCost: chainCostFor(researchState, research.id),
                    error,
                    ignoreActiveQueue: true,
                    key: research.key,
                    loading,
                    now,
                    productionRates,
                    researchState,
                    spendableResources,
                    state: viewState,
                    transactionUnavailableReason,
                  });
                  return (
                    <InspectCatalogTile
                      asset={research.asset}
                      currentText={`Level ${status.currentLevel}`}
                      isDimmed={status.currentLevel === 0}
                      isSelected={research.key === selectedResearch.key}
                      key={research.key}
                      label={research.label}
                      labelTone={researchCatalogTitleTone(status)}
                      onClick={() => handleSelectResearch(research.key)}
                      statusText={researchCatalogStatusText(status)}
                      statusTone={status.tileStatus === "Locked" || status.tileStatus === "ShortResources" ? "warning" : "accent"}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
        catalogClassName="grid gap-4"
        detail={(
          <ResearchDetailPanel
            actionPending={actionState.status === "pending"}
            actionPendingLabel={actionState.status === "pending" ? actionState.label : undefined}
            canTransact={canTransact}
            error={error}
            loading={loading}
            now={now}
            onResearch={() => onResearch(selectedResearch.id, selectedResearch.key)}
            onOpenRequirement={onOpenRequirement}
            onSupply={onSupply}
            research={selectedResearch}
            researchState={researchState}
            productionRates={productionRates}
            spendableResources={spendableResources}
            state={viewState}
            transactionUnavailableReason={transactionUnavailableReason}
          />
        )}
        detailPanelRef={detailPanelRef}
      />
        </>
      )}
    </div>
  );
}

export function shouldHideResearchValues({
  researchState,
  useLocalStateFallback,
}: {
  error: string | undefined;
  loading: boolean;
  researchState: ChainResearchState | null;
  useLocalStateFallback: boolean;
}): boolean {
  if (useLocalStateFallback) return false;
  return !researchState;
}

export function ResearchLoadErrorPanel({
  loading,
  reason,
}: {
  loading: boolean;
  reason: string | undefined;
}) {
  if (loading) {
    return <CatalogSkeleton label="Loading research" />;
  }

  if (isGameUnavailableMessage(reason)) {
    return <GameUnavailableNotice />;
  }

  return (
    <div className="rounded-lg border border-rose-300/20 bg-rose-300/5 px-4 py-4 text-sm text-rose-100">
      <p className="font-semibold">
        Research state could not be loaded.
      </p>
      {reason ? (
        <p className="mt-1 text-rose-100/80">{reason}</p>
      ) : null}
      <p className="mt-3 text-xs text-rose-100/70">
        Levels, costs, resources, queue state, and requirement-derived values are unavailable until live research state loads.
      </p>
    </div>
  );
}

export function researchRefreshErrorLabel({
  error,
  researchState,
}: {
  error: string | undefined;
  researchState: ChainResearchState | null;
}): string | undefined {
  if (!error || !researchState) return undefined;
  return `Refreshing research state: ${error}`;
}

export function ResearchStatusPanel({
  actionState,
  error,
  loading,
  researchState,
}: {
  actionState: ResearchActionState;
  error: string | undefined;
  loading: boolean;
  researchState: ChainResearchState | null;
}) {
  // Only suppress notices during the initial load (no state yet). Keeping the
  // last notice visible across refreshes avoids a blink/layout-jump when state
  // is silently re-fetched.
  if (loading && !researchState) {
    return null;
  }

  const walletRecoveryMessage = walletRecoveryActionMessage(error ?? researchState?.unavailableReason);
  if (walletRecoveryMessage) {
    return <Notice tone="danger">{walletRecoveryMessage}</Notice>;
  }

  const refreshError = researchRefreshErrorLabel({ error, researchState });
  if (refreshError) {
    return isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="neutral">{refreshError}</Notice>;
  }

  if (error) {
    return isGameUnavailableMessage(error)
      ? <GameUnavailableNotice />
      : <Notice tone="danger">Research state could not be loaded. Actions are disabled until game state is available.</Notice>;
  }

  if (!researchState) {
    return null;
  }

  if (researchState?.researchAvailable === false) {
    return (
      <Notice tone="neutral">
        {researchState.unavailableReason ?? "Research is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!researchState?.homePlanetId) {
    return (
      <Notice tone="danger">
        No VeydriftGame home planet was found for this wallet. Research levels and actions are not shown from local state.
      </Notice>
    );
  }

  // Only surface failures. Success/pending action banners and the queue-status
  // banner are intentionally not rendered so the page does not flash transient
  // status banners on every action; queue progress remains in the header
  // completion control and the selected technology's queue detail.
  if (actionState.status === "error") {
    return <Notice tone="danger">{actionState.label}</Notice>;
  }

  return null;
}

function Notice({
  children,
  tone,
}: {
  children: ComponentChildren;
  tone: "danger" | "neutral" | "success";
}) {
  const classes = {
    danger: "border-rose-300/20 bg-rose-300/5 text-rose-200",
    neutral: "border-sky-300/20 bg-sky-300/5 text-sky-200",
    success: "border-emerald-300/20 bg-emerald-300/5 text-emerald-200",
  } as const;

  return (
    <div className={`notice-enter rounded border p-3 text-sm ${classes[tone]}`}>
      {children}
    </div>
  );
}

function ResearchDetailPanel({
  actionPending,
  actionPendingLabel,
  canTransact,
  error,
  loading,
  now,
  onResearch,
  onOpenRequirement,
  onSupply,
  research,
  researchState,
  productionRates,
  spendableResources,
  state,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  now: number;
  onResearch: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onSupply?: ((resources: SupplyResources) => void) | undefined;
  research: (typeof researchCatalog)[number];
  researchState: ChainResearchState | null;
  productionRates?: Resources | undefined;
  spendableResources?: Resources | undefined;
  state: PlayableState;
  transactionUnavailableReason?: string | undefined;
}) {
  const chainCost = chainCostFor(researchState, research.id);
  const status = researchActionStatus({
    actionPending,
    actionPendingLabel,
    canTransact,
    chainCost,
    chainDurationSeconds: chainDurationFor(researchState, research.id),
    error,
    key: research.key,
    loading,
    now,
    productionRates,
    researchState,
    spendableResources,
    state,
    transactionUnavailableReason,
  });
  const requirementStates = getResearchRequirementStates(state, research.key);
  const effectRows = researchEffectRows(state, research.key, {
    researchNetworkLabLevels: researchState?.researchNetworkLabLevels,
  });
  const unlockRows = researchUnlockRows(research.key);
  const levelInfoRows = researchLevelInfoRows(state, research.key, {
    researchNetworkLabLevels: researchState?.researchNetworkLabLevels,
  });
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const supplyRequest = supplyResourceShortfall(spendableResources, chainCost);

  return (
    <InspectDetailShell>
      <InspectDetailHero
        image={(
          <InspectDetailImage
            asset={research.asset}
            cacheKey={`research:${research.key}`}
            isDimmed={status.currentLevel === 0}
          />
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold text-white">{research.label}</h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>Level {status.currentLevel} to {status.targetLevel}</span>
              <ResearchLevelInfoButton
                onClick={() => setIsInfoOpen(true)}
                researchLabel={research.label}
              />
            </div>
          </div>
          <span className={`rounded px-2 py-1 text-xs font-semibold ${status.disabled ? "bg-white/5 text-slate-400" : "bg-emerald-300/10 text-emerald-200"}`}>
            {status.badge}
          </span>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          {researchDescriptions[research.key] ?? "Expands the empire research model for future technologies and unlock paths."}
        </p>
      </InspectDetailHero>

      <dl className="mt-4 grid gap-2">
        <InspectInfoRow label="Category" value={research.lane} />
        <InspectInfoRow label="Requirements">
          <RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={requirementStates} />
        </InspectInfoRow>
        <InspectInfoRow label="Research cost" value={status.cost ? formatCost(status.cost) : "Unavailable until chain state loads"} />
        {status.durationSeconds === undefined ? null : (
          <InspectInfoRow label="Research time" value={formatDuration(status.durationSeconds)} />
        )}
      </dl>

      <ResearchEffectsSection effectRows={effectRows} unlockRows={unlockRows} />

      <ResearchActionReasonNotice disabled={status.disabled} reason={status.reason} />

      <div className={`mt-3 grid gap-2 ${supplyRequest && onSupply ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          aria-label={`Research ${research.label} to Level ${status.targetLevel}`}
          className="h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          disabled={status.disabled}
          onClick={onResearch}
          type="button"
        >
          {status.actionLabel}
        </button>
        {supplyRequest && onSupply ? (
          <button
            aria-label={`Supply missing resources for ${research.label}`}
            className="h-10 w-full rounded-md border border-sky-300/40 bg-sky-300/10 px-3 text-sm font-semibold text-sky-200 transition hover:bg-sky-300/20"
            onClick={() => onSupply(supplyRequest)}
            type="button"
          >
            Supply
          </button>
        ) : null}
      </div>

      {isInfoOpen && (
        <ResearchLevelInfoModal
          currentLevel={status.currentLevel}
          onClose={() => setIsInfoOpen(false)}
          researchLabel={research.label}
          rows={levelInfoRows}
        />
      )}
    </InspectDetailShell>
  );
}

export function ResearchActionReasonNotice({
  disabled,
  reason,
}: {
  disabled: boolean;
  reason: string;
}) {
  return (
    <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className={`text-sm font-semibold ${disabled ? "text-slate-400" : "text-emerald-200"}`}>
        {reason}
      </p>
    </div>
  );
}

export type ResearchLevelInfoRow = {
  cost: Resources;
  current: boolean;
  // Per-level predicted research time for the reference table (VEY-KANEO-472).
  // Undefined when prerequisites for that level are unmet. Client-computed, matching
  // this catalogue's existing client-side cost/effect derivation.
  durationSeconds?: number | undefined;
  effect: string;
  level: number;
  next: boolean;
  requirementStatus: string;
};

const MAX_RESEARCH_INFO_LEVEL = 12;

export function researchLevelInfoRows(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
  options: {
    maxLevel?: number | undefined;
    researchNetworkLabLevels?: readonly number[] | undefined;
  } = {},
): ResearchLevelInfoRow[] {
  const currentLevel = state.research[key];
  const maxLevel = Math.max(
    1,
    options.maxLevel ?? Math.max(MAX_RESEARCH_INFO_LEVEL, currentLevel + 5),
  );

  return Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    const preResearch = { ...state.research, [key]: level - 1 };
    const targetState = {
      ...state,
      research: preResearch,
    };
    const cost = researchCost(preResearch, key);
    const requirementStatus = researchLevelRequirementStatus(targetState, key, level);
    const durationSeconds = requirementStatus !== "Met"
      ? undefined
      : researchDurationEstimate(state.buildings, cost, {
          networkLevel: preResearch.intergalacticResearchNetwork,
          requiredLabLevel: researchLabRequirementFor(key),
          researchNetworkLabLevels: options.researchNetworkLabLevels,
        });

    return {
      cost,
      current: currentLevel === level,
      durationSeconds,
      effect: researchLevelEffectSummary(state, key, level, options.researchNetworkLabLevels),
      level,
      next: currentLevel + 1 === level,
      requirementStatus,
    };
  });
}

export function ResearchLevelInfoButton({
  onClick,
  researchLabel,
}: {
  onClick: () => void;
  researchLabel: string;
}) {
  return (
    <button
      aria-label="Research level details"
      className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-200 sm:h-7 sm:w-7"
      onClick={onClick}
      title={`${researchLabel} level details`}
      type="button"
    >
      <Info aria-hidden="true" size={15} strokeWidth={2.2} />
    </button>
  );
}

export function ResearchLevelInfoModal({
  currentLevel,
  onClose,
  researchLabel,
  rows,
}: {
  currentLevel: number;
  onClose: () => void;
  researchLabel: string;
  rows: ResearchLevelInfoRow[];
}) {
  return (
    <div
      aria-labelledby="research-level-info-title"
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-center bg-black/70 p-3"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={escapeCloseRef(onClose)}
      role="dialog"
    >
      <div className="modal-panel-enter max-h-[min(44rem,calc(100dvh-1.5rem))] w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#0f1624] shadow-2xl shadow-black/40">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h3 id="research-level-info-title" className="break-words text-base font-semibold text-white">
              {researchLabel} levels
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Current Level {currentLevel}
            </p>
          </div>
          <button
            aria-label="Close level table"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white sm:h-8 sm:w-8"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-8rem)] overflow-auto">
          <table className="level-info-table min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#111827] text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <ResearchLevelInfoHeader className="min-w-24 whitespace-nowrap">Level</ResearchLevelInfoHeader>
                <ResearchLevelInfoHeader className="min-w-24 whitespace-nowrap">Status</ResearchLevelInfoHeader>
                <ResearchLevelInfoHeader className="min-w-52">Research cost</ResearchLevelInfoHeader>
                <ResearchLevelInfoHeader className="min-w-32">Research time</ResearchLevelInfoHeader>
                <ResearchLevelInfoHeader className="min-w-52">Requirements</ResearchLevelInfoHeader>
                <ResearchLevelInfoHeader className="min-w-60">Effect</ResearchLevelInfoHeader>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className={`border-t border-white/10 ${
                    row.current
                      ? "bg-emerald-300/10"
                      : row.next
                        ? "bg-cyan-300/10"
                        : "odd:bg-white/[0.015]"
                  }`}
                  key={row.level}
                >
                  <ResearchLevelInfoCell className="whitespace-nowrap" dataLabel="Level">
                    <span className="font-semibold text-white">Level {row.level}</span>
                  </ResearchLevelInfoCell>
                  <ResearchLevelInfoCell className="min-w-24" dataLabel="Status">
                    <div className="flex flex-wrap gap-1">
                      {row.current ? <ResearchLevelPill tone="current">Current</ResearchLevelPill> : null}
                      {row.next ? <ResearchLevelPill tone="next">Next</ResearchLevelPill> : null}
                      {!row.current && !row.next && row.requirementStatus !== "Met" ? (
                        <ResearchLevelPill tone="locked">Locked</ResearchLevelPill>
                      ) : null}
                    </div>
                  </ResearchLevelInfoCell>
                  <ResearchLevelInfoCell dataLabel="Research cost">{formatCost(row.cost)}</ResearchLevelInfoCell>
                  <ResearchLevelInfoCell dataLabel="Research time">
                    {row.durationSeconds === undefined ? "Unavailable until prerequisites are met" : formatDuration(row.durationSeconds)}
                  </ResearchLevelInfoCell>
                  <ResearchLevelInfoCell dataLabel="Requirements">{row.requirementStatus}</ResearchLevelInfoCell>
                  <ResearchLevelInfoCell dataLabel="Effect">{row.effect}</ResearchLevelInfoCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResearchLevelInfoHeader({
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

function ResearchLevelInfoCell({
  children,
  className = "",
  dataLabel,
}: {
  children: ComponentChildren;
  className?: string | undefined;
  dataLabel?: string | undefined;
}) {
  return (
    <td className={`border-b border-white/10 px-3 py-2 align-top text-slate-200 ${className}`} data-label={dataLabel}>
      {children}
    </td>
  );
}

function ResearchLevelPill({
  children,
  tone,
}: {
  children: string;
  tone: "current" | "locked" | "next";
}) {
  const className = tone === "current"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
    : tone === "next"
      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
      : "border-amber-300/30 bg-amber-300/10 text-amber-200";

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-normal ${className}`}>
      {children}
    </span>
  );
}

function researchLevelRequirementStatus(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
  targetLevel: number,
): string {
  const missing = researchRequirementsFor(key).flatMap((requirement) => {
    if (requirement.type === "building") {
      return state.buildings[requirement.key] >= requirement.level
        ? []
        : [`Requires ${formatRequirement(requirement)}`];
    }

    if (requirement.type === "energy") {
      const produced = energyBalance(
        state.buildings,
        state.research.energy,
        state.ships.solarSatellite,
      ).produced;
      const required = researchEnergyRequirementForLevel(key, targetLevel, requirement.produced);
      return produced >= required
        ? []
        : [`Requires Energy production ${required.toLocaleString()}`];
    }

    return state.research[requirement.key] >= requirement.level
      ? []
      : [`Requires ${formatRequirement(requirement)}`];
  });

  return missing.length > 0 ? missing.join(", ") : "Met";
}

function researchEnergyRequirementForLevel(
  key: ResearchKey,
  targetLevel: number,
  baseRequirement: number,
): number {
  if (key !== "graviton") return baseRequirement;
  return Math.floor(baseRequirement * (3 ** Math.max(0, targetLevel - 1)));
}

function researchLevelEffectSummary(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
  targetLevel: number,
  researchNetworkLabLevels?: readonly number[] | undefined,
): string {
  const beforeLevel = targetLevel - 1;
  const rowState = {
    ...state,
    research: {
      ...state.research,
      [key]: beforeLevel,
    },
  };
  const effectRows = researchEffectRows(rowState, key, { researchNetworkLabLevels });
  const directEffects = effectRows.map((row) => {
    const delta = row.delta ? ` (${row.delta})` : "";
    return `${row.target}: ${row.next}${delta}`;
  });
  const unlocks = researchUnlockRows(key)
    .filter((row) => row.endsWith(`Level ${targetLevel}`))
    .map((row) => row.replace(` at Level ${targetLevel}`, ""));

  if (directEffects.length > 0 && unlocks.length > 0) {
    return `${directEffects.join("; ")}; unlocks ${unlocks.join(", ")}`;
  }

  if (directEffects.length > 0) {
    return directEffects.join("; ");
  }

  if (unlocks.length > 0) {
    return `Unlocks ${unlocks.join(", ")}`;
  }

  return "Used as an unlock or prerequisite in current Veydrift rules";
}

export function ResearchEffectsSection({
  effectRows,
  unlockRows,
}: {
  effectRows: ReturnType<typeof researchEffectRows>;
  unlockRows: string[];
}) {
  return (
    <section className="mt-4 rounded border border-white/10 bg-white/[0.03] p-3">
      <h4 className="text-xs font-semibold uppercase tracking-normal text-slate-400">Effects</h4>
      {effectRows.length > 0 ? (
        <>
          <div className="mt-2 overflow-hidden rounded border border-white/10">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400">
                <tr>
                  <th className="w-2/5 px-2 py-1.5 font-semibold">Target</th>
                  <th className="px-2 py-1.5 font-semibold">Current</th>
                  <th className="px-2 py-1.5 font-semibold">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {effectRows.map((row) => (
                  <tr key={row.target}>
                    <td className="px-2 py-1.5 text-slate-200">{row.target}</td>
                    <td className="px-2 py-1.5 text-slate-300">{row.current}</td>
                    <td className="px-2 py-1.5 text-emerald-200">
                      {row.next}
                      {row.delta ? <span className="ml-1 text-emerald-300/80">({row.delta})</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unlockRows.length > 0 ? <ResearchUnlockList title="Also unlocks" unlockRows={unlockRows} /> : null}
        </>
      ) : unlockRows.length > 0 ? (
        <ResearchUnlockList unlockRows={unlockRows} />
      ) : (
        <p className="mt-2 text-xs text-slate-400">No direct numeric effect in current Veydrift rules; this technology is used as an unlock or prerequisite.</p>
      )}
    </section>
  );
}

function ResearchUnlockList({
  title,
  unlockRows,
}: {
  title?: string | undefined;
  unlockRows: string[];
}) {
  return (
    <div className="mt-2">
      {title ? <p className="text-xs font-semibold text-slate-400">{title}</p> : null}
      <ul className="mt-1 grid gap-1 text-xs text-slate-300">
        {sortResearchUnlockRows(unlockRows).slice(0, 8).map((row) => (
          <li className="rounded border border-white/10 bg-white/[0.03] px-2 py-1" key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}

export function sortResearchUnlockRows(unlockRows: readonly string[]): string[] {
  return [...unlockRows].sort((left, right) => {
    const levelDifference = researchUnlockLevel(left) - researchUnlockLevel(right);
    if (levelDifference !== 0) return levelDifference;

    const leftName = left.replace(/ at Level \d+$/, "");
    const rightName = right.replace(/ at Level \d+$/, "");
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
}

function researchUnlockLevel(row: string): number {
  const level = row.match(/ at Level (\d+)$/)?.[1];
  return level === undefined ? Number.MAX_SAFE_INTEGER : Number(level);
}

export function ActiveResearchQueuePanel({
  now,
  progressState,
  queue,
}: {
  now: number;
  progressState?: ConstructionProgress | undefined;
  queue: NonNullable<ReturnType<typeof researchQueueForDisplay>>;
}) {
  const queueLabel = `${queue.label} ${queue.targetLevel}`;
  const asset = researchCatalog.find((research) => research.key === queue.key)?.asset;

  return (
    <QueueProgressPanel
      asset={asset}
      itemText={queueLabel}
      label={queueLabel}
      now={now}
      progressState={progressState}
      readyAt={queue.readyAt}
      startedAt={queue.startedAt}
      title="Research"
      tone="violet"
    />
  );
}

export function researchActionStatus({
  actionPending,
  actionPendingLabel,
  canTransact,
  chainCost,
  chainDurationSeconds,
  error,
  ignoreActiveQueue = false,
  key,
  loading,
  now,
  productionRates,
  researchState,
  spendableResources,
  state,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  canTransact: boolean;
  chainCost: Resources | undefined;
  chainDurationSeconds?: number | undefined;
  error: string | undefined;
  ignoreActiveQueue?: boolean | undefined;
  key: ResearchKey;
  loading: boolean;
  now: number;
  productionRates?: Resources | undefined;
  researchState: ChainResearchState | null;
  spendableResources?: Resources | undefined;
  state: PlayableState;
  transactionUnavailableReason?: string | undefined;
}) {
  const cost = chainCost;
  const currentLevel = state.research[key];
  const activeQueue = !ignoreActiveQueue && researchState?.queue?.active
    ? researchState.queue
    : undefined;
  const activeQueueResearch = activeQueue?.itemId === undefined
    ? undefined
    : researchCatalog.find((research) => research.id === activeQueue.itemId);
  const missingRequirement = unmetResearchRequirement(state, key);
  const resourcesAvailable = Boolean(researchState?.resourcesAsOfNow ?? researchState?.resources);
  const spendable = spendableResources ?? state.resources;
  const affordable = cost ? canAfford(spendable, cost) : false;
  const displayedActive = !ignoreActiveQueue && state.researchQueue?.key === key;
  const active = displayedActive || activeQueueResearch?.key === key;
  const activeTargetLevel = state.researchQueue?.targetLevel ?? activeQueue?.targetLevel;
  const targetLevel = active ? activeTargetLevel ?? currentLevel + 1 : currentLevel + 1;
  const activeReadyAt = displayedActive ? state.researchQueue?.readyAt : timestampToMs(activeQueue?.readyAt);
  const activeReady = active && Boolean(activeReadyAt && activeReadyAt <= now);
  const queueOccupied = !ignoreActiveQueue
    && (Boolean(state.researchQueue) || Boolean(activeQueue))
    && !active;
  const occupiedQueueLabel = state.researchQueue?.label ?? activeQueueResearch?.label;
  const reason = actionPending
    ? actionPendingLabel ?? "Awaiting wallet"
    : loading && !researchState
      ? "Loading research state"
      : error
        ? "Research state unavailable"
        : !researchState
          ? "Research state not loaded"
          : researchState.researchAvailable === false
          ? researchState.unavailableReason ?? "Research unavailable on this contract"
          : !researchState.homePlanetId
            ? "No VeydriftGame home planet"
            : !canTransact
              ? transactionUnavailableReason ?? "Wallet or game contract unavailable"
              : activeReady
                ? `Completing Level ${targetLevel}`
              : active
                ? `Research to Level ${state.researchQueue?.targetLevel ?? targetLevel} in progress`
              : queueOccupied
                ? `Research queue occupied by ${occupiedQueueLabel ?? "another technology"}`
                : missingRequirement
                  ? "Locked by unmet prerequisites"
                  : !resourcesAvailable
                    ? "Resources unavailable"
                    : !cost
                      ? "Research cost unavailable"
                      : !affordable
                        ? formatMissingResources(spendable, cost, productionRates)
                        : `Ready for Level ${targetLevel}`;

  const resourceShortfall = !actionPending
    && !error
    && Boolean(researchState)
    && researchState?.researchAvailable !== false
    && Boolean(researchState?.homePlanetId)
    && canTransact
    && !activeReady
    && !active
    && !queueOccupied
    && !missingRequirement
    && resourcesAvailable
    && Boolean(cost)
    && !affordable;

  // Completions settle automatically on-chain (lazy reconcile) — the button only ever
  // starts a new research level and is disabled while a level is in progress/completing.
  const researchReady = reason === `Ready for Level ${targetLevel}`;
  const disabled = !researchReady;
  const badge = active ? "In progress" : resourceShortfall ? "Need resources" : disabled ? "Locked" : "Available";

  return {
    actionLabel: actionPending ? actionPendingLabel ?? "Awaiting wallet" : active ? "In progress" : `Research Level ${targetLevel}`,
    badge,
    cost,
    currentLevel,
    disabled,
    // Backend-sourced predicted research time for the next level (VEY-KANEO-472).
    durationSeconds: chainDurationSeconds,
    hasMissingRequirement: Boolean(missingRequirement),
    reason,
    targetLevel,
    tileStatus: active ? "Active" : resourceShortfall ? "ShortResources" : disabled ? "Locked" : "Ready",
  };
}

export function researchCatalogTitleTone(
  status: Pick<ReturnType<typeof researchActionStatus>, "tileStatus">,
): "normal" | "muted" {
  return status.tileStatus === "Locked" || status.tileStatus === "ShortResources" ? "muted" : "normal";
}

export function researchCatalogStatusText(
  status: Pick<ReturnType<typeof researchActionStatus>, "tileStatus">,
): string {
  if (status.tileStatus === "Active") return "Active";
  return "";
}

export function researchViewState(
  state: PlayableState,
  researchState: ChainResearchState | null,
  useLocalStateFallback: boolean,
  now = Date.now(),
): PlayableState {
  if (!researchState) {
    return useLocalStateFallback ? state : { ...state, researchQueue: undefined };
  }

  return {
    ...state,
    buildings: {
      ...state.buildings,
      researchLab: researchState.researchLabLevel,
    },
    research: researchLevels(researchState),
    researchQueue: researchQueueForDisplay(researchState, state, now) ?? undefined,
    // VEY-KANEO-473: gate research affordability on the canonical settled-to-now balance
    // (`resourcesAsOfNow`) the top bar uses — the same single source the infrastructure, shipyard,
    // and defense panels now read — falling back to the raw settled `resources` only when the
    // accrued field is absent. This is the fallback the gate uses when `spendableResources` is
    // unavailable; reading the raw snapshot here is what let the panel disagree with the top bar.
    resources: toResources(researchState.resourcesAsOfNow ?? researchState.resources) ?? { metal: 0, crystal: 0, deuterium: 0 },
  };
}

function researchLevels(researchState: ChainResearchState): PlayableState["research"] {
  return Object.fromEntries(
    researchCatalog.map((research) => {
      const row = researchState.technologies.find((item) => item.id === research.id);
      return [research.key, row?.level ?? researchState.technologyLevels[research.id.toString()] ?? 0];
    }),
  ) as PlayableState["research"];
}

function researchQueueForDisplay(
  researchState: ChainResearchState | null,
  state: Pick<PlayableState, "buildings" | "research" | "researchQueue">,
  now = Date.now(),
): PlayableState["researchQueue"] {
  const queue = researchState?.queue;
  if (!queue?.active || queue.itemId === undefined) {
    return researchState ? undefined : state.researchQueue;
  }

  return chainResearchQueueForDisplay(queue, now, {
    buildings: state.buildings,
    research: state.research,
    researchNetworkLabLevels: researchState?.researchNetworkLabLevels,
  });
}

function chainCostFor(researchState: ChainResearchState | null, technologyId: number): Resources | undefined {
  const row = researchState?.technologies.find((item) => item.id === technologyId);
  return toResources(row?.cost);
}

function chainDurationFor(researchState: ChainResearchState | null, technologyId: number): number | undefined {
  const row = researchState?.technologies.find((item) => item.id === technologyId);
  return typeof row?.durationSeconds === "number" ? row.durationSeconds : undefined;
}

function toResources(resources: ChainResearchState["resources"] | ChainResearchState["technologies"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

export function formatResearchRequirements(requirements: ResearchRequirement[]): string {
  return requirements.length > 0 ? requirements.map(formatRequirement).join(", ") : "None";
}

export function getResearchRequirementStates(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
): RequirementFlair[] {
  return researchRequirementsFor(key).map((requirement) => ({
    label: formatRequirement(requirement),
    met: researchRequirementMet(state, requirement),
    target: requirement.type === "building"
      ? { kind: "building", key: requirement.key }
      : requirement.type === "research"
        ? { kind: "research", key: requirement.key }
        : { kind: "ship", key: "solarSatellite" },
  }));
}

export function formatCost(cost: Resources): string {
  const parts: Array<[string, number]> = [
    ["Metal", cost.metal],
    ["Crystal", cost.crystal],
    ["Deut.", cost.deuterium],
  ];
  return parts
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `${label} ${format(v)}`)
    .join(", ") || "No resource cost";
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatRequirement(requirement: ResearchRequirement): string {
  if (requirement.type === "building") {
    const building = buildingCatalog.find((item) => item.key === requirement.key);
    return `${building?.label ?? requirement.key} ${requirement.level}`;
  }

  if (requirement.type === "energy") {
    return `Energy production ${requirement.produced.toLocaleString()}`;
  }

  const research = researchCatalog.find((item) => item.key === requirement.key);
  return `${research?.label ?? requirement.key} ${requirement.level}`;
}

function researchRequirementMet(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  requirement: ResearchRequirement,
): boolean {
  if (requirement.type === "building") {
    return state.buildings[requirement.key] >= requirement.level;
  }

  if (requirement.type === "energy") {
    return energyBalance(
      state.buildings,
      state.research.energy,
      state.ships.solarSatellite,
    ).produced >= requirement.produced;
  }

  return state.research[requirement.key] >= requirement.level;
}
