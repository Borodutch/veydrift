import { useEffect, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, RotateCw, UserRound } from "lucide-preact";
import { planetImageForType } from "../data/mockUniverse";
import { fleetMissionDistance } from "../fleetMissionRules";
import type { Coordinates } from "../types";
import { fetchHighscores, shortAddress, type HighscoreCategory, type HighscoreEntry, type HighscorePlanet, type HighscoreResponse } from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

type RankingsPageProps = {
  apiBaseUrl: string | undefined;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
};

const categories: Array<{ key: HighscoreCategory; label: string }> = [
  { key: "total", label: "Total" },
  { key: "economy", label: "Economy" },
  { key: "research", label: "Research" },
  { key: "researchLevels", label: "Research levels" },
  { key: "military", label: "Military" },
  { key: "fleet", label: "Fleet value" },
  { key: "fleetCount", label: "Ships" },
  { key: "defense", label: "Defense" },
];

export const rankingsColumnLabels = ["Rank", "Commander", "Score"] as const;
export const rankingsPageSize = 50;

export function primaryRankingEntries(data: HighscoreResponse | null): HighscoreEntry[] {
  return data?.rankings.total ?? [];
}

export function rankingsPaginationLabel(pagination: NonNullable<HighscoreResponse["pagination"]>): string {
  return `Page ${pagination.page} of ${pagination.totalPages}`;
}

export function shouldShowRankingsInitialLoader({
  hasLoadedData,
  loading,
}: {
  hasLoadedData: boolean;
  loading: boolean;
}): boolean {
  return loading && !hasLoadedData;
}

export function RankingsPage({ apiBaseUrl, currentAllianceId, currentWallet, onSelectAlliance, onSelectPlayer, onSelectPlanet, originCoordinates }: RankingsPageProps) {
  const [active, setActive] = useState<HighscoreCategory>("total");
  const [data, setData] = useState<HighscoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const load = (targetPage = page) => {
    if (!apiBaseUrl) {
      setData(null);
      setError("Game API unavailable.");
      return;
    }

    setLoading(true);
    setError(undefined);
    fetchHighscores(apiBaseUrl, {
      ...(currentWallet ? { currentWallet } : {}),
      page: targetPage,
      pageSize: rankingsPageSize
    })
      .then(setData)
      .catch((nextError) => {
        console.error(nextError);
        setError(nextError instanceof Error ? nextError.message : "Rankings could not be loaded.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(page);
  }, [apiBaseUrl, currentWallet, page]);

  const entries = data?.rankings[active] ?? [];
  const pagination = data?.pagination ?? null;
  const currentPlayerPage = data?.currentPlayer?.rankings[active] ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">
            Public Highscores
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Rankings</h1>
        </div>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          onClick={() => load(page)}
          type="button"
        >
          <RotateCw aria-hidden="true" size={14} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      {loading && data ? <InlineSyncIndicator label="Refreshing rankings" /> : null}

      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            aria-pressed={active === category.key}
            className={`h-9 rounded border px-3 text-xs font-semibold transition ${
              active === category.key
                ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
            key={category.key}
            onClick={() => setActive(category.key)}
            type="button"
          >
            {category.label}
          </button>
        ))}
      </div>

      <RankingsTable
        active={active}
        currentAllianceId={currentAllianceId}
        currentWallet={currentWallet}
        entries={entries}
        hasLoadedData={Boolean(data)}
        loading={loading}
        onSelectAlliance={onSelectAlliance}
        onSelectPlayer={onSelectPlayer}
        onSelectPlanet={onSelectPlanet}
        originCoordinates={originCoordinates}
      />

      {pagination ? (
        <RankingsPagination
          loading={loading}
          currentPlayerPage={currentPlayerPage}
          onNext={() => setPage((currentPage) => currentPage + 1)}
          onPrevious={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
          onCurrentPlayer={() => currentPlayerPage ? setPage(currentPlayerPage.page) : undefined}
          pagination={pagination}
        />
      ) : null}

      {data ? (
        <p className="text-xs leading-5 text-slate-500">
          {data.formula.summary}
        </p>
      ) : null}
    </section>
  );
}

export function RankingsPagination({
  currentPlayerPage,
  loading,
  onCurrentPlayer,
  onNext,
  onPrevious,
  pagination,
}: {
  currentPlayerPage?: { rank: number; page: number } | null | undefined;
  loading: boolean;
  onCurrentPlayer?: (() => void) | undefined;
  onNext: () => void;
  onPrevious: () => void;
  pagination: NonNullable<HighscoreResponse["pagination"]>;
}) {
  const firstEntry = pagination.totalEntries === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastEntry = Math.min(pagination.page * pagination.pageSize, pagination.totalEntries);

  return (
    <div className="flex flex-col gap-2 border-t border-white/10 pt-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span>
        {rankingsPaginationLabel(pagination)}
        <span className="ml-2 text-slate-600">
          {firstEntry}-{lastEntry} of {pagination.totalEntries}
        </span>
      </span>
      <div className="flex items-center gap-2">
        {currentPlayerPage ? (
          <button
            aria-label={`Go to your rank ${currentPlayerPage.rank}`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-cyan-300/20 bg-cyan-300/10 px-2.5 text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading || pagination.page === currentPlayerPage.page}
            onClick={onCurrentPlayer}
            title="Go to your rank"
            type="button"
          >
            <UserRound aria-hidden="true" size={13} />
            <span className="font-mono">#{currentPlayerPage.rank}</span>
          </button>
        ) : null}
        <button
          aria-label="Previous rankings page"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || !pagination.hasPreviousPage}
          onClick={onPrevious}
          title="Previous page"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Next rankings page"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || !pagination.hasNextPage}
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

export function RankingsTable({
  active = "total",
  currentAllianceId,
  currentWallet,
  entries,
  hasLoadedData = entries.length > 0,
  loading,
  onSelectAlliance,
  onSelectPlayer,
  onSelectPlanet,
  originCoordinates,
}: {
  active?: HighscoreCategory;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entries: HighscoreEntry[];
  hasLoadedData?: boolean | undefined;
  loading: boolean;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
      <div className="grid grid-cols-[52px_minmax(0,1fr)_88px] border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[72px_minmax(0,1fr)_120px]">
        {rankingsColumnLabels.map((label) => (
          <span className={`${label === "Rank" || label === "Commander" ? "" : "text-right"}`} key={label}>
            {label}
          </span>
        ))}
      </div>
      {shouldShowRankingsInitialLoader({ hasLoadedData, loading }) ? (
        <div className="p-3">
          <VeydriftLoader label="Loading rankings" />
        </div>
      ) : entries.length === 0 ? (
        <RankingsMessage label="No settled commanders indexed yet" />
      ) : (
        entries.map((entry) => (
          <RankingRow
            active={active}
            currentAllianceId={currentAllianceId}
            currentWallet={currentWallet}
            entry={entry}
            key={`${active}-${entry.wallet}`}
            onSelectAlliance={onSelectAlliance}
            onSelectPlayer={onSelectPlayer}
            onSelectPlanet={onSelectPlanet}
            originCoordinates={originCoordinates}
          />
        ))
      )}
    </div>
  );
}

function RankingRow({
  active,
  currentAllianceId,
  currentWallet,
  entry,
  onSelectAlliance,
  onSelectPlayer,
  onSelectPlanet,
  originCoordinates,
}: {
  active: HighscoreCategory;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entry: HighscoreEntry;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
}) {
  const homePlanet = entry.homePlanet ?? null;
  const rankedPlanets = rankingPlanets(entry);
  const canOpenPlayer = Boolean(onSelectPlayer);
  const commanderLabel = entry.displayName?.trim() || shortAddress(entry.wallet);
  const normalizedWallet = entry.wallet.toLowerCase();
  const isCurrentPlayer = Boolean(currentWallet && normalizedWallet === currentWallet.toLowerCase());
  const alliance = entry.alliance ?? null;
  const isSameAllianceProtection = entry.attackProtection?.blockedReason === "same_alliance";
  const isSameAlliance = Boolean(
    !isCurrentPlayer && (
      isSameAllianceProtection
        || (
          alliance
          && currentAllianceId
          && currentAllianceId !== "0"
          && alliance.allianceId === currentAllianceId
        )
    )
  );
  const isAttackProtected = Boolean(
    entry.attackProtection
      && !entry.attackProtection.allowed
      && entry.attackProtection.blockedReason !== "none"
      && entry.attackProtection.blockedReason !== "same_alliance"
  );
  const rowTone = isCurrentPlayer
    ? "border-cyan-300/25 bg-cyan-300/[0.09] shadow-[inset_3px_0_0_rgba(103,232,249,0.7)]"
    : isAttackProtected
        ? "border-red-300/20 bg-red-300/[0.06] shadow-[inset_3px_0_0_rgba(248,113,113,0.5)]"
        : isSameAlliance
          ? "border-sky-300/20 bg-sky-300/[0.06] shadow-[inset_3px_0_0_rgba(125,211,252,0.55)]"
          : "border-white/5";

  const openAlliance = () => {
    if (!alliance || !onSelectAlliance) return;
    onSelectAlliance(alliance.allianceId);
  };
  const openPlayer = () => {
    if (!onSelectPlayer) return;
    onSelectPlayer(entry.wallet);
  };

  return (
    <div
      aria-current={isCurrentPlayer ? "true" : undefined}
      className={`grid grid-cols-[52px_minmax(0,1fr)_88px] items-center border-b px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[72px_minmax(0,1fr)_120px] ${rowTone}`}
      data-ranking-wallet={normalizedWallet}
    >
      <span className={`font-mono ${isCurrentPlayer ? "text-cyan-100" : isSameAlliance ? "text-sky-100" : "text-slate-400"}`}>#{entry.rank}</span>
      <span className="flex min-w-0 items-center gap-2.5">
        {rankedPlanets.length > 0 ? (
          <span className="flex max-w-28 shrink-0 flex-wrap gap-1">
            {rankedPlanets.map((planet) => (
              <button
                aria-label={`Open planet at ${homePlanetCoordinatesLabel(planet)}`}
                className="relative h-8 w-8 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30 transition hover:border-cyan-200/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                disabled={!onSelectPlanet}
                key={planet.planetId}
                onClick={() => onSelectPlanet?.(planet.coordinates)}
                title={`Open ${homePlanetHoverLabel(planet)}`}
                type="button"
              >
                <OptimizedImage
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  sizes="icon"
                  src={planetImageForType(planet.archetype)}
                />
              </button>
            ))}
          </span>
        ) : null}
        <span className="min-w-0 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            {alliance ? (
              <button
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 ${
                  isSameAlliance
                    ? "border-sky-300/25 bg-sky-300/10 text-sky-100 hover:border-sky-200/50 hover:bg-sky-300/15"
                    : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:border-cyan-200/50 hover:bg-cyan-300/15"
                }`}
                disabled={!onSelectAlliance}
                onClick={openAlliance}
                title={`Open alliance ${alliance.tag}`}
                type="button"
              >
                {`[${alliance.tag}]`}
              </button>
            ) : null}
            <button
              className={`min-w-0 text-left ${canOpenPlayer ? "cursor-pointer" : "cursor-default"}`}
              disabled={!canOpenPlayer}
              onClick={openPlayer}
              title={`Open player ${commanderLabel}`}
              type="button"
            >
              <span className={`block truncate font-mono ${canOpenPlayer ? "text-slate-100 hover:text-cyan-100" : "text-slate-100"}`}>
                {commanderLabel}
              </span>
            </button>
            {isCurrentPlayer ? (
              <span className="shrink-0 rounded border border-cyan-200/30 bg-cyan-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-cyan-100">
                You
              </span>
            ) : null}
            {isAttackProtected ? (
              <span
                className="shrink-0 rounded border border-red-200/30 bg-red-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-red-100"
                title={entry.attackProtection?.blockedReasonLabel ?? "Attack blocked by protection rules"}
              >
                Protected
              </span>
            ) : null}
          </span>
          {homePlanet ? (
            <span className="block min-w-0 truncate text-xs text-slate-500" title={homePlanetHoverLabel(homePlanet)}>
              {homePlanetLabel(homePlanet)}
            </span>
          ) : null}
        </span>
      </span>
      <span className="text-right font-mono font-semibold text-cyan-100">{formatScore(entry.score[active])}</span>
      {rankedPlanets.length > 0 ? (
        <div className="col-start-2 col-end-4 mt-2 min-w-0 space-y-1 sm:col-start-2">
          {rankedPlanets.map((planet) => (
            <button
              className="grid w-full grid-cols-[minmax(0,1fr)_46px_72px_68px] items-center gap-2 rounded border border-white/5 bg-black/20 px-2 py-1.5 text-left text-[11px] transition hover:border-cyan-200/30 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-cyan-300/30 sm:grid-cols-[minmax(0,1fr)_56px_88px_82px]"
              disabled={!onSelectPlanet}
              key={`tactical-${planet.planetId}`}
              onClick={() => onSelectPlanet?.(planet.coordinates)}
              title={`Open ${homePlanetHoverLabel(planet)}`}
              type="button"
            >
              <span className="min-w-0 truncate text-slate-200">
                {homePlanetLabel(planet)}
              </span>
              <span className="font-mono text-slate-400" title={originCoordinates ? `Distance from ${coordinateLabel(originCoordinates)}` : "Select a planet to calculate distance"}>
                {planetDistanceLabel(originCoordinates, planet.coordinates)}
              </span>
              <span className="font-mono text-emerald-100" title={planetRaidableResourcesLabel(planet)}>
                {compactScore(planet.tactical?.raidableResourceTotal ?? "0")}
              </span>
              <span className="font-mono text-rose-100" title={planetCombatLabel(planet)}>
                {compactScore(planet.tactical?.combatPower ?? "0")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RankingsMessage({ label }: { label: string }) {
  return (
    <div className="px-3 py-8 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

function formatScore(value: string): string {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function compactScore(value: string): string {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) return value;
  if (numericValue >= 1_000_000_000) return `${trimCompactNumber(numericValue / 1_000_000_000)}B`;
  if (numericValue >= 1_000_000) return `${trimCompactNumber(numericValue / 1_000_000)}M`;
  if (numericValue >= 1_000) return `${trimCompactNumber(numericValue / 1_000)}K`;
  return Math.max(0, Math.floor(numericValue)).toLocaleString("en-US");
}

function trimCompactNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function homePlanetLabel(planet: HighscorePlanet): string {
  return planet.name?.trim() || "Unnamed planet";
}

function homePlanetCoordinatesLabel(planet: HighscorePlanet): string {
  return coordinateLabel(planet.coordinates);
}

function homePlanetHoverLabel(planet: HighscorePlanet): string {
  const coordinates = homePlanetCoordinatesLabel(planet);
  const name = planet.name?.trim();
  return name ? `${name} ${coordinates}` : coordinates;
}

function coordinateLabel(coordinates: Coordinates): string {
  return `[${coordinates.galaxy}:${coordinates.system}:${coordinates.position}]`;
}

function planetDistanceLabel(origin: Coordinates | null | undefined, target: Coordinates): string {
  if (!origin) return "--";
  return `${fleetMissionDistance(origin, target)}ss`;
}

function planetRaidableResourcesLabel(planet: HighscorePlanet): string {
  const resources = planet.tactical?.raidableResources;
  if (!resources) return "Raidable resources unavailable";
  return `Raidable M ${formatScore(resources.metal)} / C ${formatScore(resources.crystal)} / D ${formatScore(resources.deuterium)}`;
}

function planetCombatLabel(planet: HighscorePlanet): string {
  const tactical = planet.tactical;
  if (!tactical) return "Combat signal unavailable";
  return `Combat ${formatScore(tactical.combatPower)} from ${tactical.ships.count} ships and ${tactical.defenses.count} defenses`;
}

function rankingPlanets(entry: HighscoreEntry): HighscorePlanet[] {
  const planets = entry.planets && entry.planets.length > 0
    ? entry.planets
    : entry.homePlanet
      ? [entry.homePlanet]
      : [];
  const seen = new Set<string>();
  return planets.filter((planet) => {
    if (seen.has(planet.planetId)) return false;
    seen.add(planet.planetId);
    return true;
  });
}
