// Offline importer for the independently collected planet-1 audit, not a live indexer.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { Group, Side, Technology } from "./oracle";

interface Source { id: string; owner: string; ships: number[]; technology: Technology }
export interface PriorBattle { id: string; seed: string; attackers: Source[]; defender: Source & { defenses: number[] } }
export interface BattleReport {
  missionId: string; targetPlanetId: string; targetIsMoon: boolean; randomSeed: string;
  transactionHash: string; outcome: unknown; rounds: unknown;
  stagedEvidence: { complete: boolean; members: { side: Side; owner: string; missionId: string; units: { unit: number; starting: number }[] }[] };
}
export interface Research {
  id: string; impactBlock: number; finalBlock: number;
  owners: Record<string, { frozenDecoded: Technology & { captured: boolean } }>;
}
export const historicalIds = ["97808","97839","97876","97881"];
const sha = (s:string) => createHash("sha256").update(s).digest("hex");

/** Pure validation: completeness comes from matching both rosters, not the evidence flag. */
export function validateHistoricalGroups(b: BattleReport, old: PriorBattle, research: Research): Group[] {
  assert.equal(b.missionId,old.id); assert.equal(research.id,old.id);
  assert.equal(b.targetPlanetId,"1"); assert.equal(b.targetIsMoon,false);
  assert.equal(b.stagedEvidence.complete,true);
  assert.ok(old.attackers.length > 0,"missing reference attackers");
  const expected = new Map<string, { side: Side; source: Source; manifest: number[] }>();
  for (const [side, sources] of [[0,old.attackers],[1,[old.defender]]] as const) {
    for (const source of sources) {
      assert.ok(!expected.has(source.id),"duplicate reference source");
      assert.equal(source.ships.length,16,"reference ship lanes");
      if (side === 1) assert.equal(old.defender.defenses.length,8,"reference defense lanes");
      const manifest = [...source.ships,...(side === 1 ? old.defender.defenses : [])];
      for (const count of manifest) assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 0xffffffff,"invalid reference count");
      expected.set(source.id,{side,source,manifest});
    }
  }
  const seen = new Set<string>(); const groups: Group[] = [];
  for (const m of b.stagedEvidence.members) {
    const p = expected.get(m.missionId); assert.ok(p,"unexpected source");
    assert.ok(!seen.has(m.missionId),"duplicate source"); seen.add(m.missionId);
    assert.equal(m.side,p.side,"source side mismatch"); assert.equal(m.owner,p.source.owner,"source owner mismatch");
    const t = research.owners[m.owner]?.frozenDecoded; assert.ok(t,"missing frozen research"); assert.equal(t.captured,true);
    const technology = {weapons:t.weapons,shielding:t.shielding,armor:t.armor};
    assert.deepEqual(technology,p.source.technology);
    const lanes = new Map<number,number>();
    for (const u of m.units) {
      assert.ok(Number.isSafeInteger(u.unit) && u.unit >= 0 && u.unit < p.manifest.length,"unexpected unit lane");
      assert.ok(!lanes.has(u.unit),"duplicate unit lane");
      assert.equal(u.starting,p.manifest[u.unit],"source lane count mismatch");
      lanes.set(u.unit,u.starting);
      groups.push({side:m.side,owner:m.owner,source:m.missionId,type:u.unit,count:u.starting,technology});
    }
    // The archived format is sparse: absent zero lanes are valid, absent nonzero lanes are not.
    for (let type=0;type<p.manifest.length;type++) assert.equal(lanes.get(type) ?? 0,p.manifest[type],"missing source lane");
  }
  assert.equal(seen.size,expected.size,"missing source member");
  return groups;
}

/** Reads/validates every battle before the CLI is permitted to write any output. */
export function buildHistoricalFixtures(read: (path:string)=>string) {
  const frozenText = read("deployed/historical-research-storage.json");
  const frozen: Research[] = JSON.parse(frozenText);
  const prior: PriorBattle[] = JSON.parse(read("simulation/inputs.json"));
  return historicalIds.map(id=>{
    const text = read("mission-"+id+".json"); const {battleReport:b}: {battleReport:BattleReport} = JSON.parse(text);
    const captures = frozen.filter(f=>f.id===id); assert.equal(captures.length,1,"missing/duplicate research battle");
    const originals = prior.filter(p=>p.id===id); assert.equal(originals.length,1,"missing/duplicate reference battle");
    const research=captures[0]!; const old=originals[0]!;
    assert.equal(b.missionId,id);
    const groups=validateHistoricalGroups(b,old,research);
    const seed="0x"+BigInt(b.randomSeed).toString(16).padStart(64,"0"); assert.equal(seed,old.seed);
    return {id,seed,groups,evidence:{chainId:8453,game:"0xf397910F005151b09644228573a4353818D3755d",planetId:1,targetIsMoon:false,impactBlock:research.impactBlock,resolvedBlock:research.finalBlock,receipt:b.transactionHash,sourceSha256:sha(text),frozenResearchSha256:sha(frozenText),oldOutcome:b.outcome,oldRounds:b.rounds}};
  });
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("usage: bun packages/battle-oracle/import-historical.ts AUDIT_DIRECTORY");
  const fixtures=buildHistoricalFixtures(p=>readFileSync(join(root,p),"utf8"));
  writeFileSync(new URL("./fixtures/planet1.json",import.meta.url),JSON.stringify(fixtures,null,2));
  console.log("Verified and imported four frozen historical rosters and seeds");
}
