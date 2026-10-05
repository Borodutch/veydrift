import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { advance, checkpoint, effective, hit, initialize, restore, result, RULES, uniform, type Input, type Group, type State } from "./oracle";
const seed = "0x" + "01".repeat(32);
const owner = (n: number) => "0x" + n.toString(16).padStart(40,"0");
const tech = {weapons:0,shielding:0,armor:0};
const group = (side: 0|1, type: number, count=1, source=String(side+1)): Group => ({side,type,count,source,owner:owner(side+1),technology:{...tech}});
const base = (attack:bigint,shield=0n,hull=100n) => ({attack,shield,hull});
const input = (): Input => ({seed,catalog:[{type:0,...base(21n,10n,300n)},{type:1,...base(31n,10n,400n)}],groups:[group(0,0,7),group(1,1,8)],rapidfire:[]});
function finish(s:State,chunk=1000): State { let shots=0; while(!s.done) {shots+=advance(s,chunk); if(shots>1_000_000) throw new Error("test host shot budget; incomplete");} return s; }
const noExplosion = (bound:bigint) => bound-1n;

test("exact overlapping hull damage persists across hits", () => {
  const u={cohort:0,hull:100n,shield:20n};
  hit(u,base(0n,20n),35n,noExplosion); expect(u).toEqual({cohort:0,hull:85n,shield:0n});
  hit(u,base(0n,20n),35n,noExplosion); expect(u.hull).toBe(50n);
  hit(u,base(0n,20n),1000n,()=>{throw Error("overkill must not draw");}); expect(u.hull).toBe(0n);
});
test("strict greater-than 30 percent and exact explosion probability", () => {
  const u={cohort:0,hull:100n,shield:0n}; let draws=0;
  hit(u,base(0n),30n,()=>{draws++;return 0n;}); expect(draws).toBe(0); expect(u.hull).toBe(70n);
  hit(u,base(0n),1n,n=>{expect(n).toBe(100n);draws++;return 31n;}); expect(u.hull).toBe(69n); expect(draws).toBe(1);
  hit(u,base(0n),1n,()=>31n); expect(u.hull).toBe(0n);
});
test("bounce threshold is full shield, strict and no health buckets", () => {
  const stats=base(0n,1000n,1000n); const u={cohort:0,hull:1000n,shield:11n};
  expect(hit(u,stats,9n,noExplosion).bounced).toBe(true); expect(u.shield).toBe(11n);
  hit(u,stats,10n,noExplosion); expect(u.shield).toBe(1n);
  hit(u,stats,11n,noExplosion); expect(u.hull).toBe(990n); expect(u.shield).toBe(0n);
  hit(u,stats,9n,noExplosion); expect(u.hull).toBe(981n);
});
test("shield-only hits never explode previously damaged hull", () => {
  const u={cohort:0,hull:40n,shield:100n}; hit(u,base(0n,100n),20n,()=>{throw Error("unexpected explosion draw");});
  expect(u.hull).toBe(40n); expect(u.shield).toBe(80n);
});
test("integer tech scaling and each owner's independent W/S/A", () => {
  expect(effective(base(11n,13n,19n),{weapons:1,shielding:2,armor:3})).toEqual(base(12n,15n,24n));
  const i=input(); i.groups.push({...group(0,0,1,"3"),owner:owner(3),technology:{weapons:2,shielding:3,armor:4}});
  const s=initialize(i); expect(s.cohorts.filter(c=>c.side===0).map(c=>[c.attack,c.shield,c.hull])).toEqual([[21n,10n,300n],[25n,13n,420n]]);
});
test("simultaneous round eligibility permits killed defender's shot", () => {
  const i=input(); i.catalog=[{type:0,...base(100n)},{type:1,...base(100n)}]; i.groups=[group(0,0),group(1,1)];
  const s=initialize(i); advance(s,1); expect(s.units[1]!.hull).toBe(0n); expect(s.done).toBe(false);
  advance(s,1); expect(result(s).outcome).toBe("draw"); expect(s.rounds[0]!.shots).toEqual([1n,1n]);
});
test("shield resets only at round boundary, hull never resets", () => {
  const i=input(); i.catalog=[{type:0,...base(20n,10n,1000n)},{type:1,...base(20n,10n,1000n)}]; i.groups=[group(0,0),group(1,1)];
  const s=initialize(i); advance(s,1); expect(s.units[1]!.shield).toBe(0n); expect(s.units[1]!.hull).toBe(990n);
  advance(s,1); expect(s.round).toBe(2); expect(s.units.map(u=>u.shield)).toEqual([10n,10n]); expect(s.units.map(u=>u.hull)).toEqual([990n,990n]);
  finish(s); expect(s.rounds.length).toBe(6); expect(s.units.map(u=>u.hull)).toEqual([940n,940n]);
});
test("restart and arbitrary shot chunks retain all stream and RF state", () => {
  const i=input(); i.rapidfire=[{shooter:0,target:1,factor:20},{shooter:1,target:0,factor:5}];
  const reference=finish(initialize(i));
  for(const chunk of [1,2,3,11,71]) {
    let s=initialize(i); let steps=0;
    while(!s.done) {advance(s,chunk); s=restore(checkpoint(s)); if(++steps>10000) throw Error("test budget");}
    expect(checkpoint(s)).toBe(checkpoint(reference));
  }
});
test("zero-step and terminal resumes are no-ops; pending has no result", () => {
  const s=initialize(input()); const before=checkpoint(s); expect(advance(s,0)).toBe(0); expect(checkpoint(s)).toBe(before); expect(()=>result(s)).toThrow("incomplete");
  finish(s); const after=checkpoint(s); expect(advance(s,100)).toBe(0); expect(checkpoint(s)).toBe(after);
});
test("same-tech partitions, owner/IDs and ordering never affect combat", () => {
  for(let n=0;n<16;n++) {
    const i=input(); i.seed="0x"+n.toString(16).padStart(64,"0"); i.rapidfire=[{shooter:0,target:1,factor:5}];
    const a=finish(initialize(i));
    const split=structuredClone(i); split.groups=[{...group(1,1,3,"999"),owner:owner(5)},group(0,0,2,"222"),group(1,1,5,"2"),{...group(0,0,5,"333"),owner:owner(99)}];
    const b=finish(initialize(split)); expect(b.rounds).toEqual(a.rounds); expect(b.counter).toBe(a.counter); expect(b.units).toEqual(a.units);
    const rows=result(b).allocation; expect(rows.reduce((n,e)=>n+e.lost,0)).toBe(b.units.filter(u=>u.hull===0n).length);
    for(const row of rows) {expect(row.lost).toBeGreaterThanOrEqual(0);expect(row.survivors+row.lost).toBe(row.initial);expect(row.survivors).toBeGreaterThanOrEqual(0);}
  }
});
test("target-dependent RF is not capped at 64, and chunks don't truncate", () => {
  const i=input(); i.catalog=[{type:0,...base(0n)},{type:1,...base(0n)}]; i.groups=[group(0,0),group(1,1)]; i.rapidfire=[{shooter:0,target:1,factor:1250}];
  const s=initialize(i); advance(s,100); expect(s.done).toBe(false); expect(s.shots[0]).toBeGreaterThan(64n);
  const completed=finish(s); expect(completed.rounds.some(r=>r.shots[0]>64n)).toBe(true); expect(completed.rounds.every(r=>r.shots[1]===1n)).toBe(true);
});
test("independent target sampling permits repeated hits, not balanced allocation", () => {
  const i=input(); i.catalog=[{type:0,...base(1n,0n,1000n)},{type:1,...base(0n,0n,1000n)}]; i.groups=[group(0,0,10),group(1,1,10)];
  const s=initialize(i); advance(s,10); const remaining=s.units.slice(10).map(u=>u.hull);
  expect(new Set(remaining).size).toBeGreaterThan(1); expect(remaining.reduce((n,h)=>n+1000n-h,0n)).toBe(10n);
});
test("uniform stream uses big endian counters and rejection sampling", () => {
  const s={seed,counter:0n}; const bound=(1n<<255n)+1n; let counter=0n; let expected=0n; let rejected=0;
  for(let k=0;k<20;k++) {
    for(;;) {
      const hash=createHash("sha256").update(RULES+":random:").update(Buffer.from(seed.slice(2),"hex")).update(Buffer.from((counter++).toString(16).padStart(64,"0"),"hex")).digest("hex");
      const word=BigInt("0x"+hash); if(word<bound) {expected=word;break;} rejected++;
    }
    expect(uniform(s,bound)).toBe(expected); expect(s.counter).toBe(counter);
  }
  expect(rejected).toBeGreaterThan(0);
});
test("invalid counts, identity, stats, tech and operational budgets fail closed", () => {
  for(const count of [-1,0.5,0x100000000,NaN]) {const i=input();i.groups[0]!.count=count;expect(()=>initialize(i)).toThrow();}
  const duplicate=input();duplicate.groups.push(duplicate.groups[0]!);expect(()=>initialize(duplicate)).toThrow("duplicate");
  const overflow=input();overflow.catalog[0]!.hull=1n<<255n;expect(()=>initialize(overflow)).toThrow("overflow");
  const badTech=input();badTech.groups[0]!.technology.armor=65536;expect(()=>initialize(badTech)).toThrow("technology");
  expect(()=>initialize(input(),1)).toThrow("host unit budget");
  expect(()=>initialize({...input(),seed:"0x01"})).toThrow("bytes32");
  expect(()=>uniform({seed,counter:1n<<256n},2n)).toThrow("exhausted");
});
test("empty side resolves without a fabricated round", () => {
  const i=input();i.groups=i.groups.filter(g=>g.side===1);const s=initialize(i);expect(result(s).outcome).toBe("defender");expect(s.rounds).toEqual([]);
  i.groups=[];expect(result(initialize(i)).outcome).toBe("draw");
});


test("zero-power damage draws no explosion, even below 70 percent hull", () => {
  const u={cohort:0,hull:40n,shield:0n}; hit(u,base(0n),0n,()=>{throw Error("zero power cannot explode");}); expect(u.hull).toBe(40n);
});
test("dead targets stay in round pool, absorb overkill and permit type RF", () => {
  const i=input(); i.catalog=[{type:0,...base(100n)},{type:1,...base(0n)}]; i.groups=[group(0,0),group(1,1)]; i.rapidfire=[{shooter:0,target:1,factor:1250}];
  const s=initialize(i); advance(s,100); expect(s.units[1]!.hull).toBe(0n); expect(s.shots[0]).toBe(100n); expect(s.counter).toBe(200n); expect(s.done).toBe(false);
  finish(s); expect(s.rounds.length).toBe(1); expect(s.rounds[0]!.shots[1]).toBe(1n);
});
test("owner-specific shields and armor alter actual per-unit hit survival", () => {
  const original=base(100n,100n,100n);
  const a=effective(original,{weapons:1,shielding:0,armor:0});
  const b=effective(original,{weapons:0,shielding:1,armor:1});
  const u={cohort:0,hull:original.hull,shield:original.shield}; const v={cohort:1,hull:b.hull,shield:b.shield};
  hit(u,original,a.attack,noExplosion); hit(v,b,a.attack,noExplosion);
  expect(u.hull).toBe(90n); expect(v.hull).toBe(110n);
});
test("source membership and frozen owner tech cannot conflict", () => {
  const wrongSource=input(); wrongSource.groups[1]!.source=wrongSource.groups[0]!.source; expect(()=>initialize(wrongSource)).toThrow("source");
  const wrongOwner=input(); wrongOwner.groups.push({...group(0,0,1,"3"),technology:{weapons:1,shielding:0,armor:0}}); expect(()=>initialize(wrongOwner)).toThrow("technology");
});
test("largest remainder attribution conserves losses and numeric source tie-break", () => {
  const i=input();i.groups=[group(0,0,2,"10"),group(0,0,2,"2"),group(0,0,1,"20")];
  const s=initialize(i); s.units[0]!.hull=0n; s.units[1]!.hull=0n;
  // Pure attribution fixture: terminal state manufactured here, not a valid combat trace.
  const allocation=result(s).allocation; expect(allocation.map(a=>[a.source,a.lost])).toEqual([["2",1],["10",1],["20",0]]);
  s.units[1]!.hull=300n; expect(result(s).allocation.map(a=>[a.source,a.lost])).toEqual([["2",1],["10",0],["20",0]]);
});
