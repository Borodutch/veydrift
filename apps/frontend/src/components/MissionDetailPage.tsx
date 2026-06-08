import { ArrowLeft, Check, RefreshCw, Share2, Swords } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import type { BattleReport, FleetMissionSummary, MissionDetailResponse } from "../walletFlow";
import { missionLifecycleActions, type MissionLifecycleAction } from "./MissionControlPage";
import { PageHeader, RefreshButton } from "./PageHeader";

type MissionActionContext = "due" | "incoming" | "outgoing" | "returning";

export type MissionDetailActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionShareCopyState = "copied" | "error" | "idle";

// Each recycler hauls 20,000 units of debris; used to estimate recyclers needed.
const RECYCLER_CARGO_CAPACITY = 20_000;

interface MissionDetailPageProps {
  account?: string | undefined;
  actionState: MissionDetailActionState;
  canTransact: boolean;
  copyState: MissionShareCopyState;
  detail?: MissionDetailResponse | undefined;
  error?: string | undefined;
  loading: boolean;
  missionId: string | null;
  now: number;
  onBack: () => void;
  onCompleteReturn: (missionId: string) => void;
  onCopyShareUrl: () => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
  onRetry: () => void;
  shareUrl: string;
}

export function MissionDetailPage({
  account,
  actionState,
  canTransact,
  copyState,
  detail,
  error,
  loading,
  missionId,
  now,
  onBack,
  onCompleteReturn,
  onCopyShareUrl,
  onCounterplay,
  onRecall,
  onResolve,
  onRetry,
  shareUrl,
}: MissionDetailPageProps) {
  const mission = detail?.mission;
  const report = detail?.battleReport ?? undefined;
  const copyLabel = copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy link";

  return (
    <section className="grid gap-4">
      <PageHeader
        actions={(
          <>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10" onClick={onBack} type="button">
              <ArrowLeft aria-hidden="true" size={15} />
              Mission Control
            </button>
            <RefreshButton loading={loading} onRefresh={onRetry} title="Refresh mission" />
            <button
              aria-label={copyLabel}
              aria-live="polite"
              className={`inline-flex h-9 w-9 items-center justify-center rounded border text-sm font-medium transition ${
                copyState === "copied"
                  ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
                  : copyState === "error"
                    ? "border-red-300/40 bg-red-400/15 text-red-100"
                    : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
              }`}
              onClick={onCopyShareUrl}
              title={copyLabel}
              type="button"
            >
              {copyState === "copied" ? <Check aria-hidden="true" size={15} /> : <Share2 aria-hidden="true" size={15} />}
            </button>
          </>
        )}
        subtitle="Shareable mission state, current stage, available orders, and combat report when the indexed battle log exposes one."
        title={missionId ? `Mission #${missionId}` : "Mission"}
      />

      {loading ? (
        <Notice>Loading mission...</Notice>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : mission ? (
        <>
          <MissionStageSummary account={account} mission={mission} now={now} />
          <MissionActions
            account={account}
            canTransact={canTransact}
            mission={mission}
            now={now}
            onCompleteReturn={onCompleteReturn}
            onCounterplay={onCounterplay}
            onRecall={onRecall}
            onResolve={onResolve}
          />
          {actionState.status !== "idle" ? (
            <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
              {actionState.label}
            </Notice>
          ) : null}
          <MissionFacts mission={mission} now={now} shareUrl={shareUrl} />
          <MissionBattleReport mission={mission} report={report} />
        </>
      ) : (
        <Notice>No mission selected.</Notice>
      )}
    </section>
  );
}

function MissionStageSummary({ account, mission, now }: { account?: string | undefined; mission: FleetMissionSummary; now: number }) {
  const stage = missionStage(mission, now);
  const relationship = missionRelationship(mission, account);
  return (
    <section className={`rounded-lg border p-4 ${stage.tone === "danger" ? "border-red-300/25 bg-red-400/10" : stage.tone === "warning" ? "border-amber-300/25 bg-amber-300/10" : "border-cyan-300/20 bg-cyan-300/10"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">{relationship}</p>
          <h3 className="mt-1 text-xl font-semibold text-white">{stage.label}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{stage.detail}</p>
        </div>
        <span className="rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm font-medium text-slate-200">
          {missionTypeLabel(mission.missionType)}
        </span>
      </div>
    </section>
  );
}

function MissionActions({
  account,
  canTransact,
  mission,
  now,
  onCompleteReturn,
  onCounterplay,
  onRecall,
  onResolve,
}: {
  account?: string | undefined;
  canTransact: boolean;
  mission: FleetMissionSummary;
  now: number;
  onCompleteReturn: (missionId: string) => void;
  onCounterplay: (missionId: string, mode: "acsDefend" | "intercept") => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string) => void;
}) {
  const context = missionActionContext(mission, now, account);
  const actions = missionLifecycleActions({ canTransact, context, mission, now })
    .filter((action) => action.kind !== "recall" || Boolean(mission.recallCost));

  if (actions.length === 0) {
    return (
      <Notice>
        No wallet action applies at this mission stage.
      </Notice>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Available Orders</h3>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => action.kind === "counterplay" ? (
          <span className="contents" key={action.kind}>
            <ActionButton action={{ ...action, label: "Group defend" }} onClick={() => onCounterplay(mission.missionId, "acsDefend")} />
            <ActionButton action={{ ...action, label: "Intercept" }} onClick={() => onCounterplay(mission.missionId, "intercept")} />
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
    </section>
  );
}

function MissionFacts({ mission, now, shareUrl }: { mission: FleetMissionSummary; now: number; shareUrl: string }) {
  const noFleetReturned = isNoFleetReturned(mission);
  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <Panel title="Route">
        <Row label="Origin" value={planetLabel(mission.originPlanet, mission.originPlanetId)} />
        <Row label="Target" value={planetLabel(mission.targetPlanet, mission.targetPlanetId)} />
        <Row label="Commander" value={shortHash(mission.owner)} />
        <Row label="Mission id" value={mission.missionId} />
      </Panel>
      <Panel title="Timing">
        <Row label="Arrival" value={formatMissionTime(mission.arrivalAt, now)} />
        {noFleetReturned ? (
          <Row label="Return" value="Completed, no fleet returned" />
        ) : (
          <Row label="Return" value={formatMissionTime(mission.returnAt, now)} />
        )}
        <Row label="Needs resolution" value={mission.needsResolution ? "Yes" : "No"} />
        <Row label="Share URL" value={shareUrl || "Available after navigation"} />
      </Panel>
      <Panel title="Fleet And Cargo">
        <Row label="Ships" value={formatShips(mission.ships)} />
        <Row label="Cargo" value={formatResources(mission.cargo)} />
        <Row label="Fuel cost" value={`${formatResource(mission.fuelCost)} deuterium`} />
        <Row label="Recall cost" value={mission.recallCost ? `${formatResource(mission.recallCost)} deuterium` : "Not recallable"} />
      </Panel>
    </section>
  );
}

function MissionBattleReport({
  mission,
  report,
}: {
  mission: FleetMissionSummary;
  report?: BattleReport | undefined;
}) {
  if (!isCombatMission(mission)) {
    return (
      <Notice>
        This is a {missionTypeLabel(mission.missionType).toLowerCase()} mission, so there is no combat battle report section.
      </Notice>
    );
  }

  if (!report) {
    return (
      <Notice tone={mission.needsResolution ? "warning" : "neutral"}>
        {mission.needsResolution
          ? "Combat is due or resolving; the indexed battle report is not available yet."
          : "No indexed battle report is available for this combat mission yet."}
      </Notice>
    );
  }

  const outcome = battleOutcomeSummary(report.outcome);
  const debrisTotal = Number(report.debris.metal) + Number(report.debris.crystal);
  const recyclersNeeded = debrisTotal > 0 ? Math.ceil(debrisTotal / RECYCLER_CARGO_CAPACITY) : 0;

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
          <Swords aria-hidden="true" size={17} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-white">Battle Report</h3>
          <p className="text-xs text-slate-500">Reconstructed from the on-chain combat log for mission #{report.missionId}.</p>
        </div>
      </div>

      <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${outcome.className}`}>
        <p className="text-base font-semibold">{outcome.label}</p>
        <p className="text-xs font-medium uppercase tracking-[0.14em] opacity-80">{report.rounds} {report.rounds === 1 ? "round" : "rounds"} fought</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Combatants">
          <Row label="Attacker" value={shortHash(report.attacker)} />
          <Row label="Defender" value={`Planet #${report.targetPlanetId}`} />
          <Row label="Outcome" value={outcome.label} />
          <Row label="Rounds fought" value={report.rounds.toString()} />
        </Panel>
        <Panel title="Attacker Fleet">
          <Row label="Combat ships" value={formatShipsByKind(mission.ships, "combat")} />
          <Row label="Civil ships" value={formatShipsByKind(mission.ships, "civil")} />
          <Row label="Full fleet" value={formatShips(mission.ships)} />
        </Panel>
        <Panel title="Fleet Losses">
          <Row label="Attacker losses" value={formatResources(report.attackerLosses)} />
          <Row label="Defender losses" value={formatResources(report.defenderLosses)} />
        </Panel>
        <Panel title="Plunder And Debris">
          <Row label="Loot plundered" value={formatResources(report.loot)} />
          <Row label="Debris field" value={`${formatResource(report.debris.metal)} metal / ${formatResource(report.debris.crystal)} crystal`} />
          <Row
            label="Recyclers to clear debris"
            value={recyclersNeeded > 0 ? `${formatResource(recyclersNeeded.toString())} (${formatResource(debrisTotal.toString())} debris)` : "No debris field"}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Round-by-round combat</p>
        <div className="grid gap-2">
          {report.roundReports.length === 0 ? (
            <Notice>No round-by-round snapshots were indexed for this battle.</Notice>
          ) : report.roundReports.map((round) => (
            <article className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-3 md:grid-cols-[5rem_1fr_1fr]" key={round.round}>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Round</p>
                <p className="mt-0.5 text-sm font-semibold text-white">{round.round}</p>
              </div>
              <Datum label="Attacker firepower / losses" value={`${formatResource(round.attackerUnits)} units fired; ${formatResources(round.attackerLosses)} lost`} />
              <Datum label="Defender firepower / losses" value={`${formatResource(round.defenderUnits)} units fired; ${formatResources(round.defenderLosses)} lost`} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActionButton({ action, onClick }: { action: MissionLifecycleAction; onClick: () => void }) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded border px-3 text-sm font-medium transition ${
        action.enabled
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
          : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
      }`}
      disabled={!action.enabled}
      onClick={onClick}
      title={action.enabled ? action.label : action.reason}
      type="button"
    >
      <RefreshCw aria-hidden="true" size={14} />
      {action.label}
    </button>
  );
}

function Panel({ children, title }: { children: preact.ComponentChildren; title: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      <table className="w-full border-collapse">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

// Compact two-column table row for a Panel: muted label on the left, value on the right.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-white/5 align-top first:border-t-0">
      <th scope="row" className="w-px whitespace-nowrap py-1.5 pr-4 text-left align-top text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</th>
      <td className="py-1.5 text-left align-top break-words text-sm text-slate-300">{value}</td>
    </tr>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-300">{value}</dd>
    </div>
  );
}

function Notice({ children, tone = "neutral" }: { children: preact.ComponentChildren; tone?: "danger" | "info" | "neutral" | "success" | "warning" }) {
  const className = tone === "danger"
    ? "border-red-300/25 bg-red-400/10 text-red-100"
    : tone === "warning"
      ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
      : tone === "success"
        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
        : tone === "info"
          ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-[#101624] text-slate-400";
  return <div className={`rounded-lg border p-4 text-sm ${className}`}>{children}</div>;
}

function missionStage(mission: FleetMissionSummary, now: number): { detail: string; label: string; tone: "danger" | "neutral" | "warning" } {
  if (isNoFleetReturned(mission)) {
    return { detail: "The battle is complete and no returning fleet leg exists.", label: "Completed, no fleet returned", tone: "neutral" };
  }
  if (mission.status === "Outbound" && isMissionDue(mission, now)) {
    return {
      detail: mission.needsResolution ? "The mission has reached the target and needs resolution." : "The mission has reached its target; the backend may still be indexing final state.",
      label: mission.needsResolution ? "Needs resolution" : "Arrived",
      tone: "danger",
    };
  }
  if (mission.status === "Outbound") {
    return { detail: `Arrives ${formatMissionTime(mission.arrivalAt, now)}.`, label: "Outbound", tone: "neutral" };
  }
  if (mission.status === "Returning" || mission.status === "Recalled") {
    return { detail: `Return leg lands ${formatMissionTime(mission.returnAt, now)}.`, label: mission.status, tone: "warning" };
  }
  return { detail: "The mission has no active outbound or return leg.", label: mission.status || "Completed", tone: "neutral" };
}

function missionRelationship(mission: FleetMissionSummary, account?: string | undefined): string {
  if (!account) return "Public mission";
  return mission.owner.toLowerCase() === account.toLowerCase() ? "Your mission" : "Visible mission";
}

function missionActionContext(mission: FleetMissionSummary, now: number, account?: string | undefined): MissionActionContext {
  if (mission.status === "Returning" || mission.status === "Recalled") return "returning";
  if (mission.status === "Outbound" && isMissionDue(mission, now)) return "due";
  if (account && mission.owner.toLowerCase() === account.toLowerCase()) return "outgoing";
  return "incoming";
}

function isMissionDue(mission: FleetMissionSummary, now: number): boolean {
  const arrival = timestampToMs(mission.arrivalAt);
  return arrival != null && arrival <= now;
}

function isNoFleetReturned(mission: FleetMissionSummary): boolean {
  return !["Outbound", "Returning", "Recalled"].includes(mission.status) && Object.values(mission.ships).every((value) => Number(value) <= 0);
}

function isCombatMission(mission: FleetMissionSummary): boolean {
  return ["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(mission.missionType);
}

function formatMissionTime(value: string, now: number): string {
  const ms = timestampToMs(value);
  if (ms == null || ms <= 0) return "Not scheduled";
  const absolute = formatUserTimestamp(value);
  const relative = formatDurationUntil(ms, now);
  return `${absolute} (${relative})`;
}

function planetLabel(planet: FleetMissionSummary["originPlanet"], fallbackId: string): string {
  if (!planet) return `Planet #${fallbackId}`;
  const name = planet.name ? `${planet.name} ` : "";
  return `${name}[${planet.coordinates}]`;
}

function missionTypeLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function battleOutcomeSummary(outcome: BattleReport["outcome"]): { className: string; label: string } {
  if (outcome === "AttackerWin") {
    return { className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100", label: "Attacker victory" };
  }
  if (outcome === "DefenderWin") {
    return { className: "border-red-300/30 bg-red-400/10 text-red-100", label: "Defender victory" };
  }
  return { className: "border-amber-300/30 bg-amber-300/10 text-amber-100", label: "Draw" };
}

function formatResources(resources: { metal: string; crystal: string; deuterium?: string }): string {
  const deuterium = resources.deuterium ? ` / ${formatResource(resources.deuterium)} deuterium` : "";
  return `${formatResource(resources.metal)} metal / ${formatResource(resources.crystal)} crystal${deuterium}`;
}

function formatResource(value: string): string {
  return Number(value).toLocaleString();
}

const shipLabels: Record<string, string> = {
  battlecruiser: "Battlecruiser",
  battleship: "Battleship",
  bomber: "Bomber",
  colonyShip: "Colony Ship",
  cruiser: "Cruiser",
  deathstar: "Deathstar",
  destroyer: "Destroyer",
  espionageProbe: "Espionage Probe",
  heavyFighter: "Heavy Fighter",
  largeCargo: "Large Cargo",
  lightFighter: "Light Fighter",
  recycler: "Recycler",
  smallCargo: "Small Cargo",
  solarSatellite: "Solar Satellite",
};

const civilShipKeys = new Set(["smallCargo", "largeCargo", "colonyShip", "recycler", "espionageProbe", "solarSatellite"]);

function formatShips(ships: Record<string, string>): string {
  const entries = Object.entries(ships)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `${shipLabels[key] ?? missionTypeLabel(key)} x${formatResource(count)}`);
  return entries.length > 0 ? entries.join(", ") : "None";
}

function formatShipsByKind(ships: Record<string, string>, kind: "civil" | "combat"): string {
  const filtered = Object.fromEntries(
    Object.entries(ships).filter(([key]) => kind === "civil" ? civilShipKeys.has(key) : !civilShipKeys.has(key))
  );
  return formatShips(filtered);
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}
