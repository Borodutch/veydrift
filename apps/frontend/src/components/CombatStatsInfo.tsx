import { Info } from "lucide-preact";
import type { CombatStatBlock } from "../playableMvp";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function CombatStatsInfoButton({
  label,
  stats,
}: {
  label: string;
  stats: CombatStatBlock;
}) {
  return (
    <details className="group relative inline-flex">
      <summary
        aria-label={`Open ${label} combat stats`}
        className="grid h-6 w-6 cursor-pointer list-none place-items-center rounded-full border border-sky-300/35 bg-sky-300/10 text-sky-200 transition hover:border-sky-200/60 hover:bg-sky-300/20 focus:outline-none focus:ring-2 focus:ring-sky-300/40 [&::-webkit-details-marker]:hidden"
        title="Combat stats"
      >
        <Info aria-hidden="true" size={13} strokeWidth={2.4} />
      </summary>
      <div className="absolute right-0 top-8 z-30 w-72 max-w-[calc(100vw-2rem)] rounded border border-white/15 bg-[#111827] p-3 text-left shadow-2xl shadow-black/50">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
          Battle stats
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {stats.rows.map((row) => (
            <div className="rounded border border-white/10 bg-black/25 px-2 py-1.5" key={row.label}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">{row.label}</dt>
              <dd className="mt-0.5 truncate font-semibold text-slate-100">{formatCombatStatValue(row.value)}</dd>
              {row.hint && <p className="mt-1 text-[11px] leading-4 text-slate-400">{row.hint}</p>}
            </div>
          ))}
        </dl>
        {stats.notes.length > 0 && (
          <ul className="mt-2 grid gap-1 text-[11px] leading-4 text-slate-400">
            {stats.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function formatCombatStatValue(value: number | string): string {
  return typeof value === "number" ? formatter.format(value) : value;
}
