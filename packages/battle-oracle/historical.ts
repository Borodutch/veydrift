import catalogData from "./fixtures/catalog.json";
import fixtures from "./fixtures/planet1.json";
import { advance, initialize, result, RULES, type Group, type Input } from "./oracle";
export const catalog = [...catalogData.ships.map(c=>({...c,type:c.id})), ...catalogData.defenses.map(c=>({...c,type:c.id+16}))].map(c=>({type:c.type,attack:BigInt(c.attack),shield:BigInt(c.shield),hull:BigInt(c.hull)}));
export const rapidfire = [...catalogData.shipRapidfire.map(r=>({shooter:r.attacker,target:r.defender,factor:r.value})),...catalogData.defenseRapidfire.map(r=>({shooter:r.attacker,target:r.defender+16,factor:r.value}))];
export function historicalInputs(): (Input & {id:string})[] { return fixtures.map(f=>({id:f.id,seed:f.seed,groups:f.groups as Group[],catalog,rapidfire})); }
export function replay() {
  return historicalInputs().map(input=>{
    const s=initialize(input); let shots=0;
    while(!s.done) { shots+=advance(s,10000); if(shots>1_000_000) throw Error("host shot budget exceeded; no result"); }
    const r=result(s);
    return {id:input.id,rules:RULES,seed:input.seed,outcome:r.outcome,physicalShots:shots,randomWords:s.counter.toString(),rounds:r.rounds.map(round=>({round:round.round,shots:round.shots.map(String),attackerSurvivors:round.survivors.reduce((n,c,i)=>n+(s.cohorts[i]!.side===0?c:0),0),defenderSurvivors:round.survivors.reduce((n,c,i)=>n+(s.cohorts[i]!.side===1?c:0),0)})),allocation:r.allocation};
  });
}
if(import.meta.main) console.log(JSON.stringify(replay(),null,2));
