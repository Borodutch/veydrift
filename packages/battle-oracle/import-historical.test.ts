import { expect, test } from "bun:test";
import { buildHistoricalFixtures, historicalIds, validateHistoricalGroups, type BattleReport, type PriorBattle, type Research } from "./import-historical";

function fixture(id="97808") {
  const technology={weapons:1,shielding:2,armor:3};
  const owner=(n:number)=>"0x"+String(n).padStart(40,"0");
  const ships=()=>[5,...Array<number>(15).fill(0)];
  const old: PriorBattle={id,seed:"0x"+"0".repeat(63)+"1",attackers:[{id,owner:owner(1),ships:ships(),technology},{id:"999",owner:owner(2),ships:ships(),technology}],defender:{id:"0",owner:owner(3),ships:ships(),defenses:[2,...Array<number>(7).fill(0)],technology}};
  const b: BattleReport={missionId:id,targetPlanetId:"1",targetIsMoon:false,randomSeed:"1",transactionHash:"0x"+"ab".repeat(32),outcome:"attacker",rounds:2,stagedEvidence:{complete:true,members:[...old.attackers.map(a=>({missionId:a.id,owner:a.owner,side:0 as const,units:[{unit:0,starting:5}]})),{missionId:"0",owner:old.defender.owner,side:1,units:[{unit:0,starting:5},{unit:16,starting:2}]}]}};
  const research: Research={id,impactBlock:1,finalBlock:2,owners:Object.fromEntries([...old.attackers,old.defender].map(s=>[s.owner,{frozenDecoded:{...technology,captured:true}}]))};
  return {b,old,research};
}
function validate(f:ReturnType<typeof fixture>) { return validateHistoricalGroups(f.b,f.old,f.research); }

test("pure importer accepts complete sparse rosters and explicit zero lanes without mutating input",()=>{
  const f=fixture(); f.b.stagedEvidence.members[0]!.units.push({unit:1,starting:0});
  const before=structuredClone(f); const groups=validate(f);
  expect(groups.length).toBe(5); expect(f).toEqual(before);
  f.b.stagedEvidence.members.reverse(); for(const m of f.b.stagedEvidence.members) m.units.reverse();
  expect(validate(f)).toHaveLength(5);
});
test("complete flag cannot conceal missing ACS attacker, defender, or all members",()=>{
  for (const index of [0,1,2]) { const f=fixture(); f.b.stagedEvidence.members.splice(index,1); expect(()=>validate(f)).toThrow("missing source member"); }
  const f=fixture(); f.b.stagedEvidence.members=[]; expect(()=>validate(f)).toThrow("missing source member");
});
test("exact source, owner and side identity includes resident defender source",()=>{
  for (const index of [0,2]) {
    const source=fixture(); source.b.stagedEvidence.members[index]!.missionId="123"; expect(()=>validate(source)).toThrow("unexpected source");
    const owner=fixture(); owner.b.stagedEvidence.members[index]!.owner=owner.old.attackers[1]!.owner; expect(()=>validate(owner)).toThrow("source owner mismatch");
    const side=fixture(); side.b.stagedEvidence.members[index]!.side=index===0?1:0; expect(()=>validate(side)).toThrow("source side mismatch");
  }
});
test("extra or duplicate members and duplicate reference sources are rejected",()=>{
  const extra=fixture(); extra.b.stagedEvidence.members.push({...extra.b.stagedEvidence.members[0]!,missionId:"123"}); expect(()=>validate(extra)).toThrow("unexpected source");
  const duplicate=fixture(); duplicate.b.stagedEvidence.members.push(duplicate.b.stagedEvidence.members[0]!); expect(()=>validate(duplicate)).toThrow("duplicate source");
  const reference=fixture(); reference.old.attackers.push(reference.old.attackers[0]!); expect(()=>validate(reference)).toThrow("duplicate reference source");
});
test("source lane coverage rejects omissions, count substitutions and duplicates including zero lanes",()=>{
  for (const index of [0,2]) {
    const missing=fixture(); missing.b.stagedEvidence.members[index]!.units.pop(); expect(()=>validate(missing)).toThrow("missing source lane");
    const empty=fixture(); empty.b.stagedEvidence.members[index]!.units=[]; expect(()=>validate(empty)).toThrow("missing source lane");
    const count=fixture(); count.b.stagedEvidence.members[index]!.units[0]!.starting++; expect(()=>validate(count)).toThrow("source lane count mismatch");
    const duplicate=fixture(); const m=duplicate.b.stagedEvidence.members[index]!; m.units.push(m.units[0]!); expect(()=>validate(duplicate)).toThrow("duplicate unit lane");
  }
  const zero=fixture(); zero.b.stagedEvidence.members[0]!.units.push({unit:1,starting:0},{unit:1,starting:0}); expect(()=>validate(zero)).toThrow("duplicate unit lane");
  const extra=fixture(); extra.b.stagedEvidence.members[0]!.units.push({unit:1,starting:1}); expect(()=>validate(extra)).toThrow("source lane count mismatch");
});
test("unexpected or malformed lanes are rejected even with zero starting count",()=>{
  for (const [index,unit] of [[0,16],[2,24],[0,-1],[0,0.5],[0,NaN]]) {
    const f=fixture(); f.b.stagedEvidence.members[index!]!.units.push({unit:unit!,starting:0}); expect(()=>validate(f)).toThrow("unexpected unit lane");
  }
});
test("batch builder returns nothing on a final-battle omission; validation has no write path",()=>{
  const cases=historicalIds.map(id=>fixture(id));
  const files: Record<string,string>={
    "deployed/historical-research-storage.json":JSON.stringify(cases.map(f=>f.research)),
    "simulation/inputs.json":JSON.stringify(cases.map(f=>f.old)),
    ...Object.fromEntries(cases.map(f=>["mission-"+f.b.missionId+".json",JSON.stringify({battleReport:f.b})]))
  };
  expect(buildHistoricalFixtures(p=>files[p]!)).toHaveLength(4);
  cases[3]!.b.stagedEvidence.members=[];
  files["mission-97881.json"]=JSON.stringify({battleReport:cases[3]!.b});
  let output:unknown="unchanged"; const reads:string[]=[];
  expect(()=>{output=buildHistoricalFixtures(p=>{reads.push(p);return files[p]!;});}).toThrow("missing source member");
  expect(reads.at(-1)).toBe("mission-97881.json"); expect(output).toBe("unchanged");
});
