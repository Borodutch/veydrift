import { createHash } from "node:crypto";

// Candidate/reference-only rules, not the production combat algorithm or a proof verifier.
export const RULES = "veydrift-individual-shot-candidate-2";
const U256 = 1n << 256n;
export type Side = 0 | 1;
export interface Stats { attack: bigint; shield: bigint; hull: bigint }
export interface Technology { weapons: number; shielding: number; armor: number }
export interface CatalogEntry extends Stats { type: number }
export interface Group {
  side: Side; owner: string; source: string; type: number; count: number; technology: Technology;
}
export interface Input {
  seed: string; catalog: CatalogEntry[]; groups: Group[];
  rapidfire: { shooter: number; target: number; factor: number }[];
}
export interface Cohort extends Stats { side: Side; type: number; count: number; groups: Group[] }
export interface Unit { cohort: number; hull: bigint; shield: bigint }
export interface Round { round: number; survivors: number[]; shots: [bigint, bigint] }
export interface State {
  rules: typeof RULES; seed: string; counter: bigint; cohorts: Cohort[]; units: Unit[];
  rapidfire: Input["rapidfire"]; pools: [number[], number[]]; round: number; side: Side;
  shooter: number; shots: [bigint, bigint]; rounds: Round[]; done: boolean;
}
function integer(n: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error("invalid " + name);
}
function uint(n: bigint, name: string, nonzero = false) {
  if (typeof n !== "bigint" || n < (nonzero ? 1n : 0n) || n >= U256) throw new Error("invalid " + name);
}
export function effective(base: Stats, tech: Technology): Stats {
  for (const n of [tech.weapons, tech.shielding, tech.armor]) integer(n, 0, 65535, "technology");
  uint(base.attack, "attack"); uint(base.shield, "shield"); uint(base.hull, "hull", true);
  const scale = (n: bigint, level: number) => {
    const numerator = n * (10n + BigInt(level));
    if (numerator >= U256) throw new Error("stat multiplication overflow");
    return numerator / 10n;
  };
  return { attack: scale(base.attack, tech.weapons), shield: scale(base.shield, tech.shielding), hull: scale(base.hull, tech.armor) };
}
function compare(a: bigint | number | string, b: bigint | number | string) { return a < b ? -1 : a > b ? 1 : 0; }
function memberOrder(a: Group, b: Group) { return compare(a.owner, b.owner) || compare(BigInt(a.source), BigInt(b.source)); }

/** Host safety budget is NOT a gameplay cap: refusal produces no battle result. */
export function initialize(input: Input, maxExpandedUnits = 100_000): State {
  integer(maxExpandedUnits, 1, Number.MAX_SAFE_INTEGER, "host unit budget");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.seed)) throw new Error("seed must be bytes32");
  const catalog = new Map<number, CatalogEntry>();
  for (const c of input.catalog) {
    integer(c.type, 0, 65535, "type"); effective(c, { weapons: 0, shielding: 0, armor: 0 });
    if (catalog.has(c.type)) throw new Error("duplicate catalog type"); catalog.set(c.type, c);
  }
  const lanes = new Set<string>();
  for (const r of input.rapidfire) {
    integer(r.factor, 1, 65535, "rapidfire");
    if (!catalog.has(r.shooter) || !catalog.has(r.target)) throw new Error("unknown rapidfire type");
    const lane = r.shooter + ":" + r.target;
    if (lanes.has(lane)) throw new Error("duplicate rapidfire lane"); lanes.add(lane);
  }
  const map = new Map<string, Cohort>(); const identities = new Set<string>();
  const sources = new Map<string, string>(); const technologies = new Map<string, string>(); let total = 0;
  for (const original of input.groups) {
    const g = structuredClone(original); g.owner = g.owner.toLowerCase();
    integer(g.side, 0, 1, "side"); integer(g.count, 0, 0xffffffff, "count");
    if (!/^0x[0-9a-f]{40}$/.test(g.owner) || !/^(0|[1-9][0-9]*)$/.test(g.source) || BigInt(g.source) >= U256) throw new Error("invalid source identity");
    const identity = [g.side, g.owner, g.source, g.type].join(":");
    if (identities.has(identity)) throw new Error("duplicate group"); identities.add(identity);
    const base = catalog.get(g.type); if (!base) throw new Error("unknown type");
    const stats = effective(base, g.technology);
    const technology = [g.technology.weapons,g.technology.shielding,g.technology.armor].join(":");
    const source = [g.side,g.owner,technology].join(":");
    if (sources.has(g.source) && sources.get(g.source) !== source) throw new Error("inconsistent source membership");
    if (technologies.has(g.owner) && technologies.get(g.owner) !== technology) throw new Error("inconsistent frozen owner technology");
    sources.set(g.source,source); technologies.set(g.owner,technology);
    total += g.count;
    if (!Number.isSafeInteger(total) || total > maxExpandedUnits) throw new Error("host unit budget exceeded; battle incomplete");
    if (g.count === 0) continue;
    const key = [g.side, g.type, stats.attack, stats.shield, stats.hull].join(":");
    const cohort = map.get(key) ?? { ...stats, side: g.side, type: g.type, count: 0, groups: [] };
    cohort.count += g.count; cohort.groups.push(g); map.set(key, cohort);
  }
  const cohorts = [...map.values()].sort((a,b) => compare(a.side,b.side) || compare(a.type,b.type) || compare(a.attack,b.attack) || compare(a.shield,b.shield) || compare(a.hull,b.hull));
  const units: Unit[] = [];
  cohorts.forEach((c, i) => { c.groups.sort(memberOrder); for (let j = 0; j < c.count; j++) units.push({cohort:i, hull:c.hull, shield:c.shield}); });
  const state: State = { rules:RULES, seed:input.seed.toLowerCase(), counter:0n, cohorts, units, rapidfire:structuredClone(input.rapidfire), pools:[[],[]], round:0, side:0, shooter:0, shots:[0n,0n], rounds:[], done:false };
  startRound(state); return state;
}

/** SHA-256(domain UTF8 || seed32 || counter32 BE); rejection avoids modulo bias. */
export function uniform(state: Pick<State, "seed" | "counter">, bound: bigint): bigint {
  uint(bound, "draw bound", true);
  const limit = U256 - U256 % bound;
  for (;;) {
    if (state.counter >= U256) throw new Error("random stream exhausted; battle incomplete");
    const counter = state.counter++;
    const digest = createHash("sha256").update(RULES + ":random:").update(Buffer.from(state.seed.slice(2), "hex")).update(Buffer.from(counter.toString(16).padStart(64,"0"),"hex")).digest("hex");
    const word = BigInt("0x" + digest); if (word < limit) return word % bound;
  }
}

/** Exact damage; full-shield 1% bounce, no rounded shield buckets. */
export function hit(target: Unit, stats: Stats, attack: bigint, draw: (bound: bigint) => bigint): { bounced: boolean; exploded: boolean } {
  if (target.hull === 0n) return { bounced:false, exploded:false };
  if (target.shield > 0n && attack * 100n < stats.shield) return { bounced:true, exploded:false };
  const absorbed = attack < target.shield ? attack : target.shield;
  target.shield -= absorbed;
  const damage = attack - absorbed;
  target.hull = damage >= target.hull ? 0n : target.hull - damage;
  // Every non-bouncing positive-power hit can explode damaged hull, even through shields.
  // Zero power remains an explicit older-guide candidate choice (see the rules doc).
  if (target.hull === 0n || attack === 0n) return { bounced:false, exploded:false };
  const missing = stats.hull - target.hull;
  if (missing * 10n > stats.hull * 3n && draw(stats.hull) < missing) {
    target.hull = 0n; return { bounced:false, exploded:true };
  }
  return { bounced:false, exploded:false };
}
function startRound(s: State) {
  s.pools = [[],[]];
  s.units.forEach((u,i) => { if (u.hull > 0n) s.pools[s.cohorts[u.cohort]!.side].push(i); });
  if (!s.pools[0].length || !s.pools[1].length || s.round === 6) { s.done = true; return; }
  s.round++; s.side = 0; s.shooter = 0; s.shots = [0n,0n];
  for (const pool of s.pools) for (const i of pool) s.units[i]!.shield = s.cohorts[s.units[i]!.cohort]!.shield;
}
export function survivorCounts(s: State): number[] {
  const counts = s.cohorts.map(() => 0); for (const u of s.units) if (u.hull > 0n) counts[u.cohort]!++; return counts;
}
/** One operation is one physical shot, including each RF shot. No RF cap. */
export function advance(s: State, shotBudget: number): number {
  integer(shotBudget, 0, Number.MAX_SAFE_INTEGER, "shot budget");
  if (s.rules !== RULES) throw new Error("wrong rules");
  let used = 0;
  while (!s.done && used < shotBudget) {
    const shooter = s.units[s.pools[s.side][s.shooter]!]!;
    const source = s.cohorts[shooter.cohort]!;
    const targets = s.pools[(1-s.side) as Side];
    const target = s.units[targets[Number(uniform(s,BigInt(targets.length)))]!]!;
    const targetStats = s.cohorts[target.cohort]!;
    hit(target, targetStats, source.attack, n => uniform(s,n));
    used++; s.shots[s.side]++;
    const rf = s.rapidfire.find(r => r.shooter === source.type && r.target === targetStats.type)?.factor ?? 1;
    const again = rf > 1 && uniform(s,BigInt(rf)) !== 0n;
    if (again) continue;
    s.shooter++;
    if (s.shooter < s.pools[s.side].length) continue;
    if (s.side === 0) { s.side = 1; s.shooter = 0; continue; }
    s.rounds.push({round:s.round, survivors:survivorCounts(s), shots:[...s.shots]});
    startRound(s);
  }
  return used;
}
export interface Allocation { side: Side; owner: string; source: string; type: number; initial: number; lost: number; survivors: number }
export function result(s: State): { outcome: "attacker" | "defender" | "draw"; rounds: Round[]; allocation: Allocation[] } {
  if (!s.done) throw new Error("battle incomplete");
  const counts = survivorCounts(s); const allocation: Allocation[] = [];
  s.cohorts.forEach((c,i) => {
    const losses = BigInt(c.count - counts[i]!); const total = BigInt(c.count);
    const entries = c.groups.map(g => ({g, lost: Number(losses * BigInt(g.count) / total), rem: losses * BigInt(g.count) % total}));
    let remaining = Number(losses) - entries.reduce((n,e) => n+e.lost,0);
    entries.sort((a,b) => compare(b.rem,a.rem) || memberOrder(a.g,b.g));
    for (const e of entries) { if (remaining > 0) { e.lost++; remaining--; } }
    for (const e of entries) allocation.push({side:e.g.side,owner:e.g.owner,source:e.g.source,type:e.g.type,initial:e.g.count,lost:e.lost,survivors:e.g.count-e.lost});
  });
  allocation.sort((a,b) => compare(a.side,b.side) || compare(a.type,b.type) || compare(a.owner,b.owner) || compare(BigInt(a.source),BigInt(b.source)));
  const alive = [0,0]; counts.forEach((n,i) => alive[s.cohorts[i]!.side]! += n);
  const outcome = alive[0] && !alive[1] ? "attacker" : alive[1] && !alive[0] ? "defender" : "draw";
  return {outcome, rounds:structuredClone(s.rounds), allocation};
}
// Local trusted checkpoint transport, NOT authenticated or suitable as a proof witness validator.
export function checkpoint(s: State): string { return JSON.stringify(s, (_,v) => typeof v === "bigint" ? {bigint:v.toString()} : v); }
export function restore(checkpoint: string): State {
  const s = JSON.parse(checkpoint, (_,v) => v && typeof v === "object" && Object.keys(v).length === 1 && typeof v.bigint === "string" ? BigInt(v.bigint) : v) as State;
  if (s.rules !== RULES) throw new Error("wrong checkpoint rules"); return s;
}
