import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Classic combat (ticket #44): the per-shot engine the trusted battle referee, the backend report and
 * the frontend simulator all run. See docs/battle-referee-rules.md.
 *
 * Units are individual; each participant (fleet / resident body) fires in roster order and, within
 * a participant, by technical id. Every unit alive at round start fires once plus rapidfire;
 * targets are uniform over the enemy units alive at round start (wrecks absorb shots until the round
 * ends). While a shield is up it bounces shots of at most 1% of its maximum and is otherwise held at
 * a whole percent of the maximum (rounded up, in float32, as the real game does); a shot that breaks
 * it carries the rest into the hull. Units at or below 70% hull may explode after any hit, shields
 * regenerate between rounds, max 6 rounds. Randomness is SHA-256 of a counter.
 */
export const RULES = "veydrift-classic-combat-1";
const U256 = 1n << 256n;
const MAX_ROUNDS = 6;
export type Side = 0 | 1;
export interface Stats { attack: bigint; shield: bigint; hull: bigint }
export interface Technology { weapons: number; shielding: number; armor: number }
/** `hull` is structural integrity / 10; `order` is the technical id (firing order). */
export interface CatalogEntry extends Stats { type: number; order?: number }
export interface Group {
  side: Side; owner: string; source: string; type: number; count: number; technology: Technology;
}
/** Groups must be in canonical roster order: participant order is first appearance per side. */
export interface Input {
  seed: string; catalog: CatalogEntry[]; groups: Group[];
  rapidfire: { shooter: number; target: number; factor: number }[];
}
export interface GroupState extends Group { attack: number; shield: number; hull: number; order: number }
export interface Round { round: number; survivors: number[]; shots: [bigint, bigint] }
export interface State {
  rules: typeof RULES; seed: string; counter: bigint; groups: GroupState[];
  /** Per unit: owning group, current hull/shield (shield 0 = down), alive flag. */
  unitGroup: Int32Array; hull: Float64Array; shield: Float64Array; alive: Uint8Array;
  /** Units of each side alive at round start, in firing order. */
  pools: [Int32Array, Int32Array];
  rapidfire: Map<number, number>;
  round: number; side: Side; shooter: number; shots: [bigint, bigint]; rounds: Round[]; done: boolean;
  /** Simulation-only draw source, uniform over [0, bound). The referee never sets it, so its draws
   * stay SHA-256 of the counter; a simulator may trade that exact replay for speed. */
  random?: (bound: number) => number;
}

function integer(n: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error("invalid " + name);
}
function uint(n: bigint, name: string, nonzero = false) {
  if (typeof n !== "bigint" || n < (nonzero ? 1n : 0n) || n >= U256) throw new Error("invalid " + name);
}
const MAX_STAT = 2n ** 40n;
/**
 * Effective stats, computed in double precision like the classic game: attack
 * floor(base * (1 + 0.1 * weapons)), shield ceil(base * (1 + 0.1 * shielding)) (so 25 at shielding
 * 14 is ceil(60.00000000000001) = 61, as real reports show), hull base * (10 + armour) / 10 exactly.
 */
export function effective(base: Stats, tech: Technology): Stats {
  for (const n of [tech.weapons, tech.shielding, tech.armor]) integer(n, 0, 65535, "technology");
  uint(base.attack, "attack"); uint(base.shield, "shield"); uint(base.hull, "hull", true);
  const checked = (n: bigint) => { if (n >= MAX_STAT) throw new Error("stat too large for combat arithmetic"); return n; };
  const scaled = (n: bigint, level: number) => Number(checked(n)) * (1 + 0.1 * level);
  return {
    attack: checked(BigInt(Math.floor(scaled(base.attack, tech.weapons)))),
    shield: checked(BigInt(Math.ceil(scaled(base.shield, tech.shielding)))),
    hull: checked(checked(base.hull) * (10n + BigInt(tech.armor)) / 10n)
  };
}
const rfKey = (shooter: number, target: number) => shooter * 65536 + target;

/** Host safety budget is NOT a gameplay cap: refusal produces no battle result. */
export function initialize(input: Input, maxExpandedUnits = 100_000): State {
  integer(maxExpandedUnits, 1, 50_000_000, "host unit budget");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.seed)) throw new Error("seed must be bytes32");
  const catalog = new Map<number, CatalogEntry>();
  for (const c of input.catalog) {
    integer(c.type, 0, 65535, "type"); effective(c, { weapons: 0, shielding: 0, armor: 0 });
    if (c.order !== undefined) integer(c.order, 0, 65535, "order");
    if (catalog.has(c.type)) throw new Error("duplicate catalog type"); catalog.set(c.type, c);
  }
  const rapidfire = new Map<number, number>();
  for (const r of input.rapidfire) {
    integer(r.factor, 1, 65535, "rapidfire");
    if (!catalog.has(r.shooter) || !catalog.has(r.target)) throw new Error("unknown rapidfire type");
    if (rapidfire.has(rfKey(r.shooter, r.target))) throw new Error("duplicate rapidfire lane");
    rapidfire.set(rfKey(r.shooter, r.target), r.factor);
  }
  const identities = new Set<string>(); const sources = new Map<string, string>();
  const technologies = new Map<string, string>(); const participants = new Map<string, number>();
  const groups: (GroupState & { participant: number; position: number })[] = [];
  let total = 0;
  input.groups.forEach((original, position) => {
    const g = { ...original, owner: original.owner.toLowerCase(), technology: { ...original.technology } };
    integer(g.side, 0, 1, "side"); integer(g.count, 0, 0xffffffff, "count");
    if (!/^0x[0-9a-f]{40}$/.test(g.owner) || !/^(0|[1-9][0-9]*)$/.test(g.source) || BigInt(g.source) >= U256) throw new Error("invalid source identity");
    const identity = [g.side, g.owner, g.source, g.type].join(":");
    if (identities.has(identity)) throw new Error("duplicate group"); identities.add(identity);
    const base = catalog.get(g.type); if (!base) throw new Error("unknown type");
    const stats = effective(base, g.technology);
    const technology = [g.technology.weapons, g.technology.shielding, g.technology.armor].join(":");
    const source = [g.side, g.owner, technology].join(":");
    if (sources.has(g.source) && sources.get(g.source) !== source) throw new Error("inconsistent source membership");
    if (technologies.has(g.owner) && technologies.get(g.owner) !== technology) throw new Error("inconsistent frozen owner technology");
    sources.set(g.source, source); technologies.set(g.owner, technology);
    total += g.count;
    if (!Number.isSafeInteger(total) || total > maxExpandedUnits) throw new Error("host unit budget exceeded; battle incomplete");
    const participantKey = g.side + ":" + g.source;
    if (!participants.has(participantKey)) participants.set(participantKey, participants.size);
    groups.push({ ...g, attack: Number(stats.attack), shield: Number(stats.shield), hull: Number(stats.hull),
      order: base.order ?? g.type, participant: participants.get(participantKey)!, position });
  });
  // Firing order: participant (roster order), then technical id.
  const firing = groups.map((_, i) => i).sort((a, b) => groups[a]!.participant - groups[b]!.participant
    || groups[a]!.order - groups[b]!.order || groups[a]!.position - groups[b]!.position);
  const unitGroup = new Int32Array(total), hull = new Float64Array(total), shield = new Float64Array(total);
  const alive = new Uint8Array(total); const sideUnits: [number[], number[]] = [[], []];
  let unit = 0;
  for (const index of firing) {
    const g = groups[index]!;
    for (let n = 0; n < g.count; n++, unit++) {
      unitGroup[unit] = index; hull[unit] = g.hull; shield[unit] = g.shield; alive[unit] = 1;
      sideUnits[g.side].push(unit);
    }
  }
  const state: State = {
    rules: RULES, seed: input.seed.toLowerCase(), counter: 0n,
    groups: groups.map(({ participant: _p, position: _q, ...g }) => g),
    unitGroup, hull, shield, alive, pools: [Int32Array.from(sideUnits[0]), Int32Array.from(sideUnits[1])],
    rapidfire, round: 0, side: 0, shooter: 0, shots: [0n, 0n], rounds: [], done: false
  };
  startRound(state, false);
  return state;
}

const randomDomain = utf8ToBytes(RULES + ":random:");
const draws = new Map<string, Uint8Array>();
const tails = new Map<number, number>();
/** Reused SHA-256 input for one seed: domain || seed32 || counter32 (counter written per draw). */
function drawBuffer(seed: string): Uint8Array {
  let message = draws.get(seed);
  if (!message) {
    message = new Uint8Array(randomDomain.length + 64);
    message.set(randomDomain); message.set(hexToBytes(seed.slice(2)), randomDomain.length);
    if (draws.size > 64) draws.clear();
    draws.set(seed, message);
  }
  return message;
}
const SMALL_BOUND = 2 ** 45;

/** SHA-256(domain UTF8 || seed32 || counter32 BE) mod bound, rejection sampled (no modulo bias). */
export function uniform(state: Pick<State, "seed" | "counter">, bound: bigint | number): bigint {
  if (typeof bound === "number") integer(bound, 1, SMALL_BOUND, "draw bound"); else uint(bound, "draw bound", true);
  const small = typeof bound === "number" ? bound : bound <= BigInt(SMALL_BOUND) ? Number(bound) : 0;
  const message = drawBuffer(state.seed);
  const counterOffset = message.length - 32;
  let tail = 0;
  if (small) {
    tail = tails.get(small) ?? Number(U256 % BigInt(small));
    if (tails.size > 4096) tails.clear();
    tails.set(small, tail);
  }
  for (;;) {
    if (state.counter >= U256) throw new Error("random stream exhausted; battle incomplete");
    const counter = state.counter++;
    if (counter <= 0xffffffffn) {
      message.fill(0, counterOffset, message.length - 4);
      new DataView(message.buffer, message.byteOffset).setUint32(message.length - 4, Number(counter));
    } else message.set(hexToBytes(counter.toString(16).padStart(64, "0")), counterOffset);
    const digest = sha256(message);
    if (small) {
      // word >= 2^256 - tail (tail < 2^45) is only possible when the top 26 bytes are all 0xff.
      let rejectable = tail !== 0;
      for (let i = 0; rejectable && i < 26; i++) rejectable = digest[i] === 0xff;
      if (rejectable && BigInt("0x" + bytesToHex(digest)) >= U256 - BigInt(tail)) continue;
      let remainder = 0;
      for (let i = 0; i < 32; i++) remainder = (remainder * 256 + digest[i]!) % small;
      return BigInt(remainder);
    }
    const b = bound as bigint;
    const word = BigInt("0x" + bytesToHex(digest)); if (word < U256 - U256 % b) return word % b;
  }
}
const draw = (s: Pick<State, "seed" | "counter" | "random">, bound: number) => s.random ? s.random(bound) : Number(uniform(s, bound));

const f32 = Math.fround;
/** Explosion rolls draw from [0, 2^23): a unit explodes iff draw >= 2^23 * hull / fullHull (exact
 * scaling; 2^23 keeps the draw's remainder arithmetic in fast int32 range). */
const EXPLOSION_BOUND = 2 ** 23;

/**
 * One hit of `attack` on living unit `t` (the model reproduces all 41 real combat-report data
 * points in fixtures/real-shield-reports.json):
 * - shield up: a shot of at most 1% of the full shield bounces; a shot below the remaining shield
 *   leaves it at ceil(f32(f32(f32(shield - attack) / f32(full)) * 100)) percent of full and the
 *   hull untouched; any other shot breaks the shield and attack - shield hits the hull.
 * - shield down (broken this round, or a unit without shields): the whole shot hits the hull.
 * - a unit left at or below 70% hull then explodes with probability 1 - hull/fullHull.
 */
export function hit(s: Pick<State, "seed" | "counter" | "random" | "groups" | "unitGroup" | "hull" | "shield" | "alive">, t: number, attack: number) {
  const g = s.groups[s.unitGroup[t]!]!;
  const full = g.shield, shield = s.shield[t]!;
  let damage = attack;
  if (shield > 0) {
    if (attack * 100 <= full) damage = 0;
    else if (attack < shield) {
      s.shield[t] = Math.ceil(f32(f32(f32(shield - attack) / f32(full)) * 100)) * full / 100;
      damage = 0;
    } else {
      damage = attack - shield;
      s.shield[t] = 0;
    }
  }
  const hull = s.hull[t]! - damage;
  if (hull <= 0) { s.hull[t] = 0; s.alive[t] = 0; return; }
  s.hull[t] = hull;
  if (hull <= 0.7 * g.hull && draw(s, EXPLOSION_BOUND) >= hull / g.hull * EXPLOSION_BOUND) s.alive[t] = 0;
}

function startRound(s: State, nextRound = true) {
  if (nextRound) {
    // Remove units destroyed this round; regenerate survivors' shields (hull never regenerates).
    for (const side of [0, 1] as const) {
      const pool = s.pools[side];
      let kept = 0;
      for (let i = 0; i < pool.length; i++) {
        const unit = pool[i]!;
        if (!s.alive[unit]) continue;
        s.shield[unit] = s.groups[s.unitGroup[unit]!]!.shield;
        pool[kept++] = unit;
      }
      s.pools[side] = pool.subarray(0, kept);
    }
  }
  if (!s.pools[0].length || !s.pools[1].length || s.round === MAX_ROUNDS) { s.done = true; return; }
  s.round++; s.side = 0; s.shooter = 0; s.shots = [0n, 0n];
}

export function survivorCounts(s: State): number[] {
  const counts = s.groups.map(() => 0);
  for (let unit = 0; unit < s.alive.length; unit++) if (s.alive[unit]) counts[s.unitGroup[unit]!]!++;
  return counts;
}

/** One operation is one physical shot, including each rapidfire shot. No rapidfire cap. */
export function advance(s: State, shotBudget: number): number {
  integer(shotBudget, 0, Number.MAX_SAFE_INTEGER, "shot budget");
  if (s.rules !== RULES) throw new Error("wrong rules");
  let used = 0;
  while (!s.done && used < shotBudget) {
    const shooter = s.groups[s.unitGroup[s.pools[s.side][s.shooter]!]!]!;
    const targets = s.pools[(1 - s.side) as Side];
    const target = targets[draw(s, targets.length)]!;
    if (s.alive[target]) hit(s, target, shooter.attack);
    used++; s.shots[s.side]++;
    const rf = s.rapidfire.get(rfKey(shooter.type, s.groups[s.unitGroup[target]!]!.type)) ?? 1;
    if (rf > 1 && draw(s, rf) !== 0) continue;
    s.shooter++;
    if (s.shooter < s.pools[s.side].length) continue;
    if (s.side === 0) { s.side = 1; s.shooter = 0; continue; }
    s.rounds.push({ round: s.round, survivors: survivorCounts(s), shots: [...s.shots] });
    startRound(s);
  }
  return used;
}

export interface Allocation { side: Side; owner: string; source: string; type: number; initial: number; lost: number; survivors: number }
/** Exact per-group (fleet, unit type) losses; no proportional attribution is needed. */
export function result(s: State): { outcome: "attacker" | "defender" | "draw"; rounds: Round[]; allocation: Allocation[] } {
  if (!s.done) throw new Error("battle incomplete");
  const counts = survivorCounts(s);
  const allocation: Allocation[] = s.groups.map((g, i) => ({
    side: g.side, owner: g.owner, source: g.source, type: g.type, initial: g.count, lost: g.count - counts[i]!, survivors: counts[i]!
  }));
  const alive = [0, 0]; counts.forEach((n, i) => alive[s.groups[i]!.side]! += n);
  const outcome = alive[0] && !alive[1] ? "attacker" : alive[1] && !alive[0] ? "defender" : "draw";
  return { outcome, rounds: s.rounds.map((r) => ({ ...r, survivors: [...r.survivors], shots: [...r.shots] as [bigint, bigint] })), allocation };
}
