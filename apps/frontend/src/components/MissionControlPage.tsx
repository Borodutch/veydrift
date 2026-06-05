import { Clipboard, ExternalLink, List, RefreshCw, Route, Swords } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import type { BattleReport, FleetMissionPlanetReference, FleetMissionSummary, FleetMissionVisibilityResponse, ManagedPlanetResponse } from "../walletFlow";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

type MissionControlActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionLifecycleActionKind = "completeReturn" | "counterplay" | "recall" | "resolve";

export type MissionLifecycleAction = {
  kind: MissionLifecycleActionKind;
  label: string;
  enabled: boolean;
  reason?: string | undefined;
};

interface MissionControlPageProps {
  actionState: MissionControlActionState;
  canTransact: boolean;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  loading: boolean;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onNavigateGalaxy: () => void;
  onOpenBattleReport: (missionId: string) => void;
  onOpenReport: (missionId: string) => void;
  onOpenReportList: () => void;
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
  now,
  onCompleteReturn,
  onCounterplay,
  onNavigateGalaxy,
  onOpenBattleReport,
  onOpenReport,
  onOpenReportList,
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
  const battleReports = fleetVisibility?.battleReports ?? [];
  const due = [...incoming, ...outgoing].filter((mission) => isMissionDue(mission, now));
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...(fleetVisibility?.joinableAttacks ?? [])]);
  const selectedReport = reportMissionId ? allMissions.find((mission) => mission.missionId === reportMissionId) : undefined;
  const planetLookup = planetLookupFromMissionData(allMissions, walletPlanets);
  const activeCount = incoming.length + outgoing.length + returning.length;
  const initialLoading = loading && !fleetVisibility;

  return (
    <section className="grid gap-4">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">
            Mission Control
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Mission Control</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Watch inbound attacks, active launches, returning fleets, and time-critical battle actions from one command table.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            onClick={onNavigateGalaxy}
            type="button"
          >
            <Route aria-hidden="true" size={15} />
            Galaxy
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            onClick={onOpenReportList}
            type="button"
          >
            <List aria-hidden="true" size={15} />
            Reports
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </button>
        </div>
      </header>

      {actionState.status !== "idle" && (
        <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
          {actionState.label}
        </Notice>
      )}
      {loading && fleetVisibility ? <InlineSyncIndicator label="Refreshing missions" /> : null}

      {initialLoading ? (
        <VeydriftLoader label="Mapping missions" />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Active missions" value={activeCount.toString()} />
            <Metric label="Due resolvers" value={due.length.toString()} />
            <Metric label="Hostile inbound" value={incoming.length.toString()} />
            <Metric label="Returns" value={returning.length.toString()} />
          </div>

          {reportMissionId ? (
            <MissionReportDetail
              mission={selectedReport}
              now={now}
              onBack={onOpenReportList}
              planetLookup={planetLookup}
              reportUrl={selectedReport ? reportUrlForMission?.(selectedReport.missionId) : undefined}
            />
          ) : (
            <MissionReportList
              missions={allMissions}
              now={now}
              onOpenReport={onOpenReport}
              planetLookup={planetLookup}
              reportUrlForMission={reportUrlForMission}
            />
          )}

          {activeCount === 0 ? (
            <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
              No active missions for this wallet. Use Galaxy to launch attacks, transport resources, deploy fleets, or harvest debris.
            </div>
          ) : null}

          {due.length > 0 ? (
            <section className="rounded-lg border border-red-300/25 bg-red-400/10 p-3">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-white">Needs orders now</h3>
                <p className="mt-1 text-xs leading-5 text-red-100/80">
                  These missions have reached their target. Resolve battles or land fleets before relying on those ships and slots again.
                </p>
              </div>
              <MissionSection
                actionContext="due"
                canTransact={canTransact}
                missions={due}
                now={now}
                onCompleteReturn={onCompleteReturn}
                onCounterplay={onCounterplay}
                onOpenReport={onOpenReport}
                onRecall={onRecall}
                onResolve={onResolve}
                planetLookup={planetLookup}
                title="Ready to resolve"
                tone="danger"
              />
            </section>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-3">
            <MissionSection
              actionContext="incoming"
              canTransact={canTransact}
              empty="No hostile inbound missions."
              missions={incoming}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
              planetLookup={planetLookup}
              title="Incoming attacks"
              tone="danger"
            />
            <MissionSection
              actionContext="outgoing"
              canTransact={canTransact}
              empty="No outbound missions."
              missions={outgoing}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
              planetLookup={planetLookup}
              title="Outgoing fleets"
              tone="neutral"
            />
            <MissionSection
              actionContext="returning"
              canTransact={canTransact}
              empty="No fleets waiting to return."
              missions={returning}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
              planetLookup={planetLookup}
              title="Returning fleets"
              tone="warning"
            />
          </div>

          <ResolvedBattleReportSection
            onOpenBattleReport={onOpenBattleReport}
            reports={battleReports}
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
  context: "due" | "incoming" | "outgoing" | "returning";
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

  return actions;
}

function MissionSection({
  actionContext,
  canTransact,
  empty,
  missions,
  now,
  onCompleteReturn,
  onCounterplay,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
  title,
  tone,
}: {
  actionContext: "due" | "incoming" | "outgoing" | "returning";
  canTransact: boolean;
  empty?: string | undefined;
  missions: FleetMissionSummary[];
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  title: string;
  tone: "danger" | "neutral" | "warning";
}) {
  const border = tone === "danger"
    ? "border-red-300/25 bg-red-400/10"
    : tone === "warning"
      ? "border-amber-300/25 bg-amber-300/10"
      : "border-white/10 bg-[#101624]";
  return (
    <section className={`min-w-0 rounded-lg border p-3 ${border}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-xs tabular-nums text-slate-400">{missions.length}</span>
      </div>
      {missions.length === 0 ? (
        <p className="text-xs text-slate-500">{empty ?? "No missions."}</p>
      ) : (
        <div className="grid gap-2">
          {missions.map((mission) => (
            <MissionCard
              canTransact={canTransact}
              context={actionContext}
              key={`${actionContext}:${mission.missionId}`}
              mission={mission}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
              planetLookup={planetLookup}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MissionCard({
  canTransact,
  context,
  mission,
  now,
  onCompleteReturn,
  onCounterplay,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
}: {
  canTransact: boolean;
  context: "due" | "incoming" | "outgoing" | "returning";
  mission: FleetMissionSummary;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
}) {
  const actions = missionLifecycleActions({ canTransact, context, mission, now });
  const report = missionReport(mission, now, planetLookup);
  return (
    <article className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-white">
            {missionTypeLabel(mission.missionType)} #{mission.missionId}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {report.routeSummary} / {missionStatusLabel(mission.status)}
          </p>
        </div>
        <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-300">
          Fuel {formatResource(mission.fuelCost)} D
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <MissionDatum label="Arrival" value={formatMissionTime(mission.arrivalAt, now)} />
        <MissionDatum label="Return" value={formatMissionTime(mission.returnAt, now)} />
        <MissionDatum label="Cargo" value={formatCargo(mission.cargo)} />
        <MissionDatum label="Ships" value={formatShips(mission.ships)} />
        <MissionDatum label="Commander" value={commanderLabel(mission.owner, planetLookup.get(mission.originPlanetId))} />
        <MissionDatum label="Report" value={missionReportLabel(mission)} />
      </dl>

      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map((action) => action.kind === "counterplay" ? (
            <span className="contents" key={action.kind}>
              <ActionButton
                action={{ ...action, label: "Defend with Alliance Combat System (ACS)" }}
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
              }}
            />
          ))}
        </div>
      ) : null}

      <button
        className="mt-3 inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
        onClick={() => onOpenReport(mission.missionId)}
        title="Open the shareable battle report"
        type="button"
      >
        <ExternalLink aria-hidden="true" size={13} />
        View report
      </button>
      <button
        className="ml-2 mt-3 inline-flex h-8 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
        onClick={() => copyMissionReport(mission, now, planetLookup)}
        title="Copy this battle report for chat"
        type="button"
      >
        <Clipboard aria-hidden="true" size={13} />
        Copy report
      </button>
    </article>
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

function MissionReportList({
  missions,
  now,
  onOpenReport,
  planetLookup,
  reportUrlForMission,
}: {
  missions: FleetMissionSummary[];
  now: number;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  reportUrlForMission?: ((missionId: string) => string) | undefined;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Battle reports</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Shareable mission records for visible combat, transport, harvest, return, and counterplay operations.
          </p>
        </div>
        <span className="text-xs tabular-nums text-slate-400">{missions.length}</span>
      </div>
      {missions.length === 0 ? (
        <p className="text-xs text-slate-500">No visible mission reports yet.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {missions.map((mission) => {
            const report = missionReport(mission, now, planetLookup);
            const href = reportUrlForMission?.(mission.missionId);
            return (
              <a
                className="rounded-md border border-white/10 bg-black/20 p-3 text-left transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
                href={href}
                key={`report:${mission.missionId}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenReport(mission.missionId);
                }}
              >
                <p className="text-sm font-semibold text-white">{report.title}</p>
                <p className="mt-1 text-xs text-slate-500">{report.routeSummary}</p>
                <p className="mt-2 whitespace-pre-line text-xs text-slate-300">{report.battleTime}</p>
              </a>
            );
          })}
        </div>
      )}
    </section>
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
          <ReportLine label="Alliance Combat System (ACS)" value={report.acs} />
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

function ResolvedBattleReportSection({
  onOpenBattleReport,
  reports,
}: {
  onOpenBattleReport: (missionId: string) => void;
  reports: BattleReport[];
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
            <Swords aria-hidden="true" size={17} />
          </span>
          <h3 className="text-sm font-semibold text-white">Resolved battle reports</h3>
        </div>
        <span className="text-xs tabular-nums text-slate-400">{reports.length}</span>
      </div>
      {reports.length === 0 ? (
        <p className="text-xs text-slate-500">No resolved attack reports for this wallet yet.</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {reports.slice(0, 6).map((report) => (
            <article className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3" key={report.missionId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-white">
                    Mission #{report.missionId} / {battleOutcomeLabel(report.outcome)}
                  </h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Attacker {shortHash(report.attacker)} {"->"} Planet #{report.targetPlanetId}
                  </p>
                </div>
                <button
                  className="rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
                  onClick={() => onOpenBattleReport(report.missionId)}
                  type="button"
                >
                  Open report
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <MissionDatum label="Rounds" value={report.rounds.toString()} />
                <MissionDatum label="Loot" value={formatCargo(report.loot)} />
                <MissionDatum label="Attacker losses" value={formatCargo(report.attackerLosses)} />
                <MissionDatum label="Defender losses" value={formatCargo(report.defenderLosses)} />
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#101624] p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function MissionDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-slate-300">{value}</dd>
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
  if (missionType === "AcsAttack") return "Alliance Combat System (ACS) attack";
  if (missionType === "AcsDefend") return "Alliance Combat System (ACS) defense";
  return missionType.replace(/([A-Z])/g, " $1").trim();
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
  if (mission.attackGroupId) return `Alliance Combat System (ACS) ${mission.attackGroupId}`;
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
        : "No Alliance Combat System (ACS) group recorded.",
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
    mission.attackGroupId ? `Alliance Combat System (ACS) group: ${mission.attackGroupId}` : null,
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
