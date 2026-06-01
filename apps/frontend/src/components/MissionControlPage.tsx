import { EyeOff, RefreshCw, Route, ShieldAlert, TimerReset } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import type { FleetMissionSummary, FleetMissionVisibilityResponse, OnChainResources } from "../walletFlow";
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
  protectedResources?: OnChainResources | null | undefined;
  raidableResources?: OnChainResources | null | undefined;
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
  protectedResources,
  raidableResources,
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
          <h2 className="mt-1 text-lg font-semibold text-white">Fleet Operations</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Contract-indexed missions, public resolvers, returns, and counterplay from the game contract event stream.
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

          <RaidProtectionPanel
            protectedResources={protectedResources}
            raidableResources={raidableResources}
          />

          {activeCount === 0 ? (
            <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
              No visible missions for this wallet. Launch transport, deploy, attack, harvest, or missile actions from Galaxy when the target action is contract-supported.
            </div>
          ) : null}

          {due.length > 0 ? (
            <MissionSection
              actionContext="due"
              canTransact={canTransact}
              missions={due}
              now={now}
              onCompleteReturn={onCompleteReturn}
              onCounterplay={onCounterplay}
              onRecall={onRecall}
              onResolve={onResolve}
              title="Due Public Resolution"
              tone="danger"
            />
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
              title="Incoming Hostile"
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
              title="Outgoing"
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
              title="Returning"
              tone="warning"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            <CapabilityPanel
              icon={<ShieldAlert aria-hidden="true" size={18} />}
              title="ACS and Intercept"
              body="Inbound attacks expose ACS defend and intercept launches when the wallet has an available combat ship."
            />
            <CapabilityPanel
              icon={<Route aria-hidden="true" size={18} />}
              title="Harvests and Saves"
              body="Recycler harvests, transport, deploy, and resource-save launches remain Galaxy actions because they need a target coordinate."
            />
            <CapabilityPanel
              icon={<TimerReset aria-hidden="true" size={18} />}
              title="Missiles and Moons"
              body="Missile and moon-chance entries appear here only after the indexed contract stream exposes them as mission records."
            />
            <CapabilityPanel
              icon={<EyeOff aria-hidden="true" size={18} />}
              title="No Spy Reports"
              body="Target intel is public contract state; Veydrift does not support espionage probes, scan missions, or hidden reveal reports."
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
      label: "Resolve",
      reason: due ? walletReason(canTransact) : "Mission has not arrived yet.",
    });
  }

  if (context === "outgoing" && mission.status === "Outbound") {
    actions.push({
      enabled: canTransact && !due,
      kind: "recall",
      label: "Recall",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact),
    });
  }

  if (context === "returning" && (mission.status === "Returning" || mission.status === "Recalled")) {
    actions.push({
      enabled: canTransact && returned,
      kind: "completeReturn",
      label: "Complete return",
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

function RaidProtectionPanel({
  protectedResources,
  raidableResources,
}: {
  protectedResources?: OnChainResources | null | undefined;
  raidableResources?: OnChainResources | null | undefined;
}) {
  if (!protectedResources && !raidableResources) return null;

  return (
    <section className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ResourceSummaryBlock
        label="Protected storage"
        resources={protectedResources}
      />
      <ResourceSummaryBlock
        label="Raid-exposed resources"
        resources={raidableResources}
      />
    </section>
  );
}

function ResourceSummaryBlock({
  label,
  resources,
}: {
  label: string;
  resources?: OnChainResources | null | undefined;
}) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-black/15 px-3 py-2">
      <div className="text-[0.68rem] font-semibold uppercase tracking-normal text-slate-500">{label}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-slate-200">
        {resources ? (
          <>
            <span>{formatResource(resources.metal)} Metal</span>
            <span>{formatResource(resources.crystal)} Crystal</span>
            <span>{formatResource(resources.deuterium)} Deut.</span>
          </>
        ) : (
          <span className="text-slate-500">Unavailable</span>
        )}
      </div>
    </div>
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
            {mission.originPlanetId} {"->"} {mission.targetPlanetId} / {mission.status}
          </p>
        </div>
        <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-300">
          Fuel {formatResource(mission.fuelCost)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <MissionDatum label="Arrival" value={formatDurationUntil(Number(mission.arrivalAt) * 1_000, now)} />
        <MissionDatum label="Return" value={formatDurationUntil(Number(mission.returnAt) * 1_000, now)} />
        <MissionDatum label="Cargo" value={formatCargo(mission.cargo)} />
        <MissionDatum label="Ships" value={formatShips(mission.ships)} />
      </dl>

      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map((action) => action.kind === "counterplay" ? (
            <span className="contents" key={action.kind}>
              <ActionButton
                action={{ ...action, label: "ACS defend" }}
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
      <dd className="mt-0.5 truncate text-slate-300">{value}</dd>
    </div>
  );
}

function CapabilityPanel({
  body,
  icon,
  title,
}: {
  body: string;
  icon: preact.ComponentChildren;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <div className="flex items-center gap-2 text-slate-200">
        <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
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
  return canTransact ? undefined : "Wallet or game contract unavailable.";
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

function formatResource(value: string): string {
  return Number(value).toLocaleString();
}

function shipLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
