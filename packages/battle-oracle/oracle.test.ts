import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import reports from "./fixtures/real-shield-reports.json";
import { advance, effective, hit, initialize, result, RULES, uniform, type Group, type Input, type State } from "./oracle";

const seed = "0x" + "01".repeat(32);
const owner = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const tech = { weapons: 0, shielding: 0, armor: 0 };
const group = (side: 0 | 1, type: number, count = 1, source = String(side + 1), who = side + 1): Group =>
  ({ side, type, count, source, owner: owner(who), technology: { ...tech } });
const base = (attack: bigint, shield = 0n, hull = 100n) => ({ attack, shield, hull });
const input = (): Input => ({ seed, catalog: [{ type: 0, ...base(21n, 10n, 300n) }, { type: 1, ...base(31n, 10n, 400n) }], groups: [group(0, 0, 7), group(1, 1, 8)], rapidfire: [] });
function finish(s: State, chunk = 1000): State { let shots = 0; while (!s.done) { shots += advance(s, chunk); if (shots > 1_000_000) throw new Error("test budget"); } return s; }
/** One defender unit (index 1) with the given full shield / hull; returns state and a hit helper. */
function target(fullShield: bigint, fullHull: bigint) {
  const i = input(); i.catalog = [{ type: 0, ...base(1n) }, { type: 1, ...base(0n, fullShield, fullHull) }]; i.groups = [group(0, 0), group(1, 1)];
  const s = initialize(i);
  return { s, shoot: (attack: number) => { const before = s.counter; hit(s, 1, attack); return s.counter - before; } };
}

test("OGame tech scaling in double precision: attack floored, shield rounded up, hull exact", () => {
  expect(effective(base(11n, 13n, 19n), { weapons: 1, shielding: 2, armor: 3 })).toEqual(base(12n, 16n, 24n));
  // Real reports: Large Cargo shield 25 at shielding 14 is ceil(60.00000000000001) = 61; Recyclers
  // (attack 1) at weapons 18 fire 2, not 2.8; 6.5 floors to 6.
  expect(effective(base(5n, 25n, 1200n), { weapons: 3, shielding: 14, armor: 0 })).toEqual(base(6n, 61n, 1200n));
  expect(effective(base(1n, 10n, 1600n), { weapons: 18, shielding: 0, armor: 7 }).attack).toBe(2n);
  const i = input(); i.groups.push({ ...group(0, 0, 1, "3", 3), technology: { weapons: 2, shielding: 3, armor: 4 } });
  const s = initialize(i);
  expect(s.groups.filter((g) => g.side === 0).map((g) => [g.attack, g.shield, g.hull])).toEqual([[21, 10, 300], [25, 13, 420]]);
});

test("a shot below the remaining shield holds it at a whole percent, rounded up, and spares the hull", () => {
  const { s, shoot } = target(17n, 1000n);
  shoot(9); // 8 of 17 left = 47.06% -> 48% of 17
  expect(s.shield[1]).toBe(48 * 17 / 100); expect(s.hull[1]).toBe(1000);
});

test("percentages are rounded in float32 like the real game: 60% of a 6000 shield reads 61%", () => {
  const { s, shoot } = target(6000n, 1_000_000n);
  shoot(1200); expect(s.shield[1]).toBe(4800);
  shoot(1200); expect(s.shield[1]).toBe(3660);
});

test("a shot of at most 1% bounces while the shield is up; just above 1% takes one percent", () => {
  const { s, shoot } = target(1000n, 1000n);
  shoot(9); shoot(10); expect(s.shield[1]).toBe(1000);
  shoot(11); expect(s.shield[1]).toBe(990); expect(s.hull[1]).toBe(1000);
});

test("a shot reaching the remaining shield breaks it and the rest hits the hull; then every shot does", () => {
  const { s, shoot } = target(100n, 1000n);
  s.shield[1] = 10;
  shoot(50); expect(s.shield[1]).toBe(0); expect(s.hull[1]).toBe(960);
  shoot(50); expect(s.hull[1]).toBe(910);
  shoot(1); expect(s.hull[1]).toBe(909); // no bounce once the shield is down
  const full = target(10n, 1000n); full.shoot(25); expect(full.s.hull[1]).toBe(985); expect(full.s.shield[1]).toBe(0);
});

test("the shield model reproduces all 41 real OGame combat reports", () => {
  for (const r of reports.reports) {
    const attack = Math.floor(r.attack), shield = Math.ceil(r.shield);
    const { s, shoot } = target(BigInt(shield), 1_000_000_000_000n);
    let absorbed = 0;
    for (let n = 0; n < r.ships && s.shield[1]! > 0; n++) {
      const hull = s.hull[1]!; shoot(attack); absorbed += attack - (hull - s.hull[1]!);
    }
    expect([r.report, Math.floor(absorbed + 1e-6)]).toEqual([r.report, r.absorbed]);
  }
});

test("explosion check after any hit at or below 70% hull, with probability 1 - hull/max", () => {
  const { s, shoot } = target(1000n, 100n);
  s.hull[1] = 70.01; expect(shoot(5)).toBe(0n); // bounce, 70.01% hull: no draw
  s.hull[1] = 70; const draws = shoot(5); expect(draws).toBeGreaterThan(0n); // a bounce still rolls at 70%
  const expected = { seed: s.seed, counter: s.counter - draws };
  const word = uniform(expected, 2 ** 23); expect(s.alive[1]).toBe(word >= 0.7 * 2 ** 23 ? 0 : 1);
});

test("a destroyed unit takes no explosion draw and wrecks absorb shots until round end", () => {
  const i = input(); i.catalog = [{ type: 0, ...base(100n) }, { type: 1, ...base(0n) }]; i.groups = [group(0, 0), group(1, 1)];
  i.rapidfire = [{ shooter: 0, target: 1, factor: 1250 }];
  const s = initialize(i); advance(s, 100);
  expect(s.alive[1]).toBe(0); expect(s.shots[0]).toBe(100n); expect(s.counter).toBe(200n); expect(s.done).toBe(false);
  finish(s); expect(s.rounds.length).toBe(1); expect(s.rounds[0]!.shots[1]).toBe(1n);
});

test("units killed this round still fire; shields regenerate between rounds, hull does not", () => {
  const i = input(); i.catalog = [{ type: 0, ...base(100n) }, { type: 1, ...base(100n) }]; i.groups = [group(0, 0), group(1, 1)];
  const s = initialize(i); advance(s, 1); expect(s.alive[1]).toBe(0); advance(s, 1);
  expect(result(s).outcome).toBe("draw"); expect(s.rounds[0]!.shots).toEqual([1n, 1n]);
  const j = input(); j.catalog = [{ type: 0, ...base(20n, 10n, 1000n) }, { type: 1, ...base(20n, 10n, 1000n) }]; j.groups = [group(0, 0), group(1, 1)];
  const t = initialize(j); advance(t, 2); expect([...t.shield]).toEqual([10, 10]); expect([...t.hull]).toEqual([990, 990]);
  finish(t); expect(t.rounds.length).toBe(6);
});

test("firing order: participants in roster order, then OGame technical id within a fleet", () => {
  const i = input();
  i.catalog = [{ type: 0, order: 205, ...base(1n) }, { type: 1, order: 202, ...base(1n) }, { type: 2, order: 401, ...base(1n) }];
  i.groups = [group(0, 0, 1, "9"), group(0, 2, 1, "9"), group(0, 1, 1, "9"), group(0, 1, 1, "4", 7), group(1, 0)];
  const s = initialize(i);
  expect([...s.pools[0]].map((u) => [s.groups[s.unitGroup[u]!]!.source, s.groups[s.unitGroup[u]!]!.type])).toEqual([["9", 1], ["9", 0], ["9", 2], ["4", 1]]);
});

test("losses are exact per fleet and unit type", () => {
  for (let n = 0; n < 12; n++) {
    const i = input(); i.seed = "0x" + n.toString(16).padStart(64, "0");
    i.groups = [group(0, 0, 4, "10"), group(0, 0, 3, "11", 3), group(1, 1, 6, "0"), group(1, 1, 2, "12", 4)];
    const s = finish(initialize(i)); const rows = result(s).allocation;
    for (const [index, row] of rows.entries()) {
      let alive = 0; for (let u = 0; u < s.alive.length; u++) if (s.unitGroup[u] === index && s.alive[u]) alive++;
      expect(row.survivors).toBe(alive); expect(row.lost + row.survivors).toBe(row.initial);
    }
  }
});

test("rapidfire is target-dependent and uncapped; chunked replay is identical", () => {
  const i = input(); i.rapidfire = [{ shooter: 0, target: 1, factor: 20 }, { shooter: 1, target: 0, factor: 5 }];
  const reference = finish(initialize(i)); const r = result(reference);
  for (const chunk of [1, 2, 3, 11, 71]) {
    const s = finish(initialize(i), chunk);
    expect(result(s)).toEqual(r); expect(s.counter).toBe(reference.counter);
  }
  const big = input(); big.catalog = [{ type: 0, ...base(0n) }, { type: 1, ...base(0n) }]; big.groups = [group(0, 0), group(1, 1)];
  big.rapidfire = [{ shooter: 0, target: 1, factor: 1250 }];
  expect(finish(initialize(big)).rounds.some((round) => round.shots[0] > 64n)).toBe(true);
});

test("zero-step and terminal advances are no-ops; pending battles have no result", () => {
  const s = initialize(input()); expect(advance(s, 0)).toBe(0); expect(() => result(s)).toThrow("incomplete");
  finish(s); const counter = s.counter; expect(advance(s, 100)).toBe(0); expect(s.counter).toBe(counter);
});

test("uniform stream: big-endian counters and rejection sampling", () => {
  for (const bound of [(1n << 255n) + 1n, 7n, 1000003n]) {
    const s = { seed, counter: 0n }; let counter = 0n;
    for (let k = 0; k < 20; k++) {
      let expected = 0n;
      for (;;) {
        const hash = createHash("sha256").update(RULES + ":random:").update(Buffer.from(seed.slice(2), "hex")).update(Buffer.from((counter++).toString(16).padStart(64, "0"), "hex")).digest("hex");
        const word = BigInt("0x" + hash); if (word < (1n << 256n) - (1n << 256n) % bound) { expected = word % bound; break; }
      }
      expect(uniform(s, bound)).toBe(expected); expect(s.counter).toBe(counter);
    }
  }
});

test("invalid input fails closed", () => {
  for (const count of [-1, 0.5, 0x100000000, NaN]) { const i = input(); i.groups[0]!.count = count; expect(() => initialize(i)).toThrow(); }
  const duplicate = input(); duplicate.groups.push(duplicate.groups[0]!); expect(() => initialize(duplicate)).toThrow("duplicate");
  const huge = input(); huge.catalog[0]!.hull = 1n << 60n; expect(() => initialize(huge)).toThrow("too large");
  const badTech = input(); badTech.groups[0]!.technology.armor = 65536; expect(() => initialize(badTech)).toThrow("technology");
  expect(() => initialize(input(), 1)).toThrow("host unit budget");
  expect(() => initialize({ ...input(), seed: "0x01" })).toThrow("bytes32");
  expect(() => uniform({ seed, counter: 1n << 256n }, 2n)).toThrow("exhausted");
  const wrongSource = input(); wrongSource.groups[1]!.source = wrongSource.groups[0]!.source; expect(() => initialize(wrongSource)).toThrow("source");
  const wrongTech = input(); wrongTech.groups.push({ ...group(0, 0, 1, "3"), technology: { weapons: 1, shielding: 0, armor: 0 } }); expect(() => initialize(wrongTech)).toThrow("technology");
});

test("an empty side resolves without a round", () => {
  const i = input(); i.groups = i.groups.filter((g) => g.side === 1); const s = initialize(i);
  expect(result(s).outcome).toBe("defender"); expect(s.rounds).toEqual([]);
  i.groups = []; expect(result(initialize(i)).outcome).toBe("draw");
});
