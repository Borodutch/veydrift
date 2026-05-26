import { useEffect, useState } from "preact/hooks";
import { RotateCw } from "lucide-preact";
import { fetchHighscores, shortAddress, type HighscoreCategory, type HighscoreEntry, type HighscoreResponse } from "../walletFlow";

type RankingsPageProps = {
  apiBaseUrl: string | undefined;
};

const categories: Array<{ key: HighscoreCategory; label: string }> = [
  { key: "total", label: "Total" },
  { key: "economy", label: "Economy" },
  { key: "research", label: "Research" },
  { key: "fleet", label: "Fleet" },
  { key: "defense", label: "Defense" },
];

export function RankingsPage({ apiBaseUrl }: RankingsPageProps) {
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
        setData(null);
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

      {error ? (
        <div className="rounded border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-white/10 bg-[#0d1422]/90">
        <div className="grid grid-cols-[56px_1fr_88px_96px] border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[72px_1fr_100px_120px_120px]">
          <span>Rank</span>
          <span>Commander</span>
          <span className="text-right">Planets</span>
          <span className="text-right">Score</span>
          <span className="hidden text-right sm:block">Total</span>
        </div>
        {loading ? (
          <RankingsMessage label="Loading rankings" />
        ) : entries.length === 0 ? (
          <RankingsMessage label="No settled commanders indexed yet" />
        ) : (
          entries.map((entry) => (
            <RankingRow active={active} entry={entry} key={`${active}-${entry.wallet}`} />
          ))
        )}
      </div>

      {data ? (
        <p className="text-xs leading-5 text-slate-500">
          {data.formula.summary}
        </p>
      ) : null}
    </section>
  );
}

function RankingRow({ active, entry }: { active: HighscoreCategory; entry: HighscoreEntry }) {
  return (
    <div className="grid grid-cols-[56px_1fr_88px_96px] items-center border-b border-white/5 px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[72px_1fr_100px_120px_120px]">
      <span className="font-mono text-slate-400">#{entry.rank}</span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-slate-100">{shortAddress(entry.wallet)}</span>
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
