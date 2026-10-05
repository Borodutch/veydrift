// Offline importer for the independently collected planet-1 audit, not a live indexer.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.argv[2];
if (!root) throw new Error("usage: bun packages/battle-oracle/import-historical.ts AUDIT_DIRECTORY");
const read = (p:string) => readFileSync(join(root,p),"utf8");
const sha = (s:string) => createHash("sha256").update(s).digest("hex");
const frozenText = read("deployed/historical-research-storage.json");
const frozen = JSON.parse(frozenText);
const prior = JSON.parse(read("simulation/inputs.json"));
const fixtures = [];
for (const id of ["97808","97839","97876","97881"]) {
  const text = read("mission-"+id+".json"); const {battleReport:b} = JSON.parse(text);
  assert.equal(b.missionId,id); assert.equal(b.targetPlanetId,"1"); assert.equal(b.targetIsMoon,false);
  assert.equal(b.stagedEvidence.complete,true);
  const research = frozen.find((f:any)=>f.id===id); assert.ok(research);
  const groups = b.stagedEvidence.members.flatMap((m:any)=>{
    const t = research.owners[m.owner].frozenDecoded; assert.equal(t.captured,true);
    const technology={weapons:t.weapons,shielding:t.shielding,armor:t.armor};
    const old = prior.find((p:any)=>p.id===id);
    const p = m.side===0 ? old.attackers.find((a:any)=>a.id===m.missionId) : old.defender;
    assert.equal(m.owner,p.owner); assert.deepEqual(technology,p.technology);
    // Compare every enrolled lane to the source-audited old reference input, including zero lanes.
    const manifest=[...p.ships,...(m.side===1?p.defenses:[])];
    for(let type=0;type<manifest.length;type++) assert.equal(m.units.find((u:any)=>u.unit===type)?.starting??0,manifest[type]);
    return m.units.map((u:any)=>({side:m.side,owner:m.owner,source:m.missionId,type:u.unit,count:u.starting,technology}));
  });
  const seed="0x"+BigInt(b.randomSeed).toString(16).padStart(64,"0"); assert.equal(seed,prior.find((p:any)=>p.id===id).seed);
  fixtures.push({id,seed,groups,evidence:{chainId:8453,game:"0xf397910F005151b09644228573a4353818D3755d",planetId:1,targetIsMoon:false,impactBlock:research.impactBlock,resolvedBlock:research.finalBlock,receipt:b.transactionHash,sourceSha256:sha(text),frozenResearchSha256:sha(frozenText),oldOutcome:b.outcome,oldRounds:b.rounds}});
}
writeFileSync(new URL("./fixtures/planet1.json",import.meta.url),JSON.stringify(fixtures,null,2));
console.log("Verified and imported four frozen historical rosters and seeds");
