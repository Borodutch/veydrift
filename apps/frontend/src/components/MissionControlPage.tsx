import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Clipboard, ExternalLink, Filter, List, Undo2 } from "lucide-preact";
import type { ComponentChildren } from "preact";

import { ActionReasonNote } from "./ActionReasonNote";
import { galaxyActionIcon } from "./GalaxyActionIcon";
import { planetArtTypeForCoordinates } from "../data/mockUniverse";
import { formatDuration, formatDurationUntil } from "../durationFormat";
import { acsHoldingFuelRatePerHour, allianceDepotSustainSeconds } from "../fleetMissionRules";
import { shipAssetByKey } from "../gameAssets";
import { defenseCatalog, type ShipKey } from "../playableMvp";
import type { Coordinates, PlanetType } from "../types";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { shouldRenderMissileStrikeHistory } from "../missionVisibilityRefresh";
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
  type MissileAttackArchiveResponse,
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
import { refreshButtonState } from "./PageHeader";
import { MissionControlSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

type MissionControlActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type MissionLifecycleActionKind = "counterplay" | "joinAttack" | "joinDefense" | "recall";

export type ManualMissionResolutionKind = "arrival" | "return";

// Give the funded resolver three full minutes after a leg becomes due before
// surfacing the permissionless fallback. This avoids presenting a transaction
// that can race the keeper's in-flight settlement.
export const MANUAL_MISSION_RESOLUTION_DELAY_MS = 3 * 60_000;

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

export function applyMissionFilterSelectInput(
  filters: MissionControlFilters,
  field: "direction" | "missionType",
  value: string,
  onChange: (filters: MissionControlFilters) => void,
): void {
  onChange(normalizeMissionControlFilters({ ...filters, [field]: value }));
}

interface MissionControlPageProps {
  actionState: MissionControlActionState;
  activePlanetId?: string | undefined;
  allActiveMissions?: FleetMissionSummary[] | undefined;
  canTransact: boolean;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  globalMissionArchive?: GlobalMissionArchiveResponse | undefined;
  globalMissionArchiveError?: string | undefined;
  globalMissionArchiveLoading?: boolean | undefined;
  globalMissionArchiveTotalEntries?: number | undefined;
  // Canonical indexed alliance membership owns Alliance-tab visibility. Defaults to visible so
  // legacy callers/tests that do not model membership retain their historical tab set; the playable
  // app always passes an explicit membership-derived boolean.
  hasAlliance?: boolean | undefined;
  // The live alliance roster disambiguates the backend's active attack candidates into attacks
  // launched by allies and attacks targeting allies. `undefined` preserves legacy fixture/feed
  // behavior; the playable app always supplies the canonical roster (including an empty roster
  // after leave/dissolve) so cooperative actions fail closed as membership changes.
  allianceMemberAddresses?: readonly string[] | undefined;
  // False only after the selected launch planet's ship inventory has loaded and is empty. This
  // prevents a cooperative control from opening a composer that cannot possibly submit.
  hasAvailableMissionFleet?: boolean | undefined;
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
  missileAttackArchive?: MissileAttackArchiveResponse | undefined;
  missileAttackArchiveError?: string | undefined;
  missileAttackArchiveLoading?: boolean | undefined;
  missionFilters?: Partial<MissionControlFilters> | undefined;
  missionNumberSearch?: string | undefined;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  // VEY-KANEO-440: opens the player's own planet detail, where the Defend control is always shown
  // (enabled+explained where eligible, or disabled+explained on the launch planet itself).
  onDefendPlanet?: (() => void) | undefined;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onActiveMissionTabChange?: ((tab: ActiveMissionTabKey) => void) | undefined;
  onOpenReport: (missionId: string) => void;
  onOpenReportList: () => void;
  onGlobalMissionArchivePageChange?: ((page: number) => void) | undefined;
  onIncomingAttackArchivePageChange?: ((page: number) => void) | undefined;
  onPastMissionTabChange?: ((tab: PastMissionTabKey) => void) | undefined;
  onMissionArchivePageChange?: ((page: number) => void) | undefined;
  onMissionFiltersChange?: ((filters: MissionControlFilters) => void) | undefined;
  onMissionNumberSearchChange?: ((value: string) => void) | undefined;
  onRecall: (missionId: string) => void;
  onResolve?: ((missionId: string, kind: ManualMissionResolutionKind) => void) | undefined;
  onRefresh: () => void;
  reportMissionId?: string | undefined;
  reportUrlForMission?: ((missionId: string) => string) | undefined;
  planetArchetypesByCoordinate?: ReadonlyMap<string, PlanetType> | undefined;
  transactionUnavailableReason?: string | undefined;
  walletPlanets?: ManagedPlanetResponse[] | undefined;
}

export function MissionControlPage({
  actionState,
  activePlanetId,
  allianceMemberAddresses,
  allActiveMissions = [],
  canTransact,
  fleetVisibility,
  globalMissionArchive,
  globalMissionArchiveError,
  globalMissionArchiveLoading = false,
  globalMissionArchiveTotalEntries,
  hasAlliance = true,
  hasAvailableMissionFleet,
  incomingAttackArchive,
  incomingAttackArchiveError,
  incomingAttackArchiveLoading = false,
  initialView,
  loading,
  missionArchive,
  missionArchiveError,
  missionArchiveLoading = false,
  missileAttackArchive,
  missileAttackArchiveError,
  missileAttackArchiveLoading = false,
  missionFilters,
  missionNumberSearch = "",
  now,  onCounterplay,
  onDefendPlanet,
  onJoinAttack,
  onActiveMissionTabChange,
  onOpenReport,
  onOpenReportList,
  onGlobalMissionArchivePageChange,
  onIncomingAttackArchivePageChange,
  onPastMissionTabChange,
  onMissionArchivePageChange,
  onMissionFiltersChange,
  onMissionNumberSearchChange,
  onRecall,
  onResolve = () => undefined,
  planetArchetypesByCoordinate = EMPTY_PLANET_ARCHETYPE_LOOKUP,
  reportMissionId,
  reportUrlForMission,
  transactionUnavailableReason,
  walletPlanets = [],
}: MissionControlPageProps) {
  const incoming = fleetVisibility?.incoming ?? [];
  const outgoing = fleetVisibility?.outgoing ?? [];
  const returning = fleetVisibility?.returning ?? [];
  // Current backends return a viewer-qualified cooperative projection: membership, attacks, and
  // defenses all come from one indexed revision. During a rolling deploy, legacy responses omit
  // allianceId/joinableDefenses and retain the former roster-intersection fallback.
  const hasAuthoritativeAllianceProjection = fleetVisibility?.allianceId !== undefined
    || fleetVisibility?.joinableDefenses !== undefined;
  const cooperativeRows = hasAuthoritativeAllianceProjection
    ? {
        joinAttacks: fleetVisibility?.joinableAttacks ?? [],
        joinDefenses: fleetVisibility?.joinableDefenses ?? [],
      }
    : classifyAllianceCooperativeMissions({
        allianceMemberAddresses,
        candidates: fleetVisibility?.joinableAttacks ?? [],
        wallet: fleetVisibility?.wallet,
      });
  const authoritativeHasAlliance = fleetVisibility?.allianceId !== undefined
    ? Boolean(fleetVisibility.allianceId && fleetVisibility.allianceId !== "0")
    : hasAlliance;
  const joinableAttacks = authoritativeHasAlliance ? cooperativeRows.joinAttacks : [];
  const joinableDefenses = authoritativeHasAlliance ? cooperativeRows.joinDefenses : [];
  const completedMissions = fleetVisibility?.completedMissions ?? [];
  const battleReports = fleetVisibility?.battleReports ?? [];
  const activeMissionRows = chronologicalActiveMissionRows({ incoming, joinableAttacks, joinableDefenses, outgoing, returning });
  const {
    alliance: allianceMissionRows,
    incoming: incomingMissionRows,
    mine: myMissionRows,
  } = partitionActiveMissionRows(activeMissionRows);
  // Universe-wide active rows for the "All" tab: the player's own/alliance missions keep their exact
  // classification (direction + lifecycle actions); every other active mission renders read-only.
  const allActiveRows = allActiveMissionRows(allActiveMissions, activeMissionRows);
  const normalizedFilters = normalizeMissionControlFilters({
    ...missionFilters,
    missionNumber: missionFilters?.missionNumber ?? missionNumberSearch,
  });
  const activeFilterCount = missionControlActiveFilterCount(normalizedFilters);
  const missionFiltersActive = activeFilterCount > 0;
  const allMissions = uniqueMissions([...incoming, ...outgoing, ...returning, ...joinableAttacks, ...joinableDefenses, ...completedMissions]);
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
  const filteredIncomingMissionRows = filterActiveMissionRows(incomingMissionRows, normalizedFilters);
  const filteredAllianceMissionRows = filterActiveMissionRows(allianceMissionRows, normalizedFilters);
  const filteredAllActiveRows = filterActiveMissionRows(allActiveRows, normalizedFilters);
  const filteredStationedIncoming = incoming.filter((mission) =>
    activeMissionRowMatchesFilters({ context: "incoming", direction: incomingMissionDirection(mission), mission }, normalizedFilters)
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
  // The view comes from the URL query first (shareable, survives reload + browser back), then the
  // sessionStorage fallback for the in-app back button which lands on bare `/mission-control`.
  const requestedView = initialView ?? resolveMissionControlView();
  const showAllianceTab = authoritativeHasAlliance;
  const view = missionControlViewForAllianceMembership(requestedView, showAllianceTab);
  // A canonical membership refresh can invalidate an `at=alliance` selection while this page is
  // already mounted. Repair all three runtime sources of truth synchronously: rendered view,
  // session/in-memory persistence, and the URL query. Explicit test/story views remain side-effect
  // free because they do not represent persisted app navigation.
  if (view !== requestedView && initialView === undefined) {
    persistMissionControlView(view);
  }
  const activeTab = view.activeTab;
  const selectedActiveRows = activeTab === "all"
    ? filteredAllActiveRows
    : activeTab === "alliance"
      ? filteredAllianceMissionRows
      : activeTab === "incoming"
        ? filteredIncomingMissionRows
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
            activePlanetId={activePlanetId}
            activePage={view.activePage}
            activeTab={activeTab}
            allRows={filteredAllActiveRows}
            allianceRows={filteredAllianceMissionRows}
            showAllianceTab={showAllianceTab}
            canTransact={canTransact}
            hasAvailableMissionFleet={hasAvailableMissionFleet}
            lootByMissionId={lootByMissionId}
            lossesByMissionId={lossesByMissionId}
            incomingRows={filteredIncomingMissionRows}
            missionFiltersActive={missionFiltersActive}
            missionFilterEmptyLabel={filterEmptyLabel}
            myRows={filteredMyMissionRows}
            now={now}
            onCounterplay={onCounterplay}
            onTabChange={onActiveMissionTabChange}
            onJoinAttack={onJoinAttack}
            onOpenReport={onOpenReport}
            onRecall={onRecall}
            onResolve={onResolve}
            planetLookup={planetLookup}
            transactionUnavailableReason={transactionUnavailableReason}
            toolbarActions={(
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
              </>
            )}
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

          <MissileStrikeSection
            archive={missileAttackArchive}
            error={missileAttackArchiveError}
            loading={missileAttackArchiveLoading}
          />

          <PastMissionSection
            allCollapsedCount={globalPastCollapsedCount}
            allError={globalMissionArchiveError}
            allLoading={globalMissionArchiveLoading}
            allPagination={globalMissionArchive?.pagination}
            allRows={filteredGlobalPastMissionRows}
            allTotalEntries={globalMissionArchiveTotalEntries}
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
            onTabChange={onPastMissionTabChange}
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

function MissileStrikeSection({
  archive,
  error,
  loading,
}: {
  archive?: MissileAttackArchiveResponse | undefined;
  error?: string | undefined;
  loading: boolean;
}) {
  const rows = archive?.rows ?? [];
  // Background polling previously set `loading` before every request, briefly mounting this card,
  // then unmounting it again when an empty archive arrived.
  // Empty history is stable UI: show this section only when it has a strike or an actionable error.
  if (!shouldRenderMissileStrikeHistory({ error, rowCount: rows.length })) return null;
  return (
    <section className="grid gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.03] p-3" data-missile-strike-history>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/70">Resolved ordnance</p>
          <h2 className="text-sm font-semibold text-amber-100">Missile impacts</h2>
        </div>
        <span className="text-[11px] tabular-nums text-slate-400">{archive?.pagination.totalEntries ?? 0}</span>
      </div>
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      {loading && rows.length === 0 ? <p className="text-xs text-slate-400">Loading missile strikes…</p> : null}
      {rows.length > 0 ? (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.08] bg-black/20">
          {rows.map((strike) => {
            const target = defenseCatalog.find((defense) => defense.id === strike.primaryTargetDefenseId)?.label ?? "selected defense";
            const origin = strike.originPlanet?.name ?? `Planet #${strike.originPlanetId}`;
            const destination = strike.targetPlanet?.name ?? `Planet #${strike.targetPlanetId}`;
            return (
              <a
                className="grid gap-1 px-3 py-2 text-xs transition-colors hover:bg-white/[0.04]"
                href={`https://basescan.org/tx/${strike.transactionHash}`}
                key={strike.eventId}
                rel="noreferrer"
                target="_blank"
              >
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-slate-200">
                  <span className="font-medium">{origin} <span className="text-slate-500">→</span> {destination}</span>
                  <span className="text-slate-500">Block {strike.blockNumber}</span>
                </span>
                <span className="text-slate-400">
                  {strike.launched.toLocaleString()} launched · {strike.intercepted.toLocaleString()} intercepted · {strike.hits.toLocaleString()} hit · {strike.destroyedPrimary.toLocaleString()} {target} destroyed
                </span>
              </a>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// VEY-KANEO-440 stationed-defense display. ACS Defend stations a fleet at a planet to defend it
// against a specific incoming attack (the only stationing today's contract supports), so this panel
// surfaces both sides of that arrangement: (a) the defense fleets the player currently has stationed
// at allied planets, and (b) the allied fleets stationed at the player's own attacked planets. Each
// "holds" until the defended attack lands, so the countdown is the defended attack's arrival. The panel
// is read-only — the launch flow lives on the "Defend planet" action of an incoming attack.
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
        <OpenMissionButton onClick={() => onOpenReport(mission.missionId)} />
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
        <OpenMissionButton onClick={() => onOpenReport(attack.missionId)} />
      }
      badgeLabel="Defended"
      badgeTone={missionTypeTone("AcsDefend")}
      fleet={
        <div className="contents">
          <MissionDetailGroup title="Stationed defenders">
            {defenders && defenders.length > 0 ? (
              <div className="grid gap-2">
                {defenders.map((defender) => (
                  <StationedDefenderRow defender={defender} key={defender.missionId} now={now} />
                ))}
              </div>
            ) : (
              <p className="font-medium text-violet-100">
                {`${fallbackCount} allied ${fallbackCount === 1 ? "fleet" : "fleets"} stationed in defense`}
              </p>
            )}
          </MissionDetailGroup>
        </div>
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
  activePlanetId,
  canTransact,
  context,
  hasAvailableMissionFleet,
  mission,
  now,
  transactionUnavailableReason,
}: {
  activePlanetId?: string | undefined;
  canTransact: boolean;
  context: ActiveMissionContext;
  hasAvailableMissionFleet?: boolean | undefined;
  mission: FleetMissionSummary;
  now: number;
  transactionUnavailableReason?: string | undefined;
}): MissionLifecycleAction[] {
  const actions: MissionLifecycleAction[] = [];
  const cooperativeJoinOpen = isCooperativeJoinOpen(mission, now);
  const cooperativeEnabled = canTransact && hasAvailableMissionFleet !== false && cooperativeJoinOpen;
  const cooperativeReason = !cooperativeJoinOpen
    ? "The cooperative join cutoff has passed."
    : hasAvailableMissionFleet === false
      ? "No ships are available on the selected origin planet."
      : walletReason(canTransact, transactionUnavailableReason);

  // Arrival/return completions normally reconcile through lazy on-chain settlement and the backend
  // resolver. A separate emergency Resolve control appears beside the status pill only after that
  // automation has been overdue for three minutes; it is intentionally not a general lifecycle order.

  if (context === "outgoing" && mission.status === "Outbound") {
    // Recall is only useful while the contract still accepts it. Once the cutoff closes, omit the
    // dead-end control entirely; the mission card's remaining lifecycle state is enough explanation.
    const recallable = isFleetRecallable(mission, now);
    if (recallable) {
      actions.push({
        enabled: canTransact,
        kind: "recall",
        label: "Recall fleet",
        reason: walletReason(canTransact, transactionUnavailableReason),
      });
    }
  }

  // VEY-KANEO-465: fleet returns reconcile automatically — the backend mission
  // resolver (`missionResolution.ts`) submits `completeFleetMissionReturn` once
  // a return is due, crediting ships/cargo without any manual action. The former
  // "Land fleet" button is removed so the frontend never drives a non-lazy
  // complete/land action; returning rows are read-only until the backend lands them.

  if (
    context === "incoming"
    && mission.status === "Outbound"
    && mission.missionType === "Attack"
    && (!activePlanetId || mission.targetPlanetId !== activePlanetId)
  ) {
    actions.push({
      enabled: cooperativeEnabled,
      kind: "counterplay",
      label: "Counterplay",
      reason: cooperativeReason,
    });
  }

  if ((context === "joinAttack" || context === "joinable") && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: cooperativeEnabled,
      kind: "joinAttack",
      label: "Join Attack",
      reason: cooperativeReason,
    });
  }

  if (context === "joinDefense" && mission.status === "Outbound" && mission.missionType === "Attack") {
    actions.push({
      enabled: cooperativeEnabled,
      kind: "joinDefense",
      label: "Join Defense",
      reason: cooperativeReason,
    });
  }

  return actions;
}

// "observer" rows belong to other players and only appear on the universe-wide "All" tab. Their
// owner-only lifecycle actions remain hidden, but the delayed permissionless Resolve fallback is
// still available because it can rescue any overdue mission when the funded resolver is offline.
type ActiveMissionContext = "due" | "incoming" | "joinable" | "joinAttack" | "joinDefense" | "observer" | "outgoing" | "returning";

export type ActiveMissionRow = {
  context: ActiveMissionContext;
  direction: string;
  mission: FleetMissionSummary;
};

export function classifyAllianceCooperativeMissions({
  allianceMemberAddresses,
  candidates,
  wallet,
}: {
  allianceMemberAddresses?: readonly string[] | undefined;
  candidates: readonly FleetMissionSummary[];
  wallet?: string | undefined;
}): { joinAttacks: FleetMissionSummary[]; joinDefenses: FleetMissionSummary[] } {
  // Older feeds already label this collection `joinableAttacks` but do not provide the roster that
  // made it joinable. Keep that contract for legacy callers; production passes an explicit roster.
  if (allianceMemberAddresses === undefined) {
    return { joinAttacks: [...candidates], joinDefenses: [] };
  }

  const memberAddresses = new Set(allianceMemberAddresses.map((address) => address.toLowerCase()));
  const walletAddress = wallet?.toLowerCase();
  const joinAttacks: FleetMissionSummary[] = [];
  const joinDefenses: FleetMissionSummary[] = [];

  for (const mission of candidates) {
    if (mission.status !== "Outbound" || mission.missionType !== "Attack") continue;
    const attacker = mission.owner.toLowerCase();
    const defender = mission.targetPlanet?.owner?.toLowerCase();

    if (attacker !== walletAddress && memberAddresses.has(attacker)) {
      joinAttacks.push(mission);
    }
    if (
      defender
      && defender !== walletAddress
      && memberAddresses.has(defender)
      && !memberAddresses.has(attacker)
    ) {
      joinDefenses.push(mission);
    }
  }

  return { joinAttacks, joinDefenses };
}

type PastMissionRow = FleetMissionArchiveEntry;

const ACTIVE_MISSION_TABS = [
  // The one active-section empty state: the tab panel says it, so no separate page-level notice
  // repeats it two lines above.
  { emptyLabel: "No active missions for this wallet. Use Galaxy to launch attacks, transport resources, deploy fleets, or harvest debris.", key: "mine", label: "My missions" },
  { emptyLabel: "No fleets are currently inbound to your planets.", key: "incoming", label: "Incoming" },
  { emptyLabel: "No joinable alliance attacks or defenses.", key: "alliance", label: "Alliance" },
  { emptyLabel: "No active missions in the universe yet.", key: "all", label: "All" },
] as const;

type ActiveMissionTabKey = (typeof ACTIVE_MISSION_TABS)[number]["key"];

const ACTIVE_MISSION_DEFAULT_TAB: ActiveMissionTabKey = "mine";

function ActiveMissionSection({
  activePlanetId,
  activePage,
  activeTab,
  allRows,
  allianceRows,
  canTransact,
  hasAvailableMissionFleet,
  incomingRows,
  lootByMissionId,
  lossesByMissionId,
  missionFilterEmptyLabel,
  missionFiltersActive,
  myRows,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  onResolve,
  onTabChange,
  planetLookup,
  showAllianceTab = true,
  toolbarActions,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  activePlanetId?: string | undefined;
  activePage: number;
  activeTab: ActiveMissionTabKey;
  allRows: ActiveMissionRow[];
  allianceRows: ActiveMissionRow[];
  canTransact: boolean;
  hasAvailableMissionFleet?: boolean | undefined;
  incomingRows: ActiveMissionRow[];
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
  missionFilterEmptyLabel: string;
  missionFiltersActive: boolean;
  myRows: ActiveMissionRow[];
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string, kind: ManualMissionResolutionKind) => void;
  onTabChange?: ((tab: ActiveMissionTabKey) => void) | undefined;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  showAllianceTab?: boolean | undefined;
  toolbarActions?: ComponentChildren | undefined;
  transactionUnavailableReason?: string | undefined;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const rowsByTab: Record<ActiveMissionTabKey, ActiveMissionRow[]> = {
    all: allRows,
    alliance: allianceRows,
    incoming: incomingRows,
    mine: myRows,
  };
  const visibleTabs = ACTIVE_MISSION_TABS.filter((tab) => tab.key !== "alliance" || showAllianceTab);
  const sharedRowProps = {
    activePlanetId,
    canTransact,
    hasAvailableMissionFleet,
    lootByMissionId,
    lossesByMissionId,
    now,
    onCounterplay,
    onJoinAttack,
    onOpenReport,
    onRecall,
    onResolve,
    planetLookup,
    transactionUnavailableReason,
    wallet,
    walletPlanetIds,
  };
  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-[#101624]" data-active-tab={activeTab}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-white/10 bg-black/20 px-3 py-2">
        <div aria-label="Active missions" className="flex flex-wrap gap-1.5" role="tablist">
          {visibleTabs.map((tab) => (
            <button
              aria-selected={tab.key === activeTab}
              className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100 sm:py-1"
              data-active-tab-button={tab.key}
              key={tab.key}
              onClick={(event) => {
                showActiveMissionTab(event, tab.key);
                onTabChange?.(tab.key);
              }}
              role="tab"
              type="button"
            >
              {`${tab.label} (${rowsByTab[tab.key].length})`}
            </button>
          ))}
        </div>
        {toolbarActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-mission-toolbar>
            {toolbarActions}
          </div>
        ) : null}
      </div>
      {visibleTabs.filter((tab) => tab.key === activeTab).map((tab) => (
        <div data-active-tab-panel={tab.key} key={tab.key} role="tabpanel">
          <ActiveMissionList
            emptyLabel={missionFiltersActive ? missionFilterEmptyLabel : tab.emptyLabel}
            initialPage={activePage}
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
      className="inline-flex size-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
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
      <ChevronsUpDown aria-hidden="true" data-mission-disclosure-expand-icon size={15} />
      <ChevronsDownUp aria-hidden="true" data-mission-disclosure-collapse-icon hidden size={15} />
      <span className="sr-only" data-mission-disclosure-label>Expand all</span>
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
  button.dataset.expanded = String(state.allExpanded);
  const label = button.querySelector<HTMLElement>("[data-mission-disclosure-label]");
  if (label) label.textContent = state.label;
  const expandIcon = button.querySelector("[data-mission-disclosure-expand-icon]");
  const collapseIcon = button.querySelector("[data-mission-disclosure-collapse-icon]");
  expandIcon?.toggleAttribute("hidden", state.allExpanded);
  collapseIcon?.toggleAttribute("hidden", !state.allExpanded);
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
        className={`relative flex size-8 cursor-pointer list-none items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 [&::-webkit-details-marker]:hidden ${
          active
            ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
        }`}
        title={triggerLabel}
      >
        <Filter aria-hidden="true" size={15} />
        {active ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-cyan-300 text-[9px] font-bold leading-none text-slate-950 ring-2 ring-[#0b111d]"
            data-mission-filter-count
          >
            {activeFilterCount}
          </span>
        ) : null}
      </summary>

      {/* Same visual system as the rest of the screen: the one uppercase-tracked label style for
          the header, sentence-case muted field labels, compact 32px controls. */}
      <div
        aria-label="Mission filters"
        className="absolute right-0 z-30 mt-2 w-[min(19rem,calc(100vw-1.5rem))] rounded-lg border border-white/10 bg-[#0d1422] p-3 shadow-2xl shadow-black/50"
        id="mission-control-filter-popover"
        role="dialog"
        title="Filters combine across ongoing and past missions"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">Filter missions</h2>
          <button
            className="shrink-0 rounded text-[11px] font-medium text-cyan-200 transition hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
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

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] text-slate-500">
            Mission #
            <input
              aria-label="Search missions by number"
              className="h-8 min-w-0 rounded border border-white/10 bg-black/25 px-2 font-mono text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              inputMode="numeric"
              onInput={(event) => update({ missionNumber: event.currentTarget.value })}
              placeholder="1473"
              type="search"
              value={filters.missionNumber}
            />
          </label>

          <label className="grid gap-1 text-[11px] text-slate-500">
            Planet ID
            <input
              aria-label="Filter by origin or destination planet ID"
              className="h-8 min-w-0 rounded border border-white/10 bg-black/25 px-2 font-mono text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
              inputMode="numeric"
              onInput={(event) => update({ planetId: event.currentTarget.value })}
              placeholder="7"
              type="search"
              value={filters.planetId}
            />
          </label>

          <label className="grid gap-1 text-[11px] text-slate-500">
            Type
            {/* appearance-none + custom chevron: the native select arrow pins itself flush to the
                control's right edge, which reads as broken next to the padded inputs. */}
            <span className="relative">
              <select
                aria-label="Filter by mission type"
                className="h-8 w-full min-w-0 appearance-none rounded border border-white/10 bg-[#080d18] px-2 pr-7 text-xs text-white outline-none transition focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
                onChange={(event) => applyMissionFilterSelectInput(filters, "missionType", event.currentTarget.value, onChange)}
                onInput={(event) => applyMissionFilterSelectInput(filters, "missionType", event.currentTarget.value, onChange)}
                value={filters.missionType}
              >
                <option value="">All types</option>
                {MISSION_CONTROL_MISSION_TYPES.map((missionType) => (
                  <option key={missionType} value={missionType}>{missionTypeLabel(missionType)}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" size={12} />
            </span>
          </label>

          <label className="grid gap-1 text-[11px] text-slate-500">
            Flight state
            <span className="relative">
              <select
                aria-label="Filter by mission direction or state"
                className="h-8 w-full min-w-0 appearance-none rounded border border-white/10 bg-[#080d18] px-2 pr-7 text-xs text-white outline-none transition focus:border-cyan-300/45 focus:ring-1 focus:ring-cyan-300/25"
                onChange={(event) => applyMissionFilterSelectInput(filters, "direction", event.currentTarget.value, onChange)}
                onInput={(event) => applyMissionFilterSelectInput(filters, "direction", event.currentTarget.value, onChange)}
                value={filters.direction}
              >
                <option value="">Any</option>
                <option value="outbound">Outbound</option>
                <option value="returning">Returning</option>
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" size={12} />
            </span>
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
  activePlanetId,
  canTransact,
  hasAvailableMissionFleet,
  emptyLabel,
  initialPage = 0,
  lootByMissionId,
  lossesByMissionId,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
  rows,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  activePlanetId?: string | undefined;
  canTransact: boolean;
  hasAvailableMissionFleet?: boolean | undefined;
  emptyLabel: string;
  initialPage?: number | undefined;
  lootByMissionId: ReadonlyMap<string, BattleReport["loot"]>;
  lossesByMissionId: ReadonlyMap<string, MissionLossSummary>;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string, kind: ManualMissionResolutionKind) => void;
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
              activePlanetId={activePlanetId}
              canTransact={canTransact}
              context={context}
              direction={direction}
              harvested={returnPhaseHarvestedResources(mission)}
              hasAvailableMissionFleet={hasAvailableMissionFleet}
              key={`${context}:${mission.missionId}`}
              loot={returnPhaseLoot(mission, lootByMissionId)}
              losses={returnPhaseLosses(mission, lossesByMissionId)}
              mission={mission}
              now={now}              onCounterplay={onCounterplay}
              onJoinAttack={onJoinAttack}
              onOpenReport={onOpenReport}
              onRecall={onRecall}
              onResolve={onResolve}
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
  activePlanetId,
  canTransact,
  context,
  direction,
  harvested,
  hasAvailableMissionFleet,
  loot,
  losses,
  mission,
  now,  onCounterplay,
  onJoinAttack,
  onOpenReport,
  onRecall,
  onResolve,
  planetLookup,
  transactionUnavailableReason,
  wallet,
  walletPlanetIds,
}: {
  activePlanetId?: string | undefined;
  canTransact: boolean;
  context: ActiveMissionContext;
  direction: string;
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  hasAvailableMissionFleet?: boolean | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
  mission: FleetMissionSummary;
  now: number;  onCounterplay: (mission: FleetMissionSummary, mode: "acsDefend") => void;
  onJoinAttack: (mission: FleetMissionSummary, targetCoords: { galaxy: number; system: number; position: number } | null) => void;
  onOpenReport: (missionId: string) => void;
  onRecall: (missionId: string) => void;
  onResolve: (missionId: string, kind: ManualMissionResolutionKind) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  transactionUnavailableReason?: string | undefined;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  // VEY-397#11: only surface Join when it is actionable.
  const actions = missionLifecycleActions({ activePlanetId, canTransact, context, hasAvailableMissionFleet, mission, now, transactionUnavailableReason })
    .filter((action) => !["joinAttack", "joinDefense"].includes(action.kind) || action.enabled);
  const missionDirection = resolveMissionDirection({ context, mission, wallet, walletPlanetIds });
  const origin = missionEndpoint(mission, "origin", planetLookup);
  const target = missionEndpoint(mission, "target", planetLookup);
  const noFleetReturned = isNoFleetReturned(mission);
  const directionSubtext = direction && !["Joinable attack", "Joinable defense"].includes(direction) ? direction : undefined;
  const resolutionKind = manualMissionResolutionKind(mission, now);
  // A hostile attack heading for the player's planet is the one row that must not hide its
  // counterplay behind a click: flag it red and start it expanded.
  const hostileInbound = missionDirection === "incoming" && isOffensiveMissionType(mission.missionType);
  return (
    <MissionCard
      defaultOpen={hostileInbound}
      glance={missionGlance({ direction: missionDirection, harvested, loot, losses, mission, showOutcome: true })}
      hostile={hostileInbound}
      actions={
        <>
          {actions.map((action) => action.kind === "counterplay" ? (
            <ActionButton
              action={{ ...action, label: "Defend planet" }}
              key={action.kind}
              onClick={() => onCounterplay(mission, "acsDefend")}
            />
          ) : action.kind === "joinAttack" ? (
            <ActionButton
              action={action}
              key={action.kind}
              onClick={() => onJoinAttack(mission, target.coords)}
            />
          ) : action.kind === "joinDefense" ? (
            <ActionButton
              action={action}
              key={action.kind}
              onClick={() => onCounterplay(mission, "acsDefend")}
            />
          ) : (
            <ActionButton
              action={action}
              key={action.kind}
              onClick={() => {
                if (action.kind === "recall") onRecall(mission.missionId);
              }}
            />
          ))}
          <OpenMissionButton onClick={() => onOpenReport(mission.missionId)} />
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
      statusAction={resolutionKind ? (
        <button
          className="inline-flex h-6 w-full items-center justify-center rounded border border-amber-300/30 bg-amber-300/10 px-2 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
          data-mission-status-action="resolve"
          disabled={!canTransact}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResolve(mission.missionId, resolutionKind);
          }}
          title={canTransact ? "Resolve this overdue mission" : transactionUnavailableReason}
          type="button"
        >
          Resolve
        </button>
      ) : undefined}
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

// Expanded-panel timings: the full arrival/return picture the compact row deliberately omits. A
// recalled fleet never arrived, so its timeline shows only the actual return-home timing instead of a
// bogus target "Arrived" moment. A valid late recall can return after the original target ETA.
// Labels are tense-aware: a moment still in the future reads "Arrives"/"Returns", a past one
// "Arrived"/"Returned" — an en-route fleet's timeline must not claim it already landed.
function missionDetailTimings(mission: FleetMissionSummary, now: number): EndpointTiming[] {
  if (missionWasRecalled(mission)) {
    return [{ label: "Recalled — returned", value: compactMissionTime(mission.returnAt, now) }];
  }
  const timings: EndpointTiming[] = [
    { label: isFutureMoment(mission.arrivalAt, now) ? "Arrives" : "Arrived", value: compactMissionTime(mission.arrivalAt, now) },
  ];
  if (mission.missionType === "MissileAttack") return timings;
  if (mission.missionType === "DefenseHold") {
    timings.push({ label: "Holds until", value: compactMissionTime(defenseHoldRecallUntil(mission), now) });
  }
  timings.push({
    label: isFutureMoment(mission.returnAt, now) ? "Returns" : "Returned",
    value: compactMissionTime(mission.returnAt, now),
  });
  return timings;
}

function isFutureMoment(value: string, now: number): boolean {
  const timestamp = timestampToMs(value);
  return timestamp !== undefined && timestamp > now;
}

function pastMissionHeaderTiming(mission: FleetMissionSummary, now: number): EndpointTiming {
  if (mission.missionType === "MissileAttack") {
    return { label: "Impacted", value: compactMissionTime(mission.arrivalAt, now) };
  }
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
  // VEY-KANEO-495: a resolved attack that lost ships must not read like a normal completed mission —
  // the Battle group states the outcome (coloured by result, echoing the row's status cell),
  // non-zero per-side fleet losses (resource-value fallback — per-ship loss counts are not in the
  // served payload), and any debris created for follow-up harvest. A winning no-loss raid shows the
  // outcome without a noisy empty Losses line.
  const historicalDefenseHold = mission?.missionType === "DefenseHold"
    && (
      mission.defenseHoldOutcome !== undefined
      || mission.destroyedShips !== undefined
      || mission.survivingShips !== undefined
    )
    ? mission
    : null;
  const hasResources = Boolean(
    (cargo && resourceTotal(cargo) > 0)
      || (harvested && resourceTotal(harvested) > 0)
      || (loot && resourceTotal(loot) > 0)
  );
  // display:contents — each group participates directly in the expanded panel's fact-group row.
  return (
    <div className="contents">
      <MissionDetailGroup title={mission?.missionType === "MissileAttack" ? "Missile payload" : "Fleet"}>
        {mission?.missionType === "MissileAttack" ? (
          detailRow(
            "Payload",
            `${(mission.missileQuantity ?? 0).toLocaleString()} interplanetary missile${mission.missileQuantity === 1 ? "" : "s"} · ${defenseCatalog.find((defense) => defense.id === mission.missilePrimaryTargetId)?.label ?? "selected defense"}`,
            "text-slate-400",
          )
        ) : <FleetIcons ships={ships} />}
        {historicalDefenseHold ? (
          <>
            {detailRow("Stationed", formatShips(historicalDefenseHold.originalShips ?? historicalDefenseHold.ships), "text-slate-400")}
            {detailRow("Destroyed", historicalDefenseHold.destroyedShips === undefined || historicalDefenseHold.destroyedShips === null ? "Exact composition unavailable" : formatShips(historicalDefenseHold.destroyedShips), "text-slate-400")}
            {detailRow("Survived", historicalDefenseHold.survivingShips === undefined || historicalDefenseHold.survivingShips === null ? "Exact composition unavailable" : formatShips(historicalDefenseHold.survivingShips), "text-slate-400")}
          </>
        ) : null}
      </MissionDetailGroup>
      {hasResources ? (
        <MissionDetailGroup title="Resources">
          {cargo && resourceTotal(cargo) > 0 ? detailRow("Cargo", formatCargoNonZero(cargo)) : null}
          {harvested && resourceTotal(harvested) > 0 ? detailRow("Debris collected", formatCargoNonZero(harvested)) : null}
          {loot && resourceTotal(loot) > 0 ? detailRow("Loot", formatCargoNonZero(loot)) : null}
        </MissionDetailGroup>
      ) : null}
      {losses ? (
        <MissionDetailGroup title="Battle">
          {detailRow("Outcome", battleOutcomeLabel(losses.outcome), battleOutcomeTextTone(losses.outcome))}
          {resourceTotal(losses.attacker) > 0 ? detailRow("Attacker losses", formatCargoNonZero(losses.attacker)) : null}
          {resourceTotal(losses.defender) > 0 ? detailRow("Defender losses", formatCargoNonZero(losses.defender)) : null}
          {debrisTotal(losses.debris) > 0 ? detailRow("Debris field", formatDebrisNonZero(losses.debris)) : null}
        </MissionDetailGroup>
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
// Lifecycle state is backend-authoritative. The browser may render countdowns, but it must never
// manufacture a mission transition from its own clock. `needsResolution` and `asOfNow` are computed
// by the indexed backend; live chain events refetch those fields after the index transaction commits.
export function missionStatusPill(mission: FleetMissionSummary, _now: number): MissionStatusPill {
  if (mission.resolutionBlocker === "randomness_pending") {
    return { label: "Awaiting randomness", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  }
  if (mission.missionType === "DefenseHold" && mission.defenseHoldOutcome === "Recalled") {
    return { label: "Recalled", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  }
  if (mission.needsResolution === true) {
    const progress = mission.combatResolutionProgress;
    return {
      label: progress ? `Resolving ${progress.roundsCompleted}/${progress.totalRounds}` : "Resolving",
      tone: "border-amber-300/25 bg-amber-300/10 text-amber-100"
    };
  }
  if (mission.status === "Outbound") {
    if (mission.missionType === "DefenseHold" && mission.asOfNow?.arrived && !mission.asOfNow.returned) {
      return { label: "Stationed", tone: "border-violet-300/25 bg-violet-300/10 text-violet-100" };
    }
    return { label: "En route", tone: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
  }
  if (mission.status === "Returning" || mission.status === "Recalled") {
    if (mission.asOfNow?.returned === true) {
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
const iconRowActionButtonClass = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500 sm:h-8 sm:w-8";

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

// How the status cell renders its state:
// - default (no variant): a bordered pill — live flight phases (En route, Returning, Recalled…).
// - "muted": quiet grey text, desktop only — expected terminal states (Returned/Resolved) that
//   distinguish nothing on a list where every row ended normally.
// - "text": colored plain text, visible everywhere — a finished battle's outcome (Won / Attack
//   failed / Defended / Raided / Draw), the fact the player actually scans combat history for.
type MissionStatusPill = { label: string; tone: string; variant?: "muted" | "text" };

// The one grid template shared by every mission row AND the column-header row above each list, so
// the columns line up down the page like a real table: mission (badge stacked over #) | route |
// payload | time-over-status | disclosure chevron. The route's planet + commander pair makes every
// row two text lines tall, so each fixed column stacks two facts vertically instead of leaving its
// second line empty — and the width saved (narrow mission column, merged time/status) goes to the
// route. Below lg the rows fall back to a stacked flex-wrap layout (badge line, route line,
// payload line) where per-item inline labels do the header's job.
// Two width tiers: at lg (narrow desktop windows) the fixed columns slim down so the route — the
// only column whose content truncates — keeps enough room for full planet names; xl restores the
// roomier tracks. Without the tier split, payload/status hoarded fixed width they rarely fill
// while names collapsed to "Neph…".
const MISSION_ROW_GRID = "lg:grid lg:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,7rem)_5.5rem_1rem] lg:items-center lg:gap-x-2 xl:grid-cols-[7rem_minmax(0,1fr)_minmax(0,8.5rem)_7rem_1rem] xl:gap-x-3";

// Column headers rendered once per list — the reason the rows themselves carry no ORIGIN /
// DESTINATION / ARRIVED label chatter. Hidden below lg where rows are stacked and self-labelling.
function MissionListHeader() {
  return (
    <div className={`hidden border-b border-white/[0.06] px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500 sm:px-3 ${MISSION_ROW_GRID}`}>
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
  statusAction,
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
  statusAction?: ComponentChildren | undefined;
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
              <span className="text-slate-500 lg:hidden">{headerTiming.label} </span>
              {headerTiming.value}
            </span>
          ) : null}
          {statusPill || statusAction ? (
            <span
              className={`inline-flex min-w-[3.75rem] max-w-full ${statusAction ? "flex-col items-center gap-1" : "items-center justify-end gap-1.5"}`}
              data-mission-status-layout={statusAction ? "stacked" : "status-only"}
            >
              {statusPill ? (
                statusPill.variant === "text" ? (
                  <span className={`whitespace-nowrap text-[11px] font-medium ${statusPill.tone}`} data-mission-status={statusPill.label}>{statusPill.label}</span>
                ) : statusPill.variant === "muted" ? (
                  // Expected terminal states: quiet text, desktop only — on mobile the time's inline
                  // "Returned 9:23 AM" label already says it, so repeating the word is noise.
                  <span className="hidden text-[11px] text-slate-600 lg:inline" data-mission-status={statusPill.label}>{statusPill.label}</span>
                ) : (
                  <span className={`inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusPill.tone}`} data-mission-status={statusPill.label} title={statusPill.label}>
                    {statusPill.label}
                  </span>
                )
              ) : null}
              {statusAction}
            </span>
          ) : null}
        </span>
        <ChevronDown aria-hidden="true" className="order-1 shrink-0 text-slate-500 transition-transform group-open/mission:rotate-180 lg:order-none lg:justify-self-end" size={14} />
      </summary>
      <div className="border-t border-white/[0.06] px-2.5 pb-3 pt-2.5 sm:px-3">
        {/* The expanded panel reads as a structured report card: labeled fact groups (Timeline,
            Fleet, Resources, Battle) sharing one label style, with actions at the top-right. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-start gap-x-8 gap-y-3">
            {detailTimings.length > 0 || routeSubtext || groupId ? (
              <MissionDetailGroup title="Timeline">
                {detailTimings.map((timing) => detailRow(timing.label, timing.value))}
                {routeSubtext ? detailRow("Direction", routeSubtext, "text-slate-400") : null}
                {groupId ? detailRow("Group", groupId) : null}
              </MissionDetailGroup>
            ) : null}
            {fleet}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">{actions}</div>
        </div>
      </div>
    </details>
  );
}

// The single uppercase-tracked label style on this screen (shared with the column-header row);
// everything else is sentence case.
function MissionDetailGroup({ children, title }: { children: preact.ComponentChildren; title: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">{title}</p>
      <div className="grid gap-1 text-[11px] leading-4">{children}</div>
    </div>
  );
}

function detailRow(label: string, value: string, valueTone = "text-slate-200"): preact.ComponentChildren {
  return (
    <p className="tabular-nums" key={label}>
      <span className="text-slate-500">{label}</span> <span className={valueTone}>{value}</span>
    </p>
  );
}

export function initializeMissionRowDisclosure(element: HTMLDetailsElement | null, defaultOpen: boolean): void {
  if (!element || element.dataset.disclosureInitialized === "true") return;
  element.dataset.disclosureInitialized = "true";
  if (defaultOpen) element.open = true;
}

// Compact payload facts shown on the collapsed row — pure resource movement (cargo, loot, debris,
// battle losses). Every semantically distinct non-zero value is visible at a glance; zero totals
// render nothing at all. The battle OUTCOME lives in the status cell for finished missions;
// `showOutcome` keeps it here only for still-active rows whose status cell is busy with the live
// flight phase.
function missionGlance({
  direction,
  harvested,
  loot,
  losses,
  mission,
  showOutcome = false,
}: {
  direction: MissionDirection;
  harvested?: FleetMissionSummary["returnCargo"] | undefined;
  loot?: BattleReport["loot"] | undefined;
  losses?: MissionLossSummary | undefined;
  mission: FleetMissionSummary;
  showOutcome?: boolean;
}): preact.ComponentChildren {
  const outcome = showOutcome && losses ? missionOutcome(losses, mission, direction) : null;
  return (
    <>
      {outcome ? <span className={`text-[11px] font-medium ${outcome.tone} lg:block lg:w-full`}>{outcome.label}</span> : null}
      {/* The "Cargo" prefix is desktop-redundant (the PAYLOAD column header says it) but mobile
          rows self-label. Loot/Debris/Losses keep their one-word prefix everywhere — that
          distinction is real information. */}
      {resourceTotal(mission.cargo) > 0 ? glanceStat("Cargo", mission.cargo, { labelOnDesktop: false }) : null}
      {loot && resourceTotal(loot) > 0 ? glanceStat("Loot", loot) : null}
      {harvested && resourceTotal(harvested) > 0 ? glanceStat("Debris", harvested) : null}
      {losses && hasAnyCombatLosses(losses.attacker, losses.defender)
        ? glanceRow("Losses", lossesCompact(losses), { title: "Fleet losses: attacker / defender (resource value)" })
        : null}
    </>
  );
}

// The battle outcome from the player's side of it: their own attack reads Won / Attack failed,
// an attack on their planet reads Defended / Raided. Observer rows (the universe-wide tab, where
// direction is neutral) keep the attacker's perspective wording.
function missionOutcome(
  losses: MissionLossSummary,
  mission: FleetMissionSummary,
  direction: MissionDirection,
): { label: string; tone: string } | null {
  if (!isOffensiveMissionType(mission.missionType)) return null;
  return playerFacingBattleOutcome(losses.outcome, direction);
}

// The collapsed archive status always uses the viewer's side of the battle. Neutral/observer rows
// deliberately keep the attacker's perspective, matching outgoing rows without claiming planet
// ownership that is not present in the visible data.
function playerFacingBattleOutcome(
  outcome: BattleReport["outcome"],
  direction: MissionDirection,
): { label: string; tone: string } {
  return outcome === "Draw"
    ? { label: "Draw", tone: "text-amber-300/80" }
    : direction === "incoming"
      ? outcome === "DefenderWin"
        ? { label: "Defended", tone: "text-emerald-300/80" }
        : { label: "Raided", tone: "text-red-300/90" }
      : outcome === "AttackerWin"
        ? { label: "Won", tone: "text-emerald-300/80" }
        : { label: "Attack failed", tone: "text-red-300/90" };
}

// Per-side fleet losses as compact resource-value totals — "152K / 45K" (attacker / defender),
// bound with non-breaking spaces so the pair never splits across lines.
function lossesCompact(losses: MissionLossSummary): string {
  return lossesPairCompact(losses.attacker, losses.defender);
}

function lossesPairCompact(
  attacker: BattleReport["attackerLosses"],
  defender: BattleReport["defenderLosses"],
): string {
  return `${formatResourceCompact(String(resourceTotal(attacker)))}\u00A0/\u00A0${formatResourceCompact(String(resourceTotal(defender)))}`;
}

function glanceStat(
  label: string,
  cargo: { metal: string; crystal: string; deuterium: string },
  options: { labelOnDesktop?: boolean } = {},
): preact.ComponentChildren {
  return glanceRow(label, formatCargoCompact(cargo), options);
}

function glanceRow(
  label: string,
  value: string,
  { labelOnDesktop = true, title }: { labelOnDesktop?: boolean; title?: string } = {},
): preact.ComponentChildren {
  return (
    <span className="text-[11px] tabular-nums text-slate-400 lg:block lg:w-full" title={title}>
      <span className={`text-slate-500 ${labelOnDesktop ? "" : "lg:hidden"}`}>{label}</span>{" "}
      {value}
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
  const Icon = action.kind === "joinAttack"
    ? galaxyActionIcon("attack")
    : action.kind === "counterplay" || action.kind === "joinDefense"
      ? galaxyActionIcon("acsDefend")
      : Undo2;
  const button = (
    <button
      aria-label={action.label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101624] ${
        action.enabled
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
          : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
      }`}
      disabled={!action.enabled}
      onClick={onClick}
      title={action.enabled ? action.label : action.reason}
      type="button"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      <span className="sr-only">{action.label}</span>
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

function OpenMissionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Open"
      className={iconRowActionButtonClass}
      onClick={onClick}
      title="Open the full mission detail screen"
      type="button"
    >
      <ExternalLink aria-hidden="true" size={14} strokeWidth={1.9} />
      <span className="sr-only">Open</span>
    </button>
  );
}

export function MissionReportDetail({
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
  const isMissileAttack = mission.missionType === "MissileAttack";
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/80">
            {isMissileAttack ? "Shareable missile impact" : "Shareable mission report"}
          </p>
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
        <ReportPanel title={isMissileAttack ? "Flight" : "Battle time"}>
          <ReportLine label="Arrival" value={report.battleTime} />
          <ReportLine label="Status" value={missionDisplayStatusLabel(mission, now)} />
          {isMissileAttack ? null : <ReportLine label="Outcome" value={report.outcome} />}
        </ReportPanel>
        <ReportPanel title="Coordinates">
          <ReportLine label="Origin" value={report.origin} />
          <ReportLine label="Target" value={report.target} />
          {isMissileAttack ? null : <ReportLine label="Return" value={formatMissionTime(mission.returnAt, now)} />}
        </ReportPanel>
        {isMissileAttack ? (
          <ReportPanel title="Missile payload">
            <ReportLine label="Missiles" value={(mission.missileQuantity ?? 0).toLocaleString()} />
            <ReportLine
              label="Primary target"
              value={defenseCatalog.find((defense) => defense.id === mission.missilePrimaryTargetId)?.label ?? "Selected defense"}
            />
          </ReportPanel>
        ) : (
          <>
            <ReportPanel title="Commanders">
              <ReportLine label="Attacker" value={report.attacker} />
              <ReportLine label="Defender" value={report.defender} />
              <ReportLine label="Group combat" value={report.acs} />
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
          </>
        )}
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
// params — never a detail (`/mission/<id>`) or report (`/mission-control/report/<id>`) route.
const MISSION_CONTROL_ROUTE_PATH = "/mission-control";
const MISSION_CONTROL_VIEW_PARAM_KEYS = ["at", "pt", "ap", "pp"] as const;

function isMissionControlListPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === MISSION_CONTROL_ROUTE_PATH;
}

const ACTIVE_MISSION_TAB_KEYS = new Set<string>(ACTIVE_MISSION_TABS.map((tab) => tab.key));
const PAST_MISSION_TAB_KEYS = new Set<string>(PAST_MISSION_TABS.map((tab) => tab.key));

export const DEFAULT_MISSION_CONTROL_VIEW: MissionControlView = {
  activePage: 0,
  activeTab: ACTIVE_MISSION_DEFAULT_TAB,
  pastPage: 0,
  pastTab: PAST_MISSION_DEFAULT_TAB,
};

export function missionControlViewForAllianceMembership(
  view: MissionControlView,
  hasAlliance: boolean,
): MissionControlView {
  if (hasAlliance || view.activeTab !== "alliance") return view;
  return {
    ...view,
    activePage: 0,
    activeTab: ACTIVE_MISSION_DEFAULT_TAB,
  };
}

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
// `/mission-control` with no query — cannot restore from the URL or storage there. This
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
  // VEY-412 rework: the URL query is the source of truth — it survives browser back, hard reload, and
  // is shareable. sessionStorage / the in-memory mirror are the fallbacks for the in-app
  // "← Mission Control" button, which navigates to bare `/mission-control` (no query).
  writeMissionControlViewToLocation(next);
}

// VEY-412 rework: pure (window-free) encoders so the round-trip is unit-testable. Only non-default
// fields are written, keeping fresh-load URLs clean (`/mission-control`).
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

// Read the tab/page selection encoded in the current location query, but only when we are on the bare
// Mission Control list route. Returns null elsewhere (detail/report routes, SSR, parse errors).
function readMissionControlViewFromLocation(): Partial<MissionControlView> | null {
  if (typeof window === "undefined") return null;
  try {
    if (!isMissionControlListPath(window.location.pathname) || !window.location.search) return null;
    const parsed = parseMissionControlViewParams(window.location.search);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// Reflect the view in the URL via replaceState without creating a new history entry. Guarded to the
// bare list route so we never rewrite a detail URL.
function writeMissionControlViewToLocation(view: MissionControlView): void {
  if (typeof window === "undefined") return;
  try {
    if (!isMissionControlListPath(window.location.pathname)) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of MISSION_CONTROL_VIEW_PARAM_KEYS) params.delete(key);
    const viewParams = new URLSearchParams(buildMissionControlViewQuery(view));
    viewParams.forEach((value, key) => params.set(key, value));
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Best-effort: a sandboxed history (some embeds) can throw on replaceState.
  }
}

// VEY-412 rework: resolve the initial view by precedence — URL query (shareable, survives browser
// back + reload) first; then sessionStorage when it holds a real selection; then the in-memory
// mirror, which is the only fallback that works for the in-app back button inside the Farcaster
// iframe (sessionStorage is blocked there). A blocked/empty storage reads back as the default, so
// we only trust it when it differs from the default and otherwise defer to the in-memory mirror.
export function resolveMissionControlView(): MissionControlView {
  const persisted = readPersistedMissionControlView();
  const base = isDefaultMissionControlView(persisted) ? lastMissionControlView : persisted;
  const fromLocation = readMissionControlViewFromLocation();
  return fromLocation ? { ...base, ...fromLocation } : base;
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
  totalEntries?: number,
): number {
  if (clientFiltered) return rows.length;
  const serverTotalEntries = pagination?.totalEntries ?? totalEntries;
  if (serverTotalEntries !== undefined) {
    return Math.max(rows.length, serverTotalEntries - collapsedCount);
  }
  return paginationForRows(rows, 25).totalEntries;
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
  totalEntries?: number | undefined;
};

function PastMissionSection({
  allCollapsedCount = 0,
  allError,
  allLoading = false,
  allPagination,
  allRows,
  allTotalEntries,
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
  onTabChange,
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
  allTotalEntries?: number | undefined;
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
  onTabChange?: ((tab: PastMissionTabKey) => void) | undefined;
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
      totalEntries: allTotalEntries,
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
            const count = (
              tab.key === "all"
              && data.pagination === undefined
              && data.totalEntries === undefined
              && !missionStateFilterActive
            ) ? "…" : pastDisplayTotalEntries(
                data.rows,
                data.pagination,
                data.collapsedCount,
                missionStateFilterActive,
                data.totalEntries,
              );
            return (
              <button
                aria-selected={tab.key === pastTab}
                className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 aria-selected:border-cyan-300/35 aria-selected:bg-cyan-300/10 aria-selected:text-cyan-100 sm:py-1"
                data-past-tab-button={tab.key}
                key={tab.key}
                onClick={(event) => {
                  showPastMissionTab(event, tab.key);
                  onTabChange?.(tab.key);
                }}
                role="tab"
                type="button"
              >
                {`${tab.label} (${count})`}
              </button>
            );
          })}
        </div>
      </div>
      {PAST_MISSION_TABS.filter((tab) => tab.key === pastTab).map((tab) => (
        <div data-past-tab-panel={tab.key} key={tab.key} role="tabpanel">
          <PastMissionTable initialClientPage={pastPage} {...dataByTab[tab.key]} {...sharedRowProps} />
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
  totalEntries,
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
  const displayTotalEntries = pastDisplayTotalEntries(rows, pagination, collapsedCount, clientFiltered, totalEntries);

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
                    wallet={wallet}
                    walletPlanetIds={walletPlanetIds}
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
        <OpenMissionButton onClick={() => onOpenReport(mission.missionId)} />
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
      statusPill={pastMissionStatusPill(mission, now, losses, missionDirection)}
      subdued
      {...routeEndpointsForRow(origin, target, wallet)}
    />
  );
}

// Past-archive status: a finished battle shows its OUTCOME (Won / Attack failed / Defended /
// Raided / Draw) — "Returned"/"Resolved" says nothing about the fight the player scans for. A
// terminal recalled Attack reads "Recalled" from immutable indexed event provenance (the backend's
// terminal status collapses that to a bare "Returned"). Other expected terminal states mute to plain
// text; unusual endings keep their colored pill so they stand out.
function pastMissionStatusPill(
  mission: FleetMissionSummary,
  now: number,
  losses: MissionLossSummary | undefined,
  direction: MissionDirection,
): MissionStatusPill {
  if (mission.missionType === "Attack" && missionWasRecalled(mission)) {
    return { label: "Recalled", tone: "text-amber-300/80", variant: "text" };
  }
  const outcome = losses ? missionOutcome(losses, mission, direction) : null;
  if (outcome) return { label: outcome.label, tone: outcome.tone, variant: "text" };
  const pill = missionStatusPill(mission, now);
  if (pill.label === "Returned" || pill.label === "Resolved") return { ...pill, variant: "muted" };
  // Pills are live-flight chrome; a past row's unusual terminal state reads as amber text so the
  // finished list keeps one visual voice (colored text = noteworthy, muted text = expected).
  return { label: pill.label, tone: "text-amber-300/80", variant: "text" };
}

// FleetMissionReturned collapses recalled and ordinary fleets to Returned. recallCost is not a safe
// substitute because outbound projected costs can survive in stored summaries.
export function missionWasRecalled(mission: FleetMissionSummary): boolean {
  return mission.status === "Recalled" || mission.recallProvenance === "FleetMissionRecalled";
}

function PastBattleReportRow({
  onOpenReport,
  planetLookup,
  report,
  wallet,
  walletPlanetIds,
}: {
  onOpenReport: (missionId: string) => void;
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>;
  report: BattleReport;
  wallet?: string | undefined;
  walletPlanetIds: ReadonlySet<string>;
}) {
  const outcome = playerFacingBattleOutcome(
    report.outcome,
    resolveBattleReportDirection(report, wallet, walletPlanetIds),
  );
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
        <OpenMissionButton onClick={() => onOpenReport(report.missionId)} />
      }
      badgeLabel="Battle report"
      badgeTone="border-red-300/25 bg-red-400/10 text-red-100"
      direction="outbound"
      glance={
        <>
          {resourceTotal(lootShown) > 0 ? glanceStat("Loot", lootShown) : null}
          {hasAnyCombatLosses(report.attackerLosses, report.defenderLosses)
            ? glanceRow("Losses", lossesPairCompact(report.attackerLosses, report.defenderLosses), {
                title: "Fleet losses: attacker / defender (resource value)",
              })
            : null}
        </>
      }
      subdued
      fleet={
        <div className="contents">
          <MissionDetailGroup title="Battle">
            {detailRow("Outcome", battleOutcomeLabel(report.outcome), battleOutcomeTextTone(report.outcome))}
            {resourceTotal(lootShown) > 0 ? detailRow(isGroupedAttack ? "Group loot" : "Loot", formatCargoNonZero(lootShown)) : null}
            {resourceTotal(report.attackerLosses) > 0 ? detailRow("Attacker losses", formatCargoNonZero(report.attackerLosses)) : null}
            {resourceTotal(report.defenderLosses) > 0 ? detailRow("Defender losses", formatCargoNonZero(report.defenderLosses)) : null}
            {debrisTotal(report.debris) > 0 ? detailRow("Debris field", formatDebrisNonZero(report.debris)) : null}
            {detailRow("Combat", `${report.rounds} rounds · block ${report.blockNumber || "unknown"}`, "text-slate-400")}
            {isGroupedAttack ? detailRow("Group", `${joinerCount} ${joinerCount === 1 ? "joiner" : "joiners"}`, "text-cyan-300/80") : null}
          </MissionDetailGroup>
        </div>
      }
      missionId={report.missionId}
      origin={origin}
      statusPill={{ ...outcome, variant: "text" }}
      target={target}
    />
  );
}

function resolveBattleReportDirection(
  report: BattleReport,
  wallet: string | undefined,
  walletPlanetIds: ReadonlySet<string>,
): MissionDirection {
  if (addressesMatch(report.attacker, wallet)) return "outgoing";
  if (walletPlanetIds.has(report.targetPlanetId)) return "incoming";
  return "neutral";
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

export function partitionActiveMissionRows(rows: ActiveMissionRow[]): {
  alliance: ActiveMissionRow[];
  incoming: ActiveMissionRow[];
  mine: ActiveMissionRow[];
} {
  // Keep the player's fleet-slot usage legible: own outbound/returning fleets belong to "My missions",
  // fleets other players sent toward the wallet belong to "Incoming", and cooperative actions stay in
  // "Alliance". Rows are already deduped + chronologically sorted upstream.
  const alliance: ActiveMissionRow[] = [];
  const incoming: ActiveMissionRow[] = [];
  const mine: ActiveMissionRow[] = [];
  for (const row of rows) {
    if (row.context === "joinable" || row.context === "joinAttack" || row.context === "joinDefense") alliance.push(row);
    else if (row.context === "incoming") incoming.push(row);
    else mine.push(row);
  }
  return { alliance, incoming, mine };
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

// VEY-KANEO-479: an Attack/Harvest fleet's resolution is keeper-driven and, for attacks, gated on the
// battle randomness being committed on-chain — so its arrival clock passing does NOT mean it can be
// settled yet. Rely solely on the backend's `needsResolution` (which already encodes that gate) for
// combat missions instead of inferring "Ready to resolve" from the local clock, which would surface a
// phantom CTA in the window between arrival and the randomness commitment the keeper waits on. Other
// mission types stay on the existing clock fallback, where arrival is sufficient to resolve.
function isMissionReadyToResolve(mission: FleetMissionSummary): boolean {
  return mission.needsResolution === true;
}

// The contract refuses a recall once a fleet is within FLEET_RECALL_CUTOFF_SECONDS of arrival (and
// after arrival), reverting with "the recall cutoff has passed" — VeydriftGameStorage exposes
// FLEET_RECALL_CUTOFF_SECONDS = 60. A fleet is therefore recallable only while it is still Outbound
// and more than that cutoff away from arrival. Both Mission Control and Mission Detail gate their
// Recall affordances on this so the two screens stay consistent (VEY-KANEO-424).
const FLEET_RECALL_CUTOFF_SECONDS = 60;
export const COOPERATIVE_JOIN_CUTOFF_SECONDS = 5 * 60;

export function isCooperativeJoinOpen(mission: FleetMissionSummary, now: number): boolean {
  return mission.status === "Outbound"
    && mission.missionType === "Attack"
    && now < (Number(mission.arrivalAt) - COOPERATIVE_JOIN_CUTOFF_SECONDS) * 1_000;
}

export function isFleetRecallable(mission: FleetMissionSummary, now: number): boolean {
  if (mission.missionType === "MissileAttack") return false;
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

// The funded backend resolver should settle due mission legs promptly. If it cannot submit (for
// example, its wallet runs out of gas funds), the contract entrypoints are permissionless, so any
// connected player may rescue a leg after this grace period. Randomness-blocked combat remains
// excluded: retrying it cannot succeed until the randomness engine has fulfilled the request.
export function manualMissionResolutionKind(
  mission: FleetMissionSummary,
  now: number,
): ManualMissionResolutionKind | undefined {
  if (mission.resolutionBlocker === "randomness_pending") {
    return undefined;
  }

  if (mission.status === "Outbound") {
    const dueAt = missionDueAtMs(mission);
    return isMissionReadyToResolve(mission)
      && Number.isFinite(dueAt)
      && now >= dueAt + MANUAL_MISSION_RESOLUTION_DELAY_MS
      ? "arrival"
      : undefined;
  }

  if (mission.status === "Returning" || mission.status === "Recalled") {
    const returnAt = Number(mission.returnAt) * 1_000;
    return mission.asOfNow?.returned === true
      && Number.isFinite(returnAt) && now >= returnAt + MANUAL_MISSION_RESOLUTION_DELAY_MS
      ? "return"
      : undefined;
  }

  return undefined;
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

function isNoFleetReturned(mission: FleetMissionSummary): boolean {
  return !["Outbound", "Returning", "Recalled"].includes(mission.status)
    && Object.values(mission.ships).every((value) => Number(value) <= 0);
}

function chronologicalActiveMissionRows({
  incoming,
  joinableAttacks,
  joinableDefenses,
  outgoing,
  returning,
}: {
  incoming: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
  joinableDefenses: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
}): ActiveMissionRow[] {
  const rows: ActiveMissionRow[] = [
    ...incoming.map((mission): ActiveMissionRow => ({
      context: "incoming",
      direction: incomingMissionDirection(mission),
      mission
    })),
    ...outgoing.map((mission): ActiveMissionRow => ({ context: "outgoing", direction: "Outbound", mission })),
    ...returning.map((mission): ActiveMissionRow => ({ context: "returning", direction: "Returning", mission })),
    ...joinableAttacks.map((mission): ActiveMissionRow => ({ context: "joinAttack", direction: "Joinable attack", mission })),
    ...joinableDefenses.map((mission): ActiveMissionRow => ({ context: "joinDefense", direction: "Joinable defense", mission })),
  ];
  return sortedUniqueActiveMissionRows(rows);
}

function incomingMissionDirection(mission: FleetMissionSummary): string {
  const hostile = isOffensiveMissionType(mission.missionType);
  if (mission.status === "Returning" || mission.status === "Recalled") {
    return hostile ? "Combat resolved · attacker returning" : "Visit complete · fleet returning";
  }
  return hostile ? "Hostile inbound" : "Friendly inbound";
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
    // Returning missions are intentionally present in the archive as a standby row so a wallet never
    // has a zero-row transition when the active response advances first. While any mission is active,
    // suppress both its archive summary and report; the already-loaded archive row appears immediately
    // when the active copy leaves, preserving VEY-KANEO-434's exactly-once behavior without its gap.
    if (activeMissionIds.has(missionId)) return false;
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
// collapsed row spends no width on empty components. A non-breaking space binds each value to its
// unit letter — a wrap may only happen at the "·" separators, never inside "216 D". The expanded
// card keeps the exact figures.
function formatCargoCompact(cargo: { metal: string; crystal: string; deuterium: string }): string {
  const parts = ([["M", cargo.metal], ["C", cargo.crystal], ["D", cargo.deuterium]] as const)
    .filter(([, value]) => Number(value) > 0)
    .map(([suffix, value]) => `${formatResourceCompact(value)}\u00A0${suffix}`);
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}

// Compact from 1,000 up ("1,845" -> "1.8K") — the glance column trades exactness for scan speed;
// the expanded panel and detail page keep the full figures.
function formatResourceCompact(value: string): string {
  const numeric = Number(value);
  return Math.abs(numeric) < 1_000 ? numeric.toLocaleString("en-US") : compactResourceFormatter.format(numeric);
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
export function missionDisplayStatusLabel(mission: FleetMissionSummary, _now: number): string {
  if (mission.resolutionBlocker === "randomness_pending") return "awaiting randomness";
  if (mission.needsResolution === true) {
    const progress = mission.combatResolutionProgress;
    return progress ? `resolving ${progress.roundsCompleted}/${progress.totalRounds}` : "resolving";
  }
  if (
    mission.status === "Outbound"
    && mission.missionType === "DefenseHold"
    && mission.asOfNow?.arrived === true
    && mission.asOfNow.returned !== true
  ) return "stationed";
  if ((mission.status === "Returning" || mission.status === "Recalled") && mission.asOfNow?.returned === true) {
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
    archetype: planetArtTypeForCoordinates(planet),
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
    archetype: planetArchetypesByCoordinate.get(missionPlanetCoordinateKey(coords)) ?? planetArtTypeForCoordinates(coords),
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
    outcome: isMissionReadyToResolve(mission) ? "Ready to resolve." : missionDisplayStatusLabel(mission, now),
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
  if (mission.missionType === "MissileAttack") {
    const primaryTarget = defenseCatalog.find((defense) => defense.id === mission.missilePrimaryTargetId)?.label ?? "Selected defense";
    return [
      `Veydrift missile impact: ${report.title}`,
      `Arrival: ${report.battleTime}`,
      `Status: ${missionDisplayStatusLabel(mission, now)}`,
      `Route: ${report.routeSummary}`,
      `Missiles: ${(mission.missileQuantity ?? 0).toLocaleString()}`,
      `Primary target: ${primaryTarget}`,
      mission.transactionHash ? `Tx: ${mission.transactionHash}` : null,
    ].filter(Boolean).join("\n");
  }
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

// Text colour for the resolved-battle outcome line on a mission card: red for the player's loss,
// emerald for a win, amber for a draw. Keeps the outcome glanceable without a separate badge slot.
function battleOutcomeTextTone(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "text-emerald-300/80";
  if (outcome === "DefenderWin") return "text-red-300/90";
  return "text-amber-300/80";
}

function resourceTotal(resources: { metal: string; crystal: string; deuterium: string }): number {
  return Number(resources.metal) + Number(resources.crystal) + Number(resources.deuterium);
}

function hasAnyCombatLosses(
  attacker: BattleReport["attackerLosses"],
  defender: BattleReport["defenderLosses"],
): boolean {
  return resourceTotal(attacker) > 0 || resourceTotal(defender) > 0;
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
