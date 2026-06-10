import { ChevronLeft, ChevronRight, Clipboard, ExternalLink, List } from "lucide-preact";

import { planetArtTypeFromArchetypeOrCoords, planetImageForType, planetTypeFromCoordinates, planetTypeFromTemperature } from "../data/mockUniverse";
import { formatDurationUntil } from "../durationFormat";
import { shipAssetByKey } from "../gameAssets";
import { buildInspectHash } from "../inspectRoutes";
import type { ShipKey } from "../playableMvp";
import type { PlanetType } from "../types";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import {
  type BattleReport,
  type FleetMissionArchiveEntry,
  type FleetMissionArchiveResponse,
  type FleetMissionPlanetReference,
  type FleetMissionSummary,
  type FleetMissionVisibilityResponse,
  type GlobalMissionArchiveResponse,
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
  allActiveMissions?: FleetMissionSummary[] | undefined;
  canTransact: boolean;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  globalMissionArchive?: GlobalMissionArchiveResponse | undefined;
  globalMissionArchiveError?: string | undefined;
  globalMissionArchiveLoading?: boolean | undefined;
  // VEY-412: the tab/page selection to render initially. Defaults to the sessionStorage-persisted
  // view so the selection survives the mission-detail round-trip; tests pass it explicitly.
  initialView?: MissionControlView | undefined;
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
  onGlobalMissionArchivePageChange?: ((page: number) => void) | undefined;
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
  allActiveMissions = [],
  canTransact,
  fleetVisibility,
  globalMissionArchive,
  globalMissionArchiveError,
  globalMissionArchiveLoading = false,
  initialView,
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
  onGlobalMissionArchivePageChange,
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
  // Universe-wide active rows for the "All" tab: the player's own/alliance missions keep their exact
  // classification (direction + lifecycle actions); every other active mission renders read-only.
  const allActiveRows = allActiveMissionRows(allActiveMissions, activeMissionRows);
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...joinableAttacks, ...completedMissions]);
  const fallbackPastMissionRows = chronologicalPastMissionRows(completedMissions, battleReports);
  const rawPastMissionRows = missionArchive?.rows ?? fallbackPastMissionRows;
  const pastMissionRows = dedupePastMissionRows(rawPastMissionRows);
  // Rows collapsed by the dedupe (a mission + its battle report -> one row) so the section header
  // count can match the actual rendered rows even with server-side pagination (VEY-399#1).
  const pastCollapsedCount = rawPastMissionRows.length - pastMissionRows.length;
  // Universe-wide past archive ("All" past tab): same dedupe + collapse accounting, server-paginated.
  const rawGlobalPastRows = globalMissionArchive?.rows ?? [];
  const globalPastMissionRows = dedupePastMissionRows(rawGlobalPastRows);
  const globalPastCollapsedCount = rawGlobalPastRows.length - globalPastMissionRows.length;
  // Past missions render from the paginated archive, which can contain missions absent from the live
  // fleet-visibility feed (older pages, returned missions no longer "active"). The backend already
  // resolves each row's origin/target planet, so seed the lookup from those references too — otherwise
  // their coordinates render as "External coordinates unavailable" even though the data is available.
  const pastArchiveMissions = missionsFromArchiveRows(rawPastMissionRows);
  const globalArchiveMissions = missionsFromArchiveRows(rawGlobalPastRows);
  const lookupMissions = uniqueMissions([...allMissions, ...allActiveMissions, ...pastArchiveMissions, ...globalArchiveMissions]);
  // Loot grabbed per mission (return leg), drawn from every visible battle report so a mission card
  // can show "Cargo" (outbound) and "Loot" (return) on separate lines — VEY-404.
  const lootByMissionId = lootByMissionIdFromReports([
    ...battleReports,
    ...battleReportsFromArchiveRows(rawPastMissionRows),
    ...battleReportsFromArchiveRows(rawGlobalPastRows),
  ]);
  const selectedReport = reportMissionId ? lookupMissions.find((mission) => mission.missionId === reportMissionId) : undefined;
  const planetLookup = planetLookupFromMissionData(lookupMissions, walletPlanets);
  const walletAddress = fleetVisibility?.wallet ?? missionArchive?.wallet;
  const walletPlanetIds = walletPlanetIdSet(walletPlanets, planetLookup, walletAddress);
  const activeCount = activeMissionRows.length;
  const initialLoading = loading && !fleetVisibility;
  // VEY-412: restore the previously selected tabs + past page. The panel is DOM-driven (tabs/pages
  // toggle `hidden`), so without this the selection resets to defaults every time the component
  // remounts on returning from a mission detail (browser back or the in-app "← Mission Control").
  // The view comes from the URL hash first (shareable, survives reload + browser back), then the
  // sessionStorage fallback for the in-app back button which lands on a bare `#/mission-control`.
  const view = initialView ?? resolveMissionControlView();

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
            activePage={view.activePage}
            activeTab={view.activeTab}
            allRows={allActiveRows}
            allianceRows={allianceMissionRows}
            canTransact={canTransact}
            dueCount={due.length}
            lootByMissionId={lootByMissionId}
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
            allCollapsedCount={globalPastCollapsedCount}
            allError={globalMissionArchiveError}
            allLoading={globalMissionArchiveLoading}
            allPagination={globalMissionArchive?.pagination}
            allRows={globalPastMissionRows}
            collapsedCount={pastCollapsedCount}
            error={missionArchiveError}
            loading={missionArchiveLoading}
            lootByMissionId={lootByMissionId}
            now={now}
            onAllPageChange={onGlobalMissionArchivePageChange}
            onOpenReport={onOpenReport}
            onPageChange={onMissionArchivePageChange}
            pagination={missionArchive?.pagination}
            pastPage={view.pastPage}
            pastTab={view.pastTab}
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

  if (mission.status === "Outbound" && context !== "observer") {
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

// "observer" rows belong to other players and only appear on the universe-wide "All" tab; they
// carry no lifecycle actions (Resolve/Recall/Join), just the read-only route + Open control.
type ActiveMissionContext = "due" | "incoming" | "joinable" | "observer" | "outgoing" | "returning";

export type ActiveMissionRow = {
  context: ActiveMissionContext;
  direction: string;
  mission: FleetMissionSummary;
};

type PastMissionRow = FleetMissionArchiveEntry;

const ACTIVE_MISSION_TABS = [
  { emptyLabel: "No active missions.", key: "mine", label: "My missions" },
  { emptyLabel: "No joinable alliance attacks.", key: "alliance", label: "Alliance" },
  { emptyLabel: "No active missions in the universe yet.", key: "all", label: "All" },
] as const;

type ActiveMissionTabKey = (typeof ACTIVE_MISSION_TABS)[number]["key"];

const ACTIVE_MISSION_DEFAULT_TAB: ActiveMissionTabKey = "mine";

function ActiveMissionSection({
  activePage,
  activeTab,
  allRows,
  allianceRows,
  canTransact,
  dueCount,
  lootByMissionId,
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
  activePage: number;
  activeTab: ActiveMissionTabKey;
  allRows: ActiveMissionRow[];
  allianceRows: ActiveMissionRow[];
  canTransact: boolean;
  dueCount: number;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
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
  const rowsByTab: Record<ActiveMissionTabKey, ActiveMissionRow[]> = { all: allRows, alliance: allianceRows, mine: myRows };
  const sharedRowProps = {
    canTransact,
    lootByMissionId,
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
    <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]" data-active-tab={activeTab}>
      <div className="flex flex-col gap-2 border-b border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div aria-label="Active missions" className="flex flex-wrap gap-1.5" role="tablist">
          {ACTIVE_MISSION_TABS.map((tab) => (
            <button
              aria-selected={tab.key === activeTab}
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
        <div data-active-tab-panel={tab.key} hidden={tab.key !== activeTab} key={tab.key} role="tabpanel">
          {/* Only the initially-visible tab restores its remembered page; the hidden tabs start at 0. */}
          <ActiveMissionList emptyLabel={tab.emptyLabel} initialPage={tab.key === activeTab ? activePage : 0} rows={rowsByTab[tab.key]} {...sharedRowProps} />
        </div>
      ))}
    </section>
  );
}

function ActiveMissionList({
  canTransact,
  emptyLabel,
  initialPage = 0,
  lootByMissionId,
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
  initialPage?: number | undefined;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
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
  // VEY-412: restore the remembered page so back-navigation lands on the same page, not page 1.
  const pagination = paginationForRowsAtPage(rows, pageSize, initialPage);
  const currentPage = pagination.page - 1;

  return (
    <div
      className="p-3"
      data-past-page-current={String(currentPage)}
      data-past-page-size={String(pageSize)}
      data-past-page-total={String(pagination.totalEntries)}
    >
      {pages.map((pageRows, pageIndex) => (
        <div
          className="grid gap-3"
          data-past-page={pageIndex}
          hidden={pageIndex !== currentPage}
          key={`active-mission-page:${pageIndex}`}
        >
          {pageRows.map(({ context, direction, mission }) => (
            <MissionRow
              canTransact={canTransact}
              context={context}
              direction={direction}
              key={`${context}:${mission.missionId}`}
              loot={returnPhaseLoot(mission, lootByMissionId)}
              mission={mission}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onJoinAttack={onJoinAttack}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
              planetLookup={planetLookup}
              wallet={wallet}
              walletPlanetIds={walletPlanetIds}
            />
          ))}
        </div>
      ))}
      {pagination.totalPages > 1 ? <ClientPaginationControl className="pt-3" pagination={pagination} /> : null}
    </div>
  );
}

function MissionRow({
  canTransact,
  context,
  direction,
  loot,
  mission,
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
  canTransact: boolean;
  context: ActiveMissionContext;
  direction: string;
  loot?: BattleReport["loot"] | undefined;
  mission: FleetMissionSummary;
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
  // VEY-399#6/VEY-397#11: only surface Resolve and Join when they are actionable.
  const actions = missionLifecycleActions({ canTransact, context, mission, now })
    .filter((action) => !["joinAttack", "resolve"].includes(action.kind) || action.enabled);
  const missionDirection = resolveMissionDirection({ context, mission, wallet, walletPlanetIds });
  const origin = missionEndpoint(mission, "origin", planetLookup);
  const target = missionEndpoint(mission, "target", planetLookup);
  const noFleetReturned = isNoFleetReturned(mission);
  const directionSubtext = direction && direction !== "Joinable attack" ? direction : undefined;
  return (
    <MissionCard
      actions={
        <>
          {actions.map((action) => action.kind === "counterplay" ? (
            <span className="contents" key={action.kind}>
              <ActionButton
                action={{ ...action, label: "Group defend" }}
                onClick={() => onCounterplay(mission.missionId, "acsDefend")}
              />
              <ActionButton
                action={{ ...action, label: "Intercept" }}
                onClick={() => onCounterplay(mission.missionId, "intercept")}
              />
            </span>
          ) : action.kind === "joinAttack" ? (
            // VEY-397#13/#14: "Join" shares the Open button style/size (hidden when disabled, VEY-399#6).
            <button
              className={rowActionButtonClass}
              key={action.kind}
              onClick={() => onJoinAttack(mission.missionId, mission.targetPlanetId)}
              title="Join this alliance attack"
              type="button"
            >
              Join
            </button>
          ) : (
            <ActionButton
              action={action}
              key={action.kind}
              onClick={() => {
                if (action.kind === "resolve") onResolve(mission.missionId);
                if (action.kind === "recall") onRecall(mission.missionId);
                if (action.kind === "completeReturn") onCompleteReturn(mission.missionId);
              }}
            />
          ))}
          <button
            className={rowActionButtonClass}
            onClick={() => onOpenReport(mission.missionId)}
            title="Open the full mission detail screen"
            type="button"
          >
            <ExternalLink aria-hidden="true" size={13} />
            Open
          </button>
        </>
      }
      badgeLabel={directionalMissionTypeLabel(mission.missionType, missionDirection)}
      badgeTone={missionTypeTone(mission.missionType)}
      direction={missionRouteLeg(mission.status)}
      fleet={<MissionFleet cargo={mission.cargo} loot={loot} ships={mission.ships} />}
      groupId={mission.attackGroupId}
      headerTiming={activeMissionHeaderTiming(mission, now, noFleetReturned)}
      missionId={mission.missionId}
      origin={origin}
      progressPercent={missionProgressPercent(mission, now)}
      routeSubtext={directionSubtext}
      statusPill={missionStatusPill(mission.status)}
      target={target}
    />
  );
}

// Active cards surface the live ETA (outbound) or return countdown (returning/recalled) next to the
// status pill — the single most relevant time for the mission's current phase (VEY-400). Outbound
// fleets whose ships were all consumed on arrival have nothing to land, so the return reads
// "No fleet returned" instead of a countdown.
function activeMissionHeaderTiming(mission: FleetMissionSummary, now: number, noFleetReturned: boolean): EndpointTiming {
  const returning = mission.status === "Returning" || mission.status === "Recalled" || mission.status === "Returned";
  if (returning) {
    return { label: "Returns", value: noFleetReturned ? "No fleet returned" : missionEndpointTiming(mission.returnAt, now) };
  }
  return { label: "ETA", value: missionEndpointTiming(mission.arrivalAt, now) };
}

// Shared fleet/cargo summary for every card: ship icons with ×N counts above the cargo line
// (VEY-400 card spec). Cargo is omitted only when a caller has no cargo data (battle-report rows).
// Loot is the return-leg haul from the mission's battle report; it renders on its own line beneath
// the outbound cargo so the two read separately (VEY-404) and is omitted until a fleet is heading
// home with a resolved report.
function MissionFleet({
  cargo,
  loot,
  ships,
}: {
  cargo?: FleetMissionSummary["cargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  ships: Record<string, string>;
}) {
  return (
    <div className="space-y-1">
      <FleetIcons ships={ships} />
      {cargo ? <p className="text-[11px] text-slate-500">Cargo {formatCargo(cargo)}</p> : null}
      {loot ? <p className="text-[11px] text-slate-500">Loot {formatCargo(loot)}</p> : null}
    </div>
  );
}

// A fleet only carries loot home after its attack resolves, so the loot line is surfaced once the
// mission has left its outbound leg and a matching battle report exists. Outbound/incoming en-route
// cards stay cargo-only — the haul is not known (or not the player's) until the fleet turns back.
export function returnPhaseLoot(
  mission: FleetMissionSummary,
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>,
): BattleReport["loot"] | undefined {
  if (mission.status === "Outbound") return undefined;
  return lootByMissionId.get(mission.missionId);
}

// Status pill shown in every card header (VEY-400): "En route" for outbound fleets, "Returning"/
// "Recalled" while a fleet heads home, and the terminal status ("Returned"/"Resolved"/…) for past
// missions. This folds in the VEY-399 rework intent — status reads as a pill, never a raw timestamp.
function missionStatusPill(status: string): MissionStatusPill {
  if (status === "Outbound") return { label: "En route", tone: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
  if (status === "Returning") return { label: "Returning", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  if (status === "Recalled") return { label: "Recalled", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  return { label: status, tone: "border-slate-300/20 bg-slate-300/10 text-slate-300" };
}

// Shared style for the "Open" and "Join" row actions (VEY-397#14).
const rowActionButtonClass = "inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500";

type MissionEndpoint = {
  // Real planet archetype used to pick the planet art asset (VEY-403 / VEY-67); null only when the
  // endpoint has no resolvable planet (e.g. a battle-report attacker with no coordinates).
  archetype: PlanetType | null;
  commanderName: string | null;
  commanderWallet: string | null;
  coordinates: string | null;
  coords: { galaxy: number; position: number; system: number } | null;
  name: string;
};

// Resolves the planet archetype (art type) for an endpoint, preferring the mission feed's real
// archetype, then a shared-lookup archetype, then a deterministic coordinate-derived fallback so
// uncharted colonization targets still render planet art rather than a generic icon.
function endpointArchetype(
  refArchetype: PlanetType | null | undefined,
  identityArchetype: PlanetType | null | undefined,
  coords: { galaxy: number; position: number; system: number } | null,
): PlanetType | null {
  return planetArtTypeFromArchetypeOrCoords(refArchetype ?? identityArchetype, coords);
}

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
    archetype: endpointArchetype(ref?.archetype, identity?.archetype, coords),
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

// Compact absolute timestamp like "Jun 8, 9:55 AM" (VEY-399#4).
function compactMissionTime(value: string, now: number): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  return formatUserTimestamp(timestamp, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

// Active-row endpoint timing: a live countdown while the event is still pending, switching to the
// compact arrival/return time once it has passed (VEY-399#4 — no "Ready"/"ARRIVAL Ready" word).
function missionEndpointTiming(value: string, now: number): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  const remaining = formatDurationUntil(timestamp, now);
  return remaining === "Ready" ? compactMissionTime(value, now) : remaining;
}

type EndpointTiming = { label: string; value: string };

// The leg of the journey a card's route arrow represents: an outbound fleet flies origin -> target,
// a returning/recalled/returned fleet flies back target -> origin (home). The arrow points along
// this leg and fills with mission progress (VEY-403).
type RouteLeg = "outbound" | "returning";

function missionRouteLeg(status: string): RouteLeg {
  return status === "Returning" || status === "Recalled" || status === "Returned" ? "returning" : "outbound";
}

// The single shared, alignment-clean route cell used by every mission table — active My missions /
// Alliance and Past missions (VEY-399#5, VEY-403). Each endpoint renders its real planet art plus a
// clickable name + commander; between them a directional arrow points along the active leg
// (outbound -> target, returning -> home) and fills with mission progress. An optional whole-route
// subtext (e.g. "Returned · <time>") sits below.
function MissionRouteCell({
  direction,
  origin,
  progressPercent,
  subtext,
  target,
}: {
  direction: RouteLeg;
  origin: MissionEndpoint;
  progressPercent?: number | undefined;
  subtext?: string | undefined;
  target: MissionEndpoint;
}) {
  return (
    <div className="min-w-0">
      {/* Origin hugs the left edge, target hugs the right edge, and the directional arrow spans the
          full gap between them (VEY-403 rework). The endpoint columns size to their content but are
          capped (via the RouteEndpoint max-width) so the arrow always owns the central span. */}
      <div className="grid grid-cols-[minmax(0,auto)_minmax(2.5rem,1fr)_minmax(0,auto)] items-center gap-x-2 sm:gap-x-3">
        <RouteEndpoint align="left" endpoint={origin} />
        <RouteArrow direction={direction} progressPercent={progressPercent ?? 100} />
        <RouteEndpoint align="right" endpoint={target} />
      </div>
      {subtext ? <p className="mt-1.5 text-[11px] text-slate-500">{subtext}</p> : null}
    </div>
  );
}

// One side of the route: the planet art asset pinned to the outer edge (origin on the left, target
// on the right via the mirrored layout) with the clickable planet name + commander stacked
// alongside it. Width is capped so long planet names truncate instead of squeezing the arrow.
function RouteEndpoint({ align, endpoint }: { align: "left" | "right"; endpoint: MissionEndpoint }) {
  return (
    <div className={`flex min-w-0 max-w-[7rem] items-center gap-2 sm:max-w-[11rem] ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <EndpointPlanetImage endpoint={endpoint} />
      <div className="min-w-0">
        <EndpointName endpoint={endpoint} />
        <EndpointCommander endpoint={endpoint} />
      </div>
    </div>
  );
}

// Real planet art for an endpoint (the same asset set the Galaxy view uses for thumbnails — VEY-67).
// Falls back to a subtle ringed placeholder only when no planet can be resolved (e.g. a
// battle-report attacker without coordinates).
function EndpointPlanetImage({ endpoint }: { endpoint: MissionEndpoint }) {
  const frameClass = "relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/30 sm:h-9 sm:w-9";
  if (!endpoint.archetype) {
    return <span aria-hidden="true" className={`${frameClass} flex items-center justify-center`}><span className="h-3 w-3 rounded-full border border-white/25" /></span>;
  }
  return (
    <span className={frameClass}>
      <img
        alt={`${endpoint.name} planet`}
        className="h-full w-full object-cover"
        data-planet-art={endpoint.archetype}
        loading="lazy"
        src={planetImageForType(endpoint.archetype)}
      />
    </span>
  );
}

function EndpointName({ endpoint }: { endpoint: MissionEndpoint }) {
  if (endpoint.coords) {
    return (
      <a
        className="block min-w-0 truncate rounded font-medium text-cyan-100 underline-offset-2 transition hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50"
        href={buildInspectHash({ coords: endpoint.coords, kind: "planet" })}
        title={endpoint.coordinates ? `Open ${endpoint.coordinates} in Galaxy` : undefined}
      >
        {endpoint.name}
      </a>
    );
  }
  return (
    <span className="block min-w-0 truncate font-medium text-slate-100" title={endpoint.coordinates ?? undefined}>
      {endpoint.name}
    </span>
  );
}

function EndpointCommander({ endpoint }: { endpoint: MissionEndpoint }) {
  if (!endpoint.commanderName) return null;
  return (
    <p className="truncate text-slate-400">
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
  );
}

// Directional, progress-filled route arrow (VEY-403). The arrowhead always points along the active
// leg — right toward the target for outbound fleets, left toward home for returning fleets — and a
// cyan fill grows from the trailing end to the current position, ending in a matching arrowhead, so
// the head sits at 100% on arrival/return. A muted destination chevron marks the leading end even at
// 0% progress.
function RouteArrow({ direction, progressPercent }: { direction: RouteLeg; progressPercent: number }) {
  const progress = clamp(progressPercent, 0, 100);
  const returning = direction === "returning";
  const rounded = Math.round(progress);
  const label = returning
    ? `Returning home, ${rounded}% of the way back`
    : `Outbound to target, ${rounded}% of the way there`;
  const Chevron = returning ? ChevronLeft : ChevronRight;
  // The track is inset by 0.5rem on each side to leave room for the destination chevron; the fill
  // and its leading chevron are positioned within that same inset span so the head reaches the tip
  // exactly at 100%. All transforms are inline to avoid clashing with Tailwind transform utilities.
  const fillStyle: Record<string, string> = returning
    ? { right: "0.5rem", width: `calc((100% - 1rem) * ${progress / 100})` }
    : { left: "0.5rem", width: `calc((100% - 1rem) * ${progress / 100})` };
  const headStyle: Record<string, string> = returning
    ? { right: `calc(0.5rem + (100% - 1rem) * ${progress / 100})`, transform: "translate(50%, -50%)" }
    : { left: `calc(0.5rem + (100% - 1rem) * ${progress / 100})`, transform: "translate(-50%, -50%)" };
  return (
    <div
      aria-label={label}
      className="relative h-5 w-full"
      data-route-arrow
      data-route-direction={direction}
      data-route-progress={String(rounded)}
      role="img"
    >
      {/* Muted full-length track. */}
      <span className="absolute inset-x-2 top-1/2 h-[3px] rounded-full bg-white/12" style={{ transform: "translateY(-50%)" }} />
      {/* Muted destination chevron pinned at the leading end (visible even at 0% progress). */}
      <span
        className={`absolute top-1/2 text-white/25 ${returning ? "left-0" : "right-0"}`}
        style={{ transform: "translateY(-50%)" }}
      >
        <Chevron aria-hidden="true" size={13} />
      </span>
      {/* Cyan progress fill growing from the trailing end toward the destination tip. */}
      <span
        className="absolute top-1/2 h-[3px] rounded-full bg-cyan-300"
        data-route-fill
        data-route-progress={String(rounded)}
        style={{ ...fillStyle, transform: "translateY(-50%)" }}
      />
      {/* Cyan arrowhead riding the leading edge of the fill, marking the current position. */}
      <span className="absolute top-1/2 text-cyan-200" data-route-head style={headStyle}>
        <Chevron aria-hidden="true" size={13} />
      </span>
    </div>
  );
}

type MissionStatusPill = { label: string; tone: string };

// The shared mission-card presentation used by every Mission Control panel (VEY-400). Active and
// past missions both render through this one component so the two panels stay in sync: a header
// line (mission-type badge + #number + status pill + optional live countdown), the shared route
// block with the inline progress bar, and a footer holding the fleet/cargo summary and the
// contextual action(s). Cards drop the old table headers and read top-to-bottom on mobile.
function MissionCard({
  actions,
  badgeLabel,
  badgeTone,
  direction,
  fleet,
  groupId,
  headerTiming,
  missionId,
  origin,
  progressPercent,
  routeSubtext,
  statusPill,
  target,
}: {
  actions: preact.ComponentChildren;
  badgeLabel: string;
  badgeTone: string;
  direction: RouteLeg;
  fleet: preact.ComponentChildren;
  groupId?: string | null | undefined;
  headerTiming?: EndpointTiming | undefined;
  missionId?: string | undefined;
  origin: MissionEndpoint;
  progressPercent?: number | undefined;
  routeSubtext?: string | undefined;
  statusPill?: MissionStatusPill | undefined;
  target: MissionEndpoint;
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300 transition hover:border-white/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded border px-2 py-1 text-[11px] font-semibold ${badgeTone}`}>{badgeLabel}</span>
        {missionId ? <span className="font-semibold text-white">#{missionId}</span> : null}
        {statusPill ? (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusPill.tone}`}>
            {statusPill.label}
          </span>
        ) : null}
        {headerTiming ? (
          <span className="text-[11px] tabular-nums text-slate-400">
            <span className="font-semibold uppercase tracking-[0.1em] text-slate-600">{headerTiming.label}</span> {headerTiming.value}
          </span>
        ) : null}
        {groupId ? <span className="text-[11px] text-cyan-100/70">Group {groupId}</span> : null}
      </div>
      <div className="mt-3">
        <MissionRouteCell direction={direction} origin={origin} progressPercent={progressPercent} subtext={routeSubtext} target={target} />
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">{fleet}</div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end">{actions}</div>
      </div>
    </article>
  );
}

// Builds a clickable route endpoint from a planet id alone (used by battle-report-only past rows,
// which carry no full mission planet reference) — VEY-399 shared route reuse.
function endpointFromPlanetId(planetId: string, lookup: ReadonlyMap<string, MissionPlanetIdentity>): MissionEndpoint {
  const identity = lookup.get(planetId);
  const colony = decodeColonizationTargetId(planetId);
  const coordinates = identity?.coordinates ?? colony?.coordinates ?? null;
  const coords = colony
    ? { galaxy: colony.galaxy, position: colony.position, system: colony.system }
    : parseCoordinateString(coordinates);
  const commanderWallet = identity?.owner ?? null;
  const commanderDisplay = identity?.ownerDisplayName?.trim() || null;
  return {
    archetype: endpointArchetype(undefined, identity?.archetype, coords),
    commanderName: commanderDisplay || (commanderWallet ? shortAddress(commanderWallet) : null),
    commanderWallet,
    coordinates,
    coords,
    name: identityName(identity) || coordinates || `Planet #${planetId}`,
  };
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

const PAST_MISSION_TABS = [
  { emptyLabel: "No completed missions are visible for this wallet yet.", key: "mine", label: "My missions" },
  { emptyLabel: "No completed missions in the universe yet.", key: "all", label: "All" },
] as const;

type PastMissionTabKey = (typeof PAST_MISSION_TABS)[number]["key"];

const PAST_MISSION_DEFAULT_TAB: PastMissionTabKey = "mine";

// VEY-412: Mission Control remembers which tabs + page the player was on across the mission-detail
// round-trip. The panel is DOM-driven (tabs/pages toggle `hidden` directly), so the whole component
// remounts to defaults whenever the player returns from a mission detail — via browser back or the
// in-app "← Mission Control" button. We persist the view in sessionStorage and read it back at
// render so the restored selection is reflected directly in the markup, then write on every change.
export type MissionControlView = {
  activePage: number;
  activeTab: ActiveMissionTabKey;
  pastPage: number;
  pastTab: PastMissionTabKey;
};

const MISSION_CONTROL_VIEW_STORAGE_KEY = "veydrift:mission-control:view";

// VEY-412: the bare Mission Control list route. Only this exact path carries the tab/page query
// params — never a detail (`#/mission/<id>`) or report (`#/mission-control/report/<id>`) route.
const MISSION_CONTROL_HASH_PATH = "mission-control";

const ACTIVE_MISSION_TAB_KEYS = new Set<string>(ACTIVE_MISSION_TABS.map((tab) => tab.key));
const PAST_MISSION_TAB_KEYS = new Set<string>(PAST_MISSION_TABS.map((tab) => tab.key));

export const DEFAULT_MISSION_CONTROL_VIEW: MissionControlView = {
  activePage: 0,
  activeTab: ACTIVE_MISSION_DEFAULT_TAB,
  pastPage: 0,
  pastTab: PAST_MISSION_DEFAULT_TAB,
};

function clampPageIndex(value: unknown): number {
  const page = Math.trunc(Number(value));
  return Number.isFinite(page) && page > 0 ? page : 0;
}

function missionControlViewStorage(): Storage | null {
  // Accessing window.sessionStorage can throw in privacy mode / sandboxed iframes, and is undefined
  // under SSR and the test renderer — fall back to defaults in every such case.
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readPersistedMissionControlView(): MissionControlView {
  const storage = missionControlViewStorage();
  if (!storage) return DEFAULT_MISSION_CONTROL_VIEW;
  try {
    const raw = storage.getItem(MISSION_CONTROL_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_MISSION_CONTROL_VIEW;
    const parsed = JSON.parse(raw) as Partial<MissionControlView> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_MISSION_CONTROL_VIEW;
    return {
      activePage: clampPageIndex(parsed.activePage),
      activeTab: ACTIVE_MISSION_TAB_KEYS.has(String(parsed.activeTab))
        ? (parsed.activeTab as ActiveMissionTabKey)
        : ACTIVE_MISSION_DEFAULT_TAB,
      pastPage: clampPageIndex(parsed.pastPage),
      pastTab: PAST_MISSION_TAB_KEYS.has(String(parsed.pastTab))
        ? (parsed.pastTab as PastMissionTabKey)
        : PAST_MISSION_DEFAULT_TAB,
    };
  } catch {
    return DEFAULT_MISSION_CONTROL_VIEW;
  }
}

// VEY-412 rework: in-memory mirror of the last selected view. The Mission Control panel runs inside
// a Farcaster Mini App iframe where sessionStorage is partitioned/blocked (the guarded accessor
// returns null), so the in-app "← Mission Control" back button — which lands on a bare
// `#/mission-control` with no query — cannot restore from the URL or storage there. This
// module-level value survives the panel remount within the SPA session and covers that case.
let lastMissionControlView: MissionControlView = DEFAULT_MISSION_CONTROL_VIEW;

export function persistMissionControlView(partial: Partial<MissionControlView>): void {
  const next = { ...readPersistedMissionControlView(), ...partial };
  lastMissionControlView = next;
  const storage = missionControlViewStorage();
  if (storage) {
    try {
      storage.setItem(MISSION_CONTROL_VIEW_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence: ignore quota/security errors.
    }
  }
  // VEY-412 rework: the URL hash is the source of truth — it survives browser back, hard reload, and
  // is shareable. sessionStorage / the in-memory mirror are the fallbacks for the in-app
  // "← Mission Control" button, which navigates to a bare `#/mission-control` (no query).
  writeMissionControlViewToHash(next);
}

// VEY-412 rework: pure (window-free) encoders so the round-trip is unit-testable. Only non-default
// fields are written, keeping fresh-load URLs clean (`#/mission-control`).
export function parseMissionControlViewParams(query: string): Partial<MissionControlView> {
  const params = new URLSearchParams(query);
  const out: Partial<MissionControlView> = {};
  const activeTab = params.get("at");
  if (activeTab && ACTIVE_MISSION_TAB_KEYS.has(activeTab)) out.activeTab = activeTab as ActiveMissionTabKey;
  const pastTab = params.get("pt");
  if (pastTab && PAST_MISSION_TAB_KEYS.has(pastTab)) out.pastTab = pastTab as PastMissionTabKey;
  if (params.has("ap")) out.activePage = clampPageIndex(params.get("ap"));
  if (params.has("pp")) out.pastPage = clampPageIndex(params.get("pp"));
  return out;
}

export function buildMissionControlViewQuery(view: MissionControlView): string {
  const params = new URLSearchParams();
  if (view.activeTab !== ACTIVE_MISSION_DEFAULT_TAB) params.set("at", view.activeTab);
  if (view.pastTab !== PAST_MISSION_DEFAULT_TAB) params.set("pt", view.pastTab);
  if (view.activePage > 0) params.set("ap", String(view.activePage));
  if (view.pastPage > 0) params.set("pp", String(view.pastPage));
  return params.toString();
}

// Split a location hash into its `path` (without leading `#`/`/`) and `query` parts.
function splitHash(hash: string): { path: string; query: string } {
  const withoutHash = hash.replace(/^#/, "").replace(/^\/+/, "");
  const [path = "", query = ""] = withoutHash.split("?");
  return { path, query };
}

// Read the tab/page selection encoded in the current location hash, but only when we are on the bare
// Mission Control list route. Returns null elsewhere (detail/report routes, SSR, parse errors).
function readMissionControlViewFromHash(): Partial<MissionControlView> | null {
  if (typeof window === "undefined") return null;
  try {
    const { path, query } = splitHash(window.location.hash || "");
    if (path !== MISSION_CONTROL_HASH_PATH || !query) return null;
    const parsed = parseMissionControlViewParams(query);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// Reflect the view in the URL via replaceState — no new history entry and no `hashchange` event, so
// the router is undisturbed. Guarded to the bare list route so we never rewrite a detail URL.
function writeMissionControlViewToHash(view: MissionControlView): void {
  if (typeof window === "undefined") return;
  try {
    const { path } = splitHash(window.location.hash || "");
    if (path !== MISSION_CONTROL_HASH_PATH) return;
    const query = buildMissionControlViewQuery(view);
    const nextHash = query ? `#/${MISSION_CONTROL_HASH_PATH}?${query}` : `#/${MISSION_CONTROL_HASH_PATH}`;
    const url = `${window.location.pathname}${window.location.search}${nextHash}`;
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Best-effort: a sandboxed history (some embeds) can throw on replaceState.
  }
}

// VEY-412 rework: resolve the initial view by precedence — URL hash (shareable, survives browser
// back + reload) first; then sessionStorage when it holds a real selection; then the in-memory
// mirror, which is the only fallback that works for the in-app back button inside the Farcaster
// iframe (sessionStorage is blocked there). A blocked/empty storage reads back as the default, so
// we only trust it when it differs from the default and otherwise defer to the in-memory mirror.
export function resolveMissionControlView(): MissionControlView {
  const persisted = readPersistedMissionControlView();
  const base = isDefaultMissionControlView(persisted) ? lastMissionControlView : persisted;
  const fromHash = readMissionControlViewFromHash();
  return fromHash ? { ...base, ...fromHash } : base;
}

function isDefaultMissionControlView(view: MissionControlView): boolean {
  return (
    view.activeTab === DEFAULT_MISSION_CONTROL_VIEW.activeTab &&
    view.pastTab === DEFAULT_MISSION_CONTROL_VIEW.pastTab &&
    view.activePage === DEFAULT_MISSION_CONTROL_VIEW.activePage &&
    view.pastPage === DEFAULT_MISSION_CONTROL_VIEW.pastPage
  );
}

// The 0-based client page currently shown inside a tab panel, read straight from the DOM marker the
// pagination handlers maintain. Used when persisting a tab switch so we remember the page too.
function visibleClientPageIndex(panel: Element | null): number {
  if (!(panel instanceof HTMLElement)) return 0;
  const holder = panel.matches("[data-past-page-current]")
    ? panel
    : panel.querySelector<HTMLElement>("[data-past-page-current]");
  return holder ? clampPageIndex(holder.dataset.pastPageCurrent) : 0;
}

// VEY-399#1: the displayed total must match the actual de-duplicated rows. The fallback pagination
// already counts deduped rows; a server archive count is corrected by the rows collapsed on the
// page (a mission and its battle report render as ONE row, not two).
function pastDisplayTotalEntries(
  rows: PastMissionRow[],
  pagination: FleetMissionArchiveResponse["pagination"] | undefined,
  collapsedCount: number,
): number {
  const currentPagination = pagination ?? paginationForRows(rows, 25);
  return pagination
    ? Math.max(rows.length, currentPagination.totalEntries - collapsedCount)
    : currentPagination.totalEntries;
}

type PastMissionTabData = {
  collapsedCount: number;
  emptyLabel: string;
  error?: string | undefined;
  loading: boolean;
  onPageChange?: ((page: number) => void) | undefined;
  pagination?: FleetMissionArchiveResponse["pagination"] | undefined;
  rows: PastMissionRow[];
};

function PastMissionSection({
  allCollapsedCount = 0,
  allError,
  allLoading = false,
  allPagination,
  allRows,
  collapsedCount = 0,
  error,
  loading,
  lootByMissionId,
  now,
  onAllPageChange,
  onOpenReport,
  onPageChange,
  pagination,
  pastPage,
  pastTab,
  planetLookup,
  rows,
  wallet,
  walletPlanetIds,
}: {
  allCollapsedCount?: number | undefined;
  allError?: string | undefined;
  allLoading?: boolean | undefined;
  allPagination?: FleetMissionArchiveResponse["pagination"] | undefined;
  allRows: PastMissionRow[];
  collapsedCount?: number | undefined;
  error?: string | undefined;
  loading: boolean;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  now: number;
  onAllPageChange?: ((page: number) => void) | undefined;
  onOpenReport: (missionId: string) => void;
  onPageChange?: ((page: number) => void) | undefined;
  pagination?: FleetMissionArchiveResponse["pagination"] | undefined;
  pastPage: number;
  pastTab: PastMissionTabKey;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  rows: PastMissionRow[];
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const dataByTab: Record<PastMissionTabKey, PastMissionTabData> = {
    all: {
      collapsedCount: allCollapsedCount,
      emptyLabel: "No completed missions in the universe yet.",
      error: allError,
      loading: allLoading,
      onPageChange: onAllPageChange,
      pagination: allPagination,
      rows: allRows,
    },
    mine: {
      collapsedCount,
      emptyLabel: "No completed missions are visible for this wallet yet.",
      error,
      loading,
      onPageChange,
      pagination,
      rows,
    },
  };
  const sharedRowProps = { lootByMissionId, now, onOpenReport, planetLookup, wallet, walletPlanetIds };

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]" data-past-tab={pastTab}>
      <div className="flex flex-col gap-2 border-b border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Past missions</h3>
        <div aria-label="Past missions scope" className="flex flex-wrap gap-1.5" role="tablist">
          {PAST_MISSION_TABS.map((tab) => {
            const data = dataByTab[tab.key];
            const count = pastDisplayTotalEntries(data.rows, data.pagination, data.collapsedCount);
            return (
              <button
                aria-selected={tab.key === pastTab}
                className="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100"
                data-past-tab-button={tab.key}
                key={tab.key}
                onClick={(event) => showPastMissionTab(event, tab.key)}
                role="tab"
                type="button"
              >
                {`${tab.label} (${count})`}
              </button>
            );
          })}
        </div>
      </div>
      {PAST_MISSION_TABS.map((tab) => (
        <div data-past-tab-panel={tab.key} hidden={tab.key !== pastTab} key={tab.key} role="tabpanel">
          {/* Server-paginated tabs keep their page in app state; the client-paginated fallback restores
              the remembered page for the initially-visible tab only (VEY-412). */}
          <PastMissionTable initialClientPage={tab.key === pastTab ? pastPage : 0} {...dataByTab[tab.key]} {...sharedRowProps} />
        </div>
      ))}
    </section>
  );
}

function PastMissionTable({
  collapsedCount,
  emptyLabel,
  error,
  initialClientPage = 0,
  loading,
  lootByMissionId,
  now,
  onOpenReport,
  onPageChange,
  pagination,
  planetLookup,
  rows,
  wallet,
  walletPlanetIds,
}: PastMissionTabData & {
  initialClientPage?: number | undefined;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  now: number;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const pageSize = 25;
  const pages = paginatedRows(rows, pageSize);
  // Server-paginated tabs carry their page in the `pagination` prop (app state, survives navigation);
  // the client-paginated fallback restores the remembered page index here (VEY-412).
  const currentPagination = pagination ?? paginationForRowsAtPage(rows, pageSize, initialClientPage);
  const hasPages = currentPagination.totalPages > 1;
  const visiblePages = pagination ? [rows] : pages;
  const clientPage = pagination ? 0 : currentPagination.page - 1;
  const displayTotalEntries = pastDisplayTotalEntries(rows, pagination, collapsedCount);

  return (
    <div
      data-past-page-current={String(currentPagination.page - 1)}
      data-past-page-size={String(currentPagination.pageSize)}
      data-past-page-total={String(displayTotalEntries)}
    >
      {error ? <div className="px-3 pt-3"><Notice tone="danger">{error}</Notice></div> : null}
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">{loading ? "Loading completed missions…" : emptyLabel}</p>
      ) : (
        <>
          <div className="p-3">
            {visiblePages.map((pageRows, pageIndex) => (
              <div
                className="grid gap-3"
                data-past-page={pageIndex}
                hidden={!pagination && pageIndex !== clientPage}
                key={`past-mission-page:${pageIndex}`}
              >
                {pageRows.map((row) => row.kind === "mission" ? (
                  <PastMissionSummaryRow
                    key={`past-mission:${row.mission.missionId}`}
                    loot={returnPhaseLoot(row.mission, lootByMissionId)}
                    mission={row.mission}
                    now={now}
                    onOpenReport={onOpenReport}
                    planetLookup={planetLookup}
                    wallet={wallet}
                    walletPlanetIds={walletPlanetIds}
                  />
                ) : (
                  <PastBattleReportRow
                    key={`past-report:${row.report.missionId}`}
                    onOpenReport={onOpenReport}
                    planetLookup={planetLookup}
                    report={row.report}
                  />
                ))}
              </div>
            ))}
            {hasPages ? (
              <ClientPaginationControl
                className="pb-3"
                loading={loading}
                nextLabel="Next mission archive page"
                onPageChange={onPageChange}
                pagination={currentPagination}
                prevLabel="Previous mission archive page"
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PastMissionSummaryRow({
  loot,
  mission,
  now,
  onOpenReport,
  planetLookup,
  wallet,
  walletPlanetIds,
}: {
  loot?: BattleReport["loot"] | undefined;
  mission: FleetMissionSummary;
  now: number;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const missionDirection = resolveMissionDirection({ mission, wallet, walletPlanetIds });
  const origin = missionEndpoint(mission, "origin", planetLookup);
  const target = missionEndpoint(mission, "target", planetLookup);
  return (
    <MissionCard
      actions={
        <button
          className={rowActionButtonClass}
          onClick={() => onOpenReport(mission.missionId)}
          title="Open the full mission detail screen"
          type="button"
        >
          <ExternalLink aria-hidden="true" size={13} />
          Open
        </button>
      }
      badgeLabel={directionalMissionTypeLabel(mission.missionType, missionDirection)}
      badgeTone={missionTypeTone(mission.missionType)}
      direction={missionRouteLeg(mission.status)}
      fleet={<MissionFleet cargo={mission.cargo} loot={loot} ships={mission.ships} />}
      groupId={mission.attackGroupId}
      missionId={mission.missionId}
      origin={origin}
      // VEY-400: the terminal status (e.g. "Returned") reads as the header pill, folding in the
      // VEY-399 rework intent (status as a pill, no raw timestamp) now that cards have no columns.
      statusPill={missionStatusPill(mission.status)}
      target={target}
    />
  );
}

function PastBattleReportRow({
  onOpenReport,
  planetLookup,
  report,
}: {
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  report: BattleReport;
}) {
  const target = endpointFromPlanetId(report.targetPlanetId, planetLookup);
  const origin: MissionEndpoint = {
    archetype: null,
    commanderName: shortHash(report.attacker),
    commanderWallet: report.attacker,
    coordinates: null,
    coords: null,
    name: "Attacker",
  };
  return (
    <MissionCard
      actions={
        <button
          className={rowActionButtonClass}
          onClick={() => onOpenReport(report.missionId)}
          title="Open the full mission detail screen"
          type="button"
        >
          <ExternalLink aria-hidden="true" size={13} />
          Open
        </button>
      }
      badgeLabel="Battle report"
      badgeTone="border-red-300/25 bg-red-400/10 text-red-100"
      direction="outbound"
      fleet={
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500">Loot {formatCargo(report.loot)}</p>
          <p className="text-[11px] text-slate-500">Losses {formatCargo(report.attackerLosses)} / {formatCargo(report.defenderLosses)}</p>
        </div>
      }
      missionId={report.missionId}
      origin={origin}
      routeSubtext={`${battleOutcomeLabel(report.outcome)} · Block ${report.blockNumber || "unknown"} · ${report.rounds} rounds`}
      target={target}
    />
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

// Client-side pagination metadata for a specific 0-based page index (VEY-412): same shape as
// paginationForRows but reflecting the remembered page so the label and prev/next disabled states
// match the page actually shown after a restore.
function paginationForRowsAtPage<T>(rows: T[], pageSize: number, pageIndex: number): FleetMissionArchiveResponse["pagination"] {
  const base = paginationForRows(rows, pageSize);
  const page = Math.min(Math.max(0, Math.trunc(pageIndex)), base.totalPages - 1);
  return {
    ...base,
    page: page + 1,
    hasPreviousPage: page > 0,
    hasNextPage: page < base.totalPages - 1,
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

  // VEY-412: remember the client-paginated page so back-navigation lands on it. The same control
  // drives both the active-missions panels and the client-paginated past fallback, so persist to
  // whichever section this button lives in.
  if (section.closest("[data-active-tab]")) {
    persistMissionControlView({ activePage: clamped });
  } else if (section.closest("[data-past-tab]")) {
    persistMissionControlView({ pastPage: clamped });
  }

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

  // VEY-412: remember the tab and the page of the now-visible panel so both restore on return.
  const visiblePanel = section.querySelector<HTMLElement>(`[data-active-tab-panel="${key}"]`);
  persistMissionControlView({ activePage: visibleClientPageIndex(visiblePanel), activeTab: key as ActiveMissionTabKey });
}

function showPastMissionTab(event: Event, key: string) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) return;

  const section = button.closest<HTMLElement>("[data-past-tab]");
  if (!section) return;
  section.dataset.pastTab = key;

  section.querySelectorAll<HTMLElement>("[data-past-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pastTabPanel !== key;
  });
  section.querySelectorAll<HTMLElement>("[data-past-tab-button]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.pastTabButton === key));
  });

  // VEY-412: remember the past-missions tab and the page of the now-visible panel.
  const visiblePanel = section.querySelector<HTMLElement>(`[data-past-tab-panel="${key}"]`);
  persistMissionControlView({ pastPage: visibleClientPageIndex(visiblePanel), pastTab: key as PastMissionTabKey });
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
  return sortedUniqueActiveMissionRows(rows);
}

function sortedUniqueActiveMissionRows(rows: ActiveMissionRow[]): ActiveMissionRow[] {
  return uniqueMissionRows(rows).sort((left, right) => {
    const leftTime = nextMissionEventTimestamp(left.mission) ?? Number.MAX_SAFE_INTEGER;
    const rightTime = nextMissionEventTimestamp(right.mission) ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left.mission.missionId) - Number(right.mission.missionId);
  });
}

// Universe-wide active rows for the "All" tab. The player's own + alliance missions keep the exact
// classification used by the My missions / Alliance tabs (so direction labels and lifecycle actions
// are identical); every other active mission renders as a read-only "observer" row.
export function allActiveMissionRows(
  allActiveMissions: FleetMissionSummary[],
  classifiedRows: ActiveMissionRow[],
): ActiveMissionRow[] {
  const classified = new Map(classifiedRows.map((row) => [row.mission.missionId, row] as const));
  return sortedUniqueActiveMissionRows(
    allActiveMissions.map((mission): ActiveMissionRow =>
      classified.get(mission.missionId) ?? { context: "observer", direction: "", mission }
    )
  );
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
  archetype: PlanetType | null;
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

function battleReportsFromArchiveRows(rows: readonly FleetMissionArchiveEntry[]): BattleReport[] {
  return rows.flatMap((row) => (row.kind === "battleReport" ? [row.report] : []));
}

// Return-leg loot keyed by mission id, gathered from every battle report visible across the live
// fleet feed and the paginated archives. A mission card pairs this with the mission's outbound cargo
// so "Cargo" and "Loot" read as separate lines instead of the loot being dropped when a completed
// mission collapses with its battle report into one archive row (VEY-404).
function lootByMissionIdFromReports(reports: BattleReport[]): Map<string, BattleReport["loot"]> {
  const lookup = new Map<string, BattleReport["loot"]>();
  for (const report of reports) {
    lookup.set(report.missionId, report.loot);
  }
  return lookup;
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
    archetype: planetTypeFromTemperature(planet.temperature),
    coordinates: planet.coordinates,
    displayName: planet.name?.trim() || `Planet [${planet.coordinates}]`,
    owner: planet.owner,
    ownerDisplayName: null,
  };
}

function identityFromMissionPlanet(planet: FleetMissionPlanetReference): MissionPlanetIdentity {
  return {
    archetype: planet.archetype ?? planetTypeFromCoordinates(planet.galaxy, planet.system, planet.position),
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
