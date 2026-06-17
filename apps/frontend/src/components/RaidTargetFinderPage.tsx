import { useEffect, useMemo, useState } from "preact/hooks";
import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, Recycle, ShieldAlert, Swords } from "lucide-preact";
import { planetImageForType } from "../data/mockUniverse";
import { formatDurationUntil } from "../durationFormat";
import { activeMissionsByPlanetId, planetMissionSubtext } from "../planetMissionSubtext";
import type { Coordinates } from "../types";
import { fetchHighscores, fetchRaidFinderDebrisTargets, shortAddress, type ChainShipyardState, type DebrisTargetResponse, type FleetMissionSummary, type HighscoreEntry } from "../walletFlow";
import type { FleetMissionVisibilityResponse } from "../walletFlow";
import {
  DEFAULT_DEBRIS_TARGET_SORT,
  DEFAULT_RAID_TARGET_FILTERS,
  buildRaidTargets,
  buildDebrisTargets,
  filterRaidTargets,
  hasActiveAlliance,
  incomingThreats,
  persistRaidTargetSettings,
  raidTargetTotals,
  readPersistedRaidTargetSettings,
  recyclerCount,
  sortDebrisTargets,
  sortRaidTargets,
  type DebrisFinderTarget,
  type DebrisTargetSort,
  type DebrisTargetSortKey,
  type RaidTarget,
  type RaidTargetFilters,
  type RaidTargetSort,
  type RaidTargetSortKey,
  type RaidTargetUnitBreakdown,
} from "../raidTargetFinder";
import { defenseCatalog, shipCatalog } from "../playableMvp";
import { OptimizedImage } from "./OptimizedImage";
import { PageHeader, RefreshButton } from "./PageHeader";
import { PlanetMissionLines } from "./PlanetMissionLines";
import { RaidTargetsSkeleton } from "./LoadingSkeletons";
import { AfkFlair } from "./AfkFlair";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

export type RaidTargetAttackAction = {
  label: string;
  disabledReason?: string | undefined;
};

type RaidTargetFinderPageProps = {
  // Universe-wide active fleet missions (the unfiltered `/missions?status=active` feed). Drives the
  // per-target mission subtext so the Raid Finder classifies owner-originated vs incoming third-party
  // fleets exactly like Rankings (VEY-KANEO-448). Defaults to empty so the page renders without it.
  activeMissions?: readonly FleetMissionSummary[] | undefined;
  apiBaseUrl: string | undefined;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  attackActionForTarget?: ((target: RaidTarget) => RaidTargetAttackAction | null | undefined) | undefined;
  harvestActionForDebrisTarget?: ((target: DebrisFinderTarget) => RaidTargetAttackAction | null | undefined) | undefined;
  now?: number | undefined;
  onAttackTarget?: ((target: RaidTarget) => void) | undefined;
  onHarvestDebrisTarget?: ((target: DebrisFinderTarget) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
};

// The finder pulls the top slice of the public highscore feed; this already
// carries every occupied planet plus tactical intel and viewer attack
// protection, so a single large page is enough to scout the field.
export const raidTargetFinderPageSize = 250;

const sortColumns: Array<{ key: RaidTargetSortKey; label: string; hint: string }> = [
  { key: "distance", label: "Dist", hint: "Flight distance from your active planet" },
  { key: "loot", label: "Loot", hint: "Plunderable haul — ~50% of the target's current (production-accrued) unprotected resources you'd actually capture, not its full stockpile" },
  { key: "combat", label: "Combat", hint: "Combined ship + defense power to overcome" },
  { key: "defense", label: "Defense", hint: "Stationary defense power" },
];
const debrisSortColumns: Array<{ key: DebrisTargetSortKey; label: string; hint: string }> = [
  { key: "distance", label: "Dist", hint: "Flight distance from your active planet" },
  { key: "total", label: "Total", hint: "Metal + crystal debris" },
  { key: "metal", label: "Metal", hint: "Metal debris" },
  { key: "crystal", label: "Crystal", hint: "Crystal debris" },
  { key: "eta", label: "ETA", hint: "Estimated one-way recycler flight time" },
  { key: "fuel", label: "Fuel", hint: "Estimated deuterium fuel at full speed" },
];
type RaidFinderMode = "raids" | "debris";

export function RaidTargetFinderPage({
  activeMissions,
  apiBaseUrl,
  currentAllianceId,
  currentWallet,
  fleetVisibility,
  attackActionForTarget,
  harvestActionForDebrisTarget,
  now = Date.now(),
  onAttackTarget,
  onHarvestDebrisTarget,
  onSelectAlliance,
  onSelectPlanet,
  onSelectPlayer,
  originCoordinates,
  shipyardState,
}: RaidTargetFinderPageProps) {
  const [entries, setEntries] = useState<HighscoreEntry[]>([]);
  const [debrisEntries, setDebrisEntries] = useState<DebrisTargetResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [debrisError, setDebrisError] = useState<string | undefined>();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [mode, setMode] = useState<RaidFinderMode>("raids");
  const [persistedSettings] = useState(() => readPersistedRaidTargetSettings());
  const [filters, setFilters] = useState<RaidTargetFilters>(() => persistedSettings.filters);
  const [sort, setSort] = useState<RaidTargetSort>(() => persistedSettings.sort);
  const [debrisSort, setDebrisSort] = useState<DebrisTargetSort>(DEFAULT_DEBRIS_TARGET_SORT);
  const showAllianceFilter = hasActiveAlliance(currentAllianceId);
  const effectiveFilters = useMemo(
    () => showAllianceFilter ? filters : { ...filters, hideSameAlliance: false },
    [filters, showAllianceFilter],
  );

  useEffect(() => {
    persistRaidTargetSettings({ filters, sort });
  }, [filters, sort]);

  const load = () => {
    if (!apiBaseUrl) {
      setEntries([]);
      setError("Game API unavailable.");
      return;
    }

    setLoading(true);
    setError(undefined);
    setDebrisError(undefined);
    const highscoresRequest = fetchHighscores(apiBaseUrl, {
      category: "total",
      ...(currentWallet ? { currentWallet } : {}),
      page: 1,
      pageSize: raidTargetFinderPageSize,
    });
    const debrisRequest = fetchRaidFinderDebrisTargets(apiBaseUrl, { limit: raidTargetFinderPageSize });

    highscoresRequest
      .then((response) => {
        setEntries(response.rankings.total ?? []);
        setHasLoaded(true);
      })
      .catch((nextError) => {
        console.error(nextError);
        setError(nextError instanceof Error ? nextError.message : "Raid targets could not be loaded.");
      });
    debrisRequest
      .then((response) => setDebrisEntries(response.targets ?? []))
      .catch((nextError) => {
        console.error(nextError);
        setDebrisEntries([]);
        setDebrisError(nextError instanceof Error ? nextError.message : "Debris targets could not be loaded.");
      });
    void Promise.allSettled([highscoresRequest, debrisRequest]).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Reload whenever the API endpoint or viewer wallet changes so protection
    // and own-planet exclusion stay accurate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, currentWallet]);

  const allTargets = useMemo(
    () => buildRaidTargets({ entries, origin: originCoordinates, currentWallet, fleetVisibility }),
    [entries, originCoordinates, currentWallet, fleetVisibility],
  );
  const missionsByPlanetId = useMemo(() => activeMissionsByPlanetId(activeMissions ?? []), [activeMissions]);
  const allTargetSubtextByPlanetId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof planetMissionSubtext>>();
    for (const target of allTargets) {
      map.set(
        target.planetId,
        planetMissionSubtext(target.planetId, target.owner, missionsByPlanetId.get(target.planetId) ?? [], now),
      );
    }
    return map;
  }, [allTargets, missionsByPlanetId, now]);
  const hasActiveFleetActivity = useMemo(
    () => (target: RaidTarget) => (allTargetSubtextByPlanetId.get(target.planetId)?.lines.length ?? 0) > 0,
    [allTargetSubtextByPlanetId],
  );
  const visibleTargets = useMemo(
    () => sortRaidTargets(filterRaidTargets(allTargets, effectiveFilters, { hasActiveFleetActivity }), sort),
    [allTargets, effectiveFilters, hasActiveFleetActivity, sort],
  );
  const totals = useMemo(() => raidTargetTotals(allTargets, visibleTargets), [allTargets, visibleTargets]);
  const threats = useMemo(() => incomingThreats(fleetVisibility), [fleetVisibility]);
  const debrisTargets = useMemo(
    () => sortDebrisTargets(buildDebrisTargets({
      targets: debrisEntries,
      origin: originCoordinates,
      shipyardState,
      driveLevels: shipyardState?.technologyLevels,
    }), debrisSort),
    [debrisEntries, debrisSort, originCoordinates, shipyardState],
  );
  const availableRecyclers = recyclerCount(shipyardState);
  const totalRecyclerCapacity = availableRecyclers * 20_000;
  const subtextByPlanetId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof planetMissionSubtext>>();
    for (const target of visibleTargets) {
      map.set(target.planetId, allTargetSubtextByPlanetId.get(target.planetId) ?? planetMissionSubtext(target.planetId, target.owner, [], now));
    }
    return map;
  }, [visibleTargets, allTargetSubtextByPlanetId, now]);

  const toggleSort = (key: RaidTargetSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        // Distance defaults to ascending (closest first); value columns descending.
        : { key, direction: key === "distance" ? "asc" : "desc" },
    );
  };
  const toggleDebrisSort = (key: DebrisTargetSortKey) => {
    setDebrisSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "distance" || key === "eta" || key === "fuel" ? "asc" : "desc" },
    );
  };
  const displayedError = mode === "debris" && debrisError ? debrisError : error;

  return (
    <section className="space-y-4">
      <PageHeader
        actions={<RefreshButton loading={loading} onRefresh={load} title="Refresh raid targets" />}
        title="Raid Finder"
        titleSize="xl"
      />

      {!currentWallet ? (
        <div className="rounded border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          Connect your wallet to compute distances from your active planet and hide protected or allied targets.
        </div>
      ) : null}

      <IncomingThreatsBanner now={now} threats={threats} />

      <div className="flex flex-wrap items-center gap-2">
        <ModeButton active={mode === "raids"} label="Raid targets" onClick={() => setMode("raids")} />
        <ModeButton active={mode === "debris"} label="Debris" onClick={() => setMode("debris")} />
        {mode === "debris" ? (
          <span className="ml-auto text-xs text-slate-400">
            <span className="font-mono text-cyan-100">{availableRecyclers.toLocaleString("en-US")}</span> recyclers
            <span className="text-slate-600"> / </span>
            <span className="font-mono">{compactNumber(totalRecyclerCapacity)}</span> capacity
          </span>
        ) : null}
      </div>

      {displayedError ? (
        isGameUnavailableMessage(displayedError) ? (
          <GameUnavailableNotice />
        ) : (
          <div className="rounded border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
            {displayedError}
          </div>
        )
      ) : null}

      {mode === "raids" ? (
        <RaidTargetFilterControls
          filters={filters}
          onChange={setFilters}
          showAllianceFilter={showAllianceFilter}
          totals={totals}
        />
      ) : null}

      <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
        {mode === "raids" ? <RaidTargetTableHeader onSort={toggleSort} sort={sort} /> : <DebrisTargetTableHeader onSort={toggleDebrisSort} sort={debrisSort} />}
        {loading && !hasLoaded ? (
          <RaidTargetsSkeleton />
        ) : mode === "raids" && visibleTargets.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-500">
            {hasLoaded
              ? totals.total === 0
                ? "No raidable planets indexed yet."
                : "No targets match the current filters."
              : "No raid targets loaded yet."}
          </div>
        ) : mode === "debris" && debrisTargets.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-500">
            {hasLoaded ? "No debris fields indexed yet." : "No debris targets loaded yet."}
          </div>
        ) : mode === "raids" ? (
          visibleTargets.map((target) => (
            <RaidTargetRow
              attackAction={attackActionForTarget?.(target) ?? null}
              key={target.planetId}
              missionSubtext={
                subtextByPlanetId.get(target.planetId) ?? planetMissionSubtext(target.planetId, target.owner, [], now)
              }
              now={now}
              onAttackTarget={onAttackTarget}
              onSelectAlliance={onSelectAlliance}
              onSelectPlanet={onSelectPlanet}
              onSelectPlayer={onSelectPlayer}
              target={target}
            />
          ))
        ) : (
          debrisTargets.map((target) => (
            <DebrisTargetRow
              action={harvestActionForDebrisTarget?.(target) ?? { label: "Harvest", disabledReason: target.harvestDisabledReason ?? undefined }}
              key={target.planetId}
              now={now}
              onHarvest={onHarvestDebrisTarget}
              onSelectPlanet={onSelectPlanet}
              onSelectPlayer={onSelectPlayer}
              target={target}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`h-9 rounded border px-3 text-xs font-semibold transition ${
        active
          ? "border-signal/60 bg-signal/10 text-signal"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function IncomingThreatsBanner({
  now,
  threats,
}: {
  now: number;
  threats: ReturnType<typeof incomingThreats>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (threats.length === 0) return null;

  const soonest = threats[0]?.arrivalAtMs ?? null;

  return (
    <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <AlertTriangle aria-hidden="true" className="shrink-0" size={16} />
        <span className="font-semibold">
          {threats.length} fleet{threats.length === 1 ? "" : "s"} inbound to your planets
        </span>
        {soonest !== null ? (
          <span className="ml-auto whitespace-nowrap font-mono text-xs text-red-200/90">
            Next in {formatDurationUntil(soonest, now)}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <ul className="mt-3 space-y-1.5">
          {threats.map((threat) => (
            <li
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-red-400/20 bg-black/20 px-2.5 py-1.5 font-mono text-xs"
              key={threat.missionId}
            >
              <span className="font-semibold text-red-100">{threat.missionType}</span>
              <span className="text-red-200/90">
                {threat.originCoordinates ?? "?"} → {threat.targetCoordinates ?? "your planet"}
              </span>
              <span className="text-red-200/80">
                {threat.attackerDisplayName?.trim() || shortAddress(threat.attacker)}
              </span>
              {threat.arrivalAtMs !== null ? (
                <span className="ml-auto text-red-200/90">ETA {formatDurationUntil(threat.arrivalAtMs, now)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RaidTargetFilterControls({
  filters,
  onChange,
  showAllianceFilter,
  totals,
}: {
  filters: RaidTargetFilters;
  onChange: (filters: RaidTargetFilters) => void;
  showAllianceFilter: boolean;
  totals: ReturnType<typeof raidTargetTotals>;
}) {
  const suppressedTotals = [
    totals.protected > 0 ? `${totals.protected} protected` : null,
    showAllianceFilter && totals.sameAlliance > 0 ? `${totals.sameAlliance} allied` : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterToggle
          active={filters.hideProtected}
          label="Hide protected"
          onToggle={() => onChange({ ...filters, hideProtected: !filters.hideProtected })}
        />
        {showAllianceFilter ? (
          <FilterToggle
            active={filters.hideSameAlliance}
            label="Hide alliance"
            onToggle={() => onChange({ ...filters, hideSameAlliance: !filters.hideSameAlliance })}
          />
        ) : null}
        <FilterToggle
          active={filters.hideDefended}
          label="Hide defended"
          onToggle={() => onChange({ ...filters, hideDefended: !filters.hideDefended })}
        />
        <FilterToggle
          active={filters.hideActiveFleet}
          label="Hide active fleet"
          onToggle={() => onChange({ ...filters, hideActiveFleet: !filters.hideActiveFleet })}
        />
        <span className="ml-auto text-xs text-slate-400">
          <span className="font-mono text-cyan-100">{totals.visible}</span>
          <span className="text-slate-600"> / </span>
          <span className="font-mono">{totals.total}</span> targets
          {suppressedTotals.length > 0 ? (
            <span className="ml-2 text-slate-500">
              ({suppressedTotals.join(", ")})
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <NumberFilter
          label="Min loot"
          onChange={(value) => onChange({ ...filters, minLoot: value ?? 0 })}
          placeholder="0"
          value={filters.minLoot > 0 ? filters.minLoot : null}
        />
        <NumberFilter
          label="Max distance"
          onChange={(value) => onChange({ ...filters, maxDistance: value })}
          placeholder="any"
          value={filters.maxDistance}
        />
      </div>
    </div>
  );
}

function FilterToggle({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`h-9 rounded border px-3 text-xs font-semibold transition ${
        active
          ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
      onClick={onToggle}
      type="button"
    >
      {label}
    </button>
  );
}

function NumberFilter({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: number | null) => void;
  placeholder: string;
  value: number | null;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded border border-white/15 bg-[#070913] px-2">
      <span className="text-[11px] font-medium uppercase text-slate-500">{label}</span>
      <input
        className="h-7 w-24 rounded border border-white/10 bg-[#101624] px-2 text-sm font-semibold text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        onInput={(event) => {
          const raw = (event.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : Number.parseInt(raw, 10));
        }}
        pattern="[0-9]*"
        placeholder={placeholder}
        value={value === null ? "" : String(value)}
      />
    </label>
  );
}

function RaidTargetTableHeader({
  onSort,
  sort,
}: {
  onSort: (key: RaidTargetSortKey) => void;
  sort: RaidTargetSort;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-white/10 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[minmax(0,1fr)_64px_96px_88px_88px_auto] sm:px-3">
      <span>Target</span>
      {sortColumns.map((column) => (
        <button
          aria-label={`Sort by ${column.label}`}
          className={`hidden items-center justify-end gap-1 text-right uppercase tracking-[0.12em] transition hover:text-cyan-100 sm:flex ${
            sort.key === column.key ? "text-cyan-100" : "text-slate-500"
          }`}
          key={column.key}
          onClick={() => onSort(column.key)}
          title={column.hint}
          type="button"
        >
          {column.label}
          {sort.key === column.key ? (
            sort.direction === "asc" ? (
              <ArrowUp aria-hidden="true" size={11} />
            ) : (
              <ArrowDown aria-hidden="true" size={11} />
            )
          ) : null}
        </button>
      ))}
      <span className="text-right">Action</span>
    </div>
  );
}

function DebrisTargetTableHeader({
  onSort,
  sort,
}: {
  onSort: (key: DebrisTargetSortKey) => void;
  sort: DebrisTargetSort;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-white/10 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[minmax(0,1fr)_64px_88px_88px_88px_72px_72px_auto] sm:px-3">
      <span>Debris field</span>
      {debrisSortColumns.map((column) => (
        <button
          aria-label={`Sort by ${column.label}`}
          className={`hidden items-center justify-end gap-1 text-right uppercase tracking-[0.12em] transition hover:text-cyan-100 sm:flex ${
            sort.key === column.key ? "text-cyan-100" : "text-slate-500"
          }`}
          key={column.key}
          onClick={() => onSort(column.key)}
          title={column.hint}
          type="button"
        >
          {column.label}
          {sort.key === column.key ? (
            sort.direction === "asc" ? (
              <ArrowUp aria-hidden="true" size={11} />
            ) : (
              <ArrowDown aria-hidden="true" size={11} />
            )
          ) : null}
        </button>
      ))}
      <span className="text-right">Action</span>
    </div>
  );
}

export function DebrisTargetRow({
  action,
  now,
  onHarvest,
  onSelectPlanet,
  onSelectPlayer,
  target,
}: {
  action?: RaidTargetAttackAction | null | undefined;
  now: number;
  onHarvest?: ((target: DebrisFinderTarget) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  target: DebrisFinderTarget;
}) {
  const commanderLabel = shortAddress(target.owner);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/5 px-2 py-2.5 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_64px_88px_88px_88px_72px_72px_auto] sm:px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30">
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            sizes="icon"
            src={planetImageForType(target.archetype)}
          />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              className="min-w-0 truncate font-mono text-slate-100 hover:text-cyan-100 disabled:cursor-default disabled:hover:text-slate-100"
              disabled={!onSelectPlanet}
              onClick={() => onSelectPlanet?.(target.coordinates)}
              title={`Open ${coordinateLabel(target.coordinates)}`}
              type="button"
            >
              {target.name?.trim() || coordinateLabel(target.coordinates)}
            </button>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{coordinateLabel(target.coordinates)}</span>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-amber-100"
              title={`${target.metal.toLocaleString("en-US")} metal / ${target.crystal.toLocaleString("en-US")} crystal`}
            >
              <Recycle aria-hidden="true" size={10} /> Debris
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <button
              className="min-w-0 truncate text-left font-mono hover:text-cyan-100 disabled:cursor-default disabled:hover:text-slate-500"
              disabled={!onSelectPlayer}
              onClick={() => onSelectPlayer?.(target.owner)}
              title={`Open player ${commanderLabel}`}
              type="button"
            >
              {commanderLabel}
            </button>
            <span className="font-mono text-[10px] text-slate-500">
              {target.recyclersNeeded.toLocaleString("en-US")} recycler{target.recyclersNeeded === 1 ? "" : "s"} needed
            </span>
            <span className="flex flex-wrap gap-x-2 font-mono text-[10px] sm:hidden">
              <span><span className="text-slate-600">Dist </span>{distanceLabel(target.distance)}</span>
              <span className="text-amber-100"><span className="text-slate-600">Total </span>{compactNumber(target.total)}</span>
              <span><span className="text-slate-600">ETA </span>{etaLabel(target.etaSeconds, now)}</span>
            </span>
          </div>
        </div>
      </div>
      <span className="hidden text-right font-mono text-slate-400 sm:block" title="Distance from your active planet">{distanceLabel(target.distance)}</span>
      <span className="hidden text-right font-mono text-amber-100 sm:block" title="Total debris">{compactNumber(target.total)}</span>
      <span className="hidden text-right font-mono text-slate-300 sm:block" title="Metal debris">{compactNumber(target.metal)}</span>
      <span className="hidden text-right font-mono text-cyan-100 sm:block" title="Crystal debris">{compactNumber(target.crystal)}</span>
      <span className="hidden text-right font-mono text-slate-400 sm:block" title="Estimated recycler ETA">{etaLabel(target.etaSeconds, now)}</span>
      <span className="hidden text-right font-mono text-slate-400 sm:block" title="Estimated fuel">{target.fuelCost === null ? "--" : compactNumber(target.fuelCost)}</span>
      <div className="flex shrink-0 flex-col items-end gap-1 self-start">
        {action ? (
          <button
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-amber-300/25 px-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
            disabled={Boolean(action.disabledReason) || !onHarvest}
            onClick={() => onHarvest?.(target)}
            title={action.disabledReason ?? "Harvest this debris field"}
            type="button"
          >
            <Recycle aria-hidden="true" size={12} /> {action.label}
          </button>
        ) : null}
        <button
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-signal/25 px-2 text-xs font-medium text-signal transition hover:bg-signal/10 disabled:cursor-default disabled:opacity-50"
          disabled={!onSelectPlanet}
          onClick={() => onSelectPlanet?.(target.coordinates)}
          type="button"
        >
          <Crosshair aria-hidden="true" size={12} /> Inspect
        </button>
      </div>
    </div>
  );
}

export function RaidTargetRow({
  attackAction,
  missionSubtext,
  now,
  onAttackTarget,
  onSelectAlliance,
  onSelectPlanet,
  onSelectPlayer,
  target,
}: {
  attackAction?: RaidTargetAttackAction | null | undefined;
  missionSubtext: ReturnType<typeof planetMissionSubtext>;
  now: number;
  onAttackTarget?: ((target: RaidTarget) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  target: RaidTarget;
}) {
  const commanderLabel = target.ownerDisplayName?.trim() || shortAddress(target.owner);
  const alliance = target.alliance;
  const rowTone = target.protection.isProtected
    ? "border-red-300/15 bg-red-300/[0.04]"
    : target.protection.isSameAlliance
      ? "border-sky-400/20 bg-sky-300/[0.06]"
      : "border-white/5";

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-2 py-2.5 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_64px_96px_88px_88px_auto] sm:px-3 ${rowTone}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30">
          <OptimizedImage
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            sizes="icon"
            src={planetImageForType(target.archetype)}
          />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              className="min-w-0 truncate font-mono text-slate-100 hover:text-cyan-100 disabled:cursor-default disabled:hover:text-slate-100"
              disabled={!onSelectPlanet}
              onClick={() => onSelectPlanet?.(target.coordinates)}
              title={`Open ${coordinateLabel(target.coordinates)}`}
              type="button"
            >
              {target.name?.trim() || coordinateLabel(target.coordinates)}
            </button>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">{coordinateLabel(target.coordinates)}</span>
            {target.protection.defenderInactive ? <AfkFlair /> : null}
            {target.protection.isProtected ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded border border-red-200/30 bg-red-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-red-100"
                title={target.protection.blockedReasonLabel ?? "Attack blocked by protection rules"}
              >
                <ShieldAlert aria-hidden="true" size={10} /> Protected
              </span>
            ) : null}
            {target.protection.isSameAlliance && alliance ? (
              <span
                className="shrink-0 rounded border border-sky-300/40 bg-sky-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none text-sky-100"
                title={`Same alliance — ${alliance.name}`}
              >
                {`Ally [${alliance.tag}]`}
              </span>
            ) : null}
            {target.inbound.count > 0 ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-amber-100"
                title={
                  target.inbound.nextArrivalAtMs !== null
                    ? `Fleet inbound — arrives in ${formatDurationUntil(target.inbound.nextArrivalAtMs, now)}`
                    : "Fleet already inbound to this target"
                }
              >
                <Swords aria-hidden="true" size={10} /> Inbound {target.inbound.count}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {alliance ? (
              <button
                className="shrink-0 font-mono text-cyan-200 hover:text-cyan-100 disabled:cursor-default disabled:text-slate-500"
                disabled={!onSelectAlliance}
                onClick={() => onSelectAlliance?.(alliance.allianceId)}
                title={`Open alliance ${alliance.tag}`}
                type="button"
              >
                {`[${alliance.tag}]`}
              </button>
            ) : null}
            <button
              className="min-w-0 truncate text-left font-mono hover:text-cyan-100 disabled:cursor-default disabled:hover:text-slate-500"
              disabled={!onSelectPlayer}
              onClick={() => onSelectPlayer?.(target.owner)}
              title={`Open player ${commanderLabel}`}
              type="button"
            >
              {commanderLabel}
            </button>
            <span className="flex flex-wrap gap-x-2 font-mono text-[10px] sm:hidden">
              <span className="text-slate-400" title="Distance from your active planet">
                <span className="text-slate-600">Dist </span>
                {distanceLabel(target.distance)}
              </span>
              <span className="text-emerald-100" title={raidableResourcesLabel(target)}>
                <span className="text-slate-600">Loot </span>
                {compactNumber(target.loot)}
              </span>
              <span className="text-rose-100" title={combatLabel(target)}>
                <span className="text-slate-600">Combat </span>
                {compactNumber(target.combatPower)}
              </span>
              <span className="text-orange-100" title={defenseLabel(target)}>
                <span className="text-slate-600">Def </span>
                {compactNumber(target.defensePower)}
              </span>
            </span>
          </div>
          <PlanetMissionLines className="mt-1" planetId={target.planetId} subtext={missionSubtext} />
        </div>
      </div>

      <span
        className="hidden text-right font-mono text-slate-400 sm:block"
        title="Distance from your active planet"
      >
        {distanceLabel(target.distance)}
      </span>
      <span
        className="hidden min-w-0 truncate text-right font-mono text-emerald-100 sm:block"
        title={raidableResourcesLabel(target)}
      >
        {compactNumber(target.loot)}
      </span>
      <span className="hidden text-right font-mono text-rose-100 sm:block" title={combatLabel(target)}>
        {compactNumber(target.combatPower)}
      </span>
      <span className="hidden text-right font-mono text-orange-100 sm:block" title={defenseLabel(target)}>
        {compactNumber(target.defensePower)}
      </span>

      <div className="row-span-2 flex shrink-0 flex-col items-end gap-1 self-start sm:row-span-1">
        {attackAction ? (
          <button
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-rose-300/25 px-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
            disabled={Boolean(attackAction.disabledReason) || !onAttackTarget}
            onClick={() => onAttackTarget?.(target)}
            title={attackAction.disabledReason ?? "Attack this planet"}
            type="button"
          >
            <Swords aria-hidden="true" size={12} /> {attackAction.label}
          </button>
        ) : null}
        <button
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-signal/25 px-2 text-xs font-medium text-signal transition hover:bg-signal/10 disabled:cursor-default disabled:opacity-50"
          disabled={!onSelectPlanet}
          onClick={() => onSelectPlanet?.(target.coordinates)}
          type="button"
        >
          <Crosshair aria-hidden="true" size={12} /> Inspect
        </button>
      </div>
    </div>
  );
}

function coordinateLabel(coordinates: Coordinates): string {
  return `[${coordinates.galaxy}:${coordinates.system}:${coordinates.position}]`;
}

function distanceLabel(distance: number | null): string {
  if (distance === null) return "--";
  const value = Math.max(0, Math.trunc(distance));
  if (value >= 1_000_000) return `${trimCompact(value / 1_000_000)}M`;
  if (value >= 100_000) return `${trimCompact(value / 1_000)}K`;
  return value.toLocaleString("en-US");
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000_000) return `${trimCompact(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimCompact(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimCompact(value / 1_000)}K`;
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

function trimCompact(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function etaLabel(seconds: number | null, now: number): string {
  if (seconds === null) return "--";
  return formatDurationUntil(now + seconds * 1_000, now);
}

function fullNumber(value: string | null | undefined): string {
  if (value === null || value === undefined) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toLocaleString("en-US") : value;
  }
}

function raidableResourcesLabel(target: RaidTarget): string {
  const resources = target.raidableResources;
  if (!resources) return "Raidable resources unavailable";
  const breakdown = `LOOT M ${fullNumber(resources.metal)} / C ${fullNumber(resources.crystal)} / D ${fullNumber(resources.deuterium)}`;
  // LOOT is the ~50% on-chain plunder of the target's full production-accrued public
  // resources, so it reads lower than the planet's stockpile by design. Show that math
  // explicitly so the gap is not misread as missing accrual. (VEY-KANEO-454)
  if (target.grossLoot > 0 && target.grossLoot >= target.loot) {
    const pct = Math.round((target.loot / target.grossLoot) * 100);
    return `${breakdown} — ~${pct}% plunder of the planet's full accrued public resources (${compactNumber(target.grossLoot)}), not its full stockpile`;
  }
  return breakdown;
}

export function combatLabel(target: RaidTarget): string {
  const sections = [
    unitBreakdownSection("Ships", target.combatShipUnits, shipLabelForId),
    unitBreakdownSection("Defenses", target.defenseUnits, defenseLabelForId),
  ].filter(Boolean);
  const fallback = `from ${target.shipCount} ships and ${target.defenseCount} defenses`;
  return `Combat ${fullNumber(String(target.combatPower))}${sections.length > 0 ? ` — ${sections.join("; ")}` : ` ${fallback}`}`;
}

export function defenseLabel(target: RaidTarget): string {
  const section = unitBreakdownSection("Defenses", target.defenseUnits, defenseLabelForId);
  return `Defense power ${fullNumber(String(target.defensePower))}${section ? ` — ${section}` : ` from ${target.defenseCount} defenses`}`;
}

function unitBreakdownSection(
  label: string,
  units: readonly RaidTargetUnitBreakdown[],
  labelForId: (id: number) => string,
): string | null {
  const rows = units.filter((unit) => unit.count > 0);
  if (rows.length === 0) return null;
  return `${label}: ${rows.map((unit) => `${labelForId(unit.id)} x${unit.count} (${compactNumber(unit.power)})`).join(", ")}`;
}

function shipLabelForId(id: number): string {
  return shipCatalog.find((ship) => ship.id === id)?.label ?? `Ship ${id}`;
}

function defenseLabelForId(id: number): string {
  return defenseCatalog.find((defense) => defense.id === id)?.label ?? `Defense ${id}`;
}
