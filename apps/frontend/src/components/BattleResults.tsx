import { activeCombatModel, likeliestOutcome, REFEREE_COMBAT_MODEL_VERSION, type BattleStats, type CombatResources, type ContractBattleInput, type ContractBattleResult } from "../battlePreview";
import { battleInputToSetup, calculatorHref } from "../battleCalculatorState";
import { defenseCatalog, shipCatalog } from "../playableMvp";
import { SimulatedBattleReportControl } from "./SimulatedBattleReport";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const RECYCLER_CARGO = 20_000;

export function formatResources(resources: CombatResources | { metal: number; crystal: number }): string {
  const parts = [
    ["M", resources.metal],
    ["C", resources.crystal],
    ["D", "deuterium" in resources ? resources.deuterium : 0],
  ] as const;
  const shown = parts.filter(([, value]) => Math.round(value) > 0);
  return shown.length ? shown.map(([label, value]) => `${compact.format(Math.round(value))} ${label}`).join(" · ") : "None";
}

const average = (total: number, runs: number) => runs ? total / runs : 0;
const scale = (resources: CombatResources, runs: number): CombatResources => ({
  metal: average(resources.metal, runs), crystal: average(resources.crystal, runs), deuterium: average(resources.deuterium, runs),
});

/** Whole percents that add up to 100 (largest remainder). */
export function outcomePercents(outcomes: BattleStats["outcomes"], runs: number): BattleStats["outcomes"] {
  const keys = ["win", "draw", "defeat"] as const;
  const exact = keys.map((key) => average(outcomes[key], runs) * 100);
  const result = exact.map(Math.floor);
  let left = runs ? 100 - result.reduce((sum, value) => sum + value, 0) : 0;
  for (const index of [0, 1, 2].sort((a, b) => (exact[b]! % 1) - (exact[a]! % 1))) {
    if (left <= 0) break;
    if (exact[index]! % 1 > 0) { result[index]! += 1; left -= 1; }
  }
  return { win: result[0]!, draw: result[1]!, defeat: result[2]! };
}

/** Simulated odds, losses, debris and moon chance; `detailed` adds per-unit survivors. */
export function BattleResults({ input, stats, running = false, detailed = false, calculatorLink = false, report = null, modelVersion }: {
  input: ContractBattleInput;
  stats: BattleStats;
  running?: boolean | undefined;
  detailed?: boolean | undefined;
  calculatorLink?: boolean | undefined;
  /** An already simulated battle for the report control; otherwise it replays the likeliest sample. */
  report?: ContractBattleResult | null | undefined;
  /** The model `stats` were simulated with, so the replayed sample matches the odds (default: active model). */
  modelVersion?: number | undefined;
}) {
  const { runs } = stats;
  const debris = { metal: average(stats.debris.metal, runs), crystal: average(stats.debris.crystal, runs) };
  const recyclers = Math.ceil((debris.metal + debris.crystal) / RECYCLER_CARGO);
  const sample = stats.samples[likeliestOutcome(stats)];
  const percents = outcomePercents(stats.outcomes, runs);
  const odds = [
    { key: "win", label: "Attacker", value: percents.win, bar: "bg-emerald-400", text: "text-emerald-200" },
    { key: "draw", label: "Draw", value: percents.draw, bar: "bg-amber-300", text: "text-amber-200" },
    { key: "defeat", label: "Defender", value: percents.defeat, bar: "bg-red-400", text: "text-red-200" },
  ];
  return (
    <div aria-busy={running ? "true" : undefined} className={`grid gap-3 transition-opacity ${running ? "opacity-70" : ""}`} data-battle-results>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm font-semibold">
            {odds.map((odd) => (
              <span className={odd.value ? odd.text : "text-slate-600"} key={odd.key}>{odd.label} {odd.value}%</span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SimulatedBattleReportControl input={input} modelVersion={modelVersion} report={report} seed={sample} />
            {calculatorLink ? (
              <a
                className="inline-flex h-6 items-center gap-1 rounded border border-white/15 px-2 text-[11px] font-medium text-slate-300 transition hover:border-signal/50 hover:text-white"
                href={calculatorHref(battleInputToSetup(input))}
                rel="noopener"
                target="_blank"
              >
                Calculator
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </div>
        </div>
        <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
          {odds.map((odd) => <span className={odd.bar} key={odd.key} style={{ width: `${odd.value}%` }} />)}
        </div>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <Fact label="Attacker losses" value={formatResources(scale(stats.attackerLosses, runs))} />
        <Fact label="Defender losses (after repair)" value={formatResources(scale(stats.defenderLosses, runs))} />
        <Fact label="Debris (ships only)" value={`${formatResources(debris)}${recyclers ? ` · ${recyclers.toLocaleString()} recycler${recyclers === 1 ? "" : "s"}` : ""}`} />
        <Fact label="Moon chance" value={`${Math.round(average(stats.moonChance, runs))}%`} />
        <Fact label="Rounds" value={average(stats.rounds, runs).toFixed(1)} />
        <Fact label="Simulations" {...simulationsFact(runs, stats.exact, modelVersion ?? activeCombatModel())} />
      </dl>
      {stats.timeLimited && !running ? (
        <p className="text-xs text-amber-200">
          This battle is too large to simulate fully: the time limit allowed only {runs.toLocaleString()} run{runs === 1 ? "" : "s"}, so these averages are less certain.
        </p>
      ) : null}
      {detailed ? <Survivors input={input} stats={stats} /> : null}
    </div>
  );
}

/** Run count, qualified only under the model where quick and exact sampling actually differ. */
export function simulationsFact(runs: number, exact: boolean, model: number): { value: string; title?: string } {
  const count = runs.toLocaleString();
  if (model !== REFEREE_COMBAT_MODEL_VERSION) return { value: count };
  return exact
    ? { value: `${count} · exact`, title: "Each run is an exact replay of the battle math." }
    : { value: `${count} · quick estimate`, title: "A quicker sample of the same battle rules. The calculator replays each run exactly." };
}

function Fact({ label, value, title }: { label: string; value: string; title?: string | undefined }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3" title={title}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

/** Per-battle averages. Ships are never repaired (`repaired` null), so they lose start - left. */
export type SurvivorRow = { label: string; start: number; destroyed: number; repaired: number | null; left: number };

export function survivorGroups(input: ContractBattleInput, stats: BattleStats): Array<{ label: string; rows: SurvivorRow[] }> {
  const ships = (start: readonly number[], left: readonly number[] | undefined): SurvivorRow[] => shipCatalog
    .filter((ship) => (start[ship.id] ?? 0) > 0)
    .map((ship) => {
      const count = start[ship.id] ?? 0, remaining = average(left?.[ship.id] ?? 0, stats.runs);
      return { label: ship.label, start: count, destroyed: count - remaining, repaired: null, left: remaining };
    });
  const defenses = defenseCatalog
    .filter((defense) => (input.defender.defenses[defense.id] ?? 0) > 0)
    .map((defense) => ({
      label: defense.label,
      start: input.defender.defenses[defense.id] ?? 0,
      destroyed: average(stats.defenderDefensesDestroyed[defense.id] ?? 0, stats.runs),
      repaired: average(stats.defenderDefensesRepaired[defense.id] ?? 0, stats.runs),
      left: average(stats.defenderDefenses[defense.id] ?? 0, stats.runs),
    }));
  return [
    ...input.attackers.map((fleet, index) => ({ label: fleet.label, rows: ships(fleet.ships, stats.attackers[index]) })),
    { label: input.defender.label, rows: [...ships(input.defender.ships, stats.defenderShips), ...defenses] },
    ...input.defender.counterplay.map((fleet, index) => ({ label: fleet.label, rows: ships(fleet.ships, stats.counterplay[index]) })),
  ].filter((group) => group.rows.length);
}

/** One row as shown: every value at the same precision, and Left recomputed from the rounded
 * Destroyed and Repaired so the row always adds up (start - destroyed + repaired). */
export function displayedSurvivorRow(row: SurvivorRow): { destroyed: number; repaired: number | null; left: number; digits: number } {
  const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
  const values = [row.destroyed, row.repaired ?? 0, row.left];
  const digits = values.some((value) => value < 100 && !Number.isInteger(round(value, 6))) ? 1 : 0;
  const destroyed = round(row.destroyed, digits);
  const repaired = row.repaired === null ? null : round(row.repaired, digits);
  return { destroyed, repaired, left: round(row.start - destroyed + (repaired ?? 0), digits), digits };
}

function Survivors({ input, stats }: { input: ContractBattleInput; stats: BattleStats }) {
  const groups = survivorGroups(input, stats);
  const defenses = input.defender.defenses.some((count) => count > 0);
  return (
    <div className="grid gap-2">
      <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-2">
        {groups.map((group) => {
          // Only the target's table has defenses, and so a Repaired column.
          const repairs = group.rows.some((row) => row.repaired !== null);
          return (
            <table className="w-full text-xs tabular-nums" key={group.label}>
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 text-left font-medium">{group.label}</th>
                  <th className="py-1 pl-2 text-right font-medium">Start</th>
                  <th className="py-1 pl-2 text-right font-medium">Destroyed</th>
                  {repairs ? <th className="py-1 pl-2 text-right font-medium">Repaired</th> : null}
                  <th className="py-1 pl-2 text-right font-medium">{repairs ? "Left after repair" : "Left"}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const shown = displayedSurvivorRow(row);
                  const format = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: shown.digits, maximumFractionDigits: shown.digits });
                  return (
                    <tr className="border-t border-white/5" key={row.label}>
                      <td className="py-1 text-slate-300">{row.label}</td>
                      <td className="py-1 pl-2 text-right text-slate-400">{row.start.toLocaleString()}</td>
                      <td className={`py-1 pl-2 text-right ${shown.destroyed > 0 ? "text-red-200" : "text-slate-500"}`}>{format(shown.destroyed)}</td>
                      {repairs ? (
                        <td className={`py-1 pl-2 text-right ${shown.repaired ? "text-emerald-200" : "text-slate-500"}`}>{shown.repaired === null ? "—" : format(shown.repaired)}</td>
                      ) : null}
                      <td className={`py-1 pl-2 text-right ${shown.left < row.start ? "text-slate-100" : "text-slate-400"}`}>{format(shown.left)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        Averages per battle.{defenses ? " After the battle 70% of each destroyed defense type is rebuilt (a single destroyed unit has a 70% chance), so Left and defender losses count defenses after repair." : ""} Ships are never repaired, and debris comes from destroyed ships only.
      </p>
    </div>
  );
}
