import { ArrowLeft, RefreshCw, Share2, Swords } from "lucide-preact";

import { formatDurationUntil } from "../durationFormat";
import { defenseAssetByKey, shipAssetByKey } from "../gameAssets";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { defenseCatalog, shipCatalog, type ShipKey } from "../playableMvp";
import type { Coordinates } from "../types";
import { type BattleReport, type BattleReportParticipant, type DefenderPlanetState, type FleetMissionSummary, type FleetMissionVisibilityResponse, type MissionDetailResponse, type QueueStateResponse, type TargetCombatIntel } from "../walletFlow";
import { isFleetRecallable, missionLifecycleActions, type MissionLifecycleAction } from "./MissionControlPage";
import {
  MissionRouteCell,
  type MissionPlanetIdentity,
  missionEndpoint,
  missionProgressPercent,
  missionRouteLeg,
  shortAddress,
} from "./missionRoute";
import { PageHeader, RefreshButton } from "./PageHeader";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

type MissionActionContext = "incoming" | "observer" | "outgoing" | "returning";

export type MissionDetailActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface MissionDetailPageProps {
  actionState: MissionDetailActionState;
  canTransact: boolean;
  detail?: MissionDetailResponse | undefined;
  error?: string | undefined;
  // The wallet-scoped mission classification the Mission Control list is built from. The detail page
  // reuses it so both screens authorize the exact same orders for the same fleet (VEY-KANEO-424).
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  loading: boolean;
  missionId: string | null;
  now: number;
  onBack: () => void;  // Opens the in-app battle-report share dialog (link + copy + social targets). The control is a
  // plain button, so it presents the dialog and never navigates the viewer away (VEY-KANEO-339).
  onShareReport: () => void;
  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onRecall: (missionId: string) => void;
  onRetry: () => void;
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer: (wallet: string) => void;
}

export function MissionDetailPage({
  actionState,
  canTransact,
  detail,
  error,
  fleetVisibility,
  loading,
  missionId,
  now,
  onBack,
  onShareReport,
  onCounterplay,
  onRecall,
  onRetry,
  onSelectCoordinates,
  onSelectMoon,
  onSelectPlayer,
}: MissionDetailPageProps) {
  const mission = detail?.mission;
  const report = detail?.battleReport ?? undefined;

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
              aria-label="Share battle report"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/20"
              onClick={(event) => {
                // A plain button never navigates, but stop the event before any ancestor handler can
                // act on it — the QA symptom was the viewer dropping to the overview on share click.
                event.preventDefault();
                event.stopPropagation();
                onShareReport();
              }}
              title="Share battle report"
              type="button"
            >
              <Share2 aria-hidden="true" size={15} />
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
        isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="danger">{error}</Notice>
      ) : mission ? (
        <>
          <MissionActions
            canTransact={canTransact}
            fleetVisibility={fleetVisibility}
            mission={mission}
            now={now}
            onCounterplay={onCounterplay}
            onRecall={onRecall}
          />
          {actionState.status !== "idle" ? (
            <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
              {actionState.label}
            </Notice>
          ) : null}
          <MissionFacts
            fleetVisibility={fleetVisibility}
            reportOutcome={report?.outcome}
            hideFleetAndCargo={Boolean(report)}
            mission={mission}
            now={now}
            onSelectCoordinates={onSelectCoordinates}
            onSelectMoon={onSelectMoon}
            onSelectPlayer={onSelectPlayer}
          />
          <TargetCombatIntelPanel intel={detail?.targetCombatIntel} mission={mission} now={now} />
          <MissionBattleReport
            defenderState={detail?.defenderPlanetState ?? undefined}
            materialization={detail?.battleReportMaterialization}
            mission={mission}
            now={now}
            report={report}
          />
        </>
      ) : (
        <Notice>No mission selected.</Notice>
      )}
    </section>
  );
}

function TargetCombatIntelPanel({
  intel,
  mission,
  now,
}: {
  intel: TargetCombatIntel | null | undefined;
  mission: FleetMissionSummary;
  now: number;
}) {
  if (!isCombatMission(mission) || intel === undefined) return null;

  if (!intel) {
    return (
      <Panel title="Target Combat Intel">
        <Row label="Status" value="The target planet isn't charted in the indexed state, so its combat intelligence can't be derived." />
      </Panel>
    );
  }

  return (
    <Panel title="Target Combat Intel">
      <Row label="Combat power" value={formatResource(intel.combatPower)} />
      <Row label="Combat ships" value={<TacticalUnitIcons units={intel.combatShips.units} catalog={shipCatalog} assetByKey={shipAssetByKey} />} />
      <Row label="Defenses" value={<TacticalUnitIcons units={intel.defenses.units} catalog={defenseCatalog} assetByKey={defenseAssetByKey} />} />
      <Row label="Defense queue" value={queueLabel(intel.queues.defense, defenseCatalog, now)} />
      <Row label="Ship queue" value={queueLabel(intel.queues.ship, shipCatalog, now)} />
      <Row label="Target traffic" value={<TargetMissionTraffic missions={intel.activeMissions} now={now} />} />
    </Panel>
  );
}

function TargetMissionTraffic({
  missions,
  now,
}: {
  missions: FleetMissionSummary[];
  now: number;
}) {
  if (missions.length === 0) return <>None</>;
  return (
    <div className="grid gap-1">
      {missions.map((entry) => (
        <div className="min-w-0" key={entry.missionId}>
          <span className="font-medium text-slate-200">{missionTypeLabel(entry.missionType)} #{entry.missionId}</span>
          <span className="text-slate-500"> · </span>
          <span>{shortAddress(entry.owner)}</span>
          <span className="text-slate-500"> · </span>
          <span>{entry.status}</span>
          <span className="text-slate-500"> · </span>
          <span>{missionTrafficTiming(entry, now)}</span>
        </div>
      ))}
    </div>
  );
}

function MissionActions({
  canTransact,
  fleetVisibility,
  mission,
  now,  onCounterplay,
  onRecall,
}: {
  canTransact: boolean;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  mission: FleetMissionSummary;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onRecall: (missionId: string) => void;
}) {
  const context = missionActionContext(mission, fleetVisibility);
  // Which orders show is decided by the same wallet-scoped classification the Mission Control list
  // uses, so the two screens always agree (VEY-KANEO-424). It must NOT be gated on mission.recallCost:
  // that field is only emitted by FleetMissionRecalled, so a still-recallable Outbound fleet would
  // carry a null cost and lose its Recall button. The backend now projects the cost for Outbound
  // fleets, and the cost row below tolerates a null cost regardless.
  const actions = missionLifecycleActions({ canTransact, context, mission, now });

  // Hide the section entirely when no wallet action applies at this stage.
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Available Orders</h3>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => action.kind === "counterplay" ? (
          <ActionButton action={{ ...action, label: "Group defend" }} key={action.kind} onClick={() => onCounterplay(mission, "acsDefend")} />
        ) : (
          <ActionButton
            action={action}
            key={action.kind}
            onClick={() => {
              if (action.kind === "recall") onRecall(mission.missionId);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function MissionFacts({
  fleetVisibility,
  hideFleetAndCargo,
  mission,
  now,
  onSelectCoordinates,
  onSelectMoon,
  onSelectPlayer,
  reportOutcome,
}: {
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  hideFleetAndCargo: boolean;
  mission: FleetMissionSummary;
  now: number;
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer: (wallet: string) => void;
  reportOutcome?: BattleReport["outcome"] | undefined;
}) {
  // The recall-cost row is authorized by the same wallet-scoped classification as the Recall button,
  // so the two never contradict each other (VEY-KANEO-424).
  const context = missionActionContext(mission, fleetVisibility);
  return (
    <div className="grid gap-3">
      <MissionRoute
        mission={mission}
        now={now}
        onSelectCoordinates={onSelectCoordinates}
        onSelectMoon={onSelectMoon}
        onSelectPlayer={onSelectPlayer}
        reportOutcome={reportOutcome}
      />
      {/* When a battle report renders, the fleet and cargo are folded into the attacker side of the
          report, so the standalone panel is suppressed to avoid duplicating it. Non-combat / unresolved
          missions keep it as the only place this fleet/cargo detail is shown. */}
      {hideFleetAndCargo ? null : (
        <Panel title="Fleet And Cargo">
          <Row label="Ships" value={<UnitIcons units={shipUnits(mission.ships)} />} />
          <Row label="Cargo" value={formatResources(mission.cargo)} />
          {mission.missionType === "Harvest" ? (
            <Row label="Debris collected" value={mission.returnCargo ? formatResources(mission.returnCargo) : "Unavailable for legacy harvest reports."} />
          ) : null}
          <Row label="Fuel cost" value={`${formatResource(mission.fuelCost)} deuterium`} />
          {showsRecallCost(mission, context) ? (
            <Row label="Recall cost" value={recallCostLabel(mission, now)} />
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
// hero. Navigation stays in-app: the cell calls back through
// `onSelectCoordinates`/`onSelectMoon`/`onSelectPlayer` rather than emitting hash links. The Mission ID field is intentionally dropped (it shows in the
// page header).
const EMPTY_PLANET_LOOKUP: ReadonlyMap<string, MissionPlanetIdentity> = new Map();

function MissionRoute({
  mission,
  now,
  onSelectCoordinates,
  onSelectMoon,
  onSelectPlayer,
  reportOutcome,
}: {
  mission: FleetMissionSummary;
  now: number;
  onSelectCoordinates: (coords: Coordinates) => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer: (wallet: string) => void;
  reportOutcome?: BattleReport["outcome"] | undefined;
}) {
  // The mission carries its own origin/target planet refs, so an empty shared lookup is enough —
  // `missionEndpoint` resolves the name, coordinates, commander, and planet art straight from them.
  const origin = missionEndpoint(mission, "origin", EMPTY_PLANET_LOOKUP);
  const target = missionEndpoint(mission, "target", EMPTY_PLANET_LOOKUP);
  const noFleetReturned = isNoFleetReturned(mission);
  const defeatedAttackTiming = defeatedAttackOriginTiming(mission, reportOutcome);
  const originTiming = defeatedAttackTiming ?? (noFleetReturned
    ? { label: "Return", value: "Completed, no fleet returned" }
    : missionLegTiming(mission.returnAt, now, "Return", "Returned"));
  const targetTiming = missionLegTiming(mission.arrivalAt, now, "Arrival", "Arrived");

  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Route</h3>
      <MissionRouteCell
        direction={missionRouteLeg(mission.status)}
        onSelectCoordinates={onSelectCoordinates}
        onSelectMoon={onSelectMoon}
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
  materialization,
  mission,
  now,
  report,
}: {
  defenderState?: DefenderPlanetState | undefined;
  materialization?: MissionDetailResponse["battleReportMaterialization"] | undefined;
  mission: FleetMissionSummary;
  now: number;
  report?: BattleReport | undefined;
}) {
  if (!isCombatMission(mission)) {
    return null;
  }

  if (!report) {
    if (materialization?.status === "pending") {
      return (
        <Notice tone="warning">
          Report generating, please hold...
        </Notice>
      );
    }
    if (materialization?.status === "failed") {
      return (
        <Notice tone="warning">
          Battle report processing failed. The backend will retry after report logs are replayed.
        </Notice>
      );
    }
    if (mission.needsResolution) {
      return (
        <Notice tone="warning">
          Combat is due or resolving; the indexed battle report is not available yet.
        </Notice>
      );
    }
    if (mission.resolutionBlocker === "randomness_pending") {
      return (
        <Notice tone="warning">
          Battle randomness is still pending, so this combat mission cannot resolve yet.
        </Notice>
      );
    }
    // A combat fleet only fights once it reaches its target. While it is still flying out (Outbound
    // and not yet due) — or was recalled before it ever arrived — no battle has happened, so the
    // "no report" notice is pure noise; the whole block is suppressed until combat is actually due.
    if (hasNotReachedCombat(mission, now)) {
      return null;
    }
    return (
      <Notice tone="neutral">
        Report generating, please hold...
      </Notice>
    );
  }

  const outcome = battleOutcomeSummary(report.outcome);
  const recyclersNeeded = recyclersForDebris(report.debris);
  // ACS (Alliance Combat System) grouped attack: more than one participant means joiners fought
  // alongside the main attacker. The on-chain losses/debris/outcome are already the combined group
  // result; only loot is split per participant. For a group we show the combined attacking fleet and
  // total loot here, then break each participant's loot share out in the Attack group panel below.
  const participants = report.participants ?? [];
  const isGroupedAttack = participants.length > 1;
  const attackerShips = isGroupedAttack ? sumShips(participants.map((participant) => participant.ships)) : mission.ships;
  const totalLoot = isGroupedAttack ? sumLoot(participants) : report.loot;
  const battleTimeFleetUnits = compositionUnits(report.defenderSnapshot?.fleet, shipCatalog, shipAssetByKey);
  const battleTimeDefenseUnits = compositionUnits(report.defenderSnapshot?.defenses, defenseCatalog, defenseAssetByKey);
  const stationedDefenders = defenderState?.stationedDefenders ?? [];
  const battleTimeDefenderUnits = report.roundReports[0]?.defenderUnits ?? null;

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
          column carries its losses and battle-time defender composition when the indexer can
          reconstruct it from historical unit-count events.
          The origin/target commanders are not repeated here — they already render in the Route hero
          above. Fields the indexed history cannot prove are flagged compactly rather than fabricated.
          Debris is shown on its own below. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={isGroupedAttack ? "Attackers (group)" : "Attacker"}>
          <Row label={isGroupedAttack ? "Combat ships (combined)" : "Combat ships"} value={<UnitIcons units={shipUnitsByKind(attackerShips, "combat")} />} />
          <Row label={isGroupedAttack ? "Civil ships (combined)" : "Civil ships"} value={<UnitIcons units={shipUnitsByKind(attackerShips, "civil")} />} />
          {isGroupedAttack ? null : <Row label="Cargo carried" value={formatResources(mission.cargo)} />}
          <Row label={isGroupedAttack ? "Fleet losses (combined)" : "Fleet losses"} value={formatResources(report.attackerLosses)} />
          <Row label={isGroupedAttack ? "Loot grabbed (total)" : "Loot grabbed"} value={formatResources(totalLoot)} />
        </Panel>
        <Panel title="Defender">
          <Row label="Fleet losses" value={formatResources(report.defenderLosses)} />
          {report.defenderSnapshot ? (
            <>
              <Row label="Battle-time fleet" value={<UnitIcons units={battleTimeFleetUnits} />} />
              <Row label="Battle-time defenses" value={<UnitIcons units={battleTimeDefenseUnits} />} />
            </>
          ) : (
            <Row
              label="Battle-time defenders"
              value={battleTimeDefenderUnits
                ? `${formatResource(battleTimeDefenderUnits)} units fought; exact unit composition was not captured in indexed history.`
                : "Exact unit composition was not captured in indexed history."}
            />
          )}
          {stationedDefenders.length > 0 ? (
            <Row
              label="Stationed defenders"
              value={
                <div className="grid gap-2">
                  {stationedDefenders.map((defender) => (
                    <div className="grid gap-1" key={defender.missionId}>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">
                        {defender.defenderDisplayName ?? shortAddress(defender.defender)}
                      </span>
                      <UnitIcons units={shipUnits(defender.ships)} />
                    </div>
                  ))}
                </div>
              }
            />
          ) : null}
        </Panel>
      </div>

      {/* ACS attack group: every participant (main attacker + joiners) and the loot they personally
          hauled. Only rendered for a grouped attack; a solo attack keeps the two-column report above. */}
      {isGroupedAttack ? (
        <div className="mt-3">
          <AttackGroupPanel participants={participants} totalLoot={totalLoot} />
        </div>
      ) : null}

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

// VEY-KANEO-432: the ACS attack group breakdown. Lists every participant (main attacker + joiners),
// their committed fleet, and the loot they personally hauled (their proportional share of the raid),
// followed by the combined group total. Scales to an arbitrary number of joiners.
function AttackGroupPanel({
  participants,
  totalLoot,
}: {
  participants: BattleReportParticipant[];
  totalLoot: { metal: string; crystal: string; deuterium: string };
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Attack group</h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {participants.length} {participants.length === 1 ? "participant" : "participants"}
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Joined (ACS) attack: the combined fleet fights as one and loot is split across participants in
        proportion to each fleet's remaining cargo capacity.
      </p>
      <div className="grid gap-2">
        {participants.map((participant) => (
          <article
            key={participant.missionId}
            className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-3 sm:grid-cols-[1fr_auto] sm:items-start"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all text-sm font-medium text-slate-200">{shortAddress(participant.address)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    participant.isMainAttacker
                      ? "border border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                      : "border border-white/10 bg-white/5 text-slate-400"
                  }`}
                >
                  {participant.isMainAttacker ? "Main attacker" : "Joined"}
                </span>
              </div>
              <div className="mt-1.5">
                <UnitIcons units={[...shipUnitsByKind(participant.ships, "combat"), ...shipUnitsByKind(participant.ships, "civil")]} />
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Loot share</p>
              <p className="mt-0.5 break-words text-sm text-slate-300">{formatResources(participant.loot)}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Total group loot</span>
        <span className="break-words text-sm font-semibold text-white">{formatResources(totalLoot)}</span>
      </div>
    </section>
  );
}

// Merge several ShipKey-keyed fleets into one combined count map (uint128 strings summed as BigInt) so
// the grouped battle report can show the whole attacking force, not just the main attacker's ships.
function sumShips(shipSets: Array<Record<string, string>>): Record<string, string> {
  const totals = new Map<string, bigint>();
  for (const ships of shipSets) {
    for (const [key, count] of Object.entries(ships)) {
      totals.set(key, (totals.get(key) ?? 0n) + BigInt(count || "0"));
    }
  }
  return Object.fromEntries([...totals].map(([key, count]) => [key, count.toString()]));
}

// Sum each participant's loot share into the combined group total (BigInt to stay exact for uint128).
function sumLoot(participants: BattleReportParticipant[]): { metal: string; crystal: string; deuterium: string } {
  return participants.reduce(
    (total, participant) => ({
      metal: (BigInt(total.metal) + BigInt(participant.loot.metal || "0")).toString(),
      crystal: (BigInt(total.crystal) + BigInt(participant.loot.crystal || "0")).toString(),
      deuterium: (BigInt(total.deuterium) + BigInt(participant.loot.deuterium || "0")).toString(),
    }),
    { metal: "0", crystal: "0", deuterium: "0" }
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

// The detail page must authorize orders (Recall / Resolve / Group defend)
// the same way the Mission Control list does, or the two screens disagree for the same fleet
// (VEY-KANEO-424). Mission Control gets that classification from the backend's wallet-scoped
// fleet-visibility lists; the detail page reuses those same lists by mission id rather than
// re-deriving authorization from a bare `owner === account` check. That bare check was wrong twice
// over: it offered Group defend / Intercept to any viewer of someone else's attack (the detail page
// fabricated an "incoming" defender role for strangers), and it only matched the owner's Recall by
// luck. A fleet the wallet has no visibility relationship with is an observer and gets no orders.
//
// joinableAttacks (alliance) are intentionally treated as observer here: the detail page has no
// join-attack handler wired, so surfacing a non-functional "Join attack" button would be worse than
// omitting it. Joining stays a Mission Control affordance.
function missionActionContext(
  mission: FleetMissionSummary,
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
): MissionActionContext {
  if (!fleetVisibility) return "observer";
  const id = mission.missionId;
  if (fleetVisibility.outgoing.some((entry) => entry.missionId === id)) return "outgoing";
  if (fleetVisibility.returning.some((entry) => entry.missionId === id)) return "returning";
  if (fleetVisibility.incoming.some((entry) => entry.missionId === id)) return "incoming";
  return "observer";
}

function isMissionDue(mission: FleetMissionSummary, now: number): boolean {
  const arrival = timestampToMs(mission.arrivalAt);
  return arrival != null && arrival <= now;
}

function isNoFleetReturned(mission: FleetMissionSummary): boolean {
  return !["Outbound", "Returning", "Recalled"].includes(mission.status) && Object.values(mission.ships).every((value) => Number(value) <= 0);
}

function defeatedAttackOriginTiming(
  mission: FleetMissionSummary,
  reportOutcome: BattleReport["outcome"] | undefined,
): { label: string | null; value: string; subtext?: string } | null {
  if (reportOutcome !== "DefenderWin" || !["Attack", "AcsAttack"].includes(mission.missionType)) {
    return null;
  }
  return timestampToMs(mission.arrivalAt)
    ? { label: null, value: "Defeated", subtext: formatCompactMissionTime(mission.arrivalAt) }
    : { label: null, value: "Defeated" };
}

// VEY-KANEO-409: the recall cost only matters while a fleet is still in flight — it can be recalled
// (Outbound), is on the way out (Outbound), or has already been recalled and is heading home
// (Recalled). Once a mission has finished without being recalled, the row only ever reads
// "Not recallable", which is pure noise, so it is hidden. Returning fleets are still in transit and
// keep the row. A recalled fleet keeps it explicitly even in the unexpected case its status reads as
// finished.
//
// VEY-KANEO-424: the row is also wallet-scoped to the only viewer who can act on it — the fleet's
// OWNER (outgoing while in flight, returning/recalled on the way home). A defender (incoming) or
// unrelated observer never gets a Recall button, so showing them a "RECALL COST: N deuterium" reads
// as a bug (cost advertised, no action). QA hit exactly this twice on incoming attacks. Gating the
// row on the same context as the Recall button keeps the two consistent and matches Mission Control,
// which never surfaces a recall cost for someone else's attack.
function showsRecallCost(mission: FleetMissionSummary, context: MissionActionContext): boolean {
  if (context !== "outgoing" && context !== "returning") return false;
  if (mission.status === "Recalled") return true;
  return ["Outbound", "Returning"].includes(mission.status);
}

// VEY-KANEO-424: the deuterium recall cost is shown only when recall is actually possible — a fleet
// still Outbound and within the recall window (backend projects its cost), or one that has already
// been recalled (the cost it paid). Past the 60s cutoff, or for a Returning fleet, recall can no
// longer happen, so the row reads "Not recallable". This keeps the cost row consistent with whether
// the Recall button is offered, and matches Mission Control.
function recallCostLabel(mission: FleetMissionSummary, now: number): string {
  const recallable = mission.status === "Recalled" || isFleetRecallable(mission, now);
  return recallable && mission.recallCost ? `${formatResource(mission.recallCost)} deuterium` : "Not recallable";
}

function isCombatMission(mission: FleetMissionSummary): boolean {
  return ["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(mission.missionType);
}

// VEY-KANEO-425: a combat fleet has not fought yet while it is still outbound and en route (arrival
// in the future), or when it was recalled before ever reaching its target. A fully-landed recalled
// fleet decodes as Returned after FleetMissionReturned, but it keeps the emitted recallCost, so that
// also means no battle ever happened. In those states the "No indexed battle report" notice is
// misleading noise and is hidden. A due/arrived/returning/resolved mission falls through and keeps
// the notice, since a report is genuinely expected (and merely missing/unindexed) at that point.
function hasNotReachedCombat(mission: FleetMissionSummary, now: number): boolean {
  if (mission.status === "Recalled") return true;
  if (mission.status === "Returned" && mission.recallCost !== null) return true;
  return mission.status === "Outbound" && !isMissionDue(mission, now);
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

function missionTrafficTiming(mission: FleetMissionSummary, now: number): string {
  if (mission.status === "Returning" || mission.status === "Recalled") {
    return `returns ${formatMissionTime(mission.returnAt, now)}`;
  }
  if (mission.status === "Returned") {
    return `returned ${formatCompactMissionTime(mission.returnAt)}`;
  }
  return `arrives ${formatMissionTime(mission.arrivalAt, now)}`;
}

function queueLabel(
  queue: QueueStateResponse | null,
  catalog: readonly { id: number; label: string }[],
  now: number,
): string {
  if (!queue?.active) return "None";
  const item = catalog.find((entry, index) => (entry.id ?? index) === queue.itemId);
  const itemLabel = item?.label ?? (queue.itemId == null ? queue.kind ?? "Queue" : `ID ${queue.itemId}`);
  const quantity = queue.quantity ? ` x${queue.quantity.toLocaleString()}` : "";
  const level = queue.targetLevel ? ` L${queue.targetLevel.toLocaleString()}` : "";
  const readiness = queue.asOfNow?.complete
    ? "Ready"
    : queue.readyAt
      ? formatMissionTime(queue.readyAt, now)
      : "ready time unknown";
  return `${itemLabel}${quantity}${level} - ${readiness}`;
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

function TacticalUnitIcons({
  assetByKey,
  catalog,
  units,
}: {
  assetByKey: Record<string, string>;
  catalog: readonly { id: number; key: string; label: string }[];
  units: Array<{ id: number; count: number }> | undefined;
}) {
  return <UnitIcons units={compositionUnits(units, catalog, assetByKey)} />;
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
