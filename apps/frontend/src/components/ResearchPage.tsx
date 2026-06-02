import { useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { PlayableState, ResearchKey, ResearchRequirement, Resources } from "../playableMvp";
import {
  buildingCatalog,
  canAfford,
  energyBalance,
  researchCatalog,
  researchDurationEstimate,
  researchLabRequirementFor,
  researchRequirementsFor,
  unmetResearchRequirement,
} from "../playableMvp";
import type { ChainResearchState } from "../walletFlow";
import { researchQueueForDisplay as chainResearchQueueForDisplay } from "../chainState";
import { formatDuration, formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp } from "../timestampFormat";
import {
  InspectCatalogTile,
  InspectDetailHero,
  InspectDetailImage,
  InspectDetailShell,
  InspectInfoRow,
  SingleItemQueueProgress,
} from "./InspectProgressLayout";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

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

interface ResearchPageProps {
  actionState: ResearchActionState;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  onFinish: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onResearch: (technologyId: number, key: ResearchKey) => void;
  onSelectResearch?: ((key: ResearchKey) => void) | undefined;
  researchState: ChainResearchState | null;
  selectedResearchKey?: ResearchKey | undefined;
  settledState: PlayableState;
  state: PlayableState;
  useLocalStateFallback?: boolean | undefined;
}

export function ResearchPage({
  actionState,
  canTransact,
  error,
  loading,
  onFinish,
  onOpenRequirement,
  onRefresh,
  onResearch,
  onSelectResearch,
  researchState,
  selectedResearchKey,
  settledState,
  useLocalStateFallback = false,
}: ResearchPageProps) {
  const [localSelectedKey, setLocalSelectedKey] = useState<ResearchKey>("energy");
  const selectedKey = selectedResearchKey ?? localSelectedKey;
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectedResearch = researchCatalog.find((research) => research.key === selectedKey)
    ?? researchCatalog[0]!;
  const hideLiveValues = shouldHideResearchValues({
    error,
    loading,
    researchState,
    useLocalStateFallback,
  });
  const now = Date.now();
  const viewState = researchViewState(settledState, researchState, useLocalStateFallback, now);
  const queue = hideLiveValues ? undefined : researchQueueForDisplay(researchState, viewState, now);
  const queueReady = queue?.readyAt ? queue.readyAt <= now : false;

  function handleSelectResearch(key: ResearchKey) {
    setLocalSelectedKey(key);
    onSelectResearch?.(key);

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
            Select a technology to inspect real levels, prerequisites, cost, and on-chain action state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue && (
            <button
              className="h-9 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={!canTransact || actionState.status === "pending" || !queueReady}
              onClick={onFinish}
              type="button"
            >
              {queueReady ? "Complete research" : `Ready ${formatReady(queue.readyAt)}`}
            </button>
          )}
          <button
            className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      <ResearchStatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        queue={queue}
        researchState={researchState}
      />

      {hideLiveValues ? (
        <ResearchLoadErrorPanel
          loading={loading}
          reason={error}
        />
      ) : (
        <>
      {viewState.buildings.researchLab === 0 ? (
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
                    const status = researchActionStatus({
                      actionPending: actionState.status === "pending",
                      canTransact,
                      chainCost: chainCostFor(researchState, research.id),
                      error,
                      key: research.key,
                      loading,
                      researchState,
                      state: viewState,
                    });
                    return (
                      <InspectCatalogTile
                        asset={research.asset}
                        currentText={`Level ${status.currentLevel}`}
                        isDimmed={status.currentLevel === 0}
                        isSelected={research.key === selectedResearch.key}
                        key={research.key}
                        label={research.label}
                        onClick={() => handleSelectResearch(research.key)}
                        statusText={status.tileStatus}
                        statusTone={status.tileStatus === "Locked" ? "warning" : "accent"}
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
            actionPending={actionState.status === "pending"}
            actionPendingLabel={actionState.status === "pending" ? actionState.label : undefined}
            canTransact={canTransact}
            error={error}
            loading={loading}
            now={now}
            onResearch={() => onResearch(selectedResearch.id, selectedResearch.key)}
            onOpenRequirement={onOpenRequirement}
            queue={queue}
            research={selectedResearch}
            researchState={researchState}
            state={viewState}
          />
        </div>
      </div>
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
    return <VeydriftLoader label="Syncing research" />;
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

function ResearchStatusPanel({
  actionState,
  error,
  loading,
  queue,
  researchState,
}: {
  actionState: ResearchActionState;
  error: string | undefined;
  loading: boolean;
  queue: ReturnType<typeof researchQueueForDisplay>;
  researchState: ChainResearchState | null;
}) {
  if (loading && researchState) {
    return <InlineSyncIndicator label="Refreshing research" />;
  }

  if (loading) {
    return null;
  }

  if (error) {
    return <Notice tone="danger">Research state could not be loaded from the backend. Actions are disabled until chain state is available.</Notice>;
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

  if (actionState.status !== "idle") {
    const tone = actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "neutral";
    return <Notice tone={tone}>{actionState.label}</Notice>;
  }

  if (queue) {
    return (
      <Notice tone={queue.readyAt <= Date.now() ? "success" : "neutral"}>
        {queue.label} to Level {queue.targetLevel} is queued, ready {formatReady(queue.readyAt)}.
      </Notice>
    );
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
    <div className={`rounded border p-3 text-sm ${classes[tone]}`}>
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
  queue,
  research,
  researchState,
  state,
}: {
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  now: number;
  onResearch: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  queue: ReturnType<typeof researchQueueForDisplay>;
  research: (typeof researchCatalog)[number];
  researchState: ChainResearchState | null;
  state: PlayableState;
}) {
  const status = researchActionStatus({
    actionPending,
    actionPendingLabel,
    canTransact,
    chainCost: chainCostFor(researchState, research.id),
    error,
    key: research.key,
    loading,
    researchState,
    state,
  });
  const requirementStates = getResearchRequirementStates(state, research.key);
  const isSelectedResearchQueued = queue?.key === research.key;

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
            <p className="mt-1 text-sm text-slate-400">
              Level {status.currentLevel} to {status.targetLevel}
            </p>
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
        <InspectInfoRow
          label="Research time"
          value={
            status.durationSeconds
              ? formatDuration(status.durationSeconds)
              : status.hasMissingRequirement
                ? "Unavailable until prerequisites are met"
                : "Unavailable until chain state loads"
          }
        />
      </dl>

      <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className={`text-sm font-semibold ${status.disabled ? "text-slate-400" : "text-emerald-200"}`}>
          {status.reason}
        </p>
      </div>

      {queue && (
        <ActiveResearchQueueDetail
          isSelectedResearch={Boolean(isSelectedResearchQueued)}
          now={now}
          queue={queue}
        />
      )}

      <button
        aria-label={`Research ${research.label} to Level ${status.targetLevel}`}
        className="mt-3 h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        disabled={status.disabled}
        onClick={onResearch}
        type="button"
      >
        {status.actionLabel}
      </button>
    </InspectDetailShell>
  );
}

export function ActiveResearchQueueDetail({
  isSelectedResearch,
  now,
  queue,
}: {
  isSelectedResearch: boolean;
  now: number;
  queue: NonNullable<ReturnType<typeof researchQueueForDisplay>>;
}) {
  return SingleItemQueueProgress({
    isPrimaryItem: isSelectedResearch,
    label: `${queue.label} Level ${queue.targetLevel} is researching.`,
    now,
    queue,
    title: {
      active: "Research in progress",
      context: "Active research",
    },
  });
}

function researchActionStatus({
  actionPending,
  actionPendingLabel,
  canTransact,
  chainCost,
  error,
  key,
  loading,
  researchState,
  state,
}: {
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  canTransact: boolean;
  chainCost: Resources | undefined;
  error: string | undefined;
  key: ResearchKey;
  loading: boolean;
  researchState: ChainResearchState | null;
  state: PlayableState;
}) {
  const cost = chainCost;
  const currentLevel = state.research[key];
  const targetLevel = currentLevel + 1;
  const missingRequirement = unmetResearchRequirement(state, key);
  const resourcesAvailable = Boolean(researchState?.resources);
  const affordable = cost ? canAfford(state.resources, cost) : false;
  const active = state.researchQueue?.key === key;
  const queueOccupied = Boolean(state.researchQueue) && !active;
  const labMissing = state.buildings.researchLab === 0;
  const durationSeconds = !labMissing && cost
    ? researchDurationEstimate(state.buildings, cost, {
        networkLevel: state.research.intergalacticResearchNetwork,
        requiredLabLevel: researchLabRequirementFor(key),
        researchNetworkLabLevels: researchState?.researchNetworkLabLevels,
      })
    : undefined;

  const reason = actionPending
    ? actionPendingLabel ?? "Awaiting wallet"
    : loading
      ? "Reading on-chain research state"
      : error
        ? "Research state unavailable"
        : !researchState
          ? "Reading on-chain research state"
          : researchState.researchAvailable === false
          ? researchState.unavailableReason ?? "Research unavailable on this contract"
          : !researchState.homePlanetId
            ? "No VeydriftGame home planet"
            : !canTransact
              ? "Wallet or game contract unavailable"
              : active
                ? `Research to Level ${state.researchQueue?.targetLevel ?? targetLevel} in progress`
                : queueOccupied
                  ? `Research queue occupied by ${state.researchQueue?.label ?? "another technology"}`
                  : missingRequirement
                    ? "Locked by unmet prerequisites"
                    : !resourcesAvailable
                      ? "Resources unavailable"
                      : !affordable
                        ? "Insufficient resources"
                        : `Ready for Level ${targetLevel}`;

  const disabled = reason !== `Ready for Level ${targetLevel}`;
  const badge = active ? "In progress" : disabled ? "Locked" : "Available";

  return {
    actionLabel: actionPending ? actionPendingLabel ?? "Awaiting wallet" : active ? "In progress" : `Research Level ${targetLevel}`,
    badge,
    cost,
    currentLevel,
    disabled,
    durationSeconds,
    hasMissingRequirement: Boolean(missingRequirement),
    reason,
    targetLevel,
    tileStatus: active ? "Active" : disabled ? "Locked" : "Ready",
  };
}

function researchViewState(
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
    resources: toResources(researchState.resources) ?? { metal: 0, crystal: 0, deuterium: 0 },
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
        : undefined,
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

function formatReady(readyAt: number): string {
  const remaining = formatDurationUntil(readyAt);
  const timestamp = formatUserTimestamp(readyAt);
  return remaining === "Ready" ? `now (${timestamp})` : `in ${remaining} (${timestamp})`;
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
