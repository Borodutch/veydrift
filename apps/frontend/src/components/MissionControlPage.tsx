import { ChevronDown, ChevronLeft, ChevronRight, Clipboard, ExternalLink, Filter, List } from "lucide-preact";

import { ActionReasonNote } from "./ActionReasonNote";
import { planetTypeFromTemperature } from "../data/mockUniverse";
import { formatDuration, formatDurationUntil } from "../durationFormat";
import { acsHoldingFuelRatePerHour, allianceDepotSustainSeconds } from "../fleetMissionRules";
import { shipAssetByKey } from "../gameAssets";
import type { ShipKey } from "../playableMvp";
import type { Coordinates, PlanetType } from "../types";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { isPendingMissionLaunch } from "../postTransactionRefresh";
import {
  type BattleReport,
  type BattleReportParticipant,
  type FleetMissionArchiveEntry,
  type FleetMissionArchiveResponse,
  type FleetMissionPlanetReference,
  type FleetMissionSummary,
  type FleetMissionVisibilityResponse,
  type GlobalMissionArchiveResponse,
  type ManagedPlanetResponse,
  type StationedDefenderSummary,
  decodeColonizationTargetId,
} from "../walletFlow";
import {
  MissionRouteCell,
  type MissionEndpoint,
  type MissionPlanetIdentity,
  type RouteLeg,
  endpointFromPlanetId,
  missionEndpoint,
  missionProgressPercent,
  missionRouteLeg,
  shortAddress,
} from "./missionRoute";
import { PageHeader, RefreshButton, refreshButtonState } from "./PageHeader";
import { MissionControlSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

type MissionControlActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionLifecycleActionKind = "counterplay" | "joinAttack" | "recall";

export type MissionLifecycleAction = {
  kind: MissionLifecycleActionKind;
  label: string;
  enabled: boolean;
  reason?: string | undefined;
};

export const MISSION_CONTROL_MISSION_TYPES = [
  "Transport",
  "Deploy",
  "Colonize",
  "Attack",
  "Harvest",
  "AcsDefend",
  "MissileAttack",
  "AcsAttack",
  "DefenseHold",
] as const;

export type MissionControlDirectionFilter = "" | "outbound" | "returning";

export type MissionControlFilters = {
  direction: MissionControlDirectionFilter;
  missionNumber: string;
  missionType: string;
  planetId: string;
};

export const EMPTY_MISSION_CONTROL_FILTERS: MissionControlFilters = {
  direction: "",
  missionNumber: "",
  missionType: "",
  planetId: "",
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
  incomingAttackArchive?: FleetMissionArchiveResponse | undefined;
  incomingAttackArchiveError?: string | undefined;
  incomingAttackArchiveLoading?: boolean | undefined;
  // VEY-412: the tab/page selection to render initially. Defaults to the sessionStorage-persisted
  // view so the selection survives the mission-detail round-trip; tests pass it explicitly.
  initialView?: MissionControlView | undefined;
  loading: boolean;
  missionArchive?: FleetMissionArchiveResponse | undefined;
  missionArchiveError?: string | undefined;
  missionArchiveLoading?: boolean | undefined;
  missionFilters?: Partial<MissionControlFilters> | undefined;
  missionNumberSearch?: string | undefined;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  // VEY-KANEO-440: opens the player's own planet detail, where the Defend control is always shown
  // (enabled+explained where eligible, or disabled+explained on the launch planet itself).
  onDefendPlanet?: (() => void) | undefined;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onOpenReportList: () => void;
  onGlobalMissionArchivePageChange?: ((page: number) => void) | undefined;
  onIncomingAttackArchivePageChange?: ((page: number) => void) | undefined;
  onMissionArchivePageChange?: ((page: number) => void) | undefined;
  onMissionFiltersChange?: ((filters: MissionControlFilters) => void) | undefined;
  onMissionNumberSearchChange?: ((value: string) => void) | undefined;
  onRecall: (missionId: string) => void;
  onRefresh: () => void;
  reportMissionId?: string | undefined;
  reportUrlForMission?: ((missionId: string) => string) | undefined;
  planetArchetypesByCoordinate?: ReadonlyMap<string, PlanetType> | undefined;
  transactionUnavailableReason?: string | undefined;
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
  incomingAttackArchive,
  incomingAttackArchiveError,
  incomingAttackArchiveLoading = false,
  initialView,
  loading,
  missionArchive,
  missionArchiveError,
  missionArchiveLoading = false,
  missionFilters,
  missionNumberSearch = "",
  now,  onCounterplay,
  onDefendPlanet,
  onJoinAttack,
  onOpenReport,
  onOpenReportList,
  onGlobalMissionArchivePageChange,
  onIncomingAttackArchivePageChange,
  onMissionArchivePageChange,
  onMissionFiltersChange,
  onMissionNumberSearchChange,
  onRecall,
  onRefresh,
  planetArchetypesByCoordinate = EMPTY_PLANET_ARCHETYPE_LOOKUP,
  reportMissionId,
  reportUrlForMission,
  transactionUnavailableReason,
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
  // Universe-wide active rows for the "All" tab: the player's own/alliance missions keep their exact
  // classification (direction + lifecycle actions); every other active mission renders read-only.
  const allActiveRows = allActiveMissionRows(allActiveMissions, activeMissionRows);
  const normalizedFilters = normalizeMissionControlFilters({
    ...missionFilters,
    missionNumber: missionFilters?.missionNumber ?? missionNumberSearch,
  });
  const activeFilterCount = missionControlActiveFilterCount(normalizedFilters);
  const missionFiltersActive = activeFilterCount > 0;
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...joinableAttacks, ...completedMissions]);
  // While a mission is still active (Outbound / Returning / Recalled) it must appear ONLY in the
  // active section. Its battle report — which can already exist for a fleet that fought and is flying
  // home — must not also render as a Past Missions row, duplicating the live mission. The report
  // surfaces in Past Missions only once the fleet has fully returned (VEY-KANEO-434).
  const activeMissionIds = new Set(activeMissionRows.map((row) => row.mission.missionId));
  const allActiveMissionIds = new Set(allActiveRows.map((row) => row.mission.missionId));
  const fallbackPastMissionRows = chronologicalPastMissionRows(completedMissions, battleReports);
  const rawPastMissionRows = missionArchive?.rows ?? fallbackPastMissionRows;
  const pastMissionRows = dedupePastMissionRows(rawPastMissionRows, activeMissionIds);
  const rawIncomingAttackArchiveRows = incomingAttackArchive?.rows;
  // Rows collapsed by the dedupe (a mission + its battle report -> one row, or an active mission's
  // report suppressed) so the section header count can match the actual rendered rows even with
  // server-side pagination (VEY-399#1, VEY-KANEO-434).
  const pastCollapsedCount = rawPastMissionRows.length - pastMissionRows.length;
  // Universe-wide past archive ("All" past tab): same dedupe + collapse accounting, server-paginated.
  const rawGlobalPastRows = globalMissionArchive?.rows ?? [];
  const globalPastMissionRows = dedupePastMissionRows(rawGlobalPastRows, allActiveMissionIds);
  const globalPastCollapsedCount = rawGlobalPastRows.length - globalPastMissionRows.length;
  // Past missions render from the paginated archive, which can contain missions absent from the live
  // fleet-visibility feed (older pages, returned missions no longer "active"). The backend already
  // resolves each row's origin/target planet, so seed the lookup from those references too — otherwise
  // their coordinates render as "External coordinates unavailable" even though the data is available.
  const pastArchiveMissions = missionsFromArchiveRows(rawPastMissionRows);
  const incomingAttackArchiveMissions = missionsFromArchiveRows(rawIncomingAttackArchiveRows ?? []);
  const globalArchiveMissions = missionsFromArchiveRows(rawGlobalPastRows);
  const lookupMissions = uniqueMissions([...allMissions, ...allActiveMissions, ...pastArchiveMissions, ...incomingAttackArchiveMissions, ...globalArchiveMissions]);
  // Loot grabbed per mission (return leg), drawn from every visible battle report so a mission card
  // can show "Cargo" (outbound) and "Loot" (return) on separate lines — VEY-404.
  const lootByMissionId = lootByMissionIdFromReports([
    ...battleReports,
    ...battleReportsFromArchiveRows(rawPastMissionRows),
    ...battleReportsFromArchiveRows(rawIncomingAttackArchiveRows ?? []),
    ...battleReportsFromArchiveRows(rawGlobalPastRows),
  ]);
  // VEY-KANEO-495: fleet losses (attacker / defender) keyed by mission id, from the same battle
  // reports as loot. A mission card pairs this with the outbound cargo and return-leg loot so a
  // resolved attack — and especially a failed one whose committed fleet was wiped — shows what it
  // cost, not just the fleet it launched with and any haul.
  const lossesByMissionId = lossesByMissionIdFromReports([
    ...battleReports,
    ...battleReportsFromArchiveRows(rawPastMissionRows),
    ...battleReportsFromArchiveRows(rawIncomingAttackArchiveRows ?? []),
    ...battleReportsFromArchiveRows(rawGlobalPastRows),
  ]);
  const selectedReport = reportMissionId ? lookupMissions.find((mission) => mission.missionId === reportMissionId) : undefined;
  const planetLookup = planetLookupFromMissionData(lookupMissions, walletPlanets, planetArchetypesByCoordinate);
  const walletAddress = fleetVisibility?.wallet ?? missionArchive?.wallet;
  const walletPlanetIds = walletPlanetIdSet(walletPlanets, planetLookup, walletAddress);
  const rawIncomingAttackPastRows = rawIncomingAttackArchiveRows ?? incomingAttackPastMissionRows(pastMissionRows, walletAddress, walletPlanetIds);
  const incomingAttackRows = dedupePastMissionRows(rawIncomingAttackPastRows, activeMissionIds);
  const filteredMyMissionRows = filterActiveMissionRows(myMissionRows, normalizedFilters);
  const filteredAllianceMissionRows = filterActiveMissionRows(allianceMissionRows, normalizedFilters);
  const filteredAllActiveRows = filterActiveMissionRows(allActiveRows, normalizedFilters);
  const filteredStationedIncoming = incoming.filter((mission) =>
    activeMissionRowMatchesFilters({ context: "incoming", direction: "Hostile inbound", mission }, normalizedFilters)
  );
  const filteredStationedOutgoing = outgoing.filter((mission) =>
    activeMissionRowMatchesFilters({ context: "outgoing", direction: "Outbound", mission }, normalizedFilters)
  );
  const filteredPastMissionRows = filterPastMissionRows(pastMissionRows, normalizedFilters);
  const filteredGlobalPastMissionRows = filterPastMissionRows(globalPastMissionRows, normalizedFilters);
  const filteredIncomingAttackRows = filterPastMissionRows(incomingAttackRows, normalizedFilters);
  const filterEmptyLabel = missionFilterEmptyLabel(normalizedFilters);
  const incomingAttackPastCollapsedCount = rawIncomingAttackPastRows.length - incomingAttackRows.length;
  const initialLoading = loading && !fleetVisibility;
  // VEY-412: restore the previously selected tabs + past page. The panel is DOM-driven (tabs/pages
  // toggle `hidden`), so without this the selection resets to defaults every time the component
  // remounts on returning from a mission detail (browser back or the in-app "← Mission Control").
  // The view comes from the URL hash first (shareable, survives reload + browser back), then the
  // sessionStorage fallback for the in-app back button which lands on a bare `#/mission-control`.
  const view = initialView ?? resolveMissionControlView();
  const selectedActiveRows = view.activeTab === "all"
    ? filteredAllActiveRows
    : view.activeTab === "alliance"
      ? filteredAllianceMissionRows
      : filteredMyMissionRows;
  const selectedPastRows = view.pastTab === "all"
    ? filteredGlobalPastMissionRows
    : view.pastTab === "incomingAttacks"
      ? filteredIncomingAttackRows
      : filteredPastMissionRows;
  const hasFilteredStationedRows = filteredStationedOutgoing.some((mission) =>
    (mission.missionType === "AcsDefend" || mission.missionType === "DefenseHold")
      && mission.status === "Outbound"
  ) || filteredStationedIncoming.some((mission) =>
    mission.stationedDefenders
      ? mission.stationedDefenders.length > 0
      : (mission.counterplayDefenderMissionIds?.length ?? 0) > 0
  );
  const hasVisibleExpandableRows = selectedActiveRows.length > 0
    || selectedPastRows.length > 0
    || hasFilteredStationedRows;

  return (
    <section className="grid gap-3" data-mission-control-page ref={scheduleMissionRowsDisclosureSync}>
      <PageHeader
        actions={(
          <>
            <MissionFilterPopover
              filters={normalizedFilters}
              onChange={(filters) => {
                onMissionFiltersChange?.(filters);
                if (filters.missionNumber !== normalizedFilters.missionNumber) {
                  onMissionNumberSearchChange?.(filters.missionNumber);
                }
              }}
            />
            <MissionRowsDisclosureControl hidden={!hasVisibleExpandableRows} />
            <RefreshButton loading={loading || missionArchiveLoading} onRefresh={onRefresh} title="Refresh missions" />
          </>
        )}
        title="Mission Control"
      />

      {actionState.status !== "idle" && (
        <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
          {actionState.label}
        </Notice>
      )}
      {initialLoading ? (
        <MissionControlSkeleton />
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

          <ActiveMissionSection
            activePage={view.activePage}
            activeTab={view.activeTab}
            allRows={filteredAllActiveRows}
            allianceRows={filteredAllianceMissionRows}
            canTransact={canTransact}
            lootByMissionId={lootByMissionId}
            lossesByMissionId={lossesByMissionId}
            missionFiltersActive={missionFiltersActive}
            missionFilterEmptyLabel={filterEmptyLabel}
            myRows={filteredMyMissionRows}
            now={now}
            onCounterplay={onCounterplay}
            onJoinAttack={onJoinAttack}
            onOpenReport={onOpenReport}
            onRecall={onRecall}
            planetLookup={planetLookup}
            transactionUnavailableReason={transactionUnavailableReason}
            wallet={walletAddress}
            walletPlanetIds={walletPlanetIds}
          />

          <StationedDefenseSection
            hideWhenEmpty
            incoming={filteredStationedIncoming}
            now={now}
            onDefendPlanet={onDefendPlanet}
            onOpenReport={onOpenReport}
            outgoing={filteredStationedOutgoing}
            planetLookup={planetLookup}
          />

          <PastMissionSection
            allCollapsedCount={globalPastCollapsedCount}
            allError={globalMissionArchiveError}
            allLoading={globalMissionArchiveLoading}
            allPagination={globalMissionArchive?.pagination}
            allRows={filteredGlobalPastMissionRows}
            collapsedCount={pastCollapsedCount}
            error={missionArchiveError}
            incomingAttackCollapsedCount={incomingAttackPastCollapsedCount}
            incomingAttackError={incomingAttackArchiveError}
            incomingAttackLoading={incomingAttackArchiveLoading}
            incomingAttackPagination={incomingAttackArchive?.pagination}
            incomingAttackRows={filteredIncomingAttackRows}
            loading={missionArchiveLoading}
            lootByMissionId={lootByMissionId}
            lossesByMissionId={lossesByMissionId}
            now={now}
            onAllPageChange={onGlobalMissionArchivePageChange}
            onIncomingAttackPageChange={onIncomingAttackArchivePageChange}
            onOpenReport={onOpenReport}
            onPageChange={onMissionArchivePageChange}
            pagination={missionArchive?.pagination}
            pastPage={view.pastPage}
            pastTab={view.pastTab}
            planetLookup={planetLookup}
            missionFiltersActive={missionFiltersActive}
            missionFilterEmptyLabel={filterEmptyLabel}
            missionStateFilterActive={Boolean(normalizedFilters.direction)}
            rows={filteredPastMissionRows}
            wallet={walletAddress}
            walletPlanetIds={walletPlanetIds}
          />
        </>
      )}
    </section>
  );
}

const EMPTY_PLANET_LOOKUP: ReadonlyMap<string, MissionPlanetIdentity> = new Map();
const EMPTY_PLANET_ARCHETYPE_LOOKUP: ReadonlyMap<string, PlanetType> = new Map();

// VEY-KANEO-440 stationed-defense display. ACS Defend stations a fleet at a planet to defend it
// against a specific incoming attack (the only stationing today's contract supports), so this panel
// surfaces both sides of that arrangement: (a) the defense fleets the player currently has stationed
// at allied planets, and (b) the allied fleets stationed at the player's own attacked planets. Each
// "holds" until the defended attack lands, so the countdown is the defended attack's arrival. The panel
// is read-only — the launch flow lives on the "Group defend" action of an incoming attack.
export function StationedDefenseSection({
  incoming,
  now,
  onOpenReport,
  outgoing,
  // Mission endpoints render from each summary's embedded origin/target planet references (the backend
  // enriches them), so callers without a prebuilt lookup can omit it.
  planetLookup = EMPTY_PLANET_LOOKUP,
  // VEY-KANEO-440: launching a DefenseHold lives on a planet's Defend action, but players (and QA) look
  // for it here, where the empty state already tells them to "choose Defend". Without an affordance on
  // this panel the feature reads as missing (repeated QA "no Defend button anywhere" bounces). When
  // provided, render a "Defend a planet" CTA that opens the player's own planet detail — which always
  // shows the Defend control + its eligibility explanation — so the entry point is discoverable from the
  // screen that describes it.
  onDefendPlanet,
  // VEY-KANEO-455: Mission Control aggregates many panels, so a "Stationed defenses" card showing only
  // an empty state is noise there — hide the whole section until a fleet is actually stationed.
  hideWhenEmpty = false,
}: {
  incoming: FleetMissionSummary[];
  now: number;
  onOpenReport: (missionId: string) => void;
  outgoing: FleetMissionSummary[];
  planetLookup?: ReadonlyMap<string, MissionPlanetIdentity>;
  onDefendPlanet?: (() => void) | undefined;
  hideWhenEmpty?: boolean;
}) {
  // Both the reactive AcsDefend (keyed to a specific attack) and the DefenseHold mission (stationed
  // for a chosen window, VEY-KANEO-441) count as fleets the player has stationed in defense.
  const myStationed = outgoing
    .filter((mission) =>
      (mission.missionType === "AcsDefend" || mission.missionType === "DefenseHold")
        && mission.status === "Outbound")
    .sort((left, right) => Number(left.arrivalAt) - Number(right.arrivalAt));
  // Incoming hostile attacks on the player's own planets that already have allied defenders stationed.
  // VEY-KANEO-456: prefer the backend's reconciled `stationedDefenders` (already filtered to holds that
  // are still active as-of-now); fall back to the raw `counterplayDefenderMissionIds` count for feeds
  // predating that enrichment. An attack whose defenders have all withdrawn/elapsed drops out here, so
  // the panel never shows an emptied "Defended" card.
  const defendedPlanets = incoming
    .filter((mission) =>
      mission.stationedDefenders
        ? mission.stationedDefenders.length > 0
        : (mission.counterplayDefenderMissionIds?.length ?? 0) > 0)
    .sort((left, right) => Number(left.arrivalAt) - Number(right.arrivalAt));
  const total = myStationed.length + defendedPlanets.length;

  // VEY-KANEO-455: on Mission Control, render nothing until allied defenses are actually stationed.
  if (hideWhenEmpty && total === 0) return null;

  return (
    <section className="grid gap-2 rounded-lg border border-violet-300/15 bg-violet-300/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-violet-100">Stationed defenses</h2>
        <div className="flex items-center gap-3">
          {onDefendPlanet ? (
            <button
              className="rounded border border-violet-300/40 bg-violet-300/10 px-3 py-2 text-[11px] font-semibold text-violet-100 transition-colors hover:bg-violet-300/20 sm:px-2.5 sm:py-1"
              onClick={onDefendPlanet}
              type="button"
            >
              Defend a planet
            </button>
          ) : null}
          <span className="text-[11px] tabular-nums text-slate-400">{total}</span>
        </div>
      </div>
      {total === 0 ? (
        <p className="text-xs text-slate-400">
          No fleets are stationed in defense yet. Pick one of your other colonies or an alliance member's
          planet and choose <span className="text-violet-100">Defend</span>
          {onDefendPlanet ? (
            <>
              {" "}(use{" "}
              <button
                className="font-semibold text-violet-200 underline decoration-dotted underline-offset-2 hover:text-violet-100"
                onClick={onDefendPlanet}
                type="button"
              >
                Defend a planet
              </button>{" "}
              to open your planet, where Defend explains how to station a fleet)
            </>
          ) : null}{" "}
          to station a fleet that holds
          for a chosen duration, fighting any attack that lands while it holds. Defending another planet
          requires a second colony or an alliance member's planet to send the fleet to.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.08] bg-black/20">
          {myStationed.map((mission) => (
            <StationedDefenseCard
              key={mission.missionId}
              mission={mission}
              now={now}
              onOpenReport={onOpenReport}
              planetLookup={planetLookup}
            />
          ))}
          {defendedPlanets.map((attack) => (
            <DefendedPlanetCard
              attack={attack}
              key={attack.missionId}
              now={now}
              onOpenReport={onOpenReport}
              planetLookup={planetLookup}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// A defense fleet the player has stationed at an allied planet: full route + ships, with the "Holds"
// countdown running to the defended attack's arrival (the AcsDefend mission's arrival is pinned to it).
function StationedDefenseCard({
  mission,
  now,
  onOpenReport,
  planetLookup,
}: {
  mission: FleetMissionSummary;
  now: number;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
}) {
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
      badgeLabel="Defending"
      badgeTone={missionTypeTone("AcsDefend")}
      direction={missionRouteLeg(mission.status)}
      fleet={<MissionFleet cargo={mission.cargo} mission={mission} ships={mission.ships} />}
      headerTiming={{ label: "Holds", value: missionEndpointTiming(mission.arrivalAt, now) }}
      missionId={mission.missionId}
      origin={missionEndpoint(mission, "origin", planetLookup)}
      progressPercent={missionProgressPercent(mission, now)}
      statusPill={missionStatusPill(mission, now)}
      target={missionEndpoint(mission, "target", planetLookup)}
    />
  );
}

// One of the player's own planets that is under attack but already has allied fleets stationed to
// defend it. VEY-KANEO-456: the backend resolves each stationed defender into full detail
// (`attack.stationedDefenders`), so this card lists every defender — which alliance player owns it,
// the exact ships they brought (with image assets + counts), a live "stays until" countdown, and the
// deuterium upkeep the defended planet's Alliance Depot covers — instead of a bare count. For feeds
// predating that enrichment it falls back to the old count-only line.
function DefendedPlanetCard({
  attack,
  now,
  onOpenReport,
  planetLookup,
}: {
  attack: FleetMissionSummary;
  now: number;
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
}) {
  const defenders = attack.stationedDefenders;
  const fallbackCount = attack.counterplayDefenderMissionIds?.length ?? 0;
  return (
    <MissionCard
      actions={
        <button
          className={rowActionButtonClass}
          onClick={() => onOpenReport(attack.missionId)}
          title="Open the full mission detail screen"
          type="button"
        >
          <ExternalLink aria-hidden="true" size={13} />
          Open
        </button>
      }
      badgeLabel="Defended"
      badgeTone={missionTypeTone("AcsDefend")}
      fleet={
        defenders && defenders.length > 0 ? (
          <div className="grid gap-2">
            {defenders.map((defender) => (
              <StationedDefenderRow defender={defender} key={defender.missionId} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] font-medium text-violet-100">
            {`${fallbackCount} allied ${fallbackCount === 1 ? "fleet" : "fleets"} stationed in defense`}
          </p>
        )
      }
      direction={missionRouteLeg(attack.status)}
      headerTiming={{ label: "Holds", value: missionEndpointTiming(attack.arrivalAt, now) }}
      missionId={attack.missionId}
      origin={missionEndpoint(attack, "origin", planetLookup)}
      progressPercent={missionProgressPercent(attack, now)}
      statusPill={{ label: "Under attack", tone: "border-red-300/25 bg-red-400/10 text-red-100" }}
      target={missionEndpoint(attack, "target", planetLookup)}
    />
  );
}

// VEY-KANEO-456: one allied fleet stationed to defend the attacked planet. Shows the defender player,
// their fleet (ship art + counts), a live hold countdown to the fleet's own expiry, and the deuterium
// upkeep the planet's Alliance Depot funds. Upkeep rate + how long the depot sustains the hold are
// derived as-of-now on the client (no extra request, no poller), matching the backend's lazy
// reconciliation that already dropped any defender whose hold elapsed.
function StationedDefenderRow({
  defender,
  now,
}: {
  defender: StationedDefenderSummary;
  now: number;
}) {
  const shipCounts = shipCountsToNumbers(defender.ships);
  const upkeepPerHour = acsHoldingFuelRatePerHour(shipCounts);
  const holdUntilMs = timestampToMs(defender.holdUntil);
  const holdRemainingSeconds = holdUntilMs === undefined ? 0 : Math.max(0, (holdUntilMs - now) / 1_000);
  const sustainSeconds = allianceDepotSustainSeconds(shipCounts, defender.allianceDepotLevel);
  const depotCoversFullHold = sustainSeconds >= holdRemainingSeconds;
  const depotSummary =
    defender.allianceDepotLevel <= 0
      ? "No Alliance Depot support"
      : depotCoversFullHold
        ? `Alliance Depot Lv ${defender.allianceDepotLevel} covers the full hold`
        : `Alliance Depot Lv ${defender.allianceDepotLevel} sustains ${formatDuration(sustainSeconds)}`;
  return (
    <div className="grid gap-1 rounded border border-violet-300/15 bg-black/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[11px] font-semibold text-violet-100" title={defender.defender}>
          {stationedDefenderName(defender)}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400">
          <span className="font-semibold uppercase tracking-[0.1em] text-slate-600">Holds</span>{" "}
          {missionEndpointTiming(defender.holdUntil, now)}
        </span>
      </div>
      <FleetIcons ships={defender.ships} />
      <p className="text-[11px] text-slate-400">
        {`Upkeep ${formatResource(String(upkeepPerHour))} deut/h`} · {depotSummary}
      </p>
    </div>
  );
}

// A defender is an alliance member identified on-chain by address; show their profile display name when
// the read model resolved one, otherwise a shortened address so the player is still identifiable.
function stationedDefenderName(defender: StationedDefenderSummary): string {
  if (defender.defenderDisplayName && defender.defenderDisplayName.trim().length > 0) {
    return defender.defenderDisplayName;
  }
  const address = defender.defender;
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Coerce a mission's on-chain ship counts (string-encoded) into the numeric shape the holding-fuel
// helpers expect; unknown/blank counts collapse to 0.
function shipCountsToNumbers(ships: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(ships)) {
    counts[key] = Math.max(0, Math.trunc(Number(value) || 0));
  }
  return counts;
}

export function missionLifecycleActions({
  canTransact,
  context,
  mission,
  now,
  transactionUnavailableReason,
}: {
  canTransact: boolean;
  context: ActiveMissionContext;
  mission: FleetMissionSummary;
  now: number;
  transactionUnavailableReason?: string | undefined;
}): MissionLifecycleAction[] {
  const actions: MissionLifecycleAction[] = [];
  const due = isMissionDue(mission, now);

  // Arrival/return completions reconcile automatically — deterministically on the next
  // mutating call (lazy on-chain settle) and via the backend mission resolver — so the
  // former manual "Resolve" order is removed; arrived rows are read-only until settled.

  if (context === "outgoing" && mission.status === "Outbound") {
    // Recall is only valid more than the 60s cutoff before arrival; inside that window the contract
    // reverts, so the button is shown but disabled with a clear reason rather than offering a tx that
    // would fail (VEY-KANEO-424).
    const recallable = isFleetRecallable(mission, now);
    if (!(mission.missionType === "Deploy" && mission.targetIsMoon === true && due)) {
      actions.push({
        enabled: canTransact && recallable,
        kind: "recall",
        label: "Recall fleet",
        reason: recallable
          ? walletReason(canTransact, transactionUnavailableReason)
          : mission.missionType === "DefenseHold"
            ? "The stationed defense hold has ended."
            : "The recall cutoff has passed (within 60s of arrival).",
      });
    }
  }

  // VEY-KANEO-465: fleet returns reconcile automatically — the backend mission
  // resolver (`missionResolution.ts`) submits `completeFleetMissionReturn` once
  // a return is due, crediting ships/cargo without any manual action. The former
  // "Land fleet" button is removed so the frontend never drives a non-lazy
  // complete/land action; returning rows are read-only until the backend lands them.

  if (context === "incoming" && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: canTransact && !due,
      kind: "counterplay",
      label: "Counterplay",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact, transactionUnavailableReason),
    });
  }

  if (context === "joinable" && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: canTransact && !due,
      kind: "joinAttack",
      label: "Join attack",
      reason: due ? "Mission is already due for resolution." : walletReason(canTransact, transactionUnavailableReason),
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
  // The one active-section empty state: the tab panel says it, so no separate page-level notice
  // repeats it two lines above.
  { emptyLabel: "No active missions for this wallet. Use Galaxy to launch attacks, transport resources, deploy fleets, or harvest debris.", key: "mine", label: "My missions" },
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
  lootByMissionId,
  lossesByMissionId,
  missionFilterEmptyLabel,
  missionFiltersActive,
  myRows,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  planetLookup,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  activePage: number;
  activeTab: ActiveMissionTabKey;
  allRows: ActiveMissionRow[];
  allianceRows: ActiveMissionRow[];
  canTransact: boolean;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
  missionFilterEmptyLabel: string;
  missionFiltersActive: boolean;
  myRows: ActiveMissionRow[];
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  transactionUnavailableReason?: string | undefined;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const rowsByTab: Record<ActiveMissionTabKey, ActiveMissionRow[]> = { all: allRows, alliance: allianceRows, mine: myRows };
  const sharedRowProps = {
    canTransact,
    lootByMissionId,
    lossesByMissionId,
    now,
    onCounterplay,
    onJoinAttack,
    onOpenReport,
    onRecall,
    planetLookup,
    transactionUnavailableReason,
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
              className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100 sm:py-1"
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
      </div>
      {ACTIVE_MISSION_TABS.map((tab) => (
        <div data-active-tab-panel={tab.key} hidden={tab.key !== activeTab} key={tab.key} role="tabpanel">
          {/* Only the initially-visible tab restores its remembered page; the hidden tabs start at 0. */}
          <ActiveMissionList
            emptyLabel={missionFiltersActive ? missionFilterEmptyLabel : tab.emptyLabel}
            initialPage={tab.key === activeTab ? activePage : 0}
            rows={rowsByTab[tab.key]}
            {...sharedRowProps}
          />
        </div>
      ))}
    </section>
  );
}

export type MissionRowsDisclosureState = {
  allExpanded: boolean;
  label: "Collapse all" | "Expand all";
  nextOpen: boolean;
};

export function missionRowsDisclosureState(rows: ReadonlyArray<{ open: boolean }>): MissionRowsDisclosureState {
  const allExpanded = rows.length > 0 && rows.every((row) => row.open);
  return {
    allExpanded,
    label: allExpanded ? "Collapse all" : "Expand all",
    nextOpen: !allExpanded,
  };
}

export function setMissionRowsExpanded(rows: Array<{ open: boolean }>, open: boolean): void {
  rows.forEach((row) => {
    row.open = open;
  });
}

function MissionRowsDisclosureControl({ hidden }: { hidden: boolean }) {
  return (
    <button
      aria-label="Expand all visible mission cards"
      className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
      data-mission-disclosure-toggle
      hidden={hidden}
      onClick={(event) => {
        const root = event.currentTarget.closest<HTMLElement>("[data-mission-control-page]");
        if (!root) return;
        const rows = visibleMissionRows(root);
        setMissionRowsExpanded(rows, missionRowsDisclosureState(rows).nextOpen);
        syncMissionRowsDisclosureControl(root);
      }}
      title="Expand all visible mission cards"
      type="button"
    >
      Expand all
    </button>
  );
}

function visibleMissionRows(root: HTMLElement): HTMLDetailsElement[] {
  return Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-mission-row]"))
    .filter((row) => !hiddenByAncestor(row, root));
}

function hiddenByAncestor(element: HTMLElement, boundary: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== boundary) {
    if (current.hidden) return true;
    current = current.parentElement;
  }
  return false;
}

function syncMissionRowsDisclosureControl(source: Element): void {
  const root = source.matches("[data-mission-control-page]")
    ? source as HTMLElement
    : source.closest<HTMLElement>("[data-mission-control-page]");
  if (!root) return;
  const button = root.querySelector<HTMLButtonElement>("[data-mission-disclosure-toggle]");
  if (!button) return;
  const rows = visibleMissionRows(root);
  const state = missionRowsDisclosureState(rows);
  button.hidden = rows.length === 0;
  button.textContent = state.label;
  const accessibleLabel = `${state.label} visible mission cards`;
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
}

function scheduleMissionRowsDisclosureSync(root: HTMLElement | null): void {
  if (!root) return;
  queueMicrotask(() => {
    if (root.isConnected) syncMissionRowsDisclosureControl(root);
  });
}

function MissionFilterPopover({
  filters,
  onChange,
}: {
  filters: MissionControlFilters;
  onChange: (filters: MissionControlFilters) => void;
}) {
  const activeFilterCount = missionControlActiveFilterCount(filters);
  const active = activeFilterCount > 0;
  const triggerLabel = active
    ? `Mission filters, ${activeFilterCount} active`
    : "Mission filters";

  const update = (partial: Partial<MissionControlFilters>) => {
    onChange(normalizeMissionControlFilters({ ...filters, ...partial }));
  };

  return (
    <details
      className="group/filters relative"
      data-active-filter-count={activeFilterCount}
      data-mission-filters
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
      }}
    >
      <summary
        aria-controls="mission-control-filter-popover"
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className={`flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 [&::-webkit-details-marker]:hidden ${
          active
            ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
        }`}
        title={triggerLabel}
      >
        <Filter aria-hidden="true" size={14} />
        <span>Filters</span>
        {active ? (
          <span
            aria-hidden="true"
            className="inline-grid min-w-5 place-items-center rounded-full bg-cyan-200 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-950"
          >
            {activeFilterCount}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" className="text-slate-500 transition-transform group-open/filters:rotate-180" size={13} />
      </summary>

      <div
        aria-label="Mission filters"
        className="absolute right-0 z-30 mt-2 grid w-[min(22rem,calc(100vw-1.5rem))] gap-3 rounded-lg border border-white/15 bg-[#0d1422] p-3 shadow-2xl shadow-black/50"
        id="mission-control-filter-popover"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Filter missions</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Filters combine across ongoing and past missions.</p>
          </div>
          <button
            className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:text-slate-600"
            disabled={!active}
            onClick={(event) => {
              onChange({ ...EMPTY_MISSION_CONTROL_FILTERS });
              const details = event.currentTarget.closest("details");
              details?.removeAttribute("open");
              details?.querySelector<HTMLElement>("summary")?.focus();
            }}
            type="button"
          >
            Clear all
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-slate-300">
            Mission number
            <input
              aria-label="Search missions by number"
              className="h-10 min-w-0 rounded border border-white/10 bg-black/25 px-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              inputMode="numeric"
              onInput={(event) => update({ missionNumber: event.currentTarget.value })}
              placeholder="1473"
              type="search"
              value={filters.missionNumber}
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-300">
            Planet ID
            <input
              aria-label="Filter by origin or destination planet ID"
              className="h-10 min-w-0 rounded border border-white/10 bg-black/25 px-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              inputMode="numeric"
              onInput={(event) => update({ planetId: event.currentTarget.value })}
              placeholder="7"
              type="search"
              value={filters.planetId}
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-300">
            Mission type
            <select
              aria-label="Filter by mission type"
              className="h-10 min-w-0 rounded border border-white/10 bg-[#080d18] px-3 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              onChange={(event) => update({ missionType: event.currentTarget.value })}
              value={filters.missionType}
            >
              <option value="">All mission types</option>
              {MISSION_CONTROL_MISSION_TYPES.map((missionType) => (
                <option key={missionType} value={missionType}>{missionTypeLabel(missionType)}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-300">
            Direction / state
            <select
              aria-label="Filter by mission direction or state"
              className="h-10 min-w-0 rounded border border-white/10 bg-[#080d18] px-3 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              onChange={(event) => update({ direction: event.currentTarget.value as MissionControlDirectionFilter })}
              value={filters.direction}
            >
              <option value="">Any flight state</option>
              <option value="outbound">Outbound</option>
              <option value="returning">Returning</option>
            </select>
          </label>
        </div>
      </div>
    </details>
  );
}

function missionFilterEmptyLabel(filters: MissionControlFilters): string {
  if (
    filters.missionNumber
    && !filters.missionType
    && !filters.direction
    && !filters.planetId
  ) {
    return `No missions match #${filters.missionNumber}.`;
  }
  return "No missions match the active filters.";
}

function ActiveMissionList({
  canTransact,
  emptyLabel,
  initialPage = 0,
  lootByMissionId,
  lossesByMissionId,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  planetLookup,
  rows,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  canTransact: boolean;
  emptyLabel: string;
  initialPage?: number | undefined;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  rows: ActiveMissionRow[];
  transactionUnavailableReason?: string | undefined;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-xs text-slate-500">{emptyLabel}</p>;
  }

  const pageSize = 25;
  const pages = paginatedRows(rows, pageSize);
  // VEY-412: restore the remembered page so back-navigation lands on the same page, not page 1.
  const pagination = paginationForRowsAtPage(rows, pageSize, initialPage);
  const currentPage = pagination.page - 1;

  return (
    <div
      data-past-page-current={String(currentPage)}
      data-past-page-size={String(pageSize)}
      data-past-page-total={String(pagination.totalEntries)}
    >
      <MissionListHeader />
      {pages.map((pageRows, pageIndex) => (
        <div
          className="divide-y divide-white/[0.06]"
          data-past-page={pageIndex}
          hidden={pageIndex !== currentPage}
          key={`active-mission-page:${pageIndex}`}
        >
          {pageRows.map(({ context, direction, mission }) => (
            <MissionRow
              canTransact={canTransact}
              context={context}
              direction={direction}
              harvested={returnPhaseHarvestedResources(mission)}
              key={`${context}:${mission.missionId}`}
              loot={returnPhaseLoot(mission, lootByMissionId)}
              losses={returnPhaseLosses(mission, lossesByMissionId)}
              mission={mission}
              now={now}              onCounterplay={onCounterplay}
              onJoinAttack={onJoinAttack}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              planetLookup={planetLookup}
              transactionUnavailableReason={transactionUnavailableReason}
              wallet={wallet}
              walletPlanetIds={walletPlanetIds}
            />
          ))}
        </div>
      ))}
      {pagination.totalPages > 1 ? <ClientPaginationControl className="px-2.5 pb-2 sm:px-3" pagination={pagination} /> : null}
    </div>
  );
}

function MissionRow({
  canTransact,
  context,
  direction,
  harvested,
  loot,
  losses,
  mission,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  planetLookup,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  canTransact: boolean;
  context: ActiveMissionContext;
  direction: string;
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
  mission: FleetMissionSummary;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  transactionUnavailableReason?: string | undefined;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  // VEY-397#11: only surface Join when it is actionable.
  const actions = missionLifecycleActions({ canTransact, context, mission, now, transactionUnavailableReason })
    .filter((action) => action.kind !== "joinAttack" || action.enabled);
  const missionDirection = resolveMissionDirection({ context, mission, wallet, walletPlanetIds });
  const origin = missionEndpoint(mission, "origin", planetLookup);
  const target = missionEndpoint(mission, "target", planetLookup);
  const noFleetReturned = isNoFleetReturned(mission);
  const directionSubtext = direction && direction !== "Joinable attack" ? direction : undefined;
  const pendingMission = isPendingMissionLaunch(mission);
  // A hostile attack heading for the player's planet is the one row that must not hide its
  // counterplay behind a click: flag it red and start it expanded.
  const hostileInbound = missionDirection === "incoming" && isOffensiveMissionType(mission.missionType);
  return (
    <MissionCard
      defaultOpen={hostileInbound}
      glance={missionGlance({ direction: missionDirection, harvested, loot, losses, mission })}
      hostile={hostileInbound}
      actions={
        <>
          {!pendingMission && actions.map((action) => action.kind === "counterplay" ? (
            <ActionButton
              action={{ ...action, label: "Group defend" }}
              key={action.kind}
              onClick={() => onCounterplay(mission, "acsDefend")}
            />
          ) : action.kind === "joinAttack" ? (
            // VEY-397#13/#14: "Join" shares the Open button style/size (hidden when disabled, VEY-399#6).
            <button
              className={rowActionButtonClass}
              key={action.kind}
              onClick={() => onJoinAttack(mission, target.coords)}
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
                if (action.kind === "recall") onRecall(mission.missionId);
              }}
            />
          ))}
          {pendingMission ? (
            <span className="inline-flex h-8 items-center justify-center rounded border border-cyan-300/20 bg-cyan-300/10 px-2 text-xs font-medium text-cyan-100">
              Indexing
            </span>
          ) : (
            <button
              className={rowActionButtonClass}
              onClick={() => onOpenReport(mission.missionId)}
              title="Open the full mission detail screen"
              type="button"
            >
              <ExternalLink aria-hidden="true" size={13} />
              Open
            </button>
          )}
        </>
      }
      badgeLabel={directionalMissionTypeLabel(mission.missionType, missionDirection)}
      badgeTone={missionTypeTone(mission.missionType)}
      detailTimings={missionDetailTimings(mission, now)}
      direction={missionRouteLeg(mission.status)}
      fleet={<MissionFleet cargo={mission.cargo} harvested={harvested} loot={loot} losses={losses} mission={mission} ships={mission.ships} />}
      groupId={mission.attackGroupId}
      headerTiming={activeMissionHeaderTiming(mission, now, noFleetReturned)}
      missionId={mission.missionId}
      progressPercent={missionProgressPercent(mission, now)}
      routeSubtext={directionSubtext}
      statusPill={missionStatusPill(mission, now)}
      {...routeEndpointsForRow(origin, target, wallet)}
    />
  );
}

// On "My missions" nearly every endpoint belongs to the connected player; printing their own name
// under both planets of every row is pure repetition. Other commanders (the interesting ones) keep
// their name + profile link.
function withoutOwnCommander(endpoint: MissionEndpoint, wallet: string | undefined): MissionEndpoint {
  if (!wallet || !endpoint.commanderWallet) return endpoint;
  if (endpoint.commanderWallet.toLowerCase() !== wallet.toLowerCase()) return endpoint;
  return { ...endpoint, commanderName: null };
}

// A self-route (deploy / self-transport: both planets share an owner) names its commander once,
// under the origin — "HamZzz -> HamZzz" on every row said nothing twice.
function routeEndpointsForRow(
  origin: MissionEndpoint,
  target: MissionEndpoint,
  wallet: string | undefined,
): { origin: MissionEndpoint; target: MissionEndpoint } {
  const selfRoute = Boolean(
    origin.commanderWallet
      && target.commanderWallet
      && origin.commanderWallet.toLowerCase() === target.commanderWallet.toLowerCase()
  );
  return {
    origin: withoutOwnCommander(origin, wallet),
    target: withoutOwnCommander(selfRoute ? { ...target, commanderName: null } : target, wallet),
  };
}

// The collapsed row shows exactly ONE time — the phase-relevant one (live ETA while outbound, the
// return countdown while flying home, the hold expiry while stationed). Two timestamps per row was
// the single biggest source of row noise; the full arrival/return pair lives in the expanded panel
// via *DetailTimings below.
function activeMissionHeaderTiming(mission: FleetMissionSummary, now: number, noFleetReturned: boolean): EndpointTiming {
  if (mission.missionType === "DefenseHold" && isDefenseHoldStationed(mission, now)) {
    return { label: "Holds", value: missionEndpointTiming(defenseHoldRecallUntil(mission), now) };
  }
  const returning = mission.status === "Returning" || mission.status === "Recalled" || mission.status === "Returned";
  if (returning) {
    return { label: "Returns", value: noFleetReturned ? "No fleet returned" : missionEndpointTiming(mission.returnAt, now) };
  }
  return { label: "ETA", value: missionEndpointTiming(mission.arrivalAt, now) };
}

// Expanded-panel timings: the full arrival/return picture the compact row deliberately omits.
function missionDetailTimings(mission: FleetMissionSummary, now: number): EndpointTiming[] {
  const timings: EndpointTiming[] = [{ label: "Arrived", value: compactMissionTime(mission.arrivalAt, now) }];
  if (mission.missionType === "DefenseHold") {
    timings.push({ label: "Holds until", value: compactMissionTime(defenseHoldRecallUntil(mission), now) });
  }
  timings.push({ label: "Returned", value: compactMissionTime(mission.returnAt, now) });
  return timings;
}

function pastMissionHeaderTiming(mission: FleetMissionSummary, now: number): EndpointTiming {
  return { label: "Returned", value: compactMissionTime(mission.returnAt, now) };
}

// Shared fleet/cargo summary for every card: ship icons with ×N counts above the cargo line
// (VEY-400 card spec). Cargo is omitted only when a caller has no cargo data (battle-report rows).
// Loot is the return-leg haul from the mission's battle report; it renders on its own line beneath
// the outbound cargo so the two read separately (VEY-404) and is omitted until a fleet is heading
// home with a resolved report.
function MissionFleet({
  cargo,
  harvested,
  loot,
  losses,
  mission,
  ships,
}: {
  cargo?: FleetMissionSummary["cargo"] | undefined;
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
  mission?: FleetMissionSummary | undefined;
  ships: Record<string, string>;
}) {
  // VEY-KANEO-495: a resolved attack that lost ships must not read like a normal completed mission.
  // For the player's own offensive mission a DefenderWin is a failed attack, so the card shows a
  // distinct red "Attack failed — fleet lost" flag (criterion 2). All resolved battles also state the
  // outcome (coloured by result), non-zero per-side fleet losses (criterion 1's resource-value fallback
  // — per-ship loss counts are not in the served payload), and any debris created for follow-up harvest
  // (criterion 3). A winning no-loss raid shows the green outcome without a noisy empty Losses line.
  const attackFailed = losses && mission ? isFailedPlayerAttack(mission.missionType, losses.outcome) : false;
  const historicalDefenseHold = mission?.missionType === "DefenseHold"
    && (
      mission.defenseHoldOutcome !== undefined
      || mission.destroyedShips !== undefined
      || mission.survivingShips !== undefined
    )
    ? mission
    : null;
  return (
    <div className="space-y-1">
      <FleetIcons ships={ships} />
      {historicalDefenseHold ? (
        <>
          <p className="text-[11px] text-slate-500">Original stationed fleet {formatShips(historicalDefenseHold.originalShips ?? historicalDefenseHold.ships)}</p>
          <p className="text-[11px] text-slate-500">Destroyed in combat {historicalDefenseHold.destroyedShips === undefined || historicalDefenseHold.destroyedShips === null ? "Exact composition unavailable" : formatShips(historicalDefenseHold.destroyedShips)}</p>
          <p className="text-[11px] text-slate-500">Surviving return fleet {historicalDefenseHold.survivingShips === undefined || historicalDefenseHold.survivingShips === null ? "Exact composition unavailable" : formatShips(historicalDefenseHold.survivingShips)}</p>
        </>
      ) : null}
      {cargo && resourceTotal(cargo) > 0 ? <p className="text-[11px] text-slate-500">Cargo {formatCargoNonZero(cargo)}</p> : null}
      {harvested && resourceTotal(harvested) > 0 ? <p className="text-[11px] text-slate-500">Debris collected {formatCargoNonZero(harvested)}</p> : null}
      {loot && resourceTotal(loot) > 0 ? <p className="text-[11px] text-slate-500">Loot grabbed {formatCargoNonZero(loot)}</p> : null}
      {losses ? (
        <>
          {attackFailed ? (
            <p className="inline-flex items-center rounded border border-red-300/40 bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-200">
              Attack failed — fleet lost
            </p>
          ) : null}
          <p className={`text-[11px] ${battleOutcomeTextTone(losses.outcome)}`}>Outcome {battleOutcomeLabel(losses.outcome)}</p>
          {resourceTotal(losses.attacker) > 0 ? (
            <p className="text-[11px] text-slate-500">Attacker losses {formatCargoNonZero(losses.attacker)}</p>
          ) : null}
          {resourceTotal(losses.defender) > 0 ? (
            <p className="text-[11px] text-slate-500">Defender losses {formatCargoNonZero(losses.defender)}</p>
          ) : null}
          {debrisTotal(losses.debris) > 0 ? (
            <p className="text-[11px] text-slate-500">Debris generated {formatDebrisNonZero(losses.debris)}</p>
          ) : null}
        </>
      ) : null}
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

export function returnPhaseHarvestedResources(
  mission: FleetMissionSummary,
): FleetMissionSummary["returnCargo"] | undefined {
  if (mission.missionType !== "Harvest") return undefined;
  if (mission.status === "Outbound") return undefined;
  return mission.returnCargo ?? undefined;
}

// VEY-KANEO-495: fleet losses are known the moment combat resolves, but — like loot — they belong to
// the return leg, so they surface on a card only once the fleet has left its outbound leg (a battle
// has actually happened). An en-route outbound fleet has fought nothing yet and stays loss-free even
// if a report id collides; a mission with no matching report (e.g. a transport) shows no losses line.
export function returnPhaseLosses(
  mission: FleetMissionSummary,
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>,
): MissionLossSummary | undefined {
  if (mission.status === "Outbound") return undefined;
  return lossesByMissionId.get(mission.missionId);
}

// Status pill shown in every card header (VEY-400): "En route" for outbound fleets, "Returning"/
// "Recalled" while a fleet heads home, and the terminal status ("Returned"/"Resolved"/…) for past
// missions. This folds in the VEY-399 rework intent — status reads as a pill, never a raw timestamp.
// VEY-KANEO-433: the status pill reflects a mission's progress against the live clock, not only the
// indexed backend status. Mission resolution can lag well behind arrival (and on some deployments the
// resolver runs only on demand), so an arrived fleet keeps a stale "Outbound" backend status; showing
// "En route" then contradicts both the live ETA (already at zero) and the mission-detail timeline,
// which derives "Arrived"/"Returned" from the timestamps. Flipping the pill once the matching moment
// passes keeps Mission Control consistent with reality and updates on the 1s `now` tick — no manual
// refresh — which is the heart of this ticket. The auto-poll (#744) then folds in loot/battle reports
// once the backend actually resolves the mission.
export function missionStatusPill(mission: FleetMissionSummary, now: number): MissionStatusPill {
  if (isPendingMissionLaunch(mission)) {
    return { label: "Indexing", tone: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
  }
  if (mission.resolutionBlocker === "randomness_pending") {
    return { label: "Awaiting randomness", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  }
  if (mission.missionType === "DefenseHold" && mission.defenseHoldOutcome === "Recalled") {
    return { label: "Recalled", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  }
  // VEY-KANEO-468: completions settle lazily on-chain (the next mutating call; combat via the battle
  // keeper). A leg whose clock has passed but whose backend status has not advanced is mid-settlement,
  // so the pill reads "Resolving" until the chain reflects it — not a finished "Arrived"/"Returned".
  if (mission.status === "Outbound") {
    if (mission.missionType === "DefenseHold" && isDefenseHoldStationed(mission, now)) {
      return { label: "Stationed", tone: "border-violet-300/25 bg-violet-300/10 text-violet-100" };
    }
    return isMissionDue(mission, now)
      ? { label: "Resolving", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" }
      : { label: "En route", tone: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
  }
  if (mission.status === "Returning" || mission.status === "Recalled") {
    if (isMissionReturned(mission, now)) {
      return { label: "Resolving", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
    }
    return mission.status === "Returning"
      ? { label: "Returning", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" }
      : { label: "Recalled", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  }
  return { label: mission.status, tone: "border-slate-300/20 bg-slate-300/10 text-slate-300" };
}

// Shared style for the "Open" and "Join" row actions (VEY-397#14).
const rowActionButtonClass = "inline-flex h-10 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500 sm:h-8";

// Compact absolute timestamp like "Jun 8, 9:55 AM" (VEY-399#4) — collapsing to time-only ("9:55 AM")
// when the moment falls on the viewer's current calendar day, since repeating today's date on every
// row says nothing.
function compactMissionTime(value: string, now: number): string {
  const timestamp = timestampToMs(value);
  if (timestamp === undefined) return "Unknown";
  const sameDay = new Date(timestamp).toDateString() === new Date(now).toDateString();
  return sameDay
    ? formatUserTimestamp(timestamp, { hour: "numeric", minute: "2-digit" })
    : formatUserTimestamp(timestamp, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
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

// `muted` renders the status as quiet grey text instead of a pill: a label that is true for nearly
// every row of a list (Returned/Resolved in the past archive) distinguishes nothing and should not
// wear pill chrome.
type MissionStatusPill = { label: string; muted?: boolean; tone: string };

// The one grid template shared by every mission row AND the column-header row above each list, so
// the columns line up down the page like a real table: mission (badge stacked over #) | route |
// payload | time-over-status | disclosure chevron. The route's planet + commander pair makes every
// row two text lines tall, so each fixed column stacks two facts vertically instead of leaving its
// second line empty — and the width saved (narrow mission column, merged time/status) goes to the
// route. Below lg the rows fall back to a stacked flex-wrap layout (badge line, route line,
// payload line) where per-item inline labels do the header's job.
const MISSION_ROW_GRID = "lg:grid lg:grid-cols-[7rem_minmax(0,1fr)_minmax(0,10rem)_7rem_1rem] lg:items-center lg:gap-x-3";

// Column headers rendered once per list — the reason the rows themselves carry no ORIGIN /
// DESTINATION / ARRIVED label chatter. Hidden below lg where rows are stacked and self-labelling.
function MissionListHeader() {
  return (
    <div className={`hidden border-b border-white/[0.06] px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600 sm:px-3 ${MISSION_ROW_GRID}`}>
      <span>Mission</span>
      <span>Route</span>
      <span className="text-right">Payload</span>
      <span className="text-right">Status</span>
      <span aria-hidden="true" />
    </div>
  );
}

// The shared mission-card presentation used by every Mission Control panel (VEY-400). Active and
// past missions both render through this one component so the two panels stay in sync. Each row is
// a native <details>: the always-visible summary is the at-a-glance line (mission-type badge +
// #number + route with directional progress arrow + payload glance + one phase-relevant time +
// status) and expanding it reveals the fleet/cargo/loot breakdown, the full arrival/return
// timestamps, and the contextual action(s). Rows are hook-free — expansion is browser-native,
// matching the DOM-driven tab/page pattern of the rest of the panel.
function MissionCard({
  actions,
  badgeLabel,
  badgeTone,
  defaultOpen,
  detailTimings = [],
  direction,
  fleet,
  glance,
  groupId,
  headerTiming,
  hostile,
  missionId,
  origin,
  progressPercent,
  routeSubtext,
  statusPill,
  subdued,
  target,
}: {
  actions: preact.ComponentChildren;
  badgeLabel: string;
  badgeTone: string;
  defaultOpen?: boolean | undefined;
  detailTimings?: EndpointTiming[] | undefined;
  direction: RouteLeg;
  fleet: preact.ComponentChildren;
  glance?: preact.ComponentChildren;
  groupId?: string | null | undefined;
  headerTiming?: EndpointTiming | undefined;
  hostile?: boolean | undefined;
  missionId?: string | undefined;
  origin: MissionEndpoint;
  progressPercent?: number | undefined;
  routeSubtext?: string | undefined;
  statusPill?: MissionStatusPill | undefined;
  subdued?: boolean | undefined;
  target: MissionEndpoint;
}) {
  return (
    <details
      className={`group/mission text-xs text-slate-300 ${hostile ? "border-l-2 border-l-red-400/60 bg-red-400/[0.04]" : ""}`}
      data-default-open={defaultOpen ? "true" : undefined}
      data-mission-row
      onToggle={(event) => syncMissionRowsDisclosureControl(event.currentTarget)}
      ref={(element) => initializeMissionRowDisclosure(element, Boolean(defaultOpen))}
    >
      {/* DOM order is column order (mission, route, payload, time, status, chevron); the mobile
          stacked layout re-flows it purely with order utilities that lg resets. Empty cells still
          render on lg so absent data never shifts a row's columns out of alignment. */}
      <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2.5 py-2 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50 sm:px-3 [&::-webkit-details-marker]:hidden ${MISSION_ROW_GRID}`}>
        {/* Mission cell: inline on mobile, badge stacked over a muted # on lg — the stack keeps the
            column narrow and lines the numbers up under each other. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 lg:flex-col lg:items-start lg:justify-center">
          <span className={`inline-flex max-w-full shrink-0 truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badgeTone}`} title={badgeLabel}>{badgeLabel}</span>
          {missionId ? <span className="shrink-0 text-[11px] font-semibold text-white lg:font-medium lg:text-slate-400">{missionIdLabel(missionId)}</span> : null}
        </span>
        <div
          className="order-2 w-full min-w-0 lg:order-none lg:w-auto"
          onClick={(event) => {
            const clicked = event.target instanceof Element ? event.target : null;
            if (clicked?.closest("a,button")) event.stopPropagation();
          }}
        >
          <MissionRouteCell compact direction={direction} origin={origin} progressPercent={progressPercent} subdued={subdued} target={target} />
        </div>
        {/* Payload cell: on lg each stat is a full-width right-aligned block so long values wrap
            inside the column (never spilling into the route) and keep the column's right edge. */}
        <span className={`${glance ? "order-3 flex w-full flex-wrap items-center gap-x-2 gap-y-1" : "hidden"} min-w-0 lg:order-none lg:block lg:w-auto lg:space-y-0.5 lg:text-right`}>
          {glance}
        </span>
        {/* Time + status are the same fact told twice, so they share one cell: time on the first
            line, the state underneath (quiet text for expected states, a pill for unusual ones). */}
        <span className="order-1 ml-auto flex min-w-0 items-center gap-x-2 lg:order-none lg:ml-0 lg:flex-col lg:items-end lg:justify-center lg:gap-y-0.5">
          {headerTiming ? (
            <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-400">
              <span className="font-semibold uppercase tracking-[0.1em] text-slate-600 lg:hidden">{headerTiming.label} </span>
              {headerTiming.value}
            </span>
          ) : null}
          {statusPill ? (
            statusPill.muted ? (
              // Expected terminal states: quiet text, desktop only — on mobile the time's inline
              // "Returned 9:23 AM" label already says it, so repeating the word is noise.
              <span className="hidden text-[11px] text-slate-600 lg:inline">{statusPill.label}</span>
            ) : (
              <span className={`inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusPill.tone}`} title={statusPill.label}>
                {statusPill.label}
              </span>
            )
          ) : null}
        </span>
        <ChevronDown aria-hidden="true" className="order-1 shrink-0 text-slate-500 transition-transform group-open/mission:rotate-180 lg:order-none lg:justify-self-end" size={14} />
      </summary>
      <div className="border-t border-white/[0.06] px-2.5 pb-2.5 pt-2 sm:px-3">
        {/* Detail facts fill the left; actions sit beside them at the top-right instead of floating
            alone at the bottom of a full-width band. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid min-w-0 gap-2">
            {routeSubtext || groupId || detailTimings.length > 0 ? (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {routeSubtext ? <span>{routeSubtext}</span> : null}
                {groupId ? <span>{`Group ${groupId}`}</span> : null}
                {detailTimings.map((timing) => (
                  <span className="tabular-nums" key={timing.label}>
                    <span className="font-semibold uppercase tracking-[0.1em] text-slate-600">{timing.label}</span> {timing.value}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="min-w-0">{fleet}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">{actions}</div>
        </div>
      </div>
    </details>
  );
}

export function initializeMissionRowDisclosure(element: HTMLDetailsElement | null, defaultOpen: boolean): void {
  if (!element || element.dataset.disclosureInitialized === "true") return;
  element.dataset.disclosureInitialized = "true";
  if (defaultOpen) element.open = true;
}

// Compact payload facts shown on the collapsed row. Every semantically distinct non-zero value is
// visible at a glance; zero totals render nothing at all. Resolved combat leads with its outcome —
// the one fact a player scans battle history for.
function missionGlance({
  direction,
  harvested,
  loot,
  losses,
  mission,
}: {
  direction: MissionDirection;
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
  mission: FleetMissionSummary;
}): preact.ComponentChildren {
  return (
    <>
      {losses ? outcomeGlanceStat(losses, mission, direction) : null}
      {/* The "Cargo" prefix is desktop-redundant (the PAYLOAD column header says it) but mobile
          rows self-label. Loot/Debris keep their one-word prefix everywhere — that distinction is
          real information. */}
      {resourceTotal(mission.cargo) > 0 ? glanceStat("Cargo", mission.cargo, { labelOnDesktop: false }) : null}
      {loot && resourceTotal(loot) > 0 ? glanceStat("Loot", loot) : null}
      {harvested && resourceTotal(harvested) > 0 ? glanceStat("Debris", harvested) : null}
    </>
  );
}

// The battle outcome from the player's side of it: their own attack reads Won / Attack failed,
// an attack on their planet reads Defended / Raided. Observer rows (the universe-wide tab, where
// direction is neutral) keep the attacker's perspective wording.
function outcomeGlanceStat(losses: MissionLossSummary, mission: FleetMissionSummary, direction: MissionDirection): preact.ComponentChildren {
  if (!isOffensiveMissionType(mission.missionType)) return null;
  const { label, tone } = losses.outcome === "Draw"
    ? { label: "Draw", tone: "text-amber-300/80" }
    : direction === "incoming"
      ? losses.outcome === "DefenderWin"
        ? { label: "Defended", tone: "text-emerald-300/80" }
        : { label: "Raided", tone: "text-red-300/90" }
      : losses.outcome === "AttackerWin"
        ? { label: "Won", tone: "text-emerald-300/80" }
        : { label: "Attack failed", tone: "text-red-300/90" };
  return <span className={`text-[11px] font-medium ${tone} lg:block lg:w-full`}>{label}</span>;
}

function glanceStat(
  label: string,
  cargo: { metal: string; crystal: string; deuterium: string },
  { labelOnDesktop = true }: { labelOnDesktop?: boolean } = {},
): preact.ComponentChildren {
  return (
    <span className="text-[11px] tabular-nums text-slate-400 lg:block lg:w-full">
      <span className={`text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-600 ${labelOnDesktop ? "" : "lg:hidden"}`}>{label}</span>{" "}
      {formatCargoCompact(cargo)}
    </span>
  );
}

function missionIdLabel(missionId: string): string {
  return missionId.startsWith("pending:") ? "Pending" : `#${missionId}`;
}

// Expanded-panel fleet chips: ship image, name, and xN count. The name is spelled out because the
// expanded view has the room and hover-only titles don't exist on touch screens.
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
            {asset ? <img alt="" className="h-5 w-5 shrink-0 rounded object-contain" loading="lazy" src={asset} /> : null}
            <span className="text-[10px] text-slate-300">{name}</span>
            <span className="text-[11px] font-medium tabular-nums text-slate-200">{`x${formatResource(count)}`}</span>
          </span>
        );
      })}
    </div>
  );
}

function ActionButton({ action, onClick }: { action: MissionLifecycleAction; onClick: () => void }) {
  const button = (
    <button
      className={`rounded border px-3 py-2 text-xs font-medium transition sm:px-2 sm:py-1 ${
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

  if (action.enabled || !action.reason) {
    return button;
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {button}
      <ActionReasonNote reason={action.reason} />
    </span>
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Shareable mission report</p>
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
          <ReportLine label="Status" value={missionDisplayStatusLabel(mission, now)} />
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
          <ReportLine label={mission.missionType === "Harvest" ? "Debris collected" : "Debris field"} value={report.debris} />
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
  { emptyLabel: "No completed incoming attacks are visible for this wallet yet.", key: "incomingAttacks", label: "Incoming attacks" },
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
  clientFiltered = false,
): number {
  if (clientFiltered) return rows.length;
  const currentPagination = pagination ?? paginationForRows(rows, 25);
  return pagination
    ? Math.max(rows.length, currentPagination.totalEntries - collapsedCount)
    : currentPagination.totalEntries;
}

type PastMissionTabData = {
  clientFiltered: boolean;
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
  incomingAttackCollapsedCount = 0,
  incomingAttackError,
  incomingAttackLoading = false,
  incomingAttackPagination,
  incomingAttackRows,
  loading,
  lootByMissionId,
  lossesByMissionId,
  missionFilterEmptyLabel,
  missionFiltersActive,
  missionStateFilterActive,
  now,
  onAllPageChange,
  onIncomingAttackPageChange,
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
  incomingAttackCollapsedCount?: number | undefined;
  incomingAttackError?: string | undefined;
  incomingAttackLoading?: boolean | undefined;
  incomingAttackPagination?: FleetMissionArchiveResponse["pagination"] | undefined;
  incomingAttackRows: PastMissionRow[];
  loading: boolean;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
  missionFilterEmptyLabel: string;
  missionFiltersActive: boolean;
  missionStateFilterActive: boolean;
  now: number;
  onAllPageChange?: ((page: number) => void) | undefined;
  onIncomingAttackPageChange?: ((page: number) => void) | undefined;
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
      clientFiltered: missionStateFilterActive,
      collapsedCount: allCollapsedCount,
      emptyLabel: missionFiltersActive ? missionFilterEmptyLabel : "No completed missions in the universe yet.",
      error: allError,
      loading: allLoading,
      onPageChange: onAllPageChange,
      pagination: allPagination,
      rows: allRows,
    },
    incomingAttacks: {
      clientFiltered: missionStateFilterActive,
      collapsedCount: incomingAttackCollapsedCount,
      emptyLabel: missionFiltersActive ? missionFilterEmptyLabel : "No completed incoming attacks are visible for this wallet yet.",
      error: incomingAttackError,
      loading: incomingAttackLoading,
      onPageChange: onIncomingAttackPageChange,
      pagination: incomingAttackPagination,
      rows: incomingAttackRows,
    },
    mine: {
      clientFiltered: missionStateFilterActive,
      collapsedCount,
      emptyLabel: missionFiltersActive ? missionFilterEmptyLabel : "No completed missions are visible for this wallet yet.",
      error,
      loading,
      onPageChange,
      pagination,
      rows,
    },
  };
  const sharedRowProps = { lootByMissionId, lossesByMissionId, now, onOpenReport, planetLookup, wallet, walletPlanetIds };

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#101624]" data-past-tab={pastTab}>
      <div className="flex flex-col gap-2 border-b border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Past missions</h3>
        <div aria-label="Past missions scope" className="flex flex-wrap gap-1.5" role="tablist">
          {PAST_MISSION_TABS.map((tab) => {
            const data = dataByTab[tab.key];
            const count = pastDisplayTotalEntries(data.rows, data.pagination, data.collapsedCount, missionStateFilterActive);
            return (
              <button
                aria-selected={tab.key === pastTab}
                className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100 sm:py-1"
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
  clientFiltered,
  collapsedCount,
  emptyLabel,
  error,
  initialClientPage = 0,
  loading,
  lootByMissionId,
  lossesByMissionId,
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
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
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
  const hasPages = !clientFiltered && currentPagination.totalPages > 1;
  const visiblePages = pagination ? [rows] : pages;
  const clientPage = pagination ? 0 : currentPagination.page - 1;
  const displayTotalEntries = pastDisplayTotalEntries(rows, pagination, collapsedCount, clientFiltered);

  return (
    <div
      data-past-page-current={String(currentPagination.page - 1)}
      data-past-page-size={String(currentPagination.pageSize)}
      data-past-page-total={String(displayTotalEntries)}
    >
      {error ? (
        <div className="px-3 pt-3">
          {isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="danger">{error}</Notice>}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">{loading ? "Loading completed missions…" : emptyLabel}</p>
      ) : (
        <>
          <div>
            <MissionListHeader />
            {visiblePages.map((pageRows, pageIndex) => (
              <div
                className="divide-y divide-white/[0.06]"
                data-past-page={pageIndex}
                hidden={!pagination && pageIndex !== clientPage}
                key={`past-mission-page:${pageIndex}`}
              >
                {pageRows.map((row) => row.kind === "mission" ? (
                  <PastMissionSummaryRow
                    harvested={returnPhaseHarvestedResources(row.mission)}
                    key={`past-mission:${row.mission.missionId}`}
                    loot={returnPhaseLoot(row.mission, lootByMissionId)}
                    losses={returnPhaseLosses(row.mission, lossesByMissionId)}
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
                className="px-2.5 pb-2 sm:px-3"
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
  harvested,
  loot,
  losses,
  mission,
  now,
  onOpenReport,
  planetLookup,
  wallet,
  walletPlanetIds,
}: {
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
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
      glance={missionGlance({ direction: missionDirection, harvested, loot, losses, mission })}
      badgeLabel={directionalMissionTypeLabel(mission.missionType, missionDirection)}
      badgeTone={missionTypeTone(mission.missionType)}
      detailTimings={missionDetailTimings(mission, now)}
      // A settled journey: keep the origin -> target direction but drop the live-traffic cyan.
      direction="outbound"
      fleet={<MissionFleet cargo={mission.cargo} harvested={harvested} loot={loot} losses={losses} mission={mission} ships={mission.ships} />}
      groupId={mission.attackGroupId}
      headerTiming={pastMissionHeaderTiming(mission, now)}
      missionId={mission.missionId}
      statusPill={pastMissionStatusPill(mission, now)}
      subdued
      {...routeEndpointsForRow(origin, target, wallet)}
    />
  );
}

// Past-archive status: the expected terminal states (Returned/Resolved) mute to plain text — on a
// list where every row ended normally the pill said nothing. Unusual endings (Recalled, Awaiting
// randomness, mid-settlement Resolving) keep their colored pill so they stand out.
function pastMissionStatusPill(mission: FleetMissionSummary, now: number): MissionStatusPill {
  const pill = missionStatusPill(mission, now);
  if (pill.label === "Returned" || pill.label === "Resolved") return { ...pill, muted: true };
  return pill;
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
  const target = battleReportTargetEndpoint(report, planetLookup);
  const origin: MissionEndpoint = {
    archetype: null,
    commanderName: shortHash(report.attacker),
    commanderWallet: report.attacker,
    coordinates: null,
    coords: null,
    bodyKind: "planet",
    hasMoon: false,
    name: "Attacker",
  };
  // ACS grouped attack: surface the combined group loot and the joiner count so the compact row makes
  // clear the haul was split, with the per-participant breakdown one click away on the detail screen.
  const participants = report.participants ?? [];
  const isGroupedAttack = participants.length > 1;
  const lootShown = isGroupedAttack ? sumLoot(participants) : report.loot;
  const joinerCount = isGroupedAttack ? participants.length - 1 : 0;
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
      glance={resourceTotal(lootShown) > 0 ? glanceStat("Loot", lootShown) : null}
      subdued
      fleet={
        <div className="space-y-1">
          {resourceTotal(lootShown) > 0 ? (
            <p className="text-[11px] text-slate-500">
              {isGroupedAttack ? "Group loot grabbed " : "Loot grabbed "}{formatCargoNonZero(lootShown)}
            </p>
          ) : null}
          {resourceTotal(report.attackerLosses) > 0 ? (
            <p className="text-[11px] text-slate-500">Attacker losses {formatCargoNonZero(report.attackerLosses)}</p>
          ) : null}
          {resourceTotal(report.defenderLosses) > 0 ? (
            <p className="text-[11px] text-slate-500">Defender losses {formatCargoNonZero(report.defenderLosses)}</p>
          ) : null}
          {debrisTotal(report.debris) > 0 ? (
            <p className="text-[11px] text-slate-500">Debris generated {formatDebrisNonZero(report.debris)}</p>
          ) : null}
          {isGroupedAttack ? (
            <p className="text-[11px] text-cyan-300/80">ACS group · {joinerCount} {joinerCount === 1 ? "joiner" : "joiners"}</p>
          ) : null}
        </div>
      }
      missionId={report.missionId}
      origin={origin}
      routeSubtext={`${battleOutcomeLabel(report.outcome)} · Block ${report.blockNumber || "unknown"} · ${report.rounds} rounds`}
      statusPill={{ label: battleOutcomeLabel(report.outcome), tone: battleOutcomePillTone(report.outcome) }}
      target={target}
    />
  );
}

function battleReportTargetEndpoint(report: BattleReport, planetLookup: ReadonlyMap<string, MissionPlanetIdentity>): MissionEndpoint {
  const target = endpointFromPlanetId(report.targetPlanetId, planetLookup);
  if (!report.targetIsMoon) return target;
  return {
    ...target,
    hasMoon: true,
    name: target.name ? `Moon of ${target.name}` : `Moon at planet #${report.targetPlanetId}`,
  };
}

// Sum each participant's loot share into the combined ACS group total (BigInt to stay exact for the
// uint128 resource amounts). Mirrors the per-participant split the contract performs on-chain.
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

  syncMissionRowsDisclosureControl(section);
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
  syncMissionRowsDisclosureControl(section);
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
  syncMissionRowsDisclosureControl(section);
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
    <div className={`flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <span>
        <span data-past-page-label>Page {pagination.page} of {pagination.totalPages}</span>
        <span className="ml-2 text-slate-600" data-past-page-range>{`${firstEntry}-${lastEntry} of ${pagination.totalEntries}`}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          aria-label={prevLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
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
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
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
  return <div className={`notice-enter rounded-lg border p-3 text-sm ${className}`}>{children}</div>;
}

function isMissionDue(mission: FleetMissionSummary, now: number): boolean {
  return mission.status === "Outbound" && missionDueAtMs(mission) <= now;
}

// VEY-KANEO-479: an Attack/Harvest fleet's resolution is keeper-driven and, for attacks, gated on the
// battle randomness being committed on-chain — so its arrival clock passing does NOT mean it can be
// settled yet. Rely solely on the backend's `needsResolution` (which already encodes that gate) for
// combat missions instead of inferring "Ready to resolve" from the local clock, which would surface a
// phantom CTA in the window between arrival and the randomness commitment the keeper waits on. Other
// mission types stay on the existing clock fallback, where arrival is sufficient to resolve.
function isMissionReadyToResolve(mission: FleetMissionSummary, now: number): boolean {
  if (mission.needsResolution) {
    return true;
  }
  if (mission.missionType === "Attack" || mission.missionType === "Harvest") {
    return false;
  }
  return isMissionDue(mission, now);
}

// The contract refuses a recall once a fleet is within FLEET_RECALL_CUTOFF_SECONDS of arrival (and
// after arrival), reverting with "the recall cutoff has passed" — VeydriftGameStorage exposes
// FLEET_RECALL_CUTOFF_SECONDS = 60. A fleet is therefore recallable only while it is still Outbound
// and more than that cutoff away from arrival. Both Mission Control and Mission Detail gate their
// Recall affordances on this so the two screens stay consistent (VEY-KANEO-424).
const FLEET_RECALL_CUTOFF_SECONDS = 60;

export function isFleetRecallable(mission: FleetMissionSummary, now: number): boolean {
  if (mission.missionType === "DefenseHold") {
    return mission.status === "Outbound" && now < defenseHoldRecallUntilMs(mission);
  }
  return mission.status === "Outbound"
    && now <= (Number(mission.arrivalAt) - FLEET_RECALL_CUTOFF_SECONDS) * 1_000;
}

function missionDueAtMs(mission: FleetMissionSummary): number {
  if (mission.missionType === "DefenseHold") return defenseHoldRecallUntilMs(mission);
  return Number(mission.arrivalAt) * 1_000;
}

function defenseHoldRecallUntil(mission: FleetMissionSummary): string {
  return mission.defenseHoldUntil ?? mission.returnAt;
}

function defenseHoldRecallUntilMs(mission: FleetMissionSummary): number {
  return Number(defenseHoldRecallUntil(mission)) * 1_000;
}

function isDefenseHoldStationed(mission: FleetMissionSummary, now: number): boolean {
  return mission.status === "Outbound"
    && Number(mission.arrivalAt) * 1_000 <= now
    && now < defenseHoldRecallUntilMs(mission);
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
    return compareMissionIds(left.mission.missionId, right.mission.missionId);
  });
}

function compareMissionIds(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
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

export function normalizeMissionNumberSearch(value: string): string {
  return value.replace(/\D+/g, "");
}

export function normalizeMissionControlFilters(filters: Partial<MissionControlFilters>): MissionControlFilters {
  const direction = filters.direction;
  return {
    direction: direction === "outbound" || direction === "returning" ? direction : "",
    missionNumber: normalizeMissionNumberSearch(filters.missionNumber ?? ""),
    missionType: (filters.missionType ?? "").trim(),
    planetId: (filters.planetId ?? "").replace(/\D+/g, "").replace(/^0+(?=\d)/, ""),
  };
}

export function missionControlActiveFilterCount(filters: Partial<MissionControlFilters>): number {
  const normalized = normalizeMissionControlFilters(filters);
  return [
    normalized.direction,
    normalized.missionNumber,
    normalized.missionType,
    normalized.planetId,
  ].filter(Boolean).length;
}

export function missionIdMatchesMissionNumberSearch(missionId: string, missionNumberSearch: string): boolean {
  const normalized = normalizeMissionNumberSearch(missionNumberSearch);
  return normalized.length === 0 || missionId.includes(normalized);
}

function missionMatchesBaseFilters(mission: FleetMissionSummary, filters: MissionControlFilters): boolean {
  return missionIdMatchesMissionNumberSearch(mission.missionId, filters.missionNumber)
    && (!filters.missionType || mission.missionType === filters.missionType)
    && (!filters.planetId || mission.originPlanetId === filters.planetId || mission.targetPlanetId === filters.planetId);
}

export function activeMissionRowMatchesFilters(row: ActiveMissionRow, rawFilters: Partial<MissionControlFilters>): boolean {
  const filters = normalizeMissionControlFilters(rawFilters);
  if (!missionMatchesBaseFilters(row.mission, filters)) return false;
  if (!filters.direction) return true;
  if (filters.direction === "returning") {
    return row.context === "returning" || row.mission.status === "Returning" || row.mission.status === "Recalled";
  }
  return row.mission.status === "Outbound" && row.context !== "returning";
}

function filterActiveMissionRows(rows: ActiveMissionRow[], filters: MissionControlFilters): ActiveMissionRow[] {
  if (missionControlActiveFilterCount(filters) === 0) return rows;
  return rows.filter((row) => activeMissionRowMatchesFilters(row, filters));
}

function battleReportMatchesBaseFilters(report: BattleReport, filters: MissionControlFilters): boolean {
  return missionIdMatchesMissionNumberSearch(report.missionId, filters.missionNumber)
    && (!filters.missionType || filters.missionType === "Attack")
    && (!filters.planetId || report.targetPlanetId === filters.planetId);
}

function pastMissionRowMatchesFilters(
  row: PastMissionRow,
  filters: MissionControlFilters,
): boolean {
  if (row.kind === "battleReport") {
    if (!battleReportMatchesBaseFilters(row.report, filters)) return false;
    return !filters.direction;
  }
  if (!missionMatchesBaseFilters(row.mission, filters)) return false;
  return !filters.direction;
}

function filterPastMissionRows(
  rows: PastMissionRow[],
  filters: MissionControlFilters,
): PastMissionRow[] {
  if (missionControlActiveFilterCount(filters) === 0) return rows;
  return rows.filter((row) => pastMissionRowMatchesFilters(row, filters));
}

function dedupePastMissionRows(
  rows: PastMissionRow[],
  activeMissionIds: ReadonlySet<string> = new Set<string>(),
): PastMissionRow[] {
  const missionSummaryIds = new Set(
    rows.filter((row) => row.kind === "mission").map((row) => pastRowMissionId(row))
  );
  const seen = new Set<string>();
  return rows.filter((row) => {
    const missionId = pastRowMissionId(row);
    // A battle report whose mission is still active (Outbound / Returning / Recalled — e.g. a fleet
    // that has fought but not yet arrived home) belongs to the active section, not Past Missions. Its
    // loot already surfaces on the active card, so drop it here to avoid duplicating the live mission
    // into the archive. The report returns to Past Missions once the fleet fully lands (VEY-KANEO-434).
    if (row.kind === "battleReport" && activeMissionIds.has(missionId)) return false;
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

function incomingAttackPastMissionRows(
  rows: PastMissionRow[],
  wallet: string | undefined,
  walletPlanetIds: ReadonlySet<string>,
): PastMissionRow[] {
  return rows.filter((row) => {
    if (row.kind === "battleReport") return walletPlanetIds.has(row.report.targetPlanetId);
    return row.mission.missionType === "Attack"
      && resolveMissionDirection({ mission: row.mission, wallet, walletPlanetIds }) === "incoming";
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

function missionTypeTone(missionType: string): string {
  if (["Attack", "AcsAttack", "MissileAttack"].includes(missionType)) {
    return "border-red-300/25 bg-red-400/10 text-red-100";
  }
  if (missionType === "Transport") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (missionType === "Deploy") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (missionType === "Harvest") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(missionType)) return "border-violet-300/25 bg-violet-300/10 text-violet-100";
  return "border-slate-300/20 bg-slate-300/10 text-slate-100";
}


function walletReason(canTransact: boolean, transactionUnavailableReason?: string | undefined): string | undefined {
  return canTransact ? undefined : transactionUnavailableReason ?? "Wallet or mission actions unavailable.";
}

function formatCargo(cargo: FleetMissionSummary["cargo"]): string {
  const metal = Number(cargo.metal);
  const crystal = Number(cargo.crystal);
  const deuterium = Number(cargo.deuterium);
  if (metal + crystal + deuterium === 0) return "Empty";
  return `${formatResource(cargo.metal)} M / ${formatResource(cargo.crystal)} C / ${formatResource(cargo.deuterium)} D`;
}

function formatCargoNonZero(cargo: { metal: string; crystal: string; deuterium: string }): string {
  return ([["M", cargo.metal], ["C", cargo.crystal], ["D", cargo.deuterium]] as const)
    .filter(([, value]) => Number(value) > 0)
    .map(([suffix, value]) => `${formatResource(value)} ${suffix}`)
    .join(" / ");
}

const compactResourceFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });

// Glance-line cargo: only the non-zero resources, compact-notated ("1.9K M · 3.2K C"), so the
// collapsed row spends no width on empty components. The expanded card keeps the exact figures.
function formatCargoCompact(cargo: { metal: string; crystal: string; deuterium: string }): string {
  const parts = ([["M", cargo.metal], ["C", cargo.crystal], ["D", cargo.deuterium]] as const)
    .filter(([, value]) => Number(value) > 0)
    .map(([suffix, value]) => `${formatResourceCompact(value)} ${suffix}`);
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}

function formatResourceCompact(value: string): string {
  const numeric = Number(value);
  return Math.abs(numeric) < 10_000 ? numeric.toLocaleString("en-US") : compactResourceFormatter.format(numeric);
}

function harvestReturnCargoLabel(mission: FleetMissionSummary): string | null {
  if (mission.missionType !== "Harvest") return null;
  if (!mission.returnCargo) return "Unavailable for legacy harvest reports.";
  return formatCargo(mission.returnCargo);
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

// VEY-KANEO-433: the text-label counterpart to `missionStatusPill` — a phase label that tracks the
// live clock so the mission report card and shared battle-report text never read "en route" for a
// fleet that has already arrived (or "returning" for one that has already landed). Keeps the report
// surfaces consistent with the time-aware list pills and the mission-detail timeline.
export function missionDisplayStatusLabel(mission: FleetMissionSummary, now: number): string {
  if (mission.status === "Outbound" && mission.missionType === "DefenseHold" && isDefenseHoldStationed(mission, now)) {
    return "stationed";
  }
  // VEY-KANEO-468: a leg whose clock has passed but whose on-chain status has not advanced is
  // mid-settlement (lazy reconcile / battle keeper), so it reads "resolving" until the chain
  // reflects it — mirroring the "Resolving" list pill.
  if (mission.status === "Outbound" && isMissionDue(mission, now)) {
    if (mission.resolutionBlocker === "randomness_pending") return "awaiting randomness";
    return "resolving";
  }
  if ((mission.status === "Returning" || mission.status === "Recalled") && isMissionReturned(mission, now)) {
    return "resolving";
  }
  return missionStatusLabel(mission.status);
}

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
  return rows.flatMap((row) => {
    if (row.kind === "battleReport") return [row.report];
    return row.report ? [row.report] : [];
  });
}

// Return-leg loot keyed by mission id, gathered from every battle report visible across the live
// fleet feed and the paginated archives. A mission card pairs this with the mission's outbound cargo
// so "Cargo" and "Loot" read as separate lines instead of the loot being dropped when a completed
// mission collapses with its battle report into one archive row (VEY-404).
function lootByMissionIdFromReports(reports: BattleReport[]): Map<string, BattleReport["loot"]> {
  const lookup = new Map<string, BattleReport["loot"]>();
  for (const report of reports) {
    lookup.set(report.missionId, report.loot);
    for (const participant of report.participants ?? []) {
      lookup.set(participant.missionId, participant.loot);
    }
  }
  return lookup;
}

// VEY-KANEO-495: the attacker/defender fleet losses for a resolved battle, surfaced on the mission
// card's "Losses" line. On-chain CombatLosses is a single combined figure per battle (not split per
// ACS participant), so each side's aggregate resource loss is taken straight from the report.
export type MissionLossSummary = {
  outcome: BattleReport["outcome"];
  attacker: BattleReport["attackerLosses"];
  defender: BattleReport["defenderLosses"];
  // Debris field (metal/crystal) created by the battle — surfaced for follow-up harvest planning
  // (VEY-KANEO-495 criterion 3), alongside the per-side losses.
  debris: BattleReport["debris"];
};

// Fleet losses keyed by mission id, gathered from every battle report visible across the live fleet
// feed and the paginated archives — mirrors lootByMissionIdFromReports so a card can pair the
// outbound cargo, the return-leg loot, and the losses the battle cost on separate lines.
function lossesByMissionIdFromReports(reports: BattleReport[]): Map<string, MissionLossSummary> {
  const lookup = new Map<string, MissionLossSummary>();
  for (const report of reports) {
    const losses = { outcome: report.outcome, attacker: report.attackerLosses, defender: report.defenderLosses, debris: report.debris };
    lookup.set(report.missionId, losses);
    for (const participant of report.participants ?? []) {
      lookup.set(participant.missionId, losses);
    }
  }
  return lookup;
}

export function missionPlanetCoordinateKey(coords: Coordinates): string {
  return `${coords.galaxy}:${coords.system}:${coords.position}`;
}

export function missionSystemKeysMissingUniverseArchetypes(
  missions: readonly FleetMissionSummary[],
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType> = EMPTY_PLANET_ARCHETYPE_LOOKUP,
): string[] {
  const systemKeys = new Set<string>();
  for (const mission of missions) {
    addMissionReferenceSystemKey(systemKeys, mission.originPlanet, planetArchetypesByCoordinate);
    addMissionReferenceSystemKey(systemKeys, mission.targetPlanet, planetArchetypesByCoordinate);
  }
  return Array.from(systemKeys).sort();
}

function addMissionReferenceSystemKey(
  systemKeys: Set<string>,
  ref: FleetMissionPlanetReference | null | undefined,
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType>,
): void {
  if (!ref || ref.archetype) return;
  const coords = { galaxy: ref.galaxy, position: ref.position, system: ref.system };
  if (planetArchetypesByCoordinate.has(missionPlanetCoordinateKey(coords))) return;
  systemKeys.add(`${ref.galaxy}:${ref.system}`);
}

function planetLookupFromMissionData(
  missions: FleetMissionSummary[],
  walletPlanets: ManagedPlanetResponse[],
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType>,
): Map<string, MissionPlanetIdentity> {
  const lookup = new Map<string, MissionPlanetIdentity>();
  for (const planet of walletPlanets) {
    lookup.set(planet.planetId, identityFromManagedPlanet(planet));
  }
  for (const mission of missions) {
    if (mission.originPlanet) lookup.set(mission.originPlanet.planetId, identityFromMissionPlanet(mission.originPlanet, planetArchetypesByCoordinate));
    if (mission.targetPlanet) lookup.set(mission.targetPlanet.planetId, identityFromMissionPlanet(mission.targetPlanet, planetArchetypesByCoordinate));
  }
  return lookup;
}

function identityFromManagedPlanet(planet: ManagedPlanetResponse): MissionPlanetIdentity {
  return {
    archetype: planetTypeFromTemperature(planet.temperature),
    coordinates: planet.coordinates,
    displayName: planet.name?.trim() || `Planet [${planet.coordinates}]`,
    hasMoon: Boolean(planet.moon?.exists),
    owner: planet.owner,
    ownerDisplayName: null,
  };
}

function identityFromMissionPlanet(
  planet: FleetMissionPlanetReference,
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType>,
): MissionPlanetIdentity {
  const coords = { galaxy: planet.galaxy, position: planet.position, system: planet.system };
  return {
    archetype: planet.archetype ?? planetArchetypesByCoordinate.get(missionPlanetCoordinateKey(coords)) ?? null,
    coordinates: planet.coordinates,
    displayName: planet.name?.trim() || `Planet [${planet.coordinates}]`,
    hasMoon: Boolean(planet.hasMoon),
    owner: planet.owner,
    ownerDisplayName: planet.ownerDisplayName ?? null,
  };
}

export function missionTypeLabel(missionType: string): string {
  if (missionType === "AcsAttack") return "Group attack";
  if (missionType === "AcsDefend") return "Group defense";
  if (missionType === "DefenseHold") return "Stationed defense";
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

export function missionReport(
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
    debris: harvestReturnCargoLabel(mission) ?? "Not reported by the visible mission feed yet.",
    defender: planetLookup.get(mission.targetPlanetId)?.owner
      ? commanderLabel(planetLookup.get(mission.targetPlanetId)!.owner, planetLookup.get(mission.targetPlanetId))
      : "External commander unavailable",
    losses: mission.status === "Resolved" ? "Resolved combat losses are not exposed in this mission feed." : "Pending battle resolution.",
    origin,
    outcome: isMissionReadyToResolve(mission, now) ? "Ready to resolve." : missionDisplayStatusLabel(mission, now),
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
    `Veydrift mission report: ${report.title}`,
    `Battle time: ${report.battleTime}`,
    `Status: ${missionDisplayStatusLabel(mission, now)}`,
    `Route: ${report.routeSummary}`,
    `Attacker: ${report.attacker}`,
    `Defender: ${report.defender}`,
    `Attacker fleet: ${formatShips(mission.ships)}`,
    `Cargo carried: ${formatCargo(mission.cargo)}`,
    `Fuel burned: ${formatResource(mission.fuelCost)} deuterium`,
    `Outcome: ${report.outcome}`,
    `Losses: ${report.losses}`,
    mission.missionType === "Harvest" ? `Debris collected: ${report.debris}` : `Debris: ${report.debris}`,
    mission.attackGroupId ? `Group: ${mission.attackGroupId}` : null,
    joinedAttackMissionIds.length > 0 ? `Joined attacks: ${joinedAttackMissionIds.join(", ")}` : null,
    mission.transactionHash ? `Tx: ${mission.transactionHash}` : null,
  ].filter(Boolean).join("\n");
}

function copyText(text: string): void {
  void globalThis.navigator?.clipboard?.writeText(text);
}

function battleOutcomeLabel(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "Attacker win";
  if (outcome === "DefenderWin") return "Defender win";
  return "Draw";
}

// Offensive mission types where the player's own fleet is the attacker, so a DefenderWin report means
// the player's attack failed (VEY-KANEO-495). Mirrors the attack set used by missionTypeTone.
const OFFENSIVE_MISSION_TYPES = ["Attack", "AcsAttack", "MissileAttack"];

function isOffensiveMissionType(missionType: string): boolean {
  return OFFENSIVE_MISSION_TYPES.includes(missionType);
}

// VEY-KANEO-495: a resolved offensive mission whose report is a DefenderWin is the player's failed
// attack — the case the ticket calls out (an attack that cost ships must not read like a normal
// completed mission). Wins/draws are not flagged, so a successful raid shows no false loss flag.
function isFailedPlayerAttack(missionType: string, outcome: BattleReport["outcome"]): boolean {
  return isOffensiveMissionType(missionType) && outcome === "DefenderWin";
}

// Text colour for the resolved-battle outcome line on a mission card: red for the player's loss,
// emerald for a win, amber for a draw. Keeps the outcome glanceable without a separate badge slot.
function battleOutcomeTextTone(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "text-emerald-300/80";
  if (outcome === "DefenderWin") return "text-red-300/90";
  return "text-amber-300/80";
}

function battleOutcomePillTone(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (outcome === "DefenderWin") return "border-red-300/25 bg-red-300/10 text-red-100";
  return "border-amber-300/25 bg-amber-300/10 text-amber-100";
}

function resourceTotal(resources: { metal: string; crystal: string; deuterium: string }): number {
  return Number(resources.metal) + Number(resources.crystal) + Number(resources.deuterium);
}

function debrisTotal(debris: BattleReport["debris"]): number {
  return Number(debris.metal) + Number(debris.crystal);
}

// Debris is metal/crystal only. Zero components are omitted so an otherwise useful fact never
// contains the empty-value noise that the compact-row rework explicitly removes.
function formatDebrisNonZero(debris: BattleReport["debris"]): string {
  return ([["M", debris.metal], ["C", debris.crystal]] as const)
    .filter(([, value]) => Number(value) > 0)
    .map(([suffix, value]) => `${formatResource(value)} ${suffix}`)
    .join(" / ");
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
