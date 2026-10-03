import { describe, expect, test } from "bun:test";
import { conservedShotAllocation, shotHitGroups, runContractBattle, type ContractBattleInput } from "./battlePreview";
import { combatModelMatches } from "./combatModel";

describe("independent shot conservation", () => {
  test("individual round-robin hits match cohorts at every small boundary", () => {
    for (let n = 1; n <= 32; n++) for (const shots of [0, 1, n - 1, n, n + 1, 2 * n - 1, 2 * n, 3 * n + 1]) {
      const units = Array<number>(n).fill(0);
      for (let shot = 0; shot < shots; shot++) units[shot % n]!++;
      const actual = shotHitGroups(BigInt(shots), BigInt(n));
      const expanded = actual.flatMap(group => Array<number>(Number(group.count)).fill(Number(group.hits)));
      expect(expanded.sort((a, b) => a - b)).toEqual(units.filter(Boolean).sort((a, b) => a - b));
      expect(actual.reduce((sum, group) => sum + group.count * group.hits, 0n)).toBe(BigInt(shots));
    }
    expect(shotHitGroups(100n, 99n)).toEqual([{ hits: 1n, count: 98n }, { hits: 2n, count: 1n }]);
    expect(shotHitGroups(1n, 0n)).toEqual([]);
  });

  test("individual systematic target selection conserves every shot across mixed cohorts", () => {
    for (const counts of [[1, 1], [2, 5, 3], [1, 0, 7, 4]]) {
      const total = counts.reduce((a, b) => a + b, 0);
      for (let shots = 1; shots <= 2 * total + 1; shots++) for (let draw = 0; draw < total; draw++) {
        // Independently place one point per shot, then count points in each interval.
        const points = Array.from({ length: shots }, (_, k) => Math.floor((k * total + draw) / shots));
        let prefix = 0;
        let allocated = 0n;
        for (const count of counts) {
          const expected = points.filter(point => point >= prefix && point < prefix + count).length;
          const actual = conservedShotAllocation(BigInt(shots), BigInt(count), BigInt(prefix), BigInt(total), BigInt(draw));
          expect(actual).toBe(BigInt(expected));
          allocated += actual; prefix += count;
        }
        expect(allocated).toBe(BigInt(shots));
      }
    }
    expect(conservedShotAllocation(1n, 0n, 0n, 0n, 0n)).toBe(0n);
    const large = (1n << 64n) + 1n;
    expect(conservedShotAllocation(large, 99n, 0n, 100n, 73n) + conservedShotAllocation(large, 1n, 99n, 100n, 73n)).toBe(large);
  });

  test("missing, historical and unknown live models fail closed", () => {
    for (const value of [null, {}, { version: null }, { version: 0 }, { version: 1 }, { version: 3 }, { version: "2" }]) expect(combatModelMatches(value)).toBe(false);
    expect(combatModelMatches({ version: 2 })).toBe(true);
  });

  test("adjacent Reapers cannot receive invented first-round double hits", () => {
    for (const level of [0, 10]) for (const [a, d] of [[100, 99], [99, 100], [100, 100], [99, 98], [101, 100]]) {
      const technology = { weapons: level, shielding: level, armor: level };
      const ships = (count: number) => Array.from({ length: 16 }, (_, id) => id === 13 ? count : 0);
      const input: ContractBattleInput = { attackers: [{ id: "1", owner: "0x1", label: "Attacker", laneGroup: 0, ships: ships(a!), technology }], defender: { id: "0", owner: "0x2", label: "Defender", ships: ships(d!), defenses: Array(8).fill(0), technology, counterplay: [] } };
      for (let seed = 1; seed <= 256; seed++) {
        const result = runContractBattle(input, `0x${seed.toString(16).padStart(64, "0")}`);
        expect(result.rounds.length).toBeLessThanOrEqual(6);
        const first = result.rounds[0]!;
        const aLost = first.attackers.flatMap(p => p.lostShips).reduce((sum, row) => sum + row.count, 0);
        const dLost = first.defender.lostShips.reduce((sum, row) => sum + row.count, 0);
        // Equal-tech Reapers: one hit does not cross the explosion threshold.
        expect(aLost).toBeLessThanOrEqual(Math.max(0, d! - a!));
        expect(dLost).toBeLessThanOrEqual(Math.max(0, a! - d!));
      }
    }
  });
});
