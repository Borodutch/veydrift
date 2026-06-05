import { Clipboard, RefreshCw, Route } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import type { FleetMissionSummary, FleetMissionVisibilityResponse } from "../walletFlow";
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
  onRecall: (missionId: string) => void;
  onRefresh: () => void;
  onResolve: (missionId: string) => void;
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
  onRecall,
  onRefresh,
  onResolve,
}: MissionControlPageProps) {
  const incoming = fleetVisibility?.incoming ?? [];
  const outgoing = fleetVisibility?.outgoing ?? [];
  const returning = fleetVisibility?.returning ?? [];
  const due = [...incoming, ...outgoing].filter((mission) => isMissionDue(mission, now));
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
                onRecall={onRecall}
                onResolve={onResolve}
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
              onRecall={onRecall}
              onResolve={onResolve}
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
              onRecall={onRecall}
              onResolve={onResolve}
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
              onRecall={onRecall}
              onResolve={onResolve}
              title="Returning fleets"
              tone="warning"
            />
          </div>
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
  onRecall,
  onResolve,
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
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
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
              onRecall={onRecall}
              onResolve={onResolve}
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
  onRecall,
  onResolve,
}: {
  canTransact: boolean;
  context: "due" | "incoming" | "outgoing" | "returning";
  mission: FleetMissionSummary;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
}) {
  const actions = missionLifecycleActions({ canTransact, context, mission, now });
  return (
    <article className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-white">
            {mission.missionType} #{mission.missionId}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Planet {mission.originPlanetId} {"->"} planet {mission.targetPlanetId} / {missionStatusLabel(mission.status)}
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
        <MissionDatum label="Commander" value={shortAddress(mission.owner)} />
        <MissionDatum label="Report" value={missionReportLabel(mission)} />
      </dl>

      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map((action) => action.kind === "counterplay" ? (
            <span className="contents" key={action.kind}>
              <ActionButton
                action={{ ...action, label: "Defend with ACS" }}
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
        onClick={() => copyMissionReport(mission)}
        title="Copy a compact battle report for chat"
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

function missionReportLabel(mission: FleetMissionSummary): string {
  const joinedAttackMissionIds = mission.joinedAttackMissionIds ?? [];
  if (mission.attackGroupId) return `ACS ${mission.attackGroupId}`;
  if (joinedAttackMissionIds.length > 0) {
    return `Joined ${joinedAttackMissionIds.join(", ")}`;
  }
  return mission.transactionHash ? `${mission.transactionHash.slice(0, 10)}...` : "Ready to share";
}

function missionReportText(mission: FleetMissionSummary): string {
  const joinedAttackMissionIds = mission.joinedAttackMissionIds ?? [];
  return [
    `Veydrift ${mission.missionType} #${mission.missionId}`,
    `Status: ${missionStatusLabel(mission.status)}`,
    `Route: planet ${mission.originPlanetId} -> planet ${mission.targetPlanetId}`,
    `Ships: ${formatShips(mission.ships)}`,
    `Cargo: ${formatCargo(mission.cargo)}`,
    `Fuel: ${formatResource(mission.fuelCost)} deuterium`,
    mission.attackGroupId ? `ACS group: ${mission.attackGroupId}` : null,
    joinedAttackMissionIds.length > 0 ? `Joined attacks: ${joinedAttackMissionIds.join(", ")}` : null,
    mission.transactionHash ? `Tx: ${mission.transactionHash}` : null,
  ].filter(Boolean).join("\n");
}

function copyMissionReport(mission: FleetMissionSummary): void {
  void globalThis.navigator?.clipboard?.writeText(missionReportText(mission));
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatResource(value: string): string {
  return Number(value).toLocaleString();
}

function shipLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
