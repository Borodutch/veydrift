import { ChevronLeft, ChevronRight, Clipboard, ExternalLink, List } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import type {
  BattleReport,
  FleetMissionArchiveEntry,
  FleetMissionArchiveResponse,
  FleetMissionPlanetReference,
  FleetMissionSummary,
  FleetMissionVisibilityResponse,
  ManagedPlanetResponse,
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
  onOpenBattleReport: (missionId: string) => void;
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
  onOpenBattleReport,
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
  const due = activeMissionRows.filter(({ mission }) => isMissionDue(mission, now) || isMissionReturned(mission, now));
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...joinableAttacks, ...completedMissions]);
  const fallbackPastMissionRows = chronologicalPastMissionRows(completedMissions, battleReports);
  const rawPastMissionRows = missionArchive?.rows ?? fallbackPastMissionRows;
  const battleReportMissionIds = battleReportMissionIdSet(rawPastMissionRows);
  const pastMissionRows = dedupePastMissionRows(rawPastMissionRows);
  const selectedReport = reportMissionId ? allMissions.find((mission) => mission.missionId === reportMissionId) : undefined;
  const planetLookup = planetLookupFromMissionData(allMissions, walletPlanets);
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
            canTransact={canTransact}
            dueCount={due.length}
            missions={activeMissionRows}
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
            battleReportMissionIds={battleReportMissionIds}
            error={missionArchiveError}
            loading={missionArchiveLoading}
            now={now}
            onOpenBattleReport={onOpenBattleReport}
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
      label: "Resolve battle",
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

type ActiveMissionRow = {
  context: ActiveMissionContext;
  direction: string;
  mission: FleetMissionSummary;
};

type PastMissionRow = FleetMissionArchiveEntry;

function ActiveMissionSection({
  canTransact,
  dueCount,
  missions,
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
  dueCount: number;
  missions: ActiveMissionRow[];
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
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      {dueCount > 0 ? (
        <div className="flex items-center justify-end gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
          <span className="rounded border border-red-300/25 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-100">
            Needs orders now {dueCount}
          </span>
        </div>
      ) : null}
      {missions.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">No active missions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[58rem] w-full table-fixed border-separate border-spacing-0 text-left text-xs">
            <thead className="bg-white/[0.03] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="w-[9rem] px-3 py-2">Countdown</th>
                <th className="w-[10rem] px-3 py-2">Mission</th>
                <th className="w-[23rem] px-3 py-2">Origin {"->"} Target</th>
                <th className="w-[9rem] px-3 py-2">Return</th>
                <th className="w-[13rem] px-3 py-2">Fleet / cargo</th>
                <th className="w-[15rem] px-3 py-2">Orders</th>
              </tr>
            </thead>
            <tbody>
              {missions.map(({ context, direction, mission }) => (
                <MissionRow
                  canTransact={canTransact}
                  context={context}
                  direction={direction}
                  key={`${context}:${mission.missionId}`}
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
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MissionRow({
  canTransact,
  context,
  direction,
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
  const actions = missionLifecycleActions({ canTransact, context, mission, now });
  const report = missionReport(mission, now, planetLookup);
  const timing = missionTiming(mission, now);
  const missionDirection = resolveMissionDirection({ context, mission, wallet, walletPlanetIds });
  return (
    <tr className="align-top text-slate-300 odd:bg-black/10 even:bg-white/[0.015]">
      <td className="border-t border-white/10 px-3 py-3">
        <p className={`font-semibold tabular-nums ${timing.due ? "text-red-100" : "text-white"}`}>{timing.countdown}</p>
        <p className="mt-1 whitespace-pre-line text-slate-500">{timing.clock}</p>
      </td>
      <td className="border-t border-white/10 px-3 py-3">
        <span className={`inline-flex rounded border px-2 py-1 text-[11px] font-semibold ${missionTypeTone(mission.missionType)}`}>
          {directionalMissionTypeLabel(mission.missionType, missionDirection)}
        </span>
        <p className="mt-2 font-semibold text-white">#{mission.missionId}</p>
        <p className="mt-1 text-slate-500">{direction}</p>
        <p className="mt-1 text-slate-500">Report {missionReportLabel(mission)}</p>
      </td>
      <td className="border-t border-white/10 px-3 py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-center gap-2">
          <MissionCellLabel label={`Origin Planet #${mission.originPlanetId}`} value={report.origin} />
          <div className="min-w-0">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-300" style={{ width: `${missionProgressPercent(mission, now)}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-slate-500">-&gt;</p>
          </div>
          <MissionCellLabel label={`Target Planet #${mission.targetPlanetId}`} value={report.target} />
        </div>
        {missionDirection === "outgoing" ? null : (
          <p className="mt-2 text-slate-500">{`Commander ${commanderLabel(mission.owner, planetLookup.get(mission.originPlanetId))}`}</p>
        )}
      </td>
      <td className="border-t border-white/10 px-3 py-3 whitespace-pre-line tabular-nums">{formatMissionTime(mission.returnAt, now)}</td>
      <td className="border-t border-white/10 px-3 py-3">
        <MissionCellLabel label="Ships" value={formatShips(mission.ships)} />
        <p className="mt-2 text-slate-500">Cargo {formatCargo(mission.cargo)}</p>
        <p className="mt-1 text-slate-500">Fuel {formatResource(mission.fuelCost)} D</p>
        {mission.attackGroupId ? <p className="mt-1 text-cyan-100/70">Group {mission.attackGroupId}</p> : null}
      </td>
      <td className="border-t border-white/10 px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
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
          ) : (
            <ActionButton
              action={action}
              key={action.kind}
              onClick={() => {
                if (action.kind === "resolve") onResolve(mission.missionId);
                if (action.kind === "recall") onRecall(mission.missionId);
                if (action.kind === "completeReturn") onCompleteReturn(mission.missionId);
                if (action.kind === "joinAttack") onJoinAttack(mission.missionId, mission.targetPlanetId);
              }}
            />
          ))}
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            onClick={() => onOpenReport(mission.missionId)}
            title="Open the shareable battle report"
            type="button"
          >
            <ExternalLink aria-hidden="true" size={13} />
            View report
          </button>
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
            onClick={() => copyMissionReport(mission, now, planetLookup)}
            title="Copy this battle report for chat"
            type="button"
          >
            <Clipboard aria-hidden="true" size={13} />
            Copy report
          </button>
        </div>
      </td>
    </tr>
  );
}

function MissionCellLabel({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-slate-100">{label}</p>
      <p className="mt-1 break-words text-slate-400">{value}</p>
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
  battleReportMissionIds,
  error,
  loading,
  now,
  onOpenBattleReport,
  onOpenReport,
  onPageChange,
  pagination,
  planetLookup,
  rows,
  wallet,
  walletPlanetIds,
}: {
  battleReportMissionIds: ReadonlySet<string>;
  error?: string | undefined;
  loading: boolean;
  now: number;
  onOpenBattleReport: (missionId: string) => void;
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
  const firstEntry = currentPagination.totalEntries === 0 ? 0 : (currentPagination.page - 1) * currentPagination.pageSize + 1;
  const lastEntry = Math.min(currentPagination.page * currentPagination.pageSize, currentPagination.totalEntries);

  return (
    <section
      className="min-w-0 rounded-lg border border-white/10 bg-[#101624] p-3"
      data-past-page-current={String(currentPagination.page - 1)}
      data-past-page-size={String(currentPagination.pageSize)}
      data-past-page-total={String(currentPagination.totalEntries)}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No completed missions are visible for this wallet yet.</p>
      ) : (
        <>
          {visiblePages.map((pageRows, pageIndex) => (
            <div
              className="grid gap-2"
              data-past-page={pageIndex}
              hidden={!pagination && pageIndex !== 0}
              key={`past-mission-page:${pageIndex}`}
            >
              <div className="hidden rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid lg:grid-cols-[9rem_11rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem] lg:gap-3">
                <span>Completed</span>
                <span>Mission</span>
                <span>Route / target</span>
                <span>Result</span>
                <span>Details</span>
              </div>
              {pageRows.map((row) => row.kind === "mission" ? (
                <PastMissionSummaryRow
                  hasBattleReport={battleReportMissionIds.has(row.mission.missionId)}
                  key={`past-mission:${row.mission.missionId}`}
                  mission={row.mission}
                  now={now}
                  onOpenBattleReport={onOpenBattleReport}
                  onOpenReport={onOpenReport}
                  planetLookup={planetLookup}
                  wallet={wallet}
                  walletPlanetIds={walletPlanetIds}
                />
              ) : (
                <PastBattleReportRow
                  key={`past-report:${row.report.missionId}`}
                  onOpenBattleReport={onOpenBattleReport}
                  report={row.report}
                />
              ))}
            </div>
          ))}
          {hasPages ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span data-past-page-label>Page {currentPagination.page} of {currentPagination.totalPages}</span>
                <span className="ml-2 text-slate-600" data-past-page-range>{`${firstEntry}-${lastEntry} of ${currentPagination.totalEntries}`}</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  aria-label="Previous mission archive page"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  data-past-page-prev
                  disabled={loading || !currentPagination.hasPreviousPage}
                  onClick={(event) => onPageChange ? onPageChange(currentPagination.page - 1) : showPastMissionPage(event, "previous")}
                  title="Previous page"
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={14} />
                </button>
                <button
                  aria-label="Next mission archive page"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  data-past-page-next
                  disabled={loading || !currentPagination.hasNextPage}
                  onClick={(event) => onPageChange ? onPageChange(currentPagination.page + 1) : showPastMissionPage(event, "next")}
                  title="Next page"
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function PastMissionSummaryRow({
  hasBattleReport,
  mission,
  now,
  onOpenBattleReport,
  onOpenReport,
  planetLookup,
  wallet,
  walletPlanetIds,
}: {
  hasBattleReport: boolean;
  mission: FleetMissionSummary;
  now: number;
  onOpenBattleReport: (missionId: string) => void;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const completedAt = missionCompletionTimestamp(mission);
  const report = missionReport(mission, now, planetLookup);
  const missionDirection = resolveMissionDirection({ mission, wallet, walletPlanetIds });
  return (
    <div className="grid min-w-0 gap-3 rounded border border-white/10 bg-black/10 p-3 text-xs text-slate-300 lg:grid-cols-[9rem_11rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem] lg:items-start">
      <ArchiveField label="Completed" valueClassName="whitespace-pre-line tabular-nums">
        {completedAt === undefined ? "Unknown" : formatMissionTime(String(Math.floor(completedAt / 1_000)), now)}
      </ArchiveField>
      <ArchiveField label="Mission">
        <span className={`inline-flex rounded border px-2 py-1 text-[11px] font-semibold ${missionTypeTone(mission.missionType)}`}>
          {directionalMissionTypeLabel(mission.missionType, missionDirection)}
        </span>
        <p className="mt-2 font-semibold text-white">Mission #{mission.missionId}</p>
        <p className="mt-1 text-slate-500">{missionStatusLabel(mission.status)}</p>
      </ArchiveField>
      <ArchiveField label="Route / target" valueClassName="break-words">
        <p className="font-medium text-slate-100">{report.routeSummary}</p>
        {missionDirection === "outgoing" ? null : (
          <p className="mt-1 break-all text-slate-500">Commander {report.attacker}</p>
        )}
      </ArchiveField>
      <ArchiveField label="Result" valueClassName="break-words">
        <p className="font-medium text-slate-100">{report.outcome}</p>
        <p className="mt-1 text-slate-500">Cargo {formatCargo(mission.cargo)}</p>
        {mission.attackGroupId ? <p className="mt-1 text-cyan-100/70">Group {mission.attackGroupId}</p> : null}
      </ArchiveField>
      <ArchiveField label="Details">
        <div className="flex flex-wrap gap-1.5">
          <button
            className="inline-flex h-8 items-center justify-center rounded border border-cyan-300/35 bg-cyan-300/10 px-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
            onClick={() => onOpenReport(mission.missionId)}
            type="button"
          >
            Open details
          </button>
          {hasBattleReport ? (
            <button
              className="inline-flex h-8 items-center justify-center rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              onClick={() => onOpenBattleReport(mission.missionId)}
              type="button"
            >
              Open report
            </button>
          ) : null}
        </div>
      </ArchiveField>
    </div>
  );
}

function PastBattleReportRow({
  onOpenBattleReport,
  report,
}: {
  onOpenBattleReport: (missionId: string) => void;
  report: BattleReport;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded border border-white/10 bg-black/10 p-3 text-xs text-slate-300 lg:grid-cols-[9rem_11rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem] lg:items-start">
      <ArchiveField label="Completed" valueClassName="tabular-nums">Block {report.blockNumber || "unknown"}</ArchiveField>
      <ArchiveField label="Mission">
        <span className="inline-flex rounded border border-red-300/25 bg-red-400/10 px-2 py-1 text-[11px] font-semibold text-red-100">
          Battle report
        </span>
        <p className="mt-2 font-semibold text-white">Mission #{report.missionId}</p>
        <p className="mt-1 text-slate-500">{battleOutcomeLabel(report.outcome)}</p>
      </ArchiveField>
      <ArchiveField label="Route / target" valueClassName="break-words">
        <p className="font-medium text-slate-100">
          Attacker {shortHash(report.attacker)} {"->"} Planet #{report.targetPlanetId}
        </p>
        <p className="mt-1 text-slate-500">Rounds {report.rounds}</p>
      </ArchiveField>
      <ArchiveField label="Result" valueClassName="break-words">
        <p className="font-medium text-slate-100">Loot {formatCargo(report.loot)}</p>
        <p className="mt-1 text-slate-500">Losses {formatCargo(report.attackerLosses)} / {formatCargo(report.defenderLosses)}</p>
      </ArchiveField>
      <ArchiveField label="Details">
        <button
          className="inline-flex h-8 items-center justify-center rounded border border-cyan-300/35 bg-cyan-300/10 px-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
          onClick={() => onOpenBattleReport(report.missionId)}
          type="button"
        >
          Open report
        </button>
      </ArchiveField>
    </div>
  );
}

function ArchiveField({
  children,
  label,
  valueClassName = "",
}: {
  children: preact.ComponentChildren;
  label: string;
  valueClassName?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:hidden">{label}</p>
      <div className={`min-w-0 ${valueClassName}`}>{children}</div>
    </div>
  );
}

function paginationForRows(rows: PastMissionRow[], pageSize: number): FleetMissionArchiveResponse["pagination"] {
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

function battleReportMissionIdSet(rows: PastMissionRow[]): Set<string> {
  return new Set(rows.filter((row) => row.kind === "battleReport").map((row) => row.report.missionId));
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

function missionTiming(mission: FleetMissionSummary, now: number): { clock: string; countdown: string; due: boolean } {
  const timestamp = nextMissionEventTimestamp(mission);
  if (timestamp === undefined) return { clock: "Unknown", countdown: "Unknown", due: false };
  return {
    clock: formatUserTimestamp(timestamp),
    countdown: formatDurationUntil(timestamp, now),
    due: timestamp <= now,
  };
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
  return "External coordinates unavailable";
}

function commanderLabel(address: string, planet: MissionPlanetIdentity | undefined): string {
  const name = planet?.ownerDisplayName ?? undefined;
  return name ? `${name} (${shortAddress(address)})` : shortAddress(address);
}

function missionReportLabel(mission: FleetMissionSummary): string {
  const joinedAttackMissionIds = mission.joinedAttackMissionIds ?? [];
  if (mission.attackGroupId) return `Group ${mission.attackGroupId}`;
  if (joinedAttackMissionIds.length > 0) {
    return `Joined ${joinedAttackMissionIds.join(", ")}`;
  }
  return mission.transactionHash ? `${mission.transactionHash.slice(0, 10)}...` : "Ready to share";
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

function copyMissionReport(
  mission: FleetMissionSummary,
  now: number,
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>
): void {
  copyText(missionReportText(mission, now, planetLookup));
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
