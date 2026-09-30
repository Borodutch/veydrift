import { describe, expect, test } from "bun:test";
import { runContractBattle, type BattleFleetParticipant, type CombatTechnology, type ContractBattleInput, type ContractBattleResult } from "./battlePreview";

const tech: CombatTechnology = { weapons: 8, shielding: 8, armor: 8 };
const counts = (entries: [number, number][], length = 16) => Array.from({ length }, (_, id) => entries.find(([unit]) => unit === id)?.[1] ?? 0);
const fleet = (id: string, ships: number[], technology = tech, laneGroup = 0): BattleFleetParticipant => ({ id, owner: `owner-${id}`, label: id, ships, technology, laneGroup });
const word = (seed: number) => `0x${seed.toString(16).padStart(64, "0")}` as const;
const totals = (participants: ContractBattleResult["attackers"]) => participants.reduce((result, participant) => {
  for (const row of participant.survivingShips) result[row.id] = (result[row.id] ?? 0) + row.count;
  return result;
}, Array<number>(16).fill(0));
const outcome = (result: ContractBattleResult) => ({
  outcome: result.outcome,
  attackers: totals(result.attackers),
  defenders: totals([result.defender, ...result.defender.counterplay]),
  defenses: result.defender.survivingDefenses,
  attackerLosses: result.attackerLosses,
  defenderLosses: result.defenderLosses,
  rapidfire: result.rapidfireExtraShots,
  rounds: result.rounds.map(round => ({ attackerStartingUnits: round.attackerStartingUnits, defenderStartingUnits: round.defenderStartingUnits, attackers: totals(round.attackers), defenders: totals([round.defender, ...round.defender.counterplay]), defenses: round.defender.survivingDefenses, attackerRapidfire: round.attackerRapidfireExtraShots, defenderRapidfire: round.defenderRapidfireExtraShots })),
});

function input(): ContractBattleInput {
  return { attackers: [fleet("1", counts([[1, 61], [6, 17], [12, 9]]))], defender: { id: "planet", owner: "resident", label: "Resident", ships: counts([[0, 21], [1, 77], [6, 11], [12, 5]]), defenses: counts([[0, 40], [2, 11]], 8), technology: tech, counterplay: [] } };
}

describe("coherent coalition combat", () => {
  test("same seed gives identical combat for equal-tech attack and defense partitions", () => {
    const solo = input();
    const split = input();
    split.attackers = [fleet("91", counts([[1, 13], [6, 3], [12, 2]]), tech, 17), fleet("5", counts([[1, 19], [6, 8], [12, 3]]), tech, 2), fleet("42", counts([[1, 29], [6, 6], [12, 4]]), tech, 55)];
    split.defender.ships = counts([[0, 7], [1, 21], [6, 2], [12, 1]]);
    split.defender.counterplay = [fleet("hold-11", counts([[0, 9], [1, 31], [6, 5], [12, 2]]), tech, 2), fleet("reactive-4", counts([[0, 5], [1, 25], [6, 4], [12, 2]]), tech, 9)];
    const reversed = structuredClone(split);
    reversed.attackers = [...reversed.attackers].reverse();
    reversed.defender.counterplay = [...reversed.defender.counterplay].reverse();
    for (const seed of [1, 2, 5, 17, 46, 101, 404, 94880]) {
      const expected = outcome(runContractBattle(solo, word(seed)));
      expect(outcome(runContractBattle(split, word(seed)))).toEqual(expected);
      expect(outcome(runContractBattle(reversed, word(seed)))).toEqual(expected);
    }
  });

  test("mixed owner technology survives permutation without averaging", () => {
    const mixed = input();
    mixed.attackers = [...mixed.attackers, fleet("2", counts([[1, 39], [6, 7]]), { weapons: 10, shielding: 9, armor: 10 }, 3)];
    mixed.defender.counterplay = [fleet("hold-3", counts([[1, 33], [6, 11]]), { weapons: 10, shielding: 9, armor: 10 }, 1)];
    const reversed = structuredClone(mixed);
    reversed.attackers = [...reversed.attackers].reverse();
    for (const seed of [1, 17, 46, 404]) {
      const actual = runContractBattle(mixed, word(seed));
      expect(outcome(runContractBattle(reversed, word(seed)))).toEqual(outcome(actual));
      expect(actual.attackers[1]?.technology).toEqual({ weapons: 10, shielding: 9, armor: 10 });
      expect(actual.defender.counterplay[0]?.technology).toEqual({ weapons: 10, shielding: 9, armor: 10 });
      for (const participant of [...actual.attackers, actual.defender, ...actual.defender.counterplay]) {
        for (const start of participant.startingShips) {
          const lost = participant.lostShips.find(row => row.id === start.id)?.count ?? 0;
          const survived = participant.survivingShips.find(row => row.id === start.id)?.count ?? 0;
          expect(lost + survived).toBe(start.count);
        }
      }
    }
  });
  test("owner casualties are stable by owner and mission identity, not array order", () => {
    const value = input();
    value.attackers = [fleet("10", counts([[1, 20], [6, 5]])), fleet("2", counts([[1, 20], [6, 5]])), fleet("7", counts([[1, 20], [6, 5]]))];
    for (const participant of value.attackers) participant.owner = "0x0000000000000000000000000000000000000001";
    const reversed = structuredClone(value);
    reversed.attackers = [...reversed.attackers].reverse();
    const allocation = (result: ContractBattleResult) => Object.fromEntries(result.attackers.map(participant => [participant.id, { lost: participant.lostShips, surviving: participant.survivingShips }]));
    for (const seed of [1, 2, 5, 17, 46, 101]) expect(allocation(runContractBattle(reversed, word(seed)))).toEqual(allocation(runContractBattle(value, word(seed))));
  });

  test("aggregate cohorts can exceed one mission's uint32 quantity without expansion", () => {
    const max = 4_294_967_295;
    const value = input();
    value.attackers = Array.from({ length: 3 }, (_, index) => fleet(String(index + 1), counts([[1, max]])));
    value.defender.ships = counts([[1, max]]);
    value.defender.defenses = counts([], 8);
    const result = runContractBattle(value, word(17));
    expect(result.rounds[0]?.attackerStartingUnits).toBe(3 * max);
    const survivors = totals(result.attackers)[1] ?? 0;
    const destroyed = result.attackers.reduce((sum, participant) => sum + (participant.lostShips.find(row => row.id === 1)?.count ?? 0), 0);
    expect(survivors + destroyed).toBe(3 * max);
    expect(result.attackerSurvivors).toBe(survivors);
  });

});
