import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Recycle, ShieldAlert, Swords } from "lucide-preact";
import { planetImageForType } from "../data/mockUniverse";
import { formatDurationUntil } from "../durationFormat";
import { activeMissionsByPlanetId, planetMissionSubtext } from "../planetMissionSubtext";
import type { Coordinates } from "../types";
import { fetchHighscores, fetchRaidFinderDebrisTargets, fetchRaidFinderRifters, shortAddress, type ChainShipyardState, type DebrisTargetResponse, type FleetMissionSummary, type HighscoreEntry, type RiftFinderTargetResponse } from "../walletFlow";
import type { FleetMissionVisibilityResponse } from "../walletFlow";
import {
  DEFAULT_DEBRIS_TARGET_SORT,
  DEFAULT_RAID_TARGET_FILTERS,
  buildRaidTargets,
  buildDebrisTargets,
  filterRaidTargets,
  hasActiveAlliance,
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
import { RaidTargetsSkeleton } from "./LoadingSkeletons";
import { AfkFlair } from "./AfkFlair";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

export type RaidTargetAttackAction = {
  label: string;
  disabledReason?: string | undefined;
};

type RaidTargetFinderPageProps = {
  // Universe-wide activity lets the Hide active fleet filter classify targets
  // without adding fleet-status noise to each result row.
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

// Pull a broad tactical snapshot so filtering and sorting stay global, then
// paginate the resulting Raid Finder lists locally for a compact viewport.
export const raidTargetFinderPageSize = 250;
export const raidFinderRowsPerPage = 25;

const sortColumns: Array<{ key: RaidTargetSortKey; label: string; hint: string }> = [
  { key: "distance", label: "Dist", hint: "Flight distance from your active planet" },
  { key: "loot", label: "Loot", hint: "Plunderable haul — ~50% of the target's current (production-accrued) unprotected resources you'd actually capture, not its full stockpile" },
  { key: "defense", label: "Defense", hint: "Combined defending ship + static defense power to overcome" },
];
const debrisSortColumns: Array<{ key: DebrisTargetSortKey; label: string; hint: string }> = [
  { key: "distance", label: "Dist", hint: "Flight distance from your active planet" },
  { key: "total", label: "Total", hint: "Metal + crystal debris" },
  { key: "metal", label: "Metal", hint: "Metal debris" },
  { key: "crystal", label: "Crystal", hint: "Crystal debris" },
  { key: "eta", label: "ETA", hint: "Estimated one-way recycler flight time" },
  { key: "fuel", label: "Fuel", hint: "Estimated deuterium fuel at full speed" },
];
type RaidFinderMode = "raids" | "debris" | "rifters";
type RaidFinderPages = Record<RaidFinderMode, number>;

export type RaidFinderPaginationState = {
  endIndex: number;
  firstEntry: number;
  lastEntry: number;
  page: number;
  pageSize: number;
  startIndex: number;
  totalEntries: number;
  totalPages: number;
};

export function raidFinderPagination(
  totalEntries: number,
  requestedPage: number,
  pageSize = raidFinderRowsPerPage,
): RaidFinderPaginationState {
  const safeTotal = Number.isFinite(totalEntries) ? Math.max(0, Math.trunc(totalEntries)) : 0;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.trunc(pageSize)) : raidFinderRowsPerPage;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage) || 1));
  const startIndex = (page - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, safeTotal);
  return {
    endIndex,
    firstEntry: safeTotal === 0 ? 0 : startIndex + 1,
    lastEntry: endIndex,
    page,
    pageSize: safePageSize,
    startIndex,
    totalEntries: safeTotal,
    totalPages,
  };
}

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
  const [rifterEntries, setRifterEntries] = useState<RiftFinderTargetResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [debrisError, setDebrisError] = useState<string | undefined>();
  const [rifterError, setRifterError] = useState<string | undefined>();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [mode, setMode] = useState<RaidFinderMode>("raids");
  const [pages, setPages] = useState<RaidFinderPages>({ raids: 1, debris: 1, rifters: 1 });
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
    setRifterError(undefined);
    setPages({ raids: 1, debris: 1, rifters: 1 });
    const highscoresRequest = fetchHighscores(apiBaseUrl, {
      category: "total",
      ...(currentWallet ? { currentWallet } : {}),
      page: 1,
      pageSize: raidTargetFinderPageSize,
    });
    const debrisRequest = fetchRaidFinderDebrisTargets(apiBaseUrl, { limit: raidTargetFinderPageSize });
    const riftersRequest = fetchRaidFinderRifters(apiBaseUrl, { limit: raidTargetFinderPageSize });

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
    riftersRequest
      .then((response) => setRifterEntries(response.targets ?? []))
      .catch((nextError) => {
        console.error(nextError);
        setRifterEntries([]);
        setRifterError(nextError instanceof Error ? nextError.message : "Rift targets could not be loaded.");
      });
    void Promise.allSettled([highscoresRequest, debrisRequest, riftersRequest]).finally(() => setLoading(false));
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
  const raidPagination = useMemo(
    () => raidFinderPagination(visibleTargets.length, pages.raids),
    [pages.raids, visibleTargets.length],
  );
  const debrisPagination = useMemo(
    () => raidFinderPagination(debrisTargets.length, pages.debris),
    [debrisTargets.length, pages.debris],
  );
  const rifterPagination = useMemo(
    () => raidFinderPagination(rifterEntries.length, pages.rifters),
    [pages.rifters, rifterEntries.length],
  );
  const pagedRaidTargets = visibleTargets.slice(raidPagination.startIndex, raidPagination.endIndex);
  const pagedDebrisTargets = debrisTargets.slice(debrisPagination.startIndex, debrisPagination.endIndex);
  const pagedRifterEntries = rifterEntries.slice(rifterPagination.startIndex, rifterPagination.endIndex);
  const activePagination = mode === "raids"
    ? raidPagination
    : mode === "debris"
      ? debrisPagination
      : rifterPagination;
  const setModePage = (nextPage: number) => {
    setPages((current) => ({ ...current, [mode]: nextPage }));
  };
  const toggleSort = (key: RaidTargetSortKey) => {
    setPages((current) => ({ ...current, raids: 1 }));
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        // Distance defaults to ascending (closest first); value columns descending.
        : { key, direction: key === "distance" ? "asc" : "desc" },
    );
  };
  const toggleDebrisSort = (key: DebrisTargetSortKey) => {
    setPages((current) => ({ ...current, debris: 1 }));
    setDebrisSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "distance" || key === "eta" || key === "fuel" ? "asc" : "desc" },
    );
  };
  const displayedError = mode === "debris"
    ? (debrisError ?? error)
    : mode === "rifters"
      ? (rifterError ?? error)
      : error;

  return (
    <section className="space-y-3">
      {!currentWallet ? (
        <div className="rounded border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          Connect your wallet to compute distances from your active planet and hide protected or allied targets.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <ModeButton active={mode === "raids"} label="Raids" onClick={() => setMode("raids")} />
        <ModeButton active={mode === "rifters"} label="Rifters" onClick={() => setMode("rifters")} />
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
          onChange={(nextFilters) => {
            setFilters(nextFilters);
            setPages((current) => ({ ...current, raids: 1 }));
          }}
          showAllianceFilter={showAllianceFilter}
          totals={totals}
        />
      ) : null}

      <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
        {mode === "raids" ? <RaidTargetTableHeader onSort={toggleSort} sort={sort} /> : mode === "debris" ? <DebrisTargetTableHeader onSort={toggleDebrisSort} sort={debrisSort} /> : null}
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
        ) : mode === "rifters" && rifterEntries.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-500">
            {hasLoaded ? "No active Rift extractions indexed yet." : "No Rift targets loaded yet."}
          </div>
        ) : mode === "raids" ? (
          pagedRaidTargets.map((target) => (
            <RaidTargetRow
              attackAction={attackActionForTarget?.(target) ?? null}
              key={target.planetId}
              onAttackTarget={onAttackTarget}
              onSelectAlliance={onSelectAlliance}
              onSelectPlanet={onSelectPlanet}
              onSelectPlayer={onSelectPlayer}
              target={target}
            />
          ))
        ) : mode === "debris" ? (
          pagedDebrisTargets.map((target) => (
            <DebrisTargetRow
              action={harvestActionForDebrisTarget
                ? harvestActionForDebrisTarget(target)
                : { label: "Harvest", disabledReason: target.harvestDisabledReason ?? undefined }}
              key={target.planetId}
              now={now}
              onHarvest={onHarvestDebrisTarget}
              onSelectPlanet={onSelectPlanet}
              onSelectPlayer={onSelectPlayer}
              target={target}
            />
          ))
        ) : (
          pagedRifterEntries.map((target) => (
            <RifterTargetRow
              key={target.planetId}
              now={now}
              onSelectPlanet={onSelectPlanet}
              onSelectPlayer={onSelectPlayer}
              target={target}
            />
          ))
        )}
        {!loading && activePagination.totalEntries > 0 ? (
          <RaidFinderPagination
            onNext={() => setModePage(activePagination.page + 1)}
            onPrevious={() => setModePage(activePagination.page - 1)}
            pagination={activePagination}
          />
        ) : null}
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
      className={`h-9 rounded border px-2.5 text-xs font-semibold transition sm:h-8 ${
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

export function RaidFinderPagination({
  onNext,
  onPrevious,
  pagination,
}: {
  onNext: () => void;
  onPrevious: () => void;
  pagination: RaidFinderPaginationState;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 text-xs text-slate-400">
      <span>
        Page {pagination.page} of {pagination.totalPages}
        <span className="ml-2 text-slate-600">
          {pagination.firstEntry}-{pagination.lastEntry} of {pagination.totalEntries}
        </span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          aria-label="Previous Raid Finder page"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
          disabled={pagination.page <= 1}
          onClick={onPrevious}
          title="Previous page"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Next Raid Finder page"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
          disabled={pagination.page >= pagination.totalPages}
          onClick={onNext}
          title="Next page"
          type="button"
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      </div>
    </div>
  );
}

function RifterTargetRow({
  now,
  onSelectPlanet,
  onSelectPlayer,
  target,
}: {
  now: number;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  target: RiftFinderTargetResponse;
}) {
  const coords = coordinateLabel(target.coordinates);
  const unlocksAtMs = Number(target.unlocksAt) * 1_000;
  const resourceSummary = [
    ["M", target.resources.metal, "text-slate-200"],
    ["C", target.resources.crystal, "text-cyan-100"],
    ["D", target.resources.deuterium, "text-emerald-100"],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-fuchsia-300/10 px-3 py-2 text-sm last:border-b-0">
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-fuchsia-300/25 bg-fuchsia-300/10">
        <OptimizedImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="icon" src={planetImageForType(target.archetype)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            className="min-w-0 truncate font-mono font-semibold text-fuchsia-100 hover:text-white disabled:cursor-default disabled:hover:text-fuchsia-100"
            disabled={!onSelectPlanet}
            onClick={() => onSelectPlanet?.(target.coordinates)}
            type="button"
          >
            {target.name?.trim() || coords}
          </button>
          <span className="font-mono text-[10px] text-slate-500">{coords}</span>
          <span
            className="rounded border border-fuchsia-300/30 bg-fuchsia-300/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fuchsia-100"
            title="Rift withdrawals are fully raidable"
          >
            Rifting
          </span>
        </div>
        <button
          className="mt-0.5 block font-mono text-xs text-slate-500 hover:text-cyan-100 disabled:cursor-default disabled:hover:text-slate-500"
          disabled={!onSelectPlayer}
          onClick={() => onSelectPlayer?.(target.owner)}
          type="button"
        >
          {shortAddress(target.owner)}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
        {resourceSummary.map(([label, amount, className]) => (
          <span className={className} key={label} title={`${label} Rift resources — 100% raidable`}>
            <span className="text-slate-600">{label} </span>{fullNumber(amount)}
          </span>
        ))}
      </div>
      <span className="ml-auto whitespace-nowrap font-mono text-xs text-fuchsia-100" title="Extraction unlock time">
        {Number.isFinite(unlocksAtMs) ? `Unlocks ${formatDurationUntil(unlocksAtMs, now)}` : "Unlock time unavailable"}
      </span>
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] p-2">
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
      <span
        className="ml-auto whitespace-nowrap text-xs text-slate-400"
        title={suppressedTotals.length > 0 ? suppressedTotals.join(", ") : "Visible / total targets"}
      >
        <span className="font-mono text-cyan-100">{totals.visible}</span>
        <span className="text-slate-600"> / </span>
        <span className="font-mono">{totals.total}</span>
        <span className="hidden md:inline"> targets</span>
      </span>
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
      className={`h-9 rounded border px-2.5 text-xs font-semibold transition sm:h-8 ${
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
    <label className="flex h-9 items-center gap-1.5 rounded border border-white/15 bg-[#070913] px-2 sm:h-8">
      <span className="text-[11px] font-medium uppercase text-slate-500">{label}</span>
      <input
        className="h-8 w-20 rounded border border-white/10 bg-[#101624] px-2 text-xs font-semibold text-white outline-none [color-scheme:dark] focus:border-signal/50 sm:h-6"
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

export function applyMobileSortSelection<K extends string>(key: K, currentKey: K, onSort: (key: K) => void): void {
  if (key !== currentKey) onSort(key);
}

function MobileSortControls<K extends string>({
  columns,
  id,
  onSort,
  sort,
}: {
  columns: ReadonlyArray<{ key: K; label: string }>;
  id: string;
  onSort: (key: K) => void;
  sort: { direction: "asc" | "desc"; key: K };
}) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 px-2 py-2 sm:hidden">
      <label className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500" htmlFor={id}>
        Sort
      </label>
      <select
        className="h-10 min-w-0 flex-1 rounded border border-white/10 bg-[#0d1422] px-2 text-xs font-semibold text-slate-200"
        id={id}
        onInput={(event) => {
          const key = event.currentTarget.value as K;
          applyMobileSortSelection(key, sort.key, onSort);
        }}
        value={sort.key}
      >
        {columns.map((column) => (
          <option key={column.key} value={column.key}>{column.label}</option>
        ))}
      </select>
      <button
        aria-label={`Sort ${sort.direction === "asc" ? "descending" : "ascending"}`}
        className="grid h-10 w-10 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/10"
        onClick={() => onSort(sort.key)}
        type="button"
      >
        {sort.direction === "asc"
          ? <ArrowUp aria-hidden="true" size={13} />
          : <ArrowDown aria-hidden="true" size={13} />}
      </button>
    </div>
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
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2 border-b border-white/10 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[minmax(0,1fr)_64px_96px_88px_40px] sm:px-3">
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
      <MobileSortControls columns={sortColumns} id="raid-target-sort" onSort={onSort} sort={sort} />
    </>
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
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2 border-b border-white/10 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[minmax(0,1fr)_64px_88px_88px_88px_72px_72px_40px] sm:px-3">
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
      <MobileSortControls columns={debrisSortColumns} id="debris-target-sort" onSort={onSort} sort={sort} />
    </>
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
  const targetName = target.name?.trim();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2 border-b border-white/5 px-2 py-1.5 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_64px_88px_88px_88px_72px_72px_40px] sm:px-3">
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
              {targetName || coordinateLabel(target.coordinates)}
            </button>
            {targetName ? (
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{coordinateLabel(target.coordinates)}</span>
            ) : null}
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
      <div className="flex shrink-0 items-center justify-end self-center">
        {action ? (
          <button
            aria-label={action.disabledReason ? `${action.label}: ${action.disabledReason}` : action.label}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-amber-300/25 text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500 sm:h-8 sm:w-8"
            disabled={Boolean(action.disabledReason) || !onHarvest}
            onClick={() => onHarvest?.(target)}
            title={action.disabledReason ? `${action.label}: ${action.disabledReason}` : action.label}
            type="button"
          >
            <Recycle aria-hidden="true" size={14} strokeWidth={1.9} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RaidTargetRow({
  attackAction,
  onAttackTarget,
  onSelectAlliance,
  onSelectPlanet,
  onSelectPlayer,
  target,
}: {
  attackAction?: RaidTargetAttackAction | null | undefined;
  onAttackTarget?: ((target: RaidTarget) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  target: RaidTarget;
}) {
  const commanderLabel = target.ownerDisplayName?.trim() || shortAddress(target.owner);
  const targetName = target.name?.trim();
  const alliance = target.alliance;
  const rowTone = target.protection.isProtected
    ? "border-red-300/15 bg-red-300/[0.04]"
    : target.protection.isAtWar
      ? "border-rose-300/20 bg-rose-300/[0.06]"
    : target.protection.isSameAlliance
      ? "border-sky-400/20 bg-sky-300/[0.06]"
      : "border-white/5";

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_64px_96px_88px_40px] sm:px-3 ${rowTone}`}
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
              {targetName || coordinateLabel(target.coordinates)}
            </button>
            {targetName ? (
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{coordinateLabel(target.coordinates)}</span>
            ) : null}
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
            {target.protection.isAtWar && alliance ? (
              <span
                className="shrink-0 rounded border border-rose-300/40 bg-rose-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none text-rose-100"
                title={`At war with ${alliance.name}`}
              >
                {`War [${alliance.tag}]`}
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
              <span className="text-orange-100" title={defenseLabel(target)}>
                <span className="text-slate-600">Def </span>
                {compactNumber(target.combatPower)}
              </span>
            </span>
          </div>
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
      <span className="hidden text-right font-mono text-orange-100 sm:block" title={defenseLabel(target)}>
        {compactNumber(target.combatPower)}
      </span>

      <div className="flex shrink-0 items-center justify-end self-center">
        {attackAction ? (
          <button
            aria-label={attackAction.disabledReason ? `${attackAction.label}: ${attackAction.disabledReason}` : attackAction.label}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-rose-300/25 text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500 sm:h-8 sm:w-8"
            disabled={Boolean(attackAction.disabledReason) || !onAttackTarget}
            onClick={() => onAttackTarget?.(target)}
            title={attackAction.disabledReason ? `${attackAction.label}: ${attackAction.disabledReason}` : attackAction.label}
            type="button"
          >
            <Swords aria-hidden="true" size={14} strokeWidth={1.9} />
          </button>
        ) : null}
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

export function defenseLabel(target: RaidTarget): string {
  const sections = [
    unitBreakdownSection("Ships", target.combatShipUnits, shipLabelForId),
    unitBreakdownSection("Defenses", target.defenseUnits, defenseLabelForId),
  ].filter(Boolean);
  const fallback = `from ${target.shipCount} ships and ${target.defenseCount} defenses`;
  return `Defense ${fullNumber(String(target.combatPower))}${sections.length > 0 ? ` — ${sections.join("; ")}` : ` ${fallback}`}`;
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
