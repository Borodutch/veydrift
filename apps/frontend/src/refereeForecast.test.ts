import { afterEach, expect, test } from "bun:test";
import { advance, initialize, result, type Group } from "../../../packages/battle-oracle/oracle";
import { catalog, rapidfire } from "../../../packages/battle-oracle/catalog";
import {
  CONTRACT_COMBAT_MODEL_VERSION,
  REFEREE_COMBAT_MODEL_VERSION,
  activeCombatModel,
  forecastContractBattle,
  runContractBattle,
  setActiveCombatModel,
  type ContractBattleInput,
} from "./battlePreview";

afterEach(() => setActiveCombatModel(CONTRACT_COMBAT_MODEL_VERSION));

const ships = (entries: Record<number, number>) => Array.from({ length: 16 }, (_, id) => entries[id] ?? 0);
const tech = { weapons: 3, shielding: 2, armor: 1 };
const input: ContractBattleInput = {
  attackers: [
    { id: "7", label: "Leader", owner: "0xa", laneGroup: 0, ships: ships({ 6: 30, 7: 4 }), technology: tech },
    { id: "8", label: "Ally", owner: "0xb", laneGroup: 1, ships: ships({ 5: 25 }), technology: { weapons: 1, shielding: 1, armor: 1 } },
  ],
  defender: {
    id: "0", label: "Target", owner: "0xd", ships: ships({ 1: 120, 6: 4, 9: 10 }), defenses: [60, 0, 8, 1, 0, 0, 0, 0],
    technology: { weapons: 2, shielding: 5, armor: 3 },
    counterplay: [{ id: "9", label: "Guard", owner: "0xc", laneGroup: 0, ships: ships({ 7: 3 }), technology: { weapons: 0, shielding: 0, armor: 6 } }],
  },
};
const seed = `0x${"5eed".padStart(64, "0")}` as const;

test("only verified models 2 and 3 are accepted", () => {
  expect(() => setActiveCombatModel(4)).toThrow("out of date");
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  expect(activeCombatModel()).toBe(3);
});

test("model 3 forecast sample matches the referee's exact allocation for the same seed", () => {
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const report = runContractBattle(input, seed);
  // Independent oracle run with the same fleet-to-group mapping the referee journals.
  const owner = (source: number) => `0x${source.toString(16).padStart(40, "0")}`;
  const groups: Group[] = [];
  const push = (side: 0 | 1, source: number, type: number, count: number, technology: typeof tech) => {
    if (count > 0) groups.push({ side, owner: owner(source), source: String(source), type, count, technology });
  };
  input.attackers.forEach((fleet, i) => fleet.ships.forEach((n, unit) => unit <= 14 && unit !== 9 && push(0, i + 1, unit, n, fleet.technology)));
  input.defender.ships.forEach((n, unit) => push(1, 0, unit, n, input.defender.technology));
  input.defender.defenses.forEach((n, unit) => push(1, 0, unit + 16, n, input.defender.technology));
  input.defender.counterplay.forEach((fleet, i) => fleet.ships.forEach((n, unit) => unit <= 14 && unit !== 9 && push(1, 3 + i, unit, n, fleet.technology)));
  const state = initialize({ seed, catalog, rapidfire, groups });
  while (!state.done) advance(state, 100_000);
  const exact = result(state);
  const lost = (source: number, unit: number) => exact.allocation.find(a => a.source === String(source) && a.type === unit)?.lost ?? 0;

  expect(report.rounds.length).toBe(exact.rounds.length);
  for (const [index, fleet] of report.attackers.entries()) {
    for (const row of fleet.lostShips) expect(row.count).toBe(lost(index + 1, row.id));
    const total = fleet.lostShips.reduce((n, row) => n + row.count, 0);
    expect(total).toBe(exact.allocation.filter(a => a.source === String(index + 1)).reduce((n, a) => n + a.lost, 0));
  }
  for (const row of report.defender.lostDefenses) expect(row.count).toBe(lost(0, row.id + 16));
  const outcome = { attacker: "win", defender: "defeat", draw: "draw" }[exact.outcome];
  expect(report.outcome).toBe(outcome as typeof report.outcome);
});

test("model 3 per-round fleet losses add up exactly to the final allocation", () => {
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  // Same unit and tech: one cohort split 1/3/3, where cumulative largest-remainder is not monotone.
  const fleet = (id: string, count: number) => ({ id, label: id, owner: "0x" + id, laneGroup: 0, ships: ships({ 1: count }), technology: tech });
  const battle: ContractBattleInput = {
    attackers: [fleet("1", 1), fleet("2", 3), fleet("3", 3)],
    defender: { id: "0", label: "Target", owner: "0xd", ships: ships({ 1: 6 }), defenses: Array(8).fill(0), technology: tech, counterplay: [] },
  };
  for (let n = 1; n <= 64; n++) {
    const report = runContractBattle(battle, `0x${n.toString(16).padStart(64, "0")}`);
    report.attackers.forEach((participant, index) => {
      const final = participant.lostShips.reduce((sum, row) => sum + row.count, 0);
      const perRound = report.rounds.reduce((sum, round) => sum + (round.attackers[index]?.lostShips.reduce((s, row) => s + row.count, 0) ?? 0), 0);
      expect(perRound).toBe(final);
    });
  }
});

test("model 3 forecasts are time-boxed but always return a sample", () => {
  setActiveCombatModel(REFEREE_COMBAT_MODEL_VERSION);
  const forecast = forecastContractBattle(input, 128, false);
  expect(forecast.samples.length).toBeGreaterThanOrEqual(1);
  expect(forecast.samples.length).toBeLessThan(128);
});
