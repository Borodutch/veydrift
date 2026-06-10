import { ArrowLeft, Check, RefreshCw, Share2, Swords } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { defenseAssetByKey, shipAssetByKey } from "../gameAssets";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { defenseCatalog, shipCatalog, type ShipKey } from "../playableMvp";
import type { Coordinates } from "../types";
import { type BattleReport, type DefenderPlanetState, type FleetMissionSummary, type MissionDetailResponse } from "../walletFlow";
import { missionLifecycleActions, type MissionLifecycleAction } from "./MissionControlPage";
import {
  MissionRouteCell,
  type MissionPlanetIdentity,
  missionEndpoint,
  missionProgressPercent,
  missionRouteLeg,
} from "./missionRoute";
import { PageHeader, RefreshButton } from "./PageHeader";

type MissionActionContext = "due" | "incoming" | "outgoing" | "returning";

export type MissionDetailActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionShareCopyState = "copied" | "error" | "idle";

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
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectPlayer: (wallet: string) => void;
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
  onSelectCoordinates,
  onSelectPlayer,
}: MissionDetailPageProps) {
  const mission = detail?.mission;
  const report = detail?.battleReport ?? undefined;
  const copyLabel = copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy link";

  return (
    <section className="grid gap-4">
      <PageHeader
        beforeTitle={(
          <button className="mb-3 inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            Mission Control
          </button>
        )}
        actions={(
          <>
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
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            {missionId ? `Mission #${missionId}` : "Mission"}
            {mission ? (
              <span className="rounded border border-white/10 bg-black/20 px-2.5 py-1 text-xs font-medium text-slate-200">
                {missionTypeLabel(mission.missionType)}
              </span>
            ) : null}
          </span>
        )}
      />

      {loading ? (
        <Notice>Loading mission...</Notice>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : mission ? (
        <>
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
          <MissionFacts
            hideFleetAndCargo={Boolean(report)}
            mission={mission}
            now={now}
            onSelectCoordinates={onSelectCoordinates}
            onSelectPlayer={onSelectPlayer}
          />
          <MissionBattleReport defenderState={detail?.defenderPlanetState ?? undefined} mission={mission} report={report} />
        </>
      ) : (
        <Notice>No mission selected.</Notice>
      )}
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

  // Hide the section entirely when no wallet action applies at this stage.
  if (actions.length === 0) {
    return null;
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

function MissionFacts({
  hideFleetAndCargo,
  mission,
  now,
  onSelectCoordinates,
  onSelectPlayer,
}: {
  hideFleetAndCargo: boolean;
  mission: FleetMissionSummary;
  now: number;
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectPlayer: (wallet: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <MissionRoute
        mission={mission}
        now={now}
        onSelectCoordinates={onSelectCoordinates}
        onSelectPlayer={onSelectPlayer}
      />
      {/* When a battle report renders, the fleet and cargo are folded into the attacker side of the
          report, so the standalone panel is suppressed to avoid duplicating it. Non-combat / unresolved
          missions keep it as the only place this fleet/cargo detail is shown. */}
      {hideFleetAndCargo ? null : (
        <Panel title="Fleet And Cargo">
          <Row label="Ships" value={<UnitIcons units={shipUnits(mission.ships)} />} />
          <Row label="Cargo" value={formatResources(mission.cargo)} />
          <Row label="Fuel cost" value={`${formatResource(mission.fuelCost)} deuterium`} />
          {showsRecallCost(mission) ? (
            <Row label="Recall cost" value={mission.recallCost ? `${formatResource(mission.recallCost)} deuterium` : "Not recallable"} />
          ) : null}
        </Panel>
      )}
    </div>
  );
}

// VEY-KANEO-426: the Mission Detail Route now renders through the shared `MissionRouteCell` so it
// matches Mission Control exactly — the same origin -> target layout, directional progress-filled
// arrow, real planet art, clickable planet name, and clickable commander. The detail page keeps its
// per-leg timing (return beside the origin, arrival beside the target) as a strip beneath the shared
// hero. Navigation stays in-app: the cell calls back through `onSelectCoordinates`/`onSelectPlayer`
// rather than emitting hash links. The Mission ID field is intentionally dropped (it shows in the
// page header).
const EMPTY_PLANET_LOOKUP: ReadonlyMap<string, MissionPlanetIdentity> = new Map();

function MissionRoute({
  mission,
  now,
  onSelectCoordinates,
  onSelectPlayer,
}: {
  mission: FleetMissionSummary;
  now: number;
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectPlayer: (wallet: string) => void;
}) {
  // The mission carries its own origin/target planet refs, so an empty shared lookup is enough —
  // `missionEndpoint` resolves the name, coordinates, commander, and planet art straight from them.
  const origin = missionEndpoint(mission, "origin", EMPTY_PLANET_LOOKUP);
  const target = missionEndpoint(mission, "target", EMPTY_PLANET_LOOKUP);
  const noFleetReturned = isNoFleetReturned(mission);
  const originTiming = noFleetReturned
    ? { label: "Return", value: "Completed, no fleet returned" }
    : missionLegTiming(mission.returnAt, now, "Return", "Returned");
  const targetTiming = missionLegTiming(mission.arrivalAt, now, "Arrival", "Arrived");

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Route</h3>
      <MissionRouteCell
        direction={missionRouteLeg(mission.status)}
        onSelectCoordinates={onSelectCoordinates}
        onSelectPlayer={onSelectPlayer}
        origin={origin}
        progressPercent={missionProgressPercent(mission, now)}
        target={target}
      />
      {/* Detail-only leg timing kept beneath the shared route hero: return reads beside the origin,
          arrival beside the target (VEY-405 / VEY-411 copy retained). */}
      <div className="mt-3 grid gap-3 border-t border-white/5 pt-3 sm:grid-cols-2">
        <RouteLegTiming caption="Origin" timing={originTiming} />
        <RouteLegTiming align="right" caption="Target" timing={targetTiming} />
      </div>
    </section>
  );
}

// A single leg's timing line under the route hero. A completed leg passes a null `label`, collapsing
// to just the past-tense word ("Returned"/"Arrived") plus a compact stamp; an in-flight leg keeps its
// "Return"/"Arrival" caption with the absolute time and countdown.
function RouteLegTiming({
  align = "left",
  caption,
  timing,
}: {
  align?: "left" | "right";
  caption: string;
  timing: { label: string | null; value: string; subtext?: string };
}) {
  return (
    <div className={`text-xs text-slate-400 ${align === "right" ? "sm:text-right" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{caption}</p>
      <p>
        {timing.label ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{timing.label} </span>
        ) : null}
        <span className="break-words text-slate-300">{timing.value}</span>
      </p>
      {timing.subtext ? <p className="mt-0.5 text-[11px] text-slate-500">{timing.subtext}</p> : null}
    </div>
  );
}

function MissionBattleReport({
  defenderState,
  mission,
  report,
}: {
  defenderState?: DefenderPlanetState | undefined;
  mission: FleetMissionSummary;
  report?: BattleReport | undefined;
}) {
  if (!isCombatMission(mission)) {
    return null;
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
  const recyclersNeeded = recyclersForDebris(report.debris);
  // Defender fleet/defenses come from the indexed target-planet composition (ShipCountChanged +
  // defense events) rather than the single AttackBattleResolved event. For a freshly-resolved
  // battle this is the surviving force; we show "None" when the planet had no fleet/defenses, and
  // fall back to a precise caveat only when the target planet is not charted in the indexed state.
  const defenderFleetUnits = compositionUnits(defenderState?.fleet, shipCatalog, shipAssetByKey);
  const defenderDefenseUnits = compositionUnits(defenderState?.defenses, defenseCatalog, defenseAssetByKey);

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
          <Swords aria-hidden="true" size={17} />
        </span>
        <h3 className="text-sm font-semibold text-white">Battle Report</h3>
      </div>

      <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${outcome.className}`}>
        <p className="text-base font-semibold">{outcome.label}</p>
        <p className="text-xs font-medium uppercase tracking-[0.14em] opacity-80">{report.rounds} {report.rounds === 1 ? "round" : "rounds"} fought</p>
      </div>

      {/* Two-sided report modelled on the classic combat report: the attacker column folds in the
          offensive fleet and cargo it carried, its losses, and the loot it grabbed; the defender
          column carries its losses and surviving composition. The origin/target commanders are not
          repeated here — they already render in the Route hero above. Fields the on-chain log does not
          expose (defender composition, loot retained) are flagged compactly rather than fabricated.
          Debris is shown on its own below. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Attacker">
          <Row label="Combat ships" value={<UnitIcons units={shipUnitsByKind(mission.ships, "combat")} />} />
          <Row label="Civil ships" value={<UnitIcons units={shipUnitsByKind(mission.ships, "civil")} />} />
          <Row label="Cargo carried" value={formatResources(mission.cargo)} />
          <Row label="Fleet losses" value={formatResources(report.attackerLosses)} />
          <Row label="Loot grabbed" value={formatResources(report.loot)} />
        </Panel>
        <Panel title="Defender">
          <Row label="Fleet losses" value={formatResources(report.defenderLosses)} />
          {/* Fleet/defenses are the defender planet's indexed composition (surviving force). "None"
              when the planet had no fleet/defenses; a precise caveat only when it isn't charted. */}
          {defenderState ? (
            defenderFleetUnits.length > 0 || defenderDefenseUnits.length > 0 ? (
              <>
                <Row label="Fleet" value={<UnitIcons units={defenderFleetUnits} />} />
                <Row label="Defenses" value={<UnitIcons units={defenderDefenseUnits} />} />
              </>
            ) : (
              <Row label="Fleet / defenses" value="None" />
            )
          ) : (
            <Row label="Fleet / defenses" value="The defender planet isn't charted in the indexed state, so its surviving composition can't be derived." />
          )}
        </Panel>
      </div>

      <div className="mt-3">
        <Panel title="Debris Field">
          <Row label="Debris created" value={`${formatResource(report.debris.metal)} metal / ${formatResource(report.debris.crystal)} crystal`} />
          <Row label="Recyclers needed" value={recyclersNeeded > 0 ? `~${formatResource(String(recyclersNeeded))} (20,000 cargo each)` : "None"} />
        </Panel>
      </div>

      {/* Only render the round-by-round block when the indexed log actually exposes snapshots. */}
      {report.roundReports.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Round-by-round combat</p>
          <div className="grid gap-2">
            {report.roundReports.map((round) => (
              <article className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-3 md:grid-cols-[5rem_1fr_1fr]" key={round.round}>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Round</p>
                  <p className="mt-0.5 text-sm font-semibold text-white">{round.round}</p>
                </div>
                {/* The on-chain CombatRoundResolved event reports the units left standing at the end of
                    the round, not a count of shots fired, so label it faithfully as "units remaining". */}
                <Datum label="Attacker units / losses" value={`${formatResource(round.attackerUnits)} units remaining; ${formatResources(round.attackerLosses)} lost`} />
                <Datum label="Defender units / losses" value={`${formatResource(round.defenderUnits)} units remaining; ${formatResources(round.defenderLosses)} lost`} />
              </article>
            ))}
          </div>
        </div>
      ) : null}
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
function Row({ label, value }: { label: string; value: preact.ComponentChildren }) {
  return (
    <tr className="border-t border-white/5 align-middle first:border-t-0">
      <th scope="row" className="w-px whitespace-nowrap py-1.5 pr-4 text-left align-middle text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</th>
      <td className="py-1.5 text-left align-middle break-words text-sm text-slate-300">{value}</td>
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

// VEY-KANEO-409: the recall cost only matters while a fleet is still in flight — it can be recalled
// (Outbound), is on the way out (Outbound), or has already been recalled and is heading home
// (Recalled). Once a mission has finished without being recalled, the row only ever reads
// "Not recallable", which is pure noise, so it is hidden. Returning fleets are still in transit and
// keep the row. A recalled fleet keeps it explicitly even in the unexpected case its status reads as
// finished.
function showsRecallCost(mission: FleetMissionSummary): boolean {
  if (mission.status === "Recalled") return true;
  return ["Outbound", "Returning"].includes(mission.status);
}

function isCombatMission(mission: FleetMissionSummary): boolean {
  return ["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(mission.missionType);
}

// Timing shown beside a route endpoint. A completed leg collapses to a single
// past-tense word (origin "Returned", target "Arrived") with the moment it
// happened as compact subtext beneath it — e.g. "Jun 7, 3:40 PM" — instead of the
// old verbose inline string with a "(Ready)" suffix. A leg still in flight keeps
// its caption plus absolute time and ETA.
function missionLegTiming(
  value: string,
  now: number,
  label: string,
  pastLabel: string,
): { label: string | null; value: string; subtext?: string } {
  const ms = timestampToMs(value);
  if (ms != null && ms > 0 && ms <= now) {
    return { label: null, value: pastLabel, subtext: formatCompactMissionTime(value) };
  }
  return { label, value: formatMissionTime(value, now) };
}

// Short "month day, time" stamp (e.g. "Jun 7, 3:40 PM") used as muted subtext under
// a completed leg's past-tense word. The short month/day and the clock are formatted
// separately and joined with a comma so the result stays in this compact form rather
// than the locale's combined "Jun 7 at 3:40 PM" connector. Only called for legs with a
// valid timestamp, so it always returns a concrete string rather than a placeholder.
function formatCompactMissionTime(value: string): string {
  const date = formatUserTimestamp(value, { month: "short", day: "numeric" });
  const time = formatUserTimestamp(value, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

function formatMissionTime(value: string, now: number): string {
  const ms = timestampToMs(value);
  if (ms == null || ms <= 0) return "Not scheduled";
  const absolute = formatUserTimestamp(value);
  const relative = formatDurationUntil(ms, now);
  return `${absolute} (${relative})`;
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

// A recycler carries 20,000 units of cargo, so the fleet needed to sweep a debris field is the
// combined metal + crystal divided by that capacity, rounded up. Shown compactly next to the debris
// total rather than as a separate verbose "recyclers to clean debris" section.
const RECYCLER_CARGO_CAPACITY = 20_000;

function recyclersForDebris(debris: { crystal: string; metal: string }): number {
  const total = Number(debris.metal) + Number(debris.crystal);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / RECYCLER_CARGO_CAPACITY);
}

// A single resolved unit (ship or defense) for the icon list: the catalog label, its count, and the
// generated game art when one is mapped. `asset` is optional so unmapped/legacy keys degrade to a
// text label instead of a broken image.
type UnitItem = { key: string; label: string; count: number; asset?: string | undefined };

// Compact icon row used across the Battle Report for combat ships, civil ships, fleet, and defenses:
// small unit art with an "×N" count, mirroring Mission Control's FleetIcons. Hovering a chip shows
// the unit name and count; units without mapped art fall back to a text label. Empty lists render a
// muted "None" so the report still reads cleanly when a side fielded nothing.
function UnitIcons({ units }: { units: UnitItem[] }) {
  if (units.length === 0) return <span className="text-slate-500">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {units.map((unit) => {
        const label = `${unit.label} ×${unit.count.toLocaleString()}`;
        return (
          <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1 py-0.5" key={unit.key} title={label}>
            {unit.asset ? (
              <img alt="" className="h-5 w-5 shrink-0 rounded object-contain" loading="lazy" src={unit.asset} />
            ) : (
              <span className="text-[10px] text-slate-300">{unit.label}</span>
            )}
            <span className="text-[11px] font-medium tabular-nums text-slate-200">{`×${unit.count.toLocaleString()}`}</span>
          </span>
        );
      })}
    </div>
  );
}

// Resolves an indexed `{ id, count }` composition (ships or defenses) into icon-ready units using the
// playable catalog. Mirrors how PlanetDetail's publicStateRows resolves catalog entries (id, falling
// back to catalog index). Zero counts are dropped; the matched catalog key supplies the generated art.
function compositionUnits(
  rows: Array<{ id: number; count: number }> | undefined,
  catalog: readonly { id: number; key: string; label: string }[],
  assetByKey: Record<string, string>
): UnitItem[] {
  return (rows ?? [])
    .filter((row) => row.count > 0)
    .map((row, index) => {
      const item = catalog.find((entry, catalogIndex) => (entry.id ?? catalogIndex) === row.id);
      return {
        key: item?.key ?? `id-${row.id}-${index}`,
        label: item?.label ?? `ID ${row.id}`,
        count: row.count,
        asset: item ? assetByKey[item.key] : undefined,
      };
    });
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

// Resolves a ShipKey-keyed fleet (mission.ships) into icon-ready units, dropping zero counts and
// attaching the generated ship art when one is mapped.
function shipUnits(ships: Record<string, string>): UnitItem[] {
  return Object.entries(ships)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => ({
      key,
      label: shipLabels[key] ?? missionTypeLabel(key),
      count: Number(count),
      asset: shipAssetByKey[key as ShipKey],
    }));
}

// Narrows the resolved ship units to the combat or civil class for the attacker's two-row breakdown.
function shipUnitsByKind(ships: Record<string, string>, kind: "civil" | "combat"): UnitItem[] {
  return shipUnits(ships).filter((unit) => kind === "civil" ? civilShipKeys.has(unit.key) : !civilShipKeys.has(unit.key));
}
