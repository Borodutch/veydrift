import { useEffect, useState } from "preact/hooks";
import { RotateCw } from "lucide-preact";
import { planetImageForType } from "../data/mockUniverse";
import type { Coordinates } from "../types";
import { fetchHighscores, shortAddress, type HighscoreCategory, type HighscoreEntry, type HighscorePlanet, type HighscoreResponse } from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

type RankingsPageProps = {
  apiBaseUrl: string | undefined;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
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

export const rankingsColumnLabels = ["Rank", "Commander", "Planets", "Score", "Total"] as const;

export function primaryRankingEntries(data: HighscoreResponse | null): HighscoreEntry[] {
  return data?.rankings.total ?? [];
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

export function RankingsPage({ apiBaseUrl, currentAllianceId, currentWallet, onSelectAlliance, onSelectPlanet }: RankingsPageProps) {
  const [active, setActive] = useState<HighscoreCategory>("total");
  const [data, setData] = useState<HighscoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    if (!apiBaseUrl) {
      setData(null);
      setError("Game API unavailable.");
      return;
    }

    setLoading(true);
    setError(undefined);
    fetchHighscores(apiBaseUrl)
      .then(setData)
      .catch((nextError) => {
        console.error(nextError);
        setError(nextError instanceof Error ? nextError.message : "Rankings could not be loaded.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiBaseUrl]);

  const entries = data?.rankings[active] ?? [];

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
          onClick={load}
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
        onSelectPlanet={onSelectPlanet}
      />

      {data ? (
        <p className="text-xs leading-5 text-slate-500">
          {data.formula.summary}
        </p>
      ) : null}
    </section>
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
  onSelectPlanet,
}: {
  active?: HighscoreCategory;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entries: HighscoreEntry[];
  hasLoadedData?: boolean | undefined;
  loading: boolean;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
      <div className="grid grid-cols-[52px_minmax(0,1fr)_72px_88px] border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[72px_minmax(0,1fr)_100px_120px_120px]">
        {rankingsColumnLabels.map((label) => (
          <span className={`${label === "Total" ? "hidden sm:block " : ""}${label === "Rank" || label === "Commander" ? "" : "text-right"}`} key={label}>
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
            onSelectPlanet={onSelectPlanet}
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
  onSelectPlanet,
}: {
  active: HighscoreCategory;
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | undefined;
  entry: HighscoreEntry;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
}) {
  const homePlanet = entry.homePlanet ?? null;
  const canOpenHomePlanet = Boolean(homePlanet && onSelectPlanet);
  const commanderLabel = entry.displayName?.trim() || shortAddress(entry.wallet);
  const normalizedWallet = entry.wallet.toLowerCase();
  const isCurrentPlayer = Boolean(currentWallet && normalizedWallet === currentWallet.toLowerCase());
  const alliance = entry.alliance ?? null;
  const isSameAlliance = Boolean(
    !isCurrentPlayer
      && alliance
      && currentAllianceId
      && currentAllianceId !== "0"
      && alliance.allianceId === currentAllianceId
  );
  const rowTone = isCurrentPlayer
    ? "border-cyan-300/25 bg-cyan-300/[0.09] shadow-[inset_3px_0_0_rgba(103,232,249,0.7)]"
    : isSameAlliance
      ? "border-emerald-300/20 bg-emerald-300/[0.055] shadow-[inset_3px_0_0_rgba(110,231,183,0.55)]"
      : "border-white/5";

  const openHomePlanet = () => {
    if (!homePlanet || !onSelectPlanet) return;
    onSelectPlanet(homePlanet.coordinates);
  };

  const openAlliance = () => {
    if (!alliance || !onSelectAlliance) return;
    onSelectAlliance(alliance.allianceId);
  };

  return (
    <div
      aria-current={isCurrentPlayer ? "true" : undefined}
      className={`grid grid-cols-[52px_minmax(0,1fr)_72px_88px] items-center border-b px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[72px_minmax(0,1fr)_100px_120px_120px] ${rowTone}`}
      data-ranking-wallet={normalizedWallet}
    >
      <span className={`font-mono ${isCurrentPlayer ? "text-cyan-100" : isSameAlliance ? "text-emerald-100" : "text-slate-400"}`}>#{entry.rank}</span>
      <span className="flex min-w-0 items-center gap-2">
        {homePlanet ? (
          <button
            aria-label={`Open home planet at ${homePlanetLabel(homePlanet)}`}
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30 transition hover:border-cyan-200/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
            onClick={openHomePlanet}
            title={`Open ${homePlanetLabel(homePlanet)}`}
            type="button"
          >
            <OptimizedImage
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              sizes="icon"
              src={planetImageForType(homePlanet.archetype)}
            />
          </button>
        ) : null}
        <span className="min-w-0 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            {alliance ? (
              <button
                className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!onSelectAlliance}
                onClick={openAlliance}
                title={`Open alliance ${alliance.tag}`}
                type="button"
              >
                {`[${alliance.tag}]`}
              </button>
            ) : null}
            <button
              className={`min-w-0 text-left ${canOpenHomePlanet ? "cursor-pointer" : "cursor-default"}`}
              disabled={!canOpenHomePlanet}
              onClick={openHomePlanet}
              type="button"
            >
              <span className={`block truncate font-mono ${canOpenHomePlanet ? "text-slate-100 hover:text-cyan-100" : "text-slate-100"}`}>
                {commanderLabel}
              </span>
            </button>
            {isCurrentPlayer ? (
              <span className="shrink-0 rounded border border-cyan-200/30 bg-cyan-200/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-cyan-100">
                You
              </span>
            ) : null}
          </span>
          {homePlanet ? (
            <span className="block truncate text-xs text-slate-500">{homePlanetLabel(homePlanet)}</span>
          ) : null}
        </span>
      </span>
      <span className="text-right font-mono text-slate-300">{entry.planetCount}</span>
      <span className="text-right font-mono font-semibold text-cyan-100">{formatScore(entry.score[active])}</span>
      <span className="hidden text-right font-mono text-slate-400 sm:block">{formatScore(entry.score.total)}</span>
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

function homePlanetLabel(planet: HighscorePlanet): string {
  const coordinates = planet.coordinates;
  return planet.name?.trim() || `[${coordinates.galaxy}:${coordinates.system}:${coordinates.position}]`;
}
