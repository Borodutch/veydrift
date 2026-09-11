import { UserRound } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { backendDataStoreFor } from "../backendDataStore";
import type { GalaxyAction } from "../galaxyActions";
import { activeMissionsByPlanetId } from "../planetMissionSubtext";
import type { Coordinates } from "../types";
import { useBackendDataQuery } from "../useBackendDataQuery";
import { type FleetMissionSummary, type HighscoreCategory, type HighscoreEntry, type HighscorePlanet, type HighscoreResponse } from "../walletFlow";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { InlineStateNotice } from "./InlineStateNotice";
import { RankingsPagination, RankingsTable, rankingDisplayScore, shouldShowRankingsInitialLoader } from "./RankingsTable";
import { formatScore } from "../numberFormat";
import { Skeleton, SkeletonRegion } from "./Skeleton";
export { RankingCommanderLink, RankingsActionButtons, RankingsPagination, RankingsTable, rankingsColumnLabels, rankingsPaginationLabel, shouldShowRankingsInitialLoader } from "./RankingsTable";

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

export const rankingsPageSize = 50;

export function primaryRankingEntries(data: HighscoreResponse | null): HighscoreEntry[] {
  return data?.rankings.total ?? [];
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
  const rankingsQuery = useBackendDataQuery<HighscoreResponse>(
    backendData?.queries.highscores(requestOptions),
  );
  const dataSnapshot = rankingsQuery.snapshot;
  const data = dataSnapshot?.data ?? null;
  const loading = dataSnapshot?.freshness === "refreshing";
  const error = apiBaseUrl ? dataSnapshot?.error : "Game API unavailable.";

  const beginViewTransition = () => {
    setViewTransitioning(true);
  };

  useEffect(() => {
    setExpandedRankingWallets(new Set());
  }, [active, page]);

  useEffect(() => {
    if (viewTransitioning && !loading && dataSnapshot?.lastSuccessfulUpdate !== undefined) {
      setViewTransitioning(false);
    }
  }, [dataSnapshot?.lastSuccessfulUpdate, loading, viewTransitioning]);

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
