import { defenseCatalog, shipCatalog } from "../playableMvp";
import type { RefereeBattleReport } from "../walletFlow";

function unitLabel(unit: number): string {
  return unit < 16
    ? shipCatalog.find((ship) => ship.id === unit)?.label ?? `Ship ${unit}`
    : defenseCatalog.find((defense) => defense.id === unit - 16)?.label ?? `Defense ${unit - 16}`;
}

/** Units standing at the start and after each round, per side, with the shots each side fired. */
export function RefereeBattleRounds({ report }: { report: RefereeBattleReport }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {([0, 1] as const).map((side) => {
        const start = new Map<number, number>();
        for (const row of report.rows) if (row.side === side) start.set(row.unit, (start.get(row.unit) ?? 0) + row.count);
        const units = [...start.keys()].sort((a, b) => a - b);
        const left = report.rounds.map((round) => new Map(round.survivors.filter((entry) => entry.side === side).map((entry) => [entry.unit, entry.count])));
        return (
          <div className="overflow-x-auto rounded-md surface-inset p-3" key={side}>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-1 pr-3 text-left font-semibold text-slate-300">{side === 0 ? "Attackers" : "Defenders"}</th>
                  <th className="pb-1 pl-2 text-right font-medium">Start</th>
                  {report.rounds.map((round) => <th className="pb-1 pl-2 text-right font-medium" key={round.round}>R{round.round}</th>)}
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr className="border-t border-white/5" key={unit}>
                    <td className="py-1 pr-3 text-slate-300">{unitLabel(unit)}</td>
                    <td className="py-1 pl-2 text-right text-slate-400">{(start.get(unit) ?? 0).toLocaleString()}</td>
                    {left.map((counts, index) => (
                      <td className="py-1 pl-2 text-right text-slate-200" key={index}>{(counts.get(unit) ?? 0).toLocaleString()}</td>
                    ))}
                  </tr>
                ))}
                {report.rounds.length ? (
                  <tr className="border-t border-white/10 text-slate-500">
                    <td className="py-1 pr-3">Shots</td>
                    <td />
                    {report.rounds.map((round) => <td className="py-1 pl-2 text-right" key={round.round}>{Number(round.shots[side]).toLocaleString()}</td>)}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
