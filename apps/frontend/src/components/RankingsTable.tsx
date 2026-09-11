import { ChevronDown, ChevronLeft, ChevronRight, UserRound } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { formatScore } from "../numberFormat";
import { planetArtTypeForCoordinates, planetImageForType } from "../data/mockUniverse";
import { fleetMissionDistance } from "../fleetMissionRules";
import type { GalaxyAction } from "../galaxyActions";
import { planetMissionSubtext } from "../planetMissionSubtext";
import { rankingsProtectionPresentation } from "../rankingsAttackProtection";
import type { Coordinates } from "../types";
import { shortAddress, type FleetMissionSummary, type HighscoreCategory, type HighscoreEntry, type HighscorePlanet, type HighscoreResponse } from "../walletFlow";
import { AfkFlair } from "./AfkFlair";
import { galaxyActionIcon } from "./GalaxyActionIcon";
import { RankingsRowsSkeleton } from "./LoadingSkeletons";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetMissionLines } from "./PlanetMissionLines";
import { PlanetMoonSubsection } from "./PlanetMoonIndicator";

export const rankingsColumnLabels = ["Rank", "Commander", "Score"] as const;

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

export function RankingRow({
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
                {`War [${alliance.tag}]`}
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
            const planetType = planetArtTypeForCoordinates(planet.coordinates);
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
                        src={planetImageForType(planetType)}
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
                      planetType={planetType}
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

export function RankingsMessage({ label }: { label: string }) {
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

export function rankingDisplayScore(entry: HighscoreEntry, category: HighscoreCategory): string {
  return category === "total" ? entry.totalUserScore ?? entry.score.total : entry.score[category];
}

export function compactScore(value: string): string {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) return value;
  if (numericValue >= 1_000_000_000) return `${trimCompactNumber(numericValue / 1_000_000_000)}B`;
  if (numericValue >= 1_000_000) return `${trimCompactNumber(numericValue / 1_000_000)}M`;
  if (numericValue >= 1_000) return `${trimCompactNumber(numericValue / 1_000)}K`;
  return Math.max(0, Math.floor(numericValue)).toLocaleString("en-US");
}

export function trimCompactNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

export function homePlanetLabel(planet: HighscorePlanet): string {
  return planet.name?.trim() || homePlanetCoordinatesLabel(planet);
}

export function homePlanetCoordinatesLabel(planet: HighscorePlanet): string {
  return coordinateLabel(planet.coordinates);
}

export function homePlanetHoverLabel(planet: HighscorePlanet): string {
  const coordinates = homePlanetCoordinatesLabel(planet);
  const name = planet.name?.trim();
  return name ? `${name} ${coordinates}` : coordinates;
}

export function coordinateLabel(coordinates: Coordinates): string {
  return `[${coordinates.galaxy}:${coordinates.system}:${coordinates.position}]`;
}

export function planetDistanceLabel(origin: Coordinates | null | undefined, target: Coordinates): string {
  if (!origin) return "--";
  return `${formatDistanceValue(fleetMissionDistance(origin, target))} ss`;
}

export function formatDistanceValue(value: number): string {
  const distance = Math.max(0, Math.trunc(value));
  if (distance >= 1_000_000) return `${trimCompactNumber(distance / 1_000_000)}M`;
  if (distance >= 100_000) return `${trimCompactNumber(distance / 1_000)}K`;
  return distance.toLocaleString("en-US");
}

export function planetRaidableResourcesLabel(planet: HighscorePlanet): string {
  const resources = planet.tactical?.raidableResources;
  if (!resources) return "Raidable resources unavailable";
  return `Raidable M ${formatScore(resources.metal)} / C ${formatScore(resources.crystal)} / D ${formatScore(resources.deuterium)}`;
}

export function planetCombatLabel(planet: HighscorePlanet): string {
  const tactical = planet.tactical;
  if (!tactical) return "Combat signal unavailable";
  return `Combat ${formatScore(tactical.combatPower)} from ${tactical.ships.count} ships and ${tactical.defenses.count} defenses`;
}

export function rankingPlanets(entry: HighscoreEntry): HighscorePlanet[] {
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
