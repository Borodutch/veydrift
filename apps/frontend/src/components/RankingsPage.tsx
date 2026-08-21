import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronLeft, ChevronRight, UserRound } from "lucide-preact";
import { planetImageForType } from "../data/mockUniverse";
import { fleetMissionDistance } from "../fleetMissionRules";
import { activeMissionsByPlanetId, planetMissionSubtext } from "../planetMissionSubtext";
import type { GalaxyAction } from "../galaxyActions";
import type { Coordinates } from "../types";
import { shortAddress, type FleetMissionSummary, type HighscoreCategory, type HighscoreEntry, type HighscorePlanet, type HighscoreResponse } from "../walletFlow";
import { backendDataStoreFor } from "../backendDataStore";
import { useBackendDataSnapshot } from "../useBackendDataSnapshot";
import { OptimizedImage } from "./OptimizedImage";
import { refreshButtonState } from "./PageHeader";
import { PlanetMoonSubsection } from "./PlanetMoonIndicator";
import { PlanetMissionLines } from "./PlanetMissionLines";
import { RankingsRowsSkeleton } from "./LoadingSkeletons";
import { AfkFlair } from "./AfkFlair";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { InlineStateNotice } from "./InlineStateNotice";
import { rankingsProtectionPresentation } from "../rankingsAttackProtection";
import { galaxyActionIcon } from "./GalaxyActionIcon";
import { Skeleton, SkeletonRegion } from "./Skeleton";

type RankingsPageProps = {
  // Universe-wide active fleet missions (the unfiltered `/missions?status=active` feed). Shown as
  // per-planet subtext for ALL players — full transparency, no per-viewer fog of war (decision #9978,
  // VEY-KANEO-445). Defaults to empty so the page renders before/without the feed.
  activeMissions?: readonly FleetMissionSummary[] | undefined;
  apiBaseUrl: string | undefined;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  // Live clock (ms) driving the mission-subtext ETA countdowns; ticks every second from the app shell.
  now?: number | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  moonActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
  onMoonAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onPlanetAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
  planetActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
};

export const rankingsCategories: Array<{ key: HighscoreCategory; label: string }> = [
  { key: "total", label: "Total" },
  { key: "economy", label: "Economy" },
  { key: "research", label: "Research" },
  { key: "military", label: "Military" },
  { key: "fleet", label: "Fleet value" },
  { key: "defense", label: "Defense" },
];

export const rankingsColumnLabels = ["Rank", "Commander", "Score"] as const;
export const rankingsPageSize = 50;

export function RankingCommanderLink({
  displayName,
  href,
  onSelect,
  wallet,
}: {
  displayName?: string | null | undefined;
  href?: string | undefined;
  onSelect?: (() => void) | undefined;
  wallet: string;
}) {
  const commanderLabel = displayName?.trim() || shortAddress(wallet);
  const label = (
    <span className="block truncate font-mono text-slate-100 transition hover:text-cyan-100">
      {commanderLabel}
    </span>
  );

  if (href) {
    return (
      <a className="min-w-0 text-left" href={href} title={`Open player ${commanderLabel}`}>
        {label}
      </a>
    );
  }

  return (
    <button
      className={`min-w-0 text-left ${onSelect ? "cursor-pointer" : "cursor-default"}`}
      disabled={!onSelect}
      onClick={onSelect}
      title={`Open player ${commanderLabel}`}
      type="button"
    >
      {label}
    </button>
  );
}

export function primaryRankingEntries(data: HighscoreResponse | null): HighscoreEntry[] {
  return data?.rankings.total ?? [];
}

export function rankingsPaginationLabel(pagination: NonNullable<HighscoreResponse["pagination"]>): string {
  return `Page ${pagination.page} of ${pagination.totalPages}`;
}

export function shouldShowRankingsInitialLoader({
  hasLoadedData,
  loading,
  viewTransitioning = false,
}: {
  hasLoadedData: boolean;
  loading: boolean;
  viewTransitioning?: boolean;
}): boolean {
  return loading && (!hasLoadedData || viewTransitioning);
}

export function rankingsRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

export function rankingsCurrentPlayerRowSelector(currentWallet: string): string {
  return `[data-ranking-wallet="${currentWallet.toLowerCase()}"]`;
}

export function rankingsErrorPresentation({
  error,
  hasLoadedData,
}: {
  error: string | undefined;
  hasLoadedData: boolean;
}): { blocking: boolean; message: string; title: string } | null {
  if (!error) return null;
  if (hasLoadedData) {
    return {
      blocking: false,
      message: "Showing the latest loaded rankings. Refresh to try again.",
      title: "Rankings refresh delayed",
    };
  }
  return {
    blocking: true,
    message: "Refresh to try again. If the problem continues, check back shortly.",
    title: "Rankings unavailable",
  };
}

export function scrollRankingsCurrentPlayerRow(
  container: { querySelector: (selectors: string) => { focus?: (options?: FocusOptions) => void; scrollIntoView?: (options?: ScrollIntoViewOptions) => void } | null } | null | undefined,
  currentWallet: string | undefined,
): boolean {
  if (!container || !currentWallet) return false;

  const row = container.querySelector(rankingsCurrentPlayerRowSelector(currentWallet));
  if (!row) return false;

  row.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
  row.focus?.({ preventScroll: true });
  return true;
}

export function RankingsPage({ activeMissions, apiBaseUrl, currentAllianceId, currentWallet, now, moonActionsForPlanet, onMoonAction, onPlanetAction, onSelectAlliance, onSelectMoon, onSelectPlayer, onSelectPlanet, originCoordinates, planetActionsForPlanet }: RankingsPageProps) {
  const [active, setActive] = useState<HighscoreCategory>("total");
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [page, setPage] = useState(1);
  const [pendingCurrentPlayerJumpPage, setPendingCurrentPlayerJumpPage] = useState<number | null>(null);
  const [expandedRankingWallets, setExpandedRankingWallets] = useState<Set<string>>(() => new Set());
  const rankingsSectionRef = useRef<HTMLElement | null>(null);
  const backendData = useMemo(() => apiBaseUrl ? backendDataStoreFor(apiBaseUrl) : undefined, [apiBaseUrl]);
  const requestOptions = useMemo(() => ({
    category: active,
    ...(currentWallet ? { currentWallet } : {}),
    page,
    pageSize: rankingsPageSize,
  }), [active, currentWallet, page]);
  const dataSnapshot = useBackendDataSnapshot<HighscoreResponse>(
    backendData,
    backendData?.key("highscores", requestOptions),
  );
  const data = dataSnapshot?.data ?? null;
  const loading = dataSnapshot?.freshness === "refreshing";
  const error = apiBaseUrl ? dataSnapshot?.error : "Game API unavailable.";

  const load = (targetPage = page) => {
    if (!apiBaseUrl) {
      setViewTransitioning(false);
      return;
    }

    const store = backendDataStoreFor(apiBaseUrl);
    store.cancelScope("rankings-page");
    store.highscores({
      category: active,
      ...(currentWallet ? { currentWallet } : {}),
      page: targetPage,
      pageSize: rankingsPageSize,
      requestScope: "rankings-page",
    })
      .catch((nextError) => {
        if (!(nextError instanceof DOMException && nextError.name === "AbortError")) console.error(nextError);
      })
      .finally(() => {
        setViewTransitioning(false);
      });
  };

  const beginViewTransition = () => {
    setViewTransitioning(true);
  };

  useEffect(() => {
    load(page);
    return () => {
      if (apiBaseUrl) backendDataStoreFor(apiBaseUrl).cancelScope("rankings-page");
    };
  }, [active, apiBaseUrl, currentWallet, page]);

  useEffect(() => {
    setExpandedRankingWallets(new Set());
  }, [active, page]);

  const missionsByPlanetId = useMemo(() => activeMissionsByPlanetId(activeMissions ?? []), [activeMissions]);
  const nowMs = now ?? Date.now();
  const errorPresentation = rankingsErrorPresentation({ error, hasLoadedData: Boolean(data) });
  const entries = data?.rankings[active] ?? [];
  const pagination = data?.pagination ?? null;
  const currentPlayerPage = data?.currentPlayer?.rankings[active] ?? null;
  const currentPlayerEntry = currentWallet
    ? entries.find((entry) => entry.wallet.toLowerCase() === currentWallet.toLowerCase()) ?? null
    : null;
  const currentPlayerScore = currentPlayerEntry ? rankingDisplayScore(currentPlayerEntry, active) : null;
  const handleCurrentPlayerJump = () => {
    if (!currentPlayerPage) return;
    beginViewTransition();
    setPendingCurrentPlayerJumpPage(currentPlayerPage.page);
    setPage(currentPlayerPage.page);
  };
  useEffect(() => {
    if (pendingCurrentPlayerJumpPage === null || loading) return;
    if (!currentWallet || !data?.pagination || data.pagination.page !== pendingCurrentPlayerJumpPage) return;
    scrollRankingsCurrentPlayerRow(rankingsSectionRef.current, currentWallet);
    setPendingCurrentPlayerJumpPage(null);
  }, [currentWallet, data?.pagination?.page, loading, pendingCurrentPlayerJumpPage]);

  return (
    <section className="space-y-4" ref={rankingsSectionRef}>
      <RankingsCurrentPlayerIndicator
        currentPlayerPage={currentPlayerPage}
        currentScore={currentPlayerScore}
        currentWallet={currentWallet}
        hasLoadedData={Boolean(data)}
        loading={loading}
        onCurrentPlayer={handleCurrentPlayerJump}
        viewTransitioning={viewTransitioning}
      />

      {errorPresentation ? (
        errorPresentation.blocking && isGameUnavailableMessage(error) ? (
          <GameUnavailableNotice />
        ) : (
          <InlineStateNotice
            blocking={errorPresentation.blocking}
            title={errorPresentation.title}
            tone={errorPresentation.blocking ? "error" : "neutral"}
          >
            {errorPresentation.message}
          </InlineStateNotice>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        {rankingsCategories.map((category) => (
          <button
            aria-pressed={active === category.key}
            className={`h-9 rounded border px-3 text-xs font-semibold transition ${
              active === category.key
                ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
            key={category.key}
            onClick={() => {
              if (category.key === active) return;
              beginViewTransition();
              setActive(category.key);
            }}
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
        expandedWallets={expandedRankingWallets}
        hasLoadedData={Boolean(data)}
        loading={loading}
        missionsByPlanetId={missionsByPlanetId}
        now={nowMs}
        moonActionsForPlanet={moonActionsForPlanet}
        onMoonAction={onMoonAction}
        onPlanetAction={onPlanetAction}
        onSelectAlliance={onSelectAlliance}
        onSelectMoon={onSelectMoon}
        onSelectPlayer={onSelectPlayer}
        onSelectPlanet={onSelectPlanet}
        onTogglePlayerBodies={(wallet) => {
          setExpandedRankingWallets((current) => {
            const next = new Set(current);
            if (next.has(wallet)) {
              next.delete(wallet);
            } else {
              next.add(wallet);
            }
            return next;
          });
        }}
        originCoordinates={originCoordinates}
        planetActionsForPlanet={planetActionsForPlanet}
        viewTransitioning={viewTransitioning}
      />

      {pagination ? (
        <RankingsPagination
          loading={loading}
          currentPlayerPage={currentPlayerPage}
          onNext={() => {
            beginViewTransition();
            setPage((currentPage) => currentPage + 1);
          }}
          onPrevious={() => {
            beginViewTransition();
            setPage((currentPage) => Math.max(1, currentPage - 1));
          }}
          onCurrentPlayer={handleCurrentPlayerJump}
          pagination={pagination}
        />
      ) : null}

    </section>
  );
}

export function RankingsCurrentPlayerIndicator({
  currentPlayerPage,
  currentScore,
  currentWallet,
  hasLoadedData,
  loading,
  onCurrentPlayer,
  viewTransitioning = false,
}: {
  currentPlayerPage?: { rank: number; page: number } | null | undefined;
  currentScore?: string | null | undefined;
  currentWallet?: string | undefined;
  hasLoadedData: boolean;
  loading: boolean;
  onCurrentPlayer?: (() => void) | undefined;
  viewTransitioning?: boolean | undefined;
}) {
  if (!currentWallet) return null;

  if (shouldShowRankingsInitialLoader({ hasLoadedData, loading, viewTransitioning })) {
    return (
      <SkeletonRegion
        className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md border border-white/10 bg-white/[0.04] px-4 py-2.5"
        label="Loading your rank"
      >
        <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      </SkeletonRegion>
    );
  }

  if (!hasLoadedData) return null;

  const canJumpToCurrentPlayer = Boolean(currentPlayerPage && onCurrentPlayer);

  return (
    <button
      aria-label={currentPlayerPage ? `Your rank is ${currentPlayerPage.rank}` : "Your rank is unranked"}
      className="inline-flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-left text-sm text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15 disabled:cursor-default disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-400"
      disabled={loading || !canJumpToCurrentPlayer}
      onClick={onCurrentPlayer}
      title={currentPlayerPage ? "Go to your rank" : "Your rank is unavailable"}
      type="button"
    >
      <UserRound aria-hidden="true" className="shrink-0" size={16} />
      <span className="min-w-0">
        <span className="mr-1 text-slate-300">Your rank:</span>
        {currentPlayerPage ? (
          <>
            <span className="font-mono text-base font-semibold">#{currentPlayerPage.rank}</span>
            {currentScore ? (
              <span className="ml-2 whitespace-nowrap font-mono text-cyan-200/80">{formatScore(currentScore)}</span>
            ) : null}
          </>
        ) : (
          <span className="font-semibold">Unranked</span>
        )}
      </span>
      {canJumpToCurrentPlayer ? (
        <span className="ml-auto hidden whitespace-nowrap text-xs text-cyan-200/70 sm:inline">Jump to your row →</span>
      ) : null}
    </button>
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
          className="inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || !pagination.hasPreviousPage}
          onClick={onPrevious}
          title="Previous page"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Next rankings page"
          className="inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
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
  commanderDetailForEntry,
  currentAllianceId,
  currentWallet,
  entries,
  expandedWallets,
  hasLoadedData = entries.length > 0,
  loading,
  missionsByPlanetId,
  now,
  moonActionsForPlanet,
  onMoonAction,
  onPlanetAction,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlayer,
  onSelectPlanet,
  onTogglePlayerBodies,
  originCoordinates,
  planetActionsForPlanet,
  viewTransitioning = false,
}: {
  active?: HighscoreCategory;
  commanderDetailForEntry?: ((entry: HighscoreEntry) => ComponentChildren) | undefined;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entries: HighscoreEntry[];
  expandedWallets?: ReadonlySet<string> | undefined;
  hasLoadedData?: boolean | undefined;
  loading: boolean;
  missionsByPlanetId?: ReadonlyMap<string, FleetMissionSummary[]> | undefined;
  now?: number | undefined;
  moonActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
  onMoonAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onPlanetAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onTogglePlayerBodies?: ((wallet: string) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
  planetActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
  viewTransitioning?: boolean | undefined;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
      <div className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] border-b border-white/10 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[72px_minmax(0,1fr)_120px] sm:px-3">
        {rankingsColumnLabels.map((label) => (
          <span className={`${label === "Score" ? "hidden text-right sm:block" : ""}`} key={label}>
            {label}
          </span>
        ))}
      </div>
      {shouldShowRankingsInitialLoader({ hasLoadedData, loading, viewTransitioning }) ? (
        <RankingsRowsSkeleton />
      ) : entries.length === 0 ? (
        <RankingsMessage label="No settled commanders indexed yet" />
      ) : (
        entries.map((entry) => (
          <RankingRow
            active={active}
            commanderDetail={commanderDetailForEntry?.(entry)}
            currentAllianceId={currentAllianceId}
            currentWallet={currentWallet}
            entry={entry}
            expanded={expandedWallets ? expandedWallets.has(entry.wallet.toLowerCase()) : true}
            key={`${active}-${entry.wallet}`}
            missionsByPlanetId={missionsByPlanetId}
            now={now}
            moonActionsForPlanet={moonActionsForPlanet}
            onMoonAction={onMoonAction}
            onPlanetAction={onPlanetAction}
            onSelectAlliance={onSelectAlliance}
            onSelectMoon={onSelectMoon}
            onSelectPlayer={onSelectPlayer}
            onSelectPlanet={onSelectPlanet}
            onToggleBodies={onTogglePlayerBodies}
            originCoordinates={originCoordinates}
            planetActionsForPlanet={planetActionsForPlanet}
          />
        ))
      )}
    </div>
  );
}

function RankingRow({
  active,
  commanderDetail,
  currentAllianceId,
  currentWallet,
  entry,
  expanded,
  missionsByPlanetId,
  now,
  moonActionsForPlanet,
  onMoonAction,
  onPlanetAction,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlayer,
  onSelectPlanet,
  onToggleBodies,
  originCoordinates,
  planetActionsForPlanet,
}: {
  active: HighscoreCategory;
  commanderDetail?: ComponentChildren;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entry: HighscoreEntry;
  expanded: boolean;
  missionsByPlanetId?: ReadonlyMap<string, FleetMissionSummary[]> | undefined;
  now?: number | undefined;
  moonActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
  onMoonAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onPlanetAction?: ((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  onToggleBodies?: ((wallet: string) => void) | undefined;
  originCoordinates?: Coordinates | null | undefined;
  planetActionsForPlanet?: ((planet: HighscorePlanet, entry: HighscoreEntry) => GalaxyAction[]) | undefined;
}) {
  const rankedPlanets = rankingPlanets(entry);
  const canOpenPlayer = Boolean(onSelectPlayer);
  const commanderLabel = entry.displayName?.trim() || shortAddress(entry.wallet);
  const normalizedWallet = entry.wallet.toLowerCase();
  const isCurrentPlayer = Boolean(currentWallet && normalizedWallet === currentWallet.toLowerCase());
  const alliance = entry.alliance ?? null;
  const isSameAllianceProtection = entry.attackProtection?.blockedReason === "same_alliance";
  const isAtWar = entry.attackProtection?.atWar === true;
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
  const protectionPresentation = rankingsProtectionPresentation(entry.attackProtection);
  const bodyCount = rankedPlanets.reduce(
    (count, planet) => count + 1 + (planet.hasMoon || planet.moon?.exists ? 1 : 0),
    0,
  );
  const bodiesId = `ranking-bodies-${normalizedWallet}`;
  const isAttackProtected = Boolean(protectionPresentation);
  const isAfk = entry.attackProtection?.defenderInactive === true;
  const rowTone = isCurrentPlayer
    ? "border-cyan-300/25 bg-cyan-300/[0.09] shadow-[inset_3px_0_0_rgba(103,232,249,0.7)]"
    : isAttackProtected
        ? "border-red-300/20 bg-red-300/[0.06] shadow-[inset_3px_0_0_rgba(248,113,113,0.5)]"
        : isAtWar
          ? "border-rose-300/25 bg-rose-300/[0.08] shadow-[inset_3px_0_0_rgba(251,113,133,0.7)]"
        : isSameAlliance
          ? "border-sky-400/30 bg-sky-300/[0.12] shadow-[inset_3px_0_0_rgba(56,189,248,0.85)]"
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
      className={`grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-center border-b px-2 py-3 text-sm last:border-b-0 sm:grid-cols-[72px_minmax(0,1fr)_120px] sm:px-3 ${rowTone}`}
      data-ranking-wallet={normalizedWallet}
      tabIndex={isCurrentPlayer ? -1 : undefined}
    >
      <span className={`font-mono ${isCurrentPlayer ? "text-cyan-100" : isSameAlliance ? "text-sky-100" : "text-slate-400"}`}>#{entry.rank}</span>
      <span className="flex min-w-0 items-center">
        <span className="min-w-0 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            {alliance ? (
              <button
                className={`shrink-0 rounded border px-2 py-1.5 sm:px-1.5 sm:py-0.5 font-mono text-[10px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 ${
                  isSameAlliance
                    ? "border-sky-400/50 bg-sky-400/[0.22] text-sky-100 hover:border-sky-300/70 hover:bg-sky-400/30"
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
            <RankingCommanderLink
              displayName={commanderLabel}
              onSelect={canOpenPlayer ? openPlayer : undefined}
              wallet={entry.wallet}
            />
            {isCurrentPlayer ? (
              <span className="shrink-0 rounded border border-cyan-200/30 bg-cyan-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-cyan-100">
                You
              </span>
            ) : null}
            {isAfk ? <AfkFlair /> : null}
            {protectionPresentation ? (
              <span
                className="shrink-0 rounded border border-red-200/30 bg-red-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-red-100"
                title={protectionPresentation.detailLabel}
              >
                {protectionPresentation.badgeLabel}
              </span>
            ) : null}
            {isSameAlliance && alliance ? (
              <span
                className="shrink-0 rounded border border-sky-300/40 bg-sky-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-normal text-sky-100"
                title={entry.attackProtection?.blockedReasonLabel ?? `Same alliance — ${alliance.name}`}
              >
                {`Ally [${alliance.tag}]`}
              </span>
            ) : null}
            {isAtWar && alliance ? (
              <span
                className="shrink-0 rounded border border-rose-300/40 bg-rose-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-normal text-rose-100"
                title={`At war with ${alliance.name}. Attack eligibility is verified for the selected target: frozen original rosters and declaration direction still apply.`}
              >
                {`War [${alliance.tag}] · verify`}
              </span>
            ) : null}
          </span>
          {commanderDetail ? (
            <span className="mt-1 block truncate text-xs text-slate-500">
              {commanderDetail}
            </span>
          ) : null}
          <span className="mt-0.5 block font-mono text-xs font-semibold text-cyan-100 sm:hidden">
            Score {formatScore(rankingDisplayScore(entry, active))}
          </span>
        </span>
        {bodyCount > 0 && onToggleBodies ? (
          <button
            aria-controls={bodiesId}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} planets and moons for ${commanderLabel}`}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 text-[10px] font-semibold text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100"
            onClick={() => onToggleBodies(normalizedWallet)}
            title={`${expanded ? "Hide" : "Show"} ${bodyCount} ${bodyCount === 1 ? "body" : "bodies"}`}
            type="button"
          >
            <span className="hidden sm:inline">{bodyCount}</span>
            <ChevronDown
              aria-hidden="true"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              size={13}
            />
          </button>
        ) : null}
      </span>
      <span className="hidden text-right font-mono sm:block">
        <span className="block font-semibold text-cyan-100">{formatScore(rankingDisplayScore(entry, active))}</span>
      </span>
      {expanded && rankedPlanets.length > 0 ? (
        <div
          className="col-start-1 col-end-3 mt-2 min-w-0 max-w-full overflow-hidden space-y-1 sm:col-start-2 sm:col-end-4"
          id={bodiesId}
        >
          <div className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-normal text-slate-500 sm:grid-cols-[26px_minmax(0,1fr)_56px_88px_82px_minmax(72px,auto)] sm:gap-2">
            <span className="col-span-2">Planet</span>
            <span className="hidden text-right sm:block">Dist</span>
            <span className="hidden text-right sm:block">Loot</span>
            <span className="hidden text-right sm:block">Combat</span>
            <span className="hidden text-right sm:block">Actions</span>
          </div>
          {rankedPlanets.map((planet) => {
            const isHomePlanet = entry.homePlanetId === planet.planetId;
            const missionLines = planetMissionSubtext(planet.planetId, entry.wallet, missionsByPlanetId?.get(planet.planetId) ?? [], now ?? Date.now());
            const hasMoon = Boolean(planet.hasMoon || planet.moon?.exists);
            const moonActions = hasMoon ? moonActionsForPlanet?.(planet, entry) ?? [] : [];
            const planetActions = planetActionsForPlanet?.(planet, entry) ?? [];
            return (
              <div className="space-y-1" key={`tactical-${planet.planetId}`}>
                <div
                  className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-1 rounded border border-white/5 bg-black/20 px-2 py-1.5 text-[11px] transition hover:border-cyan-200/30 hover:bg-white/[0.06] sm:grid-cols-[26px_minmax(0,1fr)_56px_88px_82px_minmax(72px,auto)] sm:gap-2"
                  data-ranking-planet-row={planet.planetId}
                >
                  <button
                    aria-label={`Open planet at ${homePlanetCoordinatesLabel(planet)}`}
                    className="col-span-2 grid min-w-0 grid-cols-[22px_minmax(0,1fr)] items-center gap-1 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-cyan-300/30 sm:col-span-5 sm:grid-cols-[26px_minmax(0,1fr)_56px_88px_82px] sm:gap-2"
                    disabled={!onSelectPlanet}
                    onClick={() => onSelectPlanet?.(planet.coordinates)}
                    title={`Open ${homePlanetHoverLabel(planet)}`}
                    type="button"
                  >
                    <span className="relative row-span-2 h-5 w-5 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30 sm:row-span-1 sm:h-6 sm:w-6">
                      <OptimizedImage
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        sizes="icon"
                        src={planetImageForType(planet.archetype)}
                      />
                    </span>
                    <span className="min-w-0 truncate text-slate-200">
                      {isHomePlanet ? (
                        <span className="mr-1 font-mono text-[10px] font-semibold text-cyan-100">[HOME]</span>
                      ) : null}
                      {homePlanetLabel(planet)}
                    </span>
                    <span className="col-start-2 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] sm:hidden">
                      <span className="text-slate-400" title={originCoordinates ? `Distance from ${coordinateLabel(originCoordinates)}` : "Select a planet to calculate distance"}>
                        <span className="text-slate-500">Dist </span>
                        {planetDistanceLabel(originCoordinates, planet.coordinates)}
                      </span>
                      <span className="text-emerald-100" title={planetRaidableResourcesLabel(planet)}>
                        <span className="text-slate-500">Loot </span>
                        {compactScore(planet.tactical?.raidableResourceTotal ?? "0")}
                      </span>
                      <span className="text-rose-100" title={planetCombatLabel(planet)}>
                        <span className="text-slate-500">Combat </span>
                        {compactScore(planet.tactical?.combatPower ?? "0")}
                      </span>
                    </span>
                    <span className="hidden text-right font-mono text-slate-400 sm:block" title={originCoordinates ? `Distance from ${coordinateLabel(originCoordinates)}` : "Select a planet to calculate distance"}>
                      {planetDistanceLabel(originCoordinates, planet.coordinates)}
                    </span>
                    <span className="hidden min-w-0 truncate font-mono text-emerald-100 sm:block sm:text-right" title={planetRaidableResourcesLabel(planet)}>
                      {compactScore(planet.tactical?.raidableResourceTotal ?? "0")}
                    </span>
                    <span className="hidden min-w-0 truncate text-right font-mono text-rose-100 sm:block" title={planetCombatLabel(planet)}>
                      {compactScore(planet.tactical?.combatPower ?? "0")}
                    </span>
                  </button>
                  {planetActions.length > 0 ? (
                    <RankingsActionButtons
                      actions={planetActions}
                      blockedAttackLabel={protectionPresentation?.blockedAttackLabel}
                      blockedAttackHint={protectionPresentation?.detailLabel}
                      className="col-start-2 justify-start sm:col-start-6 sm:justify-end"
                      onAction={(action) => onPlanetAction?.(action, planet, entry)}
                    />
                  ) : null}
                </div>
                <PlanetMissionLines className="pl-2 sm:pl-[34px]" planetId={planet.planetId} subtext={missionLines} />
                {hasMoon ? (
                  <div className="min-w-0 pl-4 sm:pl-[34px]" data-ranking-moon-row="full-width">
                    <PlanetMoonSubsection
                      action={moonActions.length > 0 ? (
                        <RankingsActionButtons
                          actions={moonActions}
                          blockedAttackLabel={protectionPresentation?.blockedAttackLabel}
                          blockedAttackHint={protectionPresentation?.detailLabel}
                          className="min-w-0"
                          onAction={(action) => onMoonAction?.(action, planet, entry)}
                        />
                      ) : undefined}
                      className="min-w-0"
                      label="Moon"
                      onClick={onSelectMoon ? () => onSelectMoon(planet.coordinates) : undefined}
                      planetType={planet.archetype}
                      title={`Open moon at ${homePlanetCoordinatesLabel(planet)}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
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

export function RankingsActionButtons({
  actions,
  blockedAttackLabel,
  blockedAttackHint,
  className = "",
  onAction,
}: {
  actions: GalaxyAction[];
  blockedAttackLabel?: string | undefined;
  blockedAttackHint?: string | undefined;
  className?: string | undefined;
  onAction: (action: GalaxyAction) => void;
}) {
  const visibleActions = actions.filter((action) => action.enabled || action.kind === "attack");
  if (visibleActions.length === 0) return null;

  return (
    <span className={`flex flex-wrap justify-end gap-1 ${className}`}>
      {visibleActions.map((action) => {
        const Icon = galaxyActionIcon(action.kind);
        const protectedAttack = Boolean(blockedAttackLabel && action.kind === "attack");
        const label = protectedAttack ? blockedAttackLabel : action.label;
        const hint = protectedAttack
          ? `${label}: ${blockedAttackHint ?? "Attack blocked by protection."}`
          : action.enabled
            ? label
            : `${label}: ${action.reason}`;
        return (
          <button
            aria-label={hint}
            className={`inline-flex h-8 w-8 items-center justify-center rounded border transition ${
              action.enabled
                ? "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
                : "cursor-not-allowed border-red-200/20 bg-red-200/[0.08] text-red-100/70"
            }`}
            disabled={!action.enabled}
            key={action.kind}
            onClick={(event) => {
              event.stopPropagation();
              onAction(action);
            }}
            title={hint}
            type="button"
          >
            <Icon aria-hidden="true" size={14} strokeWidth={1.9} />
          </button>
        );
      })}
    </span>
  );
}

function formatScore(value: string): string {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function rankingDisplayScore(entry: HighscoreEntry, category: HighscoreCategory): string {
  return category === "total" ? entry.totalUserScore ?? entry.score.total : entry.score[category];
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
  return planet.name?.trim() || homePlanetCoordinatesLabel(planet);
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
  return `${formatDistanceValue(fleetMissionDistance(origin, target))} ss`;
}

function formatDistanceValue(value: number): string {
  const distance = Math.max(0, Math.trunc(value));
  if (distance >= 1_000_000) return `${trimCompactNumber(distance / 1_000_000)}M`;
  if (distance >= 100_000) return `${trimCompactNumber(distance / 1_000)}K`;
  return distance.toLocaleString("en-US");
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
