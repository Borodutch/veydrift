import { afterEach, expect, test } from "bun:test";
import {
  CONTRACT_COMBAT_MODEL_VERSION,
  REFEREE_COMBAT_MODEL_VERSION,
  deterministicBattleSampleWord,
  fastRandom,
  runBattleSimulation,
  runContractBattle,
  setActiveCombatModel,
  simulateBattleStats,
  type ContractBattleInput,
  type ContractBattleResult,
} from "./battlePreview";
import { advance, initialize, result, type Group } from "../../../packages/battle-oracle/oracle";
import { catalog as refereeCatalog, rapidfire as refereeRapidfire } from "../../../packages/battle-oracle/catalog";
import { EXACT_SIMULATION, FAST_SIMULATION } from "./battleSimulation";
import {
  battleInputToSetup,
  decodeSetup,
  emptyFleet,
  encodeSetup,
  fleetHasUnits,
  parseCoords,
  setupToBattleInput,
  simulateHref,
  type CalculatorFleet,
  type CalculatorSetup,
} from "./battleCalculatorState";
import { CALCULATOR_SIMULATION, fleetsToLoadOnOpen } from "./components/BattleCalculatorPage";
import { displayedSurvivorRow, outcomePercents, simulationsFact, survivorGroups } from "./components/BattleResults";
import combatCatalog from "../../../packages/contracts/combat-preview-catalog.json";

afterEach(() => setActiveCombatModel(CONTRACT_COMBAT_MODEL_VERSION));

const ships = (entries: Record<number, number>) => Array.from({ length: 16 }, (_, id) => entries[id] ?? 0);
// Fleet ids are per-page identities and never travel in links.
const withoutId = ({ id: _id, ...fleet }: CalculatorFleet) => fleet;
const decodeHref = (href: string) => decodeSetup(new URL(href, "https://veydrift.test").searchParams.get("b")!)!;

test("fast draws are seeded, stay in range and are roughly uniform", () => {
  const word = deterministicBattleSampleWord(3);
  const a = fastRandom(word), b = fastRandom(word), c = fastRandom(deterministicBattleSampleWord(4));
  const first = Array.from({ length: 8 }, () => a(1_000_000));
  expect(Array.from({ length: 8 }, () => b(1_000_000))).toEqual(first);
  expect(Array.from({ length: 8 }, () => c(1_000_000))).not.toEqual(first);
  for (const bound of [1, 7, 2 ** 23]) {
    const draw = fastRandom(word);
    let sum = 0, inRange = true;
    for (let i = 0; i < 20_000; i++) {
      const value = draw(bound);
      inRange &&= Number.isInteger(value) && value >= 0 && value < bound;
      sum += value;
    }
    expect(inRange).toBe(true);
    expect(Math.abs(sum / 20_000 - (bound - 1) / 2)).toBeLessThanOrEqual(Math.max(0.01, bound * 0.01));
  }
});

test("share links round-trip forces and drop units no player can field", () => {
  const setup: CalculatorSetup = {
    attackers: [
      { ...emptyFleet(), coords: "1:23:4", tech: { weapons: 12, shielding: 11, armor: 10 }, ships: ships({ 6: 500, 7: 20, 14: 9 }) },
      { ...emptyFleet(), coords: "2:5:9", moon: true, ships: ships({ 13: 3 }) },
    ],
    defenders: [
      { ...emptyFleet(), coords: "1:30:8", tech: { weapons: 9, shielding: 9, armor: 9 }, ships: ships({ 1: 40, 9: 12, 15: 4 }), defenses: [100, 20, 0, 1, 0, 0, 3, 1] },
      { ...emptyFleet(), ships: ships({ 5: 30 }) },
    ],
  };
  const decoded = decodeSetup(encodeSetup(setup))!;
  expect(withoutId(decoded.attackers[0]!)).toEqual(withoutId({ ...setup.attackers[0]!, ships: ships({ 6: 500, 7: 20 }) }));
  expect(withoutId(decoded.attackers[1]!)).toEqual(withoutId(setup.attackers[1]!));
  expect(decoded.defenders.map(withoutId)).toEqual(setup.defenders.map(withoutId));
  expect(new Set([...decoded.attackers, ...decoded.defenders].map((fleet) => fleet.id)).size).toBe(4);
  expect(decodeSetup("not base64 json")).toBeNull();
  const hostile = btoa(JSON.stringify({ a: [{ s: { 1: -5, 6: 1e12, 7: "x" }, t: [500, -1] }], d: [] })).replace(/=+$/, "");
  const clamped = decodeSetup(hostile)!;
  expect(clamped.attackers[0]!.ships.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 999_999_999, 0]);
  expect(clamped.attackers[0]!.tech).toEqual({ weapons: 99, shielding: 0, armor: 0 });
  expect(clamped.defenders).toHaveLength(1);
});

test("the target owns the defenses, supports defend with ships only, and attackers never field static ships", () => {
  const setup: CalculatorSetup = {
    attackers: [{ ...emptyFleet(), ships: ships({ 1: 10, 9: 5, 15: 2 }), defenses: [7, 0, 0, 0, 0, 0, 0, 0] }],
    defenders: [
      { ...emptyFleet(), coords: "4:4:4", ships: ships({ 9: 3, 15: 1 }), defenses: [50, 0, 0, 0, 0, 0, 0, 0] },
      { ...emptyFleet(), ships: ships({ 7: 2, 9: 4 }), defenses: [9, 9, 9, 9, 9, 9, 9, 9] },
    ],
  };
  const input = setupToBattleInput(setup);
  expect(input.attackers[0]!.ships).toEqual(ships({ 1: 10 }));
  expect(input.defender.ships).toEqual(ships({ 9: 3, 15: 1 }));
  expect(input.defender.defenses).toEqual([50, 0, 0, 0, 0, 0, 0, 0]);
  expect(input.defender.label).toBe("Defender [4:4:4]");
  expect(input.defender.counterplay).toHaveLength(1);
  expect(input.defender.counterplay[0]!.ships).toEqual(ships({ 7: 2 }));
  const back = battleInputToSetup(input);
  expect(back.attackers[0]!.ships).toEqual([...input.attackers[0]!.ships]);
  expect(back.defenders[0]!.defenses).toEqual([...input.defender.defenses]);
  expect(back.defenders[1]!.ships).toEqual([...input.defender.counterplay[0]!.ships]);
});

test("battle stats total real runs: defender losses are destroyed ships plus defenses not rebuilt", () => {
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const input: ContractBattleInput = {
    attackers: [{ id: "a", label: "A", owner: "", laneGroup: 0, ships: ships({ 6: 40 }), technology: { weapons: 3, shielding: 3, armor: 3 } }],
    defender: {
      id: "d", label: "D", owner: "", ships: ships({ 1: 15 }), defenses: [30, 6, 0, 0, 0, 0, 0, 0],
      technology: { weapons: 2, shielding: 2, armor: 2 }, counterplay: [],
    },
  };
  const runs = 24;
  const stats = simulateBattleStats(input, runs);
  let defenderMetal = 0, rounds = 0;
  const outcomes = { win: 0, draw: 0, defeat: 0 };
  for (let index = 0; index < runs; index++) {
    const run = runContractBattle(input, deterministicBattleSampleWord(index), index + 1, false, true);
    outcomes[run.outcome] += 1;
    rounds += run.roundCount;
    defenderMetal += run.defenderLosses.metal + run.defender.startingDefenses.reduce((total, row) => {
      const lost = row.count - (run.defender.survivingDefenses.find((left) => left.id === row.id)?.count ?? 0);
      return total + lost * combatCatalog.defenses.find((defense) => defense.id === row.id)!.metal;
    }, 0);
  }
  expect(stats.runs).toBe(runs);
  expect(stats.outcomes).toEqual(outcomes);
  expect(stats.rounds).toBe(rounds);
  expect(stats.defenderLosses.metal).toBe(defenderMetal);
  for (const [outcome, seed] of Object.entries(stats.samples)) {
    // Each sample replays (fast) to the outcome it represents.
    expect(runContractBattle(input, seed.randomWord, seed.sampleId, true, seed.fast === true).outcome).toBe(outcome as "win" | "draw" | "defeat");
  }
});

test("outcome percentages always add up to 100", () => {
  expect(outcomePercents({ win: 1, draw: 1, defeat: 1 }, 3)).toEqual({ win: 34, draw: 33, defeat: 33 });
  expect(outcomePercents({ win: 81, draw: 47, defeat: 0 }, 128)).toEqual({ win: 63, draw: 37, defeat: 0 });
  expect(outcomePercents({ win: 0, draw: 0, defeat: 0 }, 0)).toEqual({ win: 0, draw: 0, defeat: 0 });
});

test("coordinates parse in common notations", () => {
  for (const text of ["1:23:4", " 1 : 23 : 4 ", "1.23.4", "1 23 4"]) expect(parseCoords(text)).toEqual({ galaxy: 1, system: 23, position: 4 });
  for (const text of ["0:1:1", "1:2", "a:b:c", "1:2:3:4", ""]) expect(parseCoords(text)).toBeNull();
});

test("Simulate links carry the moon flag for the target and the origin", () => {
  const moonTarget = decodeHref(simulateHref({ galaxy: 1, system: 30, position: 8, moon: true }, { galaxy: 2, system: 5, position: 9, moon: true }));
  expect([moonTarget.defenders[0]!.coords, moonTarget.defenders[0]!.moon]).toEqual(["1:30:8", true]);
  expect([moonTarget.attackers[0]!.coords, moonTarget.attackers[0]!.moon]).toEqual(["2:5:9", true]);
  const planets = decodeHref(simulateHref({ galaxy: 1, system: 30, position: 8, moon: false }, { galaxy: 2, system: 5, position: 9, moon: false }));
  expect([planets.defenders[0]!.moon, planets.attackers[0]!.moon]).toEqual([false, false]);
  expect(decodeHref(simulateHref({ galaxy: 1, system: 30, position: 8, moon: false }, undefined)).attackers[0]!.coords).toBe("");
});

test("only real attacker units count: hidden defenses, Solar Satellites and Crawlers never fight", () => {
  const home = { ...emptyFleet(), ships: ships({ 9: 40, 15: 3 }), defenses: [100, 0, 0, 0, 0, 0, 0, 0] };
  expect(fleetHasUnits(home, false)).toBe(false);
  expect(fleetHasUnits(home, true)).toBe(true);
  expect(fleetHasUnits({ ...home, ships: ships({ 9: 40, 2: 1 }) }, false)).toBe(true);
  expect(fleetHasUnits(emptyFleet(), true)).toBe(false);
});

test("shared links only load fleets they do not already define, and keep their supports", () => {
  const coordsOnly = (coords: string) => ({ ...emptyFleet(), coords });
  const armed = { ...coordsOnly("3:3:3"), ships: ships({ 2: 5 }) };
  const support = { ...emptyFleet(), ships: ships({ 5: 30 }) };
  const withSupports = fleetsToLoadOnOpen({ attackers: [armed], defenders: [coordsOnly("1:2:3"), support] });
  expect(withSupports.map(({ side, fleet, keepSupports }) => [side, fleet.coords, keepSupports])).toEqual([["defenders", "1:2:3", true]]);
  const bare = fleetsToLoadOnOpen({ attackers: [coordsOnly("2:2:2")], defenders: [coordsOnly("1:2:3")] });
  expect(bare.map(({ side, keepSupports }) => [side, keepSupports])).toEqual([["attackers", false], ["defenders", false]]);
  expect(fleetsToLoadOnOpen({ attackers: [armed], defenders: [{ ...coordsOnly("1:2:3"), defenses: [5, 0, 0, 0, 0, 0, 0, 0] }] })).toEqual([]);
});

test("oversized coordinates never break share links", () => {
  const setup: CalculatorSetup = { attackers: [{ ...emptyFleet(), coords: "1:2:3".repeat(100_000) }], defenders: [emptyFleet()] };
  expect(decodeSetup(encodeSetup(setup))!.attackers[0]!.coords).toHaveLength(16);
});

test("simulations honour the time budget, and a hard ceiling even before the minimum runs", () => {
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const input: ContractBattleInput = {
    attackers: [{ id: "a", label: "A", owner: "", laneGroup: 0, ships: ships({ 6: 4 }), technology: { weapons: 0, shielding: 0, armor: 0 } }],
    defender: { id: "d", label: "D", owner: "", ships: ships({ 1: 3 }), defenses: [2, 0, 0, 0, 0, 0, 0, 0], technology: { weapons: 0, shielding: 0, armor: 0 }, counterplay: [] },
  };
  // Every run "takes" 3s on this fake clock.
  const clock = () => { let time = 0; return () => (time += 3_000) - 3_000; };
  const limits = { runs: 1_000, minRuns: 100, budgetMs: 4_000, maxMs: 8_000, fast: true };
  const ceiling = runBattleSimulation(input, limits, undefined, clock());
  expect([ceiling.runs, ceiling.timeLimited]).toEqual([3, true]);
  const budget = runBattleSimulation(input, { ...limits, minRuns: 2 }, undefined, clock());
  expect([budget.runs, budget.timeLimited]).toEqual([2, false]);
  const progress: number[] = [];
  const fast = runBattleSimulation(input, { ...limits, runs: 12 }, (stats) => progress.push(stats.runs), () => 0);
  expect(fast.runs).toBe(12);
  expect(fast.outcomes).toEqual(simulateBattleStats(input, 12).outcomes);
  expect(progress).toEqual([]);
});

// Nikita's screenshot (#105): 1 Dreadstar + 100 Reapers vs 2,000 Rocket Launchers + 5 Plasma Turrets, all techs 10.
const tech10 = { weapons: 10, shielding: 10, armor: 10 };
const screenshotBattle: ContractBattleInput = {
  attackers: [{ id: "a", label: "Attacker", owner: "", laneGroup: 0, ships: ships({ 11: 1, 13: 100 }), technology: tech10 }],
  defender: { id: "d", label: "Defender", owner: "", ships: ships({}), defenses: [2_000, 0, 0, 0, 0, 0, 5, 0], technology: tech10, counterplay: [] },
};

test("the calculator runs the referee's exact engine; mission forecasts keep the fast stream", () => {
  expect(CALCULATOR_SIMULATION).toBe(EXACT_SIMULATION);
  expect(EXACT_SIMULATION.fast).toBe(false);
  expect(EXACT_SIMULATION.minRuns).toBeGreaterThanOrEqual(300);
  expect(FAST_SIMULATION.fast).toBe(true);
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const stats = runBattleSimulation(screenshotBattle, { ...EXACT_SIMULATION, runs: 3 }, undefined, () => 0);
  expect([stats.runs, stats.exact, stats.timeLimited]).toEqual([3, true, false]);
  for (const sample of Object.values(stats.samples)) expect(sample.fast).toBe(false);
  // Each run is the oracle's own replay of its seed, with the oracle's SHA-256 draws (no override).
  const left = Array.from({ length: 8 }, () => 0);
  for (let index = 0; index < 3; index++) {
    const groups: Group[] = [
      { side: 0, owner: `0x${"1".padStart(40, "0")}`, source: "1", type: 11, count: 1, technology: tech10 },
      { side: 0, owner: `0x${"1".padStart(40, "0")}`, source: "1", type: 13, count: 100, technology: tech10 },
      { side: 1, owner: `0x${"0".padStart(40, "0")}`, source: "0", type: 16, count: 2_000, technology: tech10 },
      { side: 1, owner: `0x${"0".padStart(40, "0")}`, source: "0", type: 22, count: 5, technology: tech10 },
    ];
    const state = initialize({ seed: deterministicBattleSampleWord(index), catalog: refereeCatalog, rapidfire: refereeRapidfire, groups });
    while (!state.done) advance(state, 100_000);
    const lost = (type: number) => result(state).allocation.find((row) => row.type === type)!.lost;
    const run = runContractBattle(screenshotBattle, deterministicBattleSampleWord(index), index + 1, false, false);
    expect(run.defender.lostDefenses.find((row) => row.id === 0)?.count ?? 0).toBe(lost(16));
    expect(run.attackers[0]!.lostShips.find((row) => row.id === 13)?.count ?? 0).toBe(lost(13));
    for (const row of run.defender.survivingDefenses) left[row.id]! += row.count;
  }
  expect(stats.defenderDefenses).toEqual(left);
  // The fast stream is a different (non-replayable) sample of the same rules.
  const fast = runBattleSimulation(screenshotBattle, { ...FAST_SIMULATION, runs: 3 }, undefined, () => 0);
  expect(fast.exact).toBe(false);
  expect(fast.defenderDefenses).not.toEqual(stats.defenderDefenses);
});

test("defenses left = start - destroyed + repaired, with the contract's 70% repair and single-unit roll", () => {
  const checkRun = (input: ContractBattleInput, run: ContractBattleResult) => {
    const count = (rows: readonly { id: number; count: number }[], id: number) => rows.find((row) => row.id === id)?.count ?? 0;
    for (let id = 0; id < 8; id++) {
      const start = input.defender.defenses[id] ?? 0, destroyed = count(run.defender.lostDefenses, id), repaired = count(run.defender.repairedDefenses, id);
      expect(count(run.defender.survivingDefenses, id)).toBe(start - destroyed + repaired);
      // Shield domes are single units, so they always take the seeded 70% roll.
      const expected = destroyed > 1 ? Math.floor(destroyed * 70 / 100) : destroyed === 1 ? (BigInt(run.randomWord) + BigInt(id)) % 10n < 7n ? 1 : 0 : 0;
      expect(repaired).toBe(expected);
    }
  };
  const domes: ContractBattleInput = {
    attackers: [{ id: "a", label: "A", owner: "", laneGroup: 0, ships: ships({ 5: 60, 7: 20 }), technology: tech10 }],
    defender: { id: "d", label: "D", owner: "", ships: ships({}), defenses: [300, 40, 1, 1, 0, 0, 0, 1], technology: { weapons: 0, shielding: 0, armor: 0 }, counterplay: [] },
  };
  let singles = 0;
  for (const model of [CONTRACT_COMBAT_MODEL_VERSION, REFEREE_COMBAT_MODEL_VERSION]) {
    setActiveCombatModel(model);
    for (let index = 0; index < 8; index++) {
      const run = runContractBattle(domes, deterministicBattleSampleWord(index), index + 1, false);
      checkRun(domes, run);
      singles += run.defender.lostDefenses.filter((row) => row.count === 1).length;
    }
  }
  expect(singles).toBeGreaterThan(0);

  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const runs = 40;
  const stats = runBattleSimulation(screenshotBattle, { ...EXACT_SIMULATION, runs }, undefined, () => 0);
  for (let index = 0; index < 2; index++) checkRun(screenshotBattle, runContractBattle(screenshotBattle, deterministicBattleSampleWord(index), index + 1, false));
  for (let id = 0; id < 8; id++) {
    expect(stats.defenderDefenses[id]).toBe((screenshotBattle.defender.defenses[id] ?? 0) * runs - stats.defenderDefensesDestroyed[id]! + stats.defenderDefensesRepaired[id]!);
  }
  // The calculator rows: ~1,190 Rocket Launchers destroyed, ~830 repaired, ~1,640 left.
  const rocketLaunchers = survivorGroups(screenshotBattle, stats)[1]!.rows.find((row) => row.label === "Rocket Launcher")!;
  expect(rocketLaunchers.destroyed).toBeGreaterThan(1_100);
  expect(rocketLaunchers.destroyed).toBeLessThan(1_280);
  expect(Math.abs(rocketLaunchers.repaired! - rocketLaunchers.destroyed * 0.7)).toBeLessThan(1);
  expect(rocketLaunchers.left).toBeCloseTo(rocketLaunchers.start - rocketLaunchers.destroyed + rocketLaunchers.repaired!, 6);
  const reapers = survivorGroups(screenshotBattle, stats)[0]!.rows.find((row) => row.label === "Reaper")!;
  expect(reapers.repaired).toBeNull();
  expect(reapers.destroyed).toBeCloseTo(reapers.start - reapers.left, 6);
});

test("shown survivor rows always add up at one precision", () => {
  // 1,189.4 / 832.6 / 1,643.2 rounded one by one would read 1,189 / 833 / 1,643 (off by one).
  expect(displayedSurvivorRow({ label: "Rocket Launcher", start: 2_000, destroyed: 1_189.4, repaired: 832.6, left: 1_643.2 }))
    .toEqual({ destroyed: 1_189, repaired: 833, left: 1_644, digits: 0 });
  expect(displayedSurvivorRow({ label: "Reaper", start: 100, destroyed: 100 - 65.7, repaired: null, left: 65.7 }))
    .toEqual({ destroyed: 34.3, repaired: null, left: 65.7, digits: 1 });
  expect(displayedSurvivorRow({ label: "Plasma Turret", start: 5, destroyed: 0.04, repaired: 0, left: 4.96 }))
    .toEqual({ destroyed: 0, repaired: 0, left: 5, digits: 1 });
  expect(displayedSurvivorRow({ label: "Cruiser", start: 40, destroyed: 0, repaired: null, left: 40 }))
    .toEqual({ destroyed: 0, repaired: null, left: 40, digits: 0 });
});

test("the Simulations label qualifies runs only under model 3, in player wording", () => {
  for (const exact of [true, false]) expect(simulationsFact(1_000, exact, CONTRACT_COMBAT_MODEL_VERSION)).toEqual({ value: "1,000" });
  const exact = simulationsFact(870, true, REFEREE_COMBAT_MODEL_VERSION);
  const quick = simulationsFact(1_000, false, REFEREE_COMBAT_MODEL_VERSION);
  expect([exact.value, quick.value]).toEqual(["870 · exact", "1,000 · quick estimate"]);
  for (const text of [exact.value, exact.title, quick.value, quick.title]) expect(text).not.toMatch(/referee|seeded|draws|\(fast\)/i);
});
