import { ChevronLeft, ChevronRight, Clipboard, ExternalLink, List } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { shipAssetByKey } from "../gameAssets";
import { buildInspectHash } from "../inspectRoutes";
import type { ShipKey } from "../playableMvp";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import {
  type BattleReport,
  type FleetMissionArchiveEntry,
  type FleetMissionArchiveResponse,
  type FleetMissionPlanetReference,
  type FleetMissionSummary,
  type FleetMissionVisibilityResponse,
  type ManagedPlanetResponse,
  decodeColonizationTargetId,
} from "../walletFlow";
import { PageHeader, RefreshButton, refreshButtonState } from "./PageHeader";
import { VeydriftLoader } from "./VeydriftLoader";

type MissionControlActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionLifecycleActionKind = "completeReturn" | "counterplay" | "joinAttack" | "recall" | "resolve";

export type MissionLifecycleAction = {
  kind: MissionLifecycleActionKind;
  label: string;
  enabled: boolean;
  reason?: string | undefined;
};

export function missionControlRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

interface MissionControlPageProps {
  actionState: MissionControlActionState;
  canTransact: boolean;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  loading: boolean;
  missionArchive?: FleetMissionArchiveResponse | undefined;
  missionArchiveError?: string | undefined;
  missionArchiveLoading?: boolean | undefined;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onJoinAttack: (missionId: string, targetPlanetId: string) => void;
  onOpenReport: (missionId: string) => void;
  onOpenReportList: () => void;
  onMissionArchivePageChange?: ((page: number) => void) | undefined;
  onRecall: (missionId: string) => void;
  onRefresh: () => void;
  onResolve: (missionId: string) => void;
  reportMissionId?: string | undefined;
  reportUrlForMission?: ((missionId: string) => string) | undefined;
  walletPlanets?: ManagedPlanetResponse[] | undefined;
}

export function MissionControlPage({
  actionState,
  canTransact,
  fleetVisibility,
  loading,
  missionArchive,
  missionArchiveError,
  missionArchiveLoading = false,
  now,
  onCompleteReturn,
  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onOpenReportList,
  onMissionArchivePageChange,
  onRecall,
  onRefresh,
  onResolve,
  reportMissionId,
  reportUrlForMission,
  walletPlanets = [],
}: MissionControlPageProps) {
  const incoming = fleetVisibility?.incoming ?? [];
  const outgoing = fleetVisibility?.outgoing ?? [];
  const returning = fleetVisibility?.returning ?? [];
  const joinableAttacks = fleetVisibility?.joinableAttacks ?? [];
  const completedMissions = fleetVisibility?.completedMissions ?? [];
  const battleReports = fleetVisibility?.battleReports ?? [];
  const activeMissionRows = chronologicalActiveMissionRows({ incoming, joinableAttacks, outgoing, returning });
  const { alliance: allianceMissionRows, mine: myMissionRows } = partitionActiveMissionRows(activeMissionRows);
  // "Due"/"Needs orders now" must count only the player's own actionable missions. Alliance joinable
  // attacks are opt-in and never an obligation for the player, so they are excluded here.
  const due = myMissionRows.filter(({ mission }) => isMissionDue(mission, now) || isMissionReturned(mission, now));
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...joinableAttacks, ...completedMissions]);
  const fallbackPastMissionRows = chronologicalPastMissionRows(completedMissions, battleReports);
  const rawPastMissionRows = missionArchive?.rows ?? fallbackPastMissionRows;
  const pastMissionRows = dedupePastMissionRows(rawPastMissionRows);
  // Past missions render from the paginated archive, which can contain missions absent from the live
  // fleet-visibility feed (older pages, returned missions no longer "active"). The backend already
  // resolves each row's origin/target planet, so seed the lookup from those references too — otherwise
  // their coordinates render as "External coordinates unavailable" even though the data is available.
  const pastArchiveMissions = missionsFromArchiveRows(rawPastMissionRows);
  const lookupMissions = uniqueMissions([...allMissions, ...pastArchiveMissions]);
  const selectedReport = reportMissionId ? lookupMissions.find((mission) => mission.missionId === reportMissionId) : undefined;
  const planetLookup = planetLookupFromMissionData(lookupMissions, walletPlanets);
  const walletAddress = fleetVisibility?.wallet ?? missionArchive?.wallet;
  const walletPlanetIds = walletPlanetIdSet(walletPlanets, planetLookup, walletAddress);
  const activeCount = activeMissionRows.length;
  const initialLoading = loading && !fleetVisibility;

  return (
    <section className="grid gap-4">
      <PageHeader
        actions={<RefreshButton loading={loading || missionArchiveLoading} onRefresh={onRefresh} title="Refresh missions" />}
        subtitle="Watch inbound attacks, active launches, returning fleets, and time-critical battle actions from one command table."
        title="Mission Control"
      />

      {actionState.status !== "idle" && (
        <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
          {actionState.label}
        </Notice>
      )}
      {initialLoading ? (
        <VeydriftLoader label="Mapping missions" />
      ) : (
        <>
          {reportMissionId ? (
            <MissionReportDetail
              mission={selectedReport}
              now={now}
              onBack={onOpenReportList}
              planetLookup={planetLookup}
              reportUrl={selectedReport ? reportUrlForMission?.(selectedReport.missionId) : undefined}
            />
          ) : null}

          {activeCount === 0 ? (
            <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
              No active missions for this wallet. Use Galaxy to launch attacks, transport resources, deploy fleets, or harvest debris.
            </div>
          ) : null}
          <ActiveMissionSection
            allianceRows={allianceMissionRows}
            canTransact={canTransact}
            dueCount={due.length}
            myRows={myMissionRows}
            now={now}
            onCompleteReturn={onCompleteReturn}
            onCounterplay={onCounterplay}
            onJoinAttack={onJoinAttack}
            onOpenReport={onOpenReport}
            onRecall={onRecall}
            onResolve={onResolve}
            planetLookup={planetLookup}
            wallet={walletAddress}
            walletPlanetIds={walletPlanetIds}
          />

          <PastMissionSection
            error={missionArchiveError}
            loading={missionArchiveLoading}
            now={now}
            onOpenReport={onOpenReport}
            onPageChange={onMissionArchivePageChange}
            pagination={missionArchive?.pagination}
            planetLookup={planetLookup}
            rows={pastMissionRows}
            wallet={walletAddress}
            walletPlanetIds={walletPlanetIds}
          />
        </>
      )}
    </section>
  );
}

export function missionLifecycleActions({
  canTransact,
  context,
  mission,
  now,
}: {
  canTransact: boolean;
  context: ActiveMissionContext;
  mission: FleetMissionSummary;
  now: number;
}): MissionLifecycleAction[] {
  const actions: MissionLifecycleAction[] = [];
  const due = isMissionDue(mission, now);
  const returned = isMissionReturned(mission, now);

  if (mission.status === "Outbound") {
    actions.push({
      enabled: canTransact && due,
      kind: "resolve",
      label: "Resolve",
      reason: due ? walletReason(canTransact) : "Mission has not arrived yet.",
    });
  }

  if (context === "outgoing" && mission.status === "Outbound") {
    actions.push({
      enabled: canTransact && !due,
      kind: "recall",
      label: "Recall fleet",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact),
    });
  }

  if (context === "returning" && (mission.status === "Returning" || mission.status === "Recalled")) {
    actions.push({
      enabled: canTransact && returned,
      kind: "completeReturn",
      label: "Land fleet",
      reason: returned ? walletReason(canTransact) : "Fleet has not reached its origin yet.",
    });
  }

  if (context === "incoming" && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: canTransact && !due,
      kind: "counterplay",
      label: "Counterplay",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact),
    });
  }

  if (context === "joinable" && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: canTransact && !due,
      kind: "joinAttack",
      label: "Join attack",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact),
    });
  }

  return actions;
}

type ActiveMissionContext = "due" | "incoming" | "joinable" | "outgoing" | "returning";

export type ActiveMissionRow = {
  context: ActiveMissionContext;
  direction: string;
  mission: FleetMissionSummary;
};

type PastMissionRow = FleetMissionArchiveEntry;

const ACTIVE_MISSION_TABS = [
  { emptyLabel: "No active missions.", key: "mine", label: "My missions" },
  { emptyLabel: "No joinable alliance attacks.", key: "alliance", label: "Alliance" },
] as const;

type ActiveMissionTabKey = (typeof ACTIVE_MISSION_TABS)[number]["key"];

const ACTIVE_MISSION_DEFAULT_TAB: ActiveMissionTabKey = "mine";

function ActiveMissionSection({
  allianceRows,
  canTransact,
  dueCount,
  myRows,
  now,
  onCompleteReturn,
  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
  wallet,
  walletPlanetIds,
}: {
  allianceRows: ActiveMissionRow[];
  canTransact: boolean;
  dueCount: number;
  myRows: ActiveMissionRow[];
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onJoinAttack: (missionId: string, targetPlanetId: string) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const rowsByTab: Record<ActiveMissionTabKey, ActiveMissionRow[]> = { alliance: allianceRows, mine: myRows };
  const sharedRowProps = {
    canTransact,
    now,
    onCompleteReturn,
    onCounterplay,
    onJoinAttack,
    onOpenReport,
    onRecall,
    onResolve,
    planetLookup,
    wallet,
    walletPlanetIds,
  };
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]" data-active-tab={ACTIVE_MISSION_DEFAULT_TAB}>
      <div className="flex flex-col gap-2 border-b border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div aria-label="Active missions" className="flex flex-wrap gap-1.5" role="tablist">
          {ACTIVE_MISSION_TABS.map((tab) => (
            <button
              aria-selected={tab.key === ACTIVE_MISSION_DEFAULT_TAB}
              className="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100"
              data-active-tab-button={tab.key}
              key={tab.key}
              onClick={(event) => showActiveMissionTab(event, tab.key)}
              role="tab"
              type="button"
            >
              {`${tab.label} (${rowsByTab[tab.key].length})`}
            </button>
          ))}
        </div>
        {dueCount > 0 ? (
          <span className="self-start rounded border border-red-300/25 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-100 sm:self-auto">
            Needs orders now {dueCount}
          </span>
        ) : null}
      </div>
      {ACTIVE_MISSION_TABS.map((tab) => (
        <div data-active-tab-panel={tab.key} hidden={tab.key !== ACTIVE_MISSION_DEFAULT_TAB} key={tab.key} role="tabpanel">
          <ActiveMissionTable emptyLabel={tab.emptyLabel} rows={rowsByTab[tab.key]} {...sharedRowProps} />
        </div>
      ))}
    </section>
  );
}

function ActiveMissionTable({
  canTransact,
  emptyLabel,
  now,
  onCompleteReturn,
  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
  rows,
  wallet,
  walletPlanetIds,
}: {
  canTransact: boolean;
  emptyLabel: string;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onJoinAttack: (missionId: string, targetPlanetId: string) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  rows: ActiveMissionRow[];
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-xs text-slate-500">{emptyLabel}</p>;
  }

  const pageSize = 25;
  const pages = paginatedRows(rows, pageSize);
  const pagination = paginationForRows(rows, pageSize);

  return (
    <div
      data-past-page-current="0"
      data-past-page-size={String(pageSize)}
      data-past-page-total={String(pagination.totalEntries)}
    >
      <div className="overflow-x-auto">
        <table className="min-w-[52rem] w-full table-fixed border-separate border-spacing-0 text-left text-xs">
          <thead className="bg-white/[0.03] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="w-[9rem] px-3 py-2">Mission</th>
              <th className="w-[26rem] px-3 py-2">Route</th>
              <th className="w-[10rem] px-3 py-2">Fleet</th>
              <th className="w-[13rem] px-3 py-2">Orders</th>
            </tr>
          </thead>
          {pages.map((pageRows, pageIndex) => (
            <tbody data-past-page={pageIndex} hidden={pageIndex !== 0} key={`active-mission-page:${pageIndex}`}>
              {pageRows.map(({ context, direction, mission }) => (
                <MissionRow
                  canTransact={canTransact}
                  context={context}
                  direction={direction}
                  handlers={{ onCompleteReturn, onCounterplay, onJoinAttack, onOpenReport, onRecall, onResolve }}
                  key={`${context}:${mission.missionId}`}
                  mission={mission}
                  now={now}
                  planetLookup={planetLookup}
                  variant="active"
                  wallet={wallet}
                  walletPlanetIds={walletPlanetIds}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {pagination.totalPages > 1 ? <ClientPaginationControl className="px-3 pb-3" pagination={pagination} /> : null}
    </div>
  );
}

type MissionRowActionHandlers = {
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onJoinAttack: (missionId: string, targetPlanetId: string) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
};

// The one shared mission-row component (VEY-399). Renders My missions, Alliance, and Past missions
// with identical Mission | Route | Fleet | Orders columns. `variant` toggles the active lifecycle
// orders + per-side timing against the past completion subtext; everything else is shared.
function MissionRow({
  canTransact = false,
  context,
  direction,
  handlers,
  mission,
  now,
  planetLookup,
  variant,
  wallet,
  walletPlanetIds,
}: {
  canTransact?: boolean | undefined;
  context?: ActiveMissionContext | undefined;
  direction?: string | undefined;
  handlers: MissionRowActionHandlers;
  mission: FleetMissionSummary;
  now: number;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  variant: "active" | "past";
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const isPast = variant === "past";
  // VEY-397#11 + VEY-399#6: hide the Resolve and Join buttons while they are not actionable.
  const actions = isPast || context === undefined
    ? []
    : missionLifecycleActions({ canTransact, context, mission, now })
      .filter((action) => (action.kind !== "resolve" && action.kind !== "joinAttack") || action.enabled);
  const missionDirection = resolveMissionDirection({ context, mission, wallet, walletPlanetIds });
  // The connected wallet is always "me", so drop a commander subtext that just repeats the player's
  // own address — uniformly across active and past rows (VEY-372 carried into the shared row).
  const origin = withoutSelfCommander(missionEndpoint(mission, "origin", planetLookup), wallet);
  const target = withoutSelfCommander(missionEndpoint(mission, "target", planetLookup), wallet);
  const noFleetReturned = isNoFleetReturned(mission);

  const originTiming = isPast ? null : { label: "Return", value: noFleetReturned ? "No fleet returned" : compactMissionTime(mission.returnAt) };
  const targetTiming = isPast ? null : { label: "Arrival", value: compactMissionTime(mission.arrivalAt) };
  // VEY-399#9: past rows show "Returned · <time>" as a route subtext, not in the Mission column.
  const completedAt = isPast ? missionCompletionTimestamp(mission) : undefined;
  const routeSubtext = isPast
    ? `${missionStatusLabel(mission.status)}${completedAt === undefined ? "" : ` · ${formatUserTimestamp(completedAt)}`}`
    : null;
  const subtitle = isPast || !direction || direction === "Joinable attack" ? null : direction;

  return (
    <tr className="align-top text-slate-300 odd:bg-black/10 even:bg-white/[0.015]">
      <MissionCell
        groupId={mission.attackGroupId}
        missionId={mission.missionId}
        subtitle={subtitle}
        typeLabel={directionalMissionTypeLabel(mission.missionType, missionDirection)}
        typeTone={missionTypeTone(mission.missionType)}
      />
      <RouteCell
        origin={origin}
        originTiming={originTiming}
        progressPercent={missionProgressPercent(mission, now)}
        subtext={routeSubtext}
        target={target}
        targetTiming={targetTiming}
      />
      <FleetCell cargoLabel={cargoLabel(mission.cargo)} ships={mission.ships} />
      <OrdersCell actions={actions} handlers={handlers} mission={mission} />
    </tr>
  );
}

function MissionCell({
  groupId,
  missionId,
  subtitle,
  typeLabel,
  typeTone,
}: {
  groupId: string | null;
  missionId: string;
  subtitle: string | null;
  typeLabel: string;
  typeTone: string;
}) {
  return (
    <td className="border-t border-white/10 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded border px-2 py-1 text-[11px] font-semibold ${typeTone}`}>{typeLabel}</span>
        <span className="font-semibold text-white">#{missionId}</span>
      </div>
      {subtitle ? <p className="mt-2 text-slate-500">{subtitle}</p> : null}
      {groupId ? <p className="mt-1 text-cyan-100/70">Group {groupId}</p> : null}
    </td>
  );
}

type EndpointTiming = { label: string; value: string };

// VEY-399#5: a two-row grid fixes the misaligned route cluster. Row one keeps the origin/target
// names and the directional progress bar on one vertically-centred baseline; row two hangs the
// commander + per-side timing cleanly beneath each side using the identical column template.
const ROUTE_GRID = "grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] gap-2";

function RouteCell({
  origin,
  originTiming,
  progressPercent,
  subtext,
  target,
  targetTiming,
}: {
  origin: MissionEndpoint;
  originTiming: EndpointTiming | null;
  progressPercent: number;
  subtext: string | null;
  target: MissionEndpoint;
  targetTiming: EndpointTiming | null;
}) {
  return (
    <td className="border-t border-white/10 px-3 py-3">
      <div className={`${ROUTE_GRID} items-center`}>
        <EndpointName endpoint={origin} />
        <div className="flex min-w-0 items-center gap-1" title="Origin to target">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-cyan-300" style={{ width: `${progressPercent}%` }} />
          </div>
          <span aria-hidden="true" className="text-[10px] leading-none text-slate-500">&rsaquo;</span>
        </div>
        <EndpointName endpoint={target} />
      </div>
      <div className={`mt-1 ${ROUTE_GRID}`}>
        <EndpointMeta endpoint={origin} timing={originTiming} />
        <span aria-hidden="true" />
        <EndpointMeta endpoint={target} timing={targetTiming} />
      </div>
      {subtext ? <p className="mt-1 text-[11px] text-slate-500">{subtext}</p> : null}
    </td>
  );
}

function FleetCell({ cargoLabel, ships }: { cargoLabel: string | null; ships: Record<string, string> }) {
  return (
    <td className="border-t border-white/10 px-3 py-3">
      <FleetIcons ships={ships} />
      {cargoLabel ? <p className="mt-1 text-[11px] text-slate-500">Cargo {cargoLabel}</p> : null}
    </td>
  );
}

function OrdersCell({
  actions,
  handlers,
  mission,
}: {
  actions: MissionLifecycleAction[];
  handlers: MissionRowActionHandlers;
  mission: FleetMissionSummary;
}) {
  return (
    <td className="border-t border-white/10 px-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => action.kind === "counterplay" ? (
          <span className="contents" key={action.kind}>
            <ActionButton
              action={{ ...action, label: "Group defend" }}
              onClick={() => handlers.onCounterplay(mission.missionId, "acsDefend")}
            />
            <ActionButton
              action={{ ...action, label: "Intercept" }}
              onClick={() => handlers.onCounterplay(mission.missionId, "intercept")}
            />
          </span>
        ) : action.kind === "joinAttack" ? (
          // VEY-397#13/#14: "Join" shares the Open button style/size.
          <button
            className={rowActionButtonClass}
            disabled={!action.enabled}
            key={action.kind}
            onClick={() => handlers.onJoinAttack(mission.missionId, mission.targetPlanetId)}
            title={action.enabled ? "Join this alliance attack" : action.reason}
            type="button"
          >
            Join
          </button>
        ) : (
          <ActionButton
            action={action}
            key={action.kind}
            onClick={() => {
              if (action.kind === "resolve") handlers.onResolve(mission.missionId);
              if (action.kind === "recall") handlers.onRecall(mission.missionId);
              if (action.kind === "completeReturn") handlers.onCompleteReturn(mission.missionId);
            }}
          />
        ))}
        <OpenButton onClick={() => handlers.onOpenReport(mission.missionId)} />
      </div>
    </td>
  );
}

// VEY-399#8: a single shared "Open" control/label used by active and past rows alike.
function OpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={rowActionButtonClass} onClick={onClick} title="Open the full mission detail screen" type="button">
      <ExternalLink aria-hidden="true" size={13} />
      Open
    </button>
  );
}

// Shared style for the "Open" and "Join" row actions (VEY-397#14).
const rowActionButtonClass = "inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500";

type MissionEndpoint = {
  commanderName: string | null;
  commanderWallet: string | null;
  coordinates: string | null;
  coords: { galaxy: number; position: number; system: number } | null;
  name: string;
};

// Resolves a mission endpoint to a clickable planet (name with coords fallback, coords on
// hover) and its commander, preferring the mission's own planet reference and falling back
// to the shared planet lookup or a colonization-target decode.
function missionEndpoint(
  mission: FleetMissionSummary,
  side: "origin" | "target",
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>,
): MissionEndpoint {
  const ref = side === "origin" ? mission.originPlanet : mission.targetPlanet;
  const planetId = side === "origin" ? mission.originPlanetId : mission.targetPlanetId;
  const identity = planetLookup.get(planetId);
  const colony = ref ? null : decodeColonizationTargetId(planetId);
  const coordinates = ref?.coordinates ?? identity?.coordinates ?? colony?.coordinates ?? null;
  const coords = ref
    ? { galaxy: ref.galaxy, position: ref.position, system: ref.system }
    : colony
      ? { galaxy: colony.galaxy, position: colony.position, system: colony.system }
      : parseCoordinateString(coordinates);
  const rawName = ref?.name?.trim() || identityName(identity);
  const commanderWallet = ref?.owner ?? identity?.owner ?? (side === "origin" ? mission.owner : null);
  const commanderDisplay = ref?.ownerDisplayName?.trim() || identity?.ownerDisplayName?.trim() || null;
  return {
    commanderName: commanderDisplay || (commanderWallet ? shortAddress(commanderWallet) : null),
    commanderWallet,
    coordinates,
    coords,
    name: rawName || (coordinates ? coordinates : colony ? "Uncharted" : `Planet #${planetId}`),
  };
}

// The shared planet identity stores "Planet [coords]" as its display fallback; strip that so
// the endpoint can show the coordinates themselves when there is no real planet name.
function identityName(identity: MissionPlanetIdentity | undefined): string | null {
  if (!identity) return null;
  return /^Planet \[/.test(identity.displayName) ? null : identity.displayName;
}

function parseCoordinateString(value: string | null): { galaxy: number; position: number; system: number } | null {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part <= 0)) return null;
  return { galaxy: parts[0]!, position: parts[2]!, system: parts[1]! };
}

// VEY-399#4: a compact absolute date/time (e.g. "Jun 8, 9:55 AM") replaces the relative countdown
// that degraded to the bare word "Ready" once a mission was due.
function compactMissionTime(value: string): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  return formatUserTimestamp(timestamp, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

function cargoLabel(cargo: FleetMissionSummary["cargo"]): string | null {
  const formatted = formatCargo(cargo);
  return formatted === "Empty" ? null : formatted;
}

function withoutSelfCommander(endpoint: MissionEndpoint, wallet: string | undefined): MissionEndpoint {
  if (!addressesMatch(endpoint.commanderWallet ?? undefined, wallet)) return endpoint;
  return { ...endpoint, commanderName: null, commanderWallet: null };
}

// VEY-399#2: the origin/target planet name links to Galaxy on every row (active and past).
function EndpointName({ endpoint }: { endpoint: MissionEndpoint }) {
  if (endpoint.coords) {
    return (
      <a
        className="min-w-0 truncate rounded font-medium text-cyan-100 underline-offset-2 transition hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50"
        href={buildInspectHash({ coords: endpoint.coords, kind: "planet" })}
        title={endpoint.coordinates ? `Open ${endpoint.coordinates} in Galaxy` : undefined}
      >
        {endpoint.name}
      </a>
    );
  }
  return <span className="min-w-0 truncate font-medium text-slate-100" title={endpoint.coordinates ?? undefined}>{endpoint.name}</span>;
}

function EndpointMeta({ endpoint, timing }: { endpoint: MissionEndpoint; timing: EndpointTiming | null }) {
  if (!endpoint.commanderName && !timing) return <span aria-hidden="true" />;
  return (
    <div className="min-w-0">
      {endpoint.commanderName ? (
        <p className="break-words text-slate-400">
          {endpoint.commanderWallet ? (
            <a
              className="rounded text-slate-300 underline-offset-2 transition hover:text-cyan-100 hover:underline focus-visible:underline focus-visible:outline-none"
              href={buildInspectHash({ kind: "player", wallet: endpoint.commanderWallet })}
              title={`Open ${endpoint.commanderName}'s profile`}
            >
              {endpoint.commanderName}
            </a>
          ) : (
            endpoint.commanderName
          )}
        </p>
      ) : null}
      {timing ? (
        <p className="mt-0.5 text-[11px] text-slate-500">
          <span className="font-semibold uppercase tracking-[0.1em] text-slate-600">{timing.label}</span> {timing.value}
        </p>
      ) : null}
    </div>
  );
}

// Compact fleet column: small ship images with xN counts; hover shows the ship name + count.
function FleetIcons({ ships }: { ships: Record<string, string> }) {
  const entries = Object.entries(ships).filter(([, count]) => Number(count) > 0);
  if (entries.length === 0) return <span className="text-slate-500">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, count]) => {
        const asset = shipAssetByKey[key as ShipKey];
        const name = shipLabel(key);
        const label = `${name} x${formatResource(count)}`;
        return (
          <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1 py-0.5" key={key} title={label}>
            {asset ? (
              <img alt="" className="h-5 w-5 shrink-0 rounded object-contain" loading="lazy" src={asset} />
            ) : (
              <span className="text-[10px] text-slate-300">{name}</span>
            )}
            <span className="text-[11px] font-medium tabular-nums text-slate-200">{`x${formatResource(count)}`}</span>
          </span>
        );
      })}
    </div>
  );
}

function ActionButton({ action, onClick }: { action: MissionLifecycleAction; onClick: () => void }) {
  return (
    <button
      className={`rounded border px-2 py-1 text-xs font-medium transition ${
        action.enabled
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
          : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
      }`}
      disabled={!action.enabled}
      onClick={onClick}
      title={action.enabled ? action.label : action.reason}
      type="button"
    >
      {action.label}
    </button>
  );
}

function MissionReportDetail({
  mission,
  now,
  onBack,
  planetLookup,
  reportUrl,
}: {
  mission: FleetMissionSummary | undefined;
  now: number;
  onBack: () => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  reportUrl?: string | undefined;
}) {
  if (!mission) {
    return (
      <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-3">
        <h3 className="text-sm font-semibold text-white">Battle report unavailable</h3>
        <p className="mt-1 text-xs leading-5 text-amber-100/80">
          This share link does not match a mission visible to the connected wallet right now.
        </p>
        <button
          className="mt-3 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-slate-200 transition hover:bg-white/10"
          onClick={onBack}
          type="button"
        >
          Back to reports
        </button>
      </section>
    );
  }

  const report = missionReport(mission, now, planetLookup);
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Shareable battle report</p>
          <h3 className="mt-1 text-base font-semibold text-white">{report.title}</h3>
          <p className="mt-1 text-xs text-cyan-100/80">{report.routeSummary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            onClick={onBack}
            type="button"
          >
            <List aria-hidden="true" size={13} />
            Reports
          </button>
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            onClick={() => copyText(reportUrl ?? missionReportText(mission, now, planetLookup))}
            type="button"
          >
            <Clipboard aria-hidden="true" size={13} />
            Copy link
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <ReportPanel title="Battle time">
          <ReportLine label="Arrival" value={report.battleTime} />
          <ReportLine label="Status" value={missionStatusLabel(mission.status)} />
          <ReportLine label="Outcome" value={report.outcome} />
        </ReportPanel>
        <ReportPanel title="Commanders">
          <ReportLine label="Attacker" value={report.attacker} />
          <ReportLine label="Defender" value={report.defender} />
          <ReportLine label="Group combat" value={report.acs} />
        </ReportPanel>
        <ReportPanel title="Coordinates">
          <ReportLine label="Origin" value={report.origin} />
          <ReportLine label="Target" value={report.target} />
          <ReportLine label="Return" value={formatMissionTime(mission.returnAt, now)} />
        </ReportPanel>
        <ReportPanel title="Fleets and cargo">
          <ReportLine label="Attacker fleet" value={formatShips(mission.ships)} />
          <ReportLine label="Cargo carried" value={formatCargo(mission.cargo)} />
          <ReportLine label="Fuel burned" value={`${formatResource(mission.fuelCost)} deuterium`} />
        </ReportPanel>
        <ReportPanel title="Losses and debris">
          <ReportLine label="Fleet losses" value={report.losses} />
          <ReportLine label="Defense losses" value={report.losses} />
          <ReportLine label="Debris field" value={report.debris} />
        </ReportPanel>
        <ReportPanel title="Public proof">
          <ReportLine label="Transaction" value={mission.transactionHash || "Pending chain proof"} />
          <ReportLine label="Block" value={mission.blockNumber || "Pending chain proof"} />
          <ReportLine label="Share link" value={reportUrl ?? "Available after navigation"} />
        </ReportPanel>
      </div>
    </section>
  );
}

function PastMissionSection({
  error,
  loading,
  now,
  onOpenReport,
  onPageChange,
  pagination,
  planetLookup,
  rows,
  wallet,
  walletPlanetIds,
}: {
  error?: string | undefined;
  loading: boolean;
  now: number;
  onOpenReport: (missionId: string) => void;
  onPageChange?: ((page: number) => void) | undefined;
  pagination?: FleetMissionArchiveResponse["pagination"] | undefined;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  rows: PastMissionRow[];
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const pageSize = 25;
  const pages = paginatedRows(rows, pageSize);
  const currentPagination = pagination ?? paginationForRows(rows, pageSize);
  const hasPages = currentPagination.totalPages > 1;
  const visiblePages = pagination ? [rows] : pages;

  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]"
      data-past-page-current={String(currentPagination.page - 1)}
      data-past-page-size={String(currentPagination.pageSize)}
      data-past-page-total={String(currentPagination.totalEntries)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Past missions</h3>
        {currentPagination.totalEntries > 0 ? (
          <span className="text-[11px] tabular-nums text-slate-500">{currentPagination.totalEntries}</span>
        ) : null}
      </div>
      {error ? <div className="px-3 pt-3"><Notice tone="danger">{error}</Notice></div> : null}
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">No completed missions are visible for this wallet yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[52rem] w-full table-fixed border-separate border-spacing-0 text-left text-xs">
              <thead className="bg-white/[0.03] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="w-[9rem] px-3 py-2">Mission</th>
                  <th className="w-[26rem] px-3 py-2">Route</th>
                  <th className="w-[10rem] px-3 py-2">Fleet</th>
                  <th className="w-[13rem] px-3 py-2">Orders</th>
                </tr>
              </thead>
              {visiblePages.map((pageRows, pageIndex) => (
                <tbody
                  data-past-page={pageIndex}
                  hidden={!pagination && pageIndex !== 0}
                  key={`past-mission-page:${pageIndex}`}
                >
                  {pageRows.map((row) => row.kind === "mission" ? (
                    <MissionRow
                      handlers={pastRowHandlers(onOpenReport)}
                      key={`past-mission:${row.mission.missionId}`}
                      mission={row.mission}
                      now={now}
                      planetLookup={planetLookup}
                      variant="past"
                      wallet={wallet}
                      walletPlanetIds={walletPlanetIds}
                    />
                  ) : (
                    <PastBattleReportRow
                      key={`past-report:${row.report.missionId}`}
                      onOpenReport={onOpenReport}
                      report={row.report}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          {hasPages ? (
            <ClientPaginationControl
              loading={loading}
              nextLabel="Next mission archive page"
              onPageChange={onPageChange}
              pagination={currentPagination}
              prevLabel="Previous mission archive page"
            />
          ) : null}
        </>
      )}
    </section>
  );
}

// Past rows have no lifecycle orders; only "Open" is ever invoked, so the other handlers are no-ops.
function pastRowHandlers(onOpenReport: (missionId: string) => void): MissionRowActionHandlers {
  return {
    onCompleteReturn: () => undefined,
    onCounterplay: () => undefined,
    onJoinAttack: () => undefined,
    onOpenReport,
    onRecall: () => undefined,
    onResolve: () => undefined,
  };
}

// Standalone battle reports (no matching completed mission) reuse the shared Mission cell + Open
// control so the past table stays visually consistent across both row kinds.
function PastBattleReportRow({
  onOpenReport,
  report,
}: {
  onOpenReport: (missionId: string) => void;
  report: BattleReport;
}) {
  return (
    <tr className="align-top text-slate-300 odd:bg-black/10 even:bg-white/[0.015]">
      <MissionCell
        groupId={null}
        missionId={report.missionId}
        subtitle={battleOutcomeLabel(report.outcome)}
        typeLabel="Battle report"
        typeTone="border-red-300/25 bg-red-400/10 text-red-100"
      />
      <td className="border-t border-white/10 px-3 py-3 break-words">
        <p className="font-medium text-slate-100">
          Attacker {shortHash(report.attacker)} {"->"} Planet #{report.targetPlanetId}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">Block {report.blockNumber || "unknown"} · Rounds {report.rounds}</p>
      </td>
      <td className="border-t border-white/10 px-3 py-3 break-words">
        <p className="text-slate-100">Loot {formatCargo(report.loot)}</p>
        <p className="mt-1 text-[11px] text-slate-500">Losses {formatCargo(report.attackerLosses)} / {formatCargo(report.defenderLosses)}</p>
      </td>
      <td className="border-t border-white/10 px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <OpenButton onClick={() => onOpenReport(report.missionId)} />
        </div>
      </td>
    </tr>
  );
}

function paginationForRows<T>(rows: T[], pageSize: number): FleetMissionArchiveResponse["pagination"] {
  const totalEntries = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  return {
    page: 1,
    pageSize,
    totalEntries,
    totalPages,
    hasPreviousPage: false,
    hasNextPage: totalPages > 1,
  };
}

function paginatedRows<T>(rows: T[], pageSize: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += pageSize) {
    pages.push(rows.slice(index, index + pageSize));
  }
  return pages;
}

function showPastMissionPage(event: Event, target: number | "next" | "previous") {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) return;

  const section = button.closest<HTMLElement>("[data-past-page-current]");
  if (!section) return;

  const pages = Array.from(section.querySelectorAll<HTMLElement>("[data-past-page]"));
  if (pages.length === 0) return;

  const current = Number(section.dataset.pastPageCurrent ?? "0");
  const nextPage = target === "next"
    ? current + 1
    : target === "previous"
      ? current - 1
      : target;
  const clamped = Math.max(0, Math.min(pages.length - 1, nextPage));
  section.dataset.pastPageCurrent = clamped.toString();

  pages.forEach((page, pageIndex) => {
    page.hidden = pageIndex !== clamped;
  });

  const label = section.querySelector<HTMLElement>("[data-past-page-label]");
  if (label) label.textContent = `Page ${clamped + 1} of ${pages.length}`;

  const pageSize = Number(section.dataset.pastPageSize ?? "25");
  const totalEntries = Number(section.dataset.pastPageTotal ?? "0");
  const firstEntry = totalEntries === 0 ? 0 : clamped * pageSize + 1;
  const lastEntry = Math.min((clamped + 1) * pageSize, totalEntries);
  const range = section.querySelector<HTMLElement>("[data-past-page-range]");
  if (range) range.textContent = `${firstEntry}-${lastEntry} of ${totalEntries}`;

  const previous = section.querySelector<HTMLButtonElement>("[data-past-page-prev]");
  if (previous) previous.disabled = clamped === 0;

  const next = section.querySelector<HTMLButtonElement>("[data-past-page-next]");
  if (next) next.disabled = clamped === pages.length - 1;

}

export function partitionActiveMissionRows(rows: ActiveMissionRow[]): { alliance: ActiveMissionRow[]; mine: ActiveMissionRow[] } {
  // "Alliance" holds joinable alliance attacks; "My missions" holds the player's own outbound,
  // incoming hostile, and returning fleets. Rows are already deduped + chronologically sorted upstream.
  const alliance: ActiveMissionRow[] = [];
  const mine: ActiveMissionRow[] = [];
  for (const row of rows) {
    if (row.context === "joinable") alliance.push(row);
    else mine.push(row);
  }
  return { alliance, mine };
}

function showActiveMissionTab(event: Event, key: string) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) return;

  const section = button.closest<HTMLElement>("[data-active-tab]");
  if (!section) return;
  section.dataset.activeTab = key;

  section.querySelectorAll<HTMLElement>("[data-active-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.activeTabPanel !== key;
  });
  section.querySelectorAll<HTMLElement>("[data-active-tab-button]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.activeTabButton === key));
  });
}

// Shared prev/next pagination control. With `onPageChange` it drives server-side pagination
// (mission archive); without it, it toggles client-rendered pages via `showPastMissionPage`
// (the active-mission tabs reuse this exact pattern, 25 rows per page).
function ClientPaginationControl({
  className = "",
  loading = false,
  nextLabel = "Next page",
  onPageChange,
  pagination,
  prevLabel = "Previous page",
}: {
  className?: string | undefined;
  loading?: boolean | undefined;
  nextLabel?: string | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  pagination: FleetMissionArchiveResponse["pagination"];
  prevLabel?: string | undefined;
}) {
  const firstEntry = pagination.totalEntries === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastEntry = Math.min(pagination.page * pagination.pageSize, pagination.totalEntries);
  return (
    <div className={`mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <span>
        <span data-past-page-label>Page {pagination.page} of {pagination.totalPages}</span>
        <span className="ml-2 text-slate-600" data-past-page-range>{`${firstEntry}-${lastEntry} of ${pagination.totalEntries}`}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          aria-label={prevLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          data-past-page-prev
          disabled={loading || !pagination.hasPreviousPage}
          onClick={(event) => onPageChange ? onPageChange(pagination.page - 1) : showPastMissionPage(event, "previous")}
          title="Previous page"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={nextLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          data-past-page-next
          disabled={loading || !pagination.hasNextPage}
          onClick={(event) => onPageChange ? onPageChange(pagination.page + 1) : showPastMissionPage(event, "next")}
          title="Next page"
          type="button"
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      </div>
    </div>
  );
}

function ReportPanel({ children, title }: { children: preact.ComponentChildren; title: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <dl className="mt-3 grid gap-2 text-xs">{children}</dl>
    </div>
  );
}

function ReportLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/50">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-cyan-50/90">{value}</dd>
    </div>
  );
}

export function formatMissionTime(value: string, now: number): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  return `${formatDurationUntil(timestamp, now)}\n${formatUserTimestamp(timestamp)}`;
}

function Notice({ children, tone }: { children: preact.ComponentChildren; tone: "danger" | "info" | "success" }) {
  const className = tone === "danger"
    ? "border-red-300/25 bg-red-400/10 text-red-100"
    : tone === "success"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
      : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  return <div className={`rounded-lg border p-3 text-sm ${className}`}>{children}</div>;
}

function isMissionDue(mission: FleetMissionSummary, now: number): boolean {
  return mission.status === "Outbound" && Number(mission.arrivalAt) * 1_000 <= now;
}

function isMissionReturned(mission: FleetMissionSummary, now: number): boolean {
  return Number(mission.returnAt) * 1_000 <= now;
}

function isNoFleetReturned(mission: FleetMissionSummary): boolean {
  return !["Outbound", "Returning", "Recalled"].includes(mission.status)
    && Object.values(mission.ships).every((value) => Number(value) <= 0);
}

function chronologicalActiveMissionRows({
  incoming,
  joinableAttacks,
  outgoing,
  returning,
}: {
  incoming: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
}): ActiveMissionRow[] {
  const rows: ActiveMissionRow[] = [
    ...incoming.map((mission): ActiveMissionRow => ({ context: "incoming", direction: "Hostile inbound", mission })),
    ...outgoing.map((mission): ActiveMissionRow => ({ context: "outgoing", direction: "Outbound", mission })),
    ...returning.map((mission): ActiveMissionRow => ({ context: "returning", direction: "Returning", mission })),
    ...joinableAttacks.map((mission): ActiveMissionRow => ({ context: "joinable", direction: "Joinable attack", mission })),
  ];
  return uniqueMissionRows(rows).sort((left, right) => {
    const leftTime = nextMissionEventTimestamp(left.mission) ?? Number.MAX_SAFE_INTEGER;
    const rightTime = nextMissionEventTimestamp(right.mission) ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left.mission.missionId) - Number(right.mission.missionId);
  });
}

function chronologicalPastMissionRows(completedMissions: FleetMissionSummary[], battleReports: BattleReport[]): PastMissionRow[] {
  return [
    ...completedMissions.map((mission): PastMissionRow => ({ kind: "mission", mission })),
    ...battleReports.map((report): PastMissionRow => ({ kind: "battleReport", report })),
  ].sort((left, right) => pastRowTimestamp(right) - pastRowTimestamp(left));
}

function pastRowMissionId(row: PastMissionRow): string {
  return row.kind === "battleReport" ? row.report.missionId : row.mission.missionId;
}

function dedupePastMissionRows(rows: PastMissionRow[]): PastMissionRow[] {
  const missionSummaryIds = new Set(
    rows.filter((row) => row.kind === "mission").map((row) => pastRowMissionId(row))
  );
  const seen = new Set<string>();
  return rows.filter((row) => {
    const missionId = pastRowMissionId(row);
    // Collapse a battle report into its mission summary row when both exist, so each mission
    // appears once with links to both the mission detail and its battle report.
    if (row.kind === "battleReport" && missionSummaryIds.has(missionId)) return false;
    // Drop exact duplicate rows that slip in from re-renders, polling, or overlapping updates.
    const key = `${row.kind}:${missionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueMissionRows(rows: ActiveMissionRow[]): ActiveMissionRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.mission.missionId)) return false;
    seen.add(row.mission.missionId);
    return true;
  });
}

function nextMissionEventTimestamp(mission: FleetMissionSummary): number | undefined {
  if (mission.status === "Returning" || mission.status === "Recalled" || mission.status === "Returned") {
    return timestampToMs(mission.returnAt);
  }
  return timestampToMs(mission.arrivalAt);
}

function missionCompletionTimestamp(mission: FleetMissionSummary): number | undefined {
  if (mission.status === "Returned") return timestampToMs(mission.returnAt);
  return timestampToMs(mission.arrivalAt);
}

function pastRowTimestamp(row: PastMissionRow): number {
  if (row.kind === "battleReport") return Number(row.report.blockNumber || "0");
  const completedAt = missionCompletionTimestamp(row.mission);
  if (completedAt !== undefined) return completedAt;
  return Number(row.mission.blockNumber || "0");
}

function missionProgressPercent(mission: FleetMissionSummary, now: number): number {
  const arrivalAt = timestampToMs(mission.arrivalAt);
  const returnAt = timestampToMs(mission.returnAt);
  if (arrivalAt === undefined || returnAt === undefined) return 0;

  const returning = mission.status === "Returning" || mission.status === "Recalled" || mission.status === "Returned";
  const duration = Math.abs(returnAt - arrivalAt);
  const start = returning ? arrivalAt : arrivalAt - duration;
  const end = returning ? returnAt : arrivalAt;
  if (end <= start) return 100;

  return clamp(((now - start) / (end - start)) * 100, 0, 100);
}

function missionTypeTone(missionType: string): string {
  if (["Attack", "AcsAttack", "MissileAttack"].includes(missionType)) {
    return "border-red-300/25 bg-red-400/10 text-red-100";
  }
  if (missionType === "Transport") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (missionType === "Deploy") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (missionType === "Harvest") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (["AcsDefend", "Intercept"].includes(missionType)) return "border-violet-300/25 bg-violet-300/10 text-violet-100";
  return "border-slate-300/20 bg-slate-300/10 text-slate-100";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function walletReason(canTransact: boolean): string | undefined {
  return canTransact ? undefined : "Wallet or mission actions unavailable.";
}

function formatCargo(cargo: FleetMissionSummary["cargo"]): string {
  const metal = Number(cargo.metal);
  const crystal = Number(cargo.crystal);
  const deuterium = Number(cargo.deuterium);
  if (metal + crystal + deuterium === 0) return "Empty";
  return `${formatResource(cargo.metal)} M / ${formatResource(cargo.crystal)} C / ${formatResource(cargo.deuterium)} D`;
}

function formatShips(ships: Record<string, string>): string {
  const active = Object.entries(ships)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${shipLabel(key)} x${formatResource(value)}`);
  return active.length > 0 ? active.slice(0, 3).join(", ") : "None";
}

function missionStatusLabel(status: string): string {
  if (status === "Outbound") return "en route";
  if (status === "Returning") return "returning";
  if (status === "Recalled") return "recalled";
  return status;
}

type MissionPlanetIdentity = {
  coordinates: string;
  displayName: string;
  owner: string;
  ownerDisplayName: string | null;
};

function uniqueMissions(missions: FleetMissionSummary[]): FleetMissionSummary[] {
  const seen = new Set<string>();
  return missions.filter((mission) => {
    if (seen.has(mission.missionId)) return false;
    seen.add(mission.missionId);
    return true;
  });
}

function missionsFromArchiveRows(rows: readonly FleetMissionArchiveEntry[]): FleetMissionSummary[] {
  return rows.flatMap((row) => (row.kind === "mission" ? [row.mission] : []));
}

function planetLookupFromMissionData(
  missions: FleetMissionSummary[],
  walletPlanets: ManagedPlanetResponse[]
): Map<string, MissionPlanetIdentity> {
  const lookup = new Map<string, MissionPlanetIdentity>();
  for (const planet of walletPlanets) {
    lookup.set(planet.planetId, identityFromManagedPlanet(planet));
  }
  for (const mission of missions) {
    if (mission.originPlanet) lookup.set(mission.originPlanet.planetId, identityFromMissionPlanet(mission.originPlanet));
    if (mission.targetPlanet) lookup.set(mission.targetPlanet.planetId, identityFromMissionPlanet(mission.targetPlanet));
  }
  return lookup;
}

function identityFromManagedPlanet(planet: ManagedPlanetResponse): MissionPlanetIdentity {
  return {
    coordinates: planet.coordinates,
    displayName: planet.name?.trim() || `Planet [${planet.coordinates}]`,
    owner: planet.owner,
    ownerDisplayName: null,
  };
}

function identityFromMissionPlanet(planet: FleetMissionPlanetReference): MissionPlanetIdentity {
  return {
    coordinates: planet.coordinates,
    displayName: planet.name?.trim() || `Planet [${planet.coordinates}]`,
    owner: planet.owner,
    ownerDisplayName: planet.ownerDisplayName ?? null,
  };
}

function missionTypeLabel(missionType: string): string {
  if (missionType === "AcsAttack") return "Group attack";
  if (missionType === "AcsDefend") return "Group defense";
  return missionType.replace(/([A-Z])/g, " $1").trim();
}

type MissionDirection = "incoming" | "neutral" | "outgoing";

// Hostile missions inbound to the player read "Incoming attack"; the player's own
// launches and returning fleets keep the bare action label ("Attack", "Transport").
function directionalMissionTypeLabel(missionType: string, direction: MissionDirection): string {
  const base = missionTypeLabel(missionType);
  if (direction === "incoming") return `Incoming ${base.toLowerCase()}`;
  return base;
}

// Direction is "outgoing" when the player commands the fleet (always themselves) or
// launches from a planet they own, and "incoming" when the player's planet is the
// target. The active table already classifies hostile inbound and returning fleets,
// so that context takes precedence when available; the past table relies on owner and
// planet ownership alone.
function resolveMissionDirection({
  context,
  mission,
  wallet,
  walletPlanetIds,
}: {
  context?: ActiveMissionContext | undefined;
  mission: FleetMissionSummary;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}): MissionDirection {
  if (context === "incoming") return "incoming";
  if (context === "returning") return "outgoing";
  if (addressesMatch(mission.owner, wallet)) return "outgoing";
  if (context === "outgoing") return "outgoing";
  if (walletPlanetIds.has(mission.originPlanetId)) return "outgoing";
  if (walletPlanetIds.has(mission.targetPlanetId)) return "incoming";
  return "neutral";
}

function walletPlanetIdSet(
  walletPlanets: ManagedPlanetResponse[],
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>,
  wallet: string | undefined
): Set<string> {
  const ids = new Set(walletPlanets.map((planet) => planet.planetId));
  for (const [planetId, identity] of planetLookup) {
    if (addressesMatch(identity.owner, wallet)) ids.add(planetId);
  }
  return ids;
}

function addressesMatch(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

function planetReference(planetId: string, lookup: ReadonlyMap<string, MissionPlanetIdentity>): string {
  const planet = lookup.get(planetId);
  if (planet) return `${planet.displayName} [${planet.coordinates}]`;
  const colonyTarget = decodeColonizationTargetId(planetId);
  if (colonyTarget) return `Uncharted [${colonyTarget.coordinates}]`;
  return "External coordinates unavailable";
}

function commanderLabel(address: string, planet: MissionPlanetIdentity | undefined): string {
  const name = planet?.ownerDisplayName ?? undefined;
  return name ? `${name} (${shortAddress(address)})` : shortAddress(address);
}

function missionReport(
  mission: FleetMissionSummary,
  now: number,
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>
): {
  acs: string;
  attacker: string;
  battleTime: string;
  debris: string;
  defender: string;
  losses: string;
  origin: string;
  outcome: string;
  routeSummary: string;
  target: string;
  title: string;
} {
  const origin = planetReference(mission.originPlanetId, planetLookup);
  const target = planetReference(mission.targetPlanetId, planetLookup);
  const joinedAttackMissionIds = mission.joinedAttackMissionIds ?? [];
  return {
    acs: mission.attackGroupId
      ? `Group ${mission.attackGroupId}`
      : joinedAttackMissionIds.length > 0
        ? `Joined attacks ${joinedAttackMissionIds.join(", ")}`
        : "No group recorded.",
    attacker: commanderLabel(mission.owner, planetLookup.get(mission.originPlanetId)),
    battleTime: formatMissionTime(mission.arrivalAt, now),
    debris: "Not reported by the visible mission feed yet.",
    defender: planetLookup.get(mission.targetPlanetId)?.owner
      ? commanderLabel(planetLookup.get(mission.targetPlanetId)!.owner, planetLookup.get(mission.targetPlanetId))
      : "External commander unavailable",
    losses: mission.status === "Resolved" ? "Resolved combat losses are not exposed in this mission feed." : "Pending battle resolution.",
    origin,
    outcome: mission.needsResolution || isMissionDue(mission, now) ? "Ready to resolve." : missionStatusLabel(mission.status),
    routeSummary: `${origin} -> ${target}`,
    target,
    title: `${missionTypeLabel(mission.missionType)} #${mission.missionId}`,
  };
}

function missionReportText(
  mission: FleetMissionSummary,
  now: number,
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>
): string {
  const report = missionReport(mission, now, planetLookup);
  const joinedAttackMissionIds = mission.joinedAttackMissionIds ?? [];
  return [
    `Veydrift battle report: ${report.title}`,
    `Battle time: ${report.battleTime}`,
    `Status: ${missionStatusLabel(mission.status)}`,
    `Route: ${report.routeSummary}`,
    `Attacker: ${report.attacker}`,
    `Defender: ${report.defender}`,
    `Attacker fleet: ${formatShips(mission.ships)}`,
    `Cargo carried: ${formatCargo(mission.cargo)}`,
    `Fuel burned: ${formatResource(mission.fuelCost)} deuterium`,
    `Outcome: ${report.outcome}`,
    `Losses: ${report.losses}`,
    `Debris: ${report.debris}`,
    mission.attackGroupId ? `Group: ${mission.attackGroupId}` : null,
    joinedAttackMissionIds.length > 0 ? `Joined attacks: ${joinedAttackMissionIds.join(", ")}` : null,
    mission.transactionHash ? `Tx: ${mission.transactionHash}` : null,
  ].filter(Boolean).join("\n");
}

function copyText(text: string): void {
  void globalThis.navigator?.clipboard?.writeText(text);
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function battleOutcomeLabel(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "Attacker win";
  if (outcome === "DefenderWin") return "Defender win";
  return "Draw";
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function formatResource(value: string): string {
  return Number(value).toLocaleString();
}

function shipLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
