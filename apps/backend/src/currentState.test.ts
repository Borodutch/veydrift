import { afterEach, expect, test, setSystemTime } from "bun:test";
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "./indexer";
import { settleQueueAsOfNow } from "./asOfNow";
import { combatStageAdvancedTopic, shipQueueTimingSetTopic, shipQueuedTopic, type SettledPlanetEvent } from "./evm";
const owner = "0x2222222222222222222222222222222222222222" as const;
const planet = { planetId: "7", name: null, owner, galaxy: 2, system: 44, position: 9, fields: 100, temperature: 0, resources: { metal: "100", crystal: "200", deuterium: "300" }, lastSettledAt: "1000", blockNumber: "1", transactionHash: "0xp", eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000 } as SettledPlanetEvent;
afterEach(() => setSystemTime());
function fixture(kind: string) {
 const db = new Database(":memory:");
 const indexer = new SettlementIndexer({ async listSettledPlanetEvents(){return []}, async listDebrisFieldEvents(){return []}, async listMoonChanceReportEvents(){return []} }, 1n, { database: db, runStartupBackfill: false });
 indexer.applyEvent(planet);
 db.query("INSERT INTO contract_production_queues (queue_key,queue_kind,planet_id,owner,item_id,target_level,quantity,ready_at,started_at,original_quantity,unit_work_seconds,production_rate,metal_cost,crystal_cost,deuterium_cost,event_json) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)").run(kind+":7",kind,"7",owner,0,3,"1030","1000",3,"100","10","0","0","0","{}");
 return {db,indexer};
}
test.each(["ship", "defense", "moon-ship", "moon-defense"])("%s units appear once at each boundary on display and launch surfaces", kind => {
 const {indexer} = fixture(kind);
 for(const [at,count] of [[1009,0],[1010,1],[1020,2],[1030,3]]) {
  setSystemTime(new Date(at!*1000));
  if(kind.startsWith("moon")) {
   const state = indexer.moonState(owner,"7");
   const rows = kind === "moon-ship" ? state.ships : state.defenses;
   expect(rows.find(x=>x.id===0)?.count).toBe(count);
   if(kind === "moon-ship") expect(state.launchableShips?.find(x=>x.id===0)?.count).toBe(count);
  } else {
   const inventory = indexer.productionInventory("7",kind as "ship"|"defense",{shipyardLevel:1,naniteLevel:0});
   expect(inventory.rows[0]?.count).toBe(count); expect(inventory.launchable[0]?.count).toBe(count);
   expect(indexer.displayedUnitCounts("7",kind as "ship"|"defense")[0]?.count).toBe(count);
  }
 }
});
test("warm global and wallet fingerprints invalidate at each unit without events",()=>{
 const {indexer}=fixture("ship");
 setSystemTime(new Date(1009000)); const first=indexer.responseCacheVersion(), wallet=indexer.walletResponseCacheVersion(owner);
 setSystemTime(new Date(1010000)); expect(indexer.responseCacheVersion()).not.toBe(first); expect(indexer.walletResponseCacheVersion(owner)).not.toBe(wallet);
 const middle=indexer.responseCacheVersion(); setSystemTime(new Date(1020000)); expect(indexer.responseCacheVersion()).not.toBe(middle);
});
test("default activity updates one stable batch identity at each completion boundary",()=>{
 const {indexer}=fixture("ship");
 const first=indexer.playerActivity(owner,{page:1,pageSize:20,through:1010});
 const later=indexer.playerActivity(owner,{page:1,pageSize:20,through:1030});
 expect(first.items).toHaveLength(1);expect(later.items).toHaveLength(1);
 expect(later.items[0]?.id).toBe(first.items[0]?.id);
 expect(later.items[0]?.metadata.quantity).toBe(3);
 expect(later.items.map(x=>x.occurredAt)).toEqual(["1030"]);
 expect(indexer.playerActivity(owner,{page:1,pageSize:20,since:1010,through:1030}).items).toHaveLength(1);
});

test("partial and final settlement retain activity identity and reject duplicate logs",()=>{
 const {indexer}=fixture("ship");
 const before=indexer.playerActivity(owner,{page:1,pageSize:20,through:1030}).items;
 const topic=(n:bigint)=>"0x"+n.toString(16).padStart(64,"0");
 const log={blockNumber:"0x2",blockTimestamp:"0x410",transactionHash:"0xcomplete",logIndex:"0x0",topics:["0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785",topic(7n),topic(0n)],data:"0x"+topic(1n).slice(2)+topic(1n).slice(2)};
 indexer.applyLog(log);indexer.applyLog(log);
 const after=indexer.playerActivity(owner,{page:1,pageSize:20,through:1040}).items;
 expect(after.map(x=>x.id).sort()).toEqual(before.map(x=>x.id).sort());
 expect(indexer.shipRows("7")[0]?.count).toBe(3);
 const final = { ...log, transactionHash: "0xfinal", blockNumber: "0x3", data: "0x"+topic(2n).slice(2)+topic(3n).slice(2) };
 indexer.applyLog(final);
 expect(indexer.playerActivity(owner,{page:1,pageSize:20,through:1040}).items.map(x=>x.id).sort()).toEqual(before.map(x=>x.id).sort());
 expect(indexer.shipRows("7")[0]?.count).toBe(3);
 const settled=indexer.playerActivity(owner,{page:1,pageSize:20,through:1040}).items[0]!;
 expect(settled.occurredAt).toBe("1030"); expect(settled.metadata.quantity).toBe(3);
});
test.each(["building","research"])("%s only boundary invalidates global cache, Terraformer fields project once",kind=>{
 const {indexer,db}=fixture("ship");
 db.query("DELETE FROM contract_production_queues").run();
 db.query("INSERT INTO contract_production_queues (queue_key,queue_kind,planet_id,owner,item_id,target_level,quantity,ready_at,started_at,metal_cost,crystal_cost,deuterium_cost,event_json) VALUES (?,?,?,?,?,1,NULL,'1010','1000','0','0','0','{}')").run(kind+":"+(kind==="research"?owner:"7"),kind,"7",owner,kind==="building"?12:4);
 setSystemTime(new Date(1009000)); const version=indexer.responseCacheVersion();
 expect(indexer.planetFieldsAsOfNow("7")).toBe(100);
 setSystemTime(new Date(1010000));expect(indexer.responseCacheVersion()).not.toBe(version);
 if(kind==="building") expect(indexer.walletPlanets(owner).planets[0]?.fieldsCapacity).toBe(105);
 else expect(indexer.technologyLevels(owner)["4"]).toBe(1);
});

test("corrupt timing never falls back to whole-batch credit",()=>{
 for(const rate of ["0","-1","broken"]) {
  const result=settleQueueAsOfNow({active:true,kind:"ship",itemId:0,quantity:3,readyAt:"1030",cost:{metal:"0",crystal:"0",deuterium:"0"},productionTiming:{startedAt:"1000",originalQuantity:3,unitWorkSeconds:"100",rate}},2000);
  expect(result.completed).toEqual([]); expect(result.queue?.quantity).toBe(3);
 }
});

const topic = (n: bigint) => "0x" + n.toString(16).padStart(64,"0");
const words = (...ns: bigint[]) => "0x" + ns.map(n=>topic(n).slice(2)).join("");
function storedMission(indexer: SettlementIndexer, id="1", type=3) {
 const value = {missionId:id,statusId:1,missionTypeId:type,status:"Outbound",missionType:type===3?"Attack":"Transport",owner,originPlanetId:"7",targetPlanetId:"7",departureAt:"1000",arrivalAt:"1010",returnAt:"1020",fuelCost:"0",cargo:{metal:"8",crystal:"0",deuterium:"0"},randomnessRequestId:null,originIsMoon:false,targetIsMoon:false,ships:{smallCargo:"9"}};
 (indexer as any).upsertCanonicalFleetMission(value);
 return value;
}
test("scalar Returning refresh cannot certify retained launch ships as survivors",()=>{
 const {indexer}=fixture("ship"); setSystemTime(new Date(1030000));
 const launch=storedMission(indexer);
 const {ships, ...scalar}=launch;
 (indexer as any).upsertCanonicalFleetMission({...scalar,statusId:2,status:"Returning"});
 expect(indexer.currentFleetResourceCredits("7",false)).toEqual({metal:"0",crystal:"0",deuterium:"0"});
 expect(indexer.fleetMission("1")?.status).toBe("Returning");
 const {indexer:proven}=fixture("ship");
 (proven as any).upsertCanonicalFleetMission({...launch,statusId:2,status:"Returning",ships:{smallCargo:"2"}});
 expect(proven.currentFleetResourceCredits("7",false).metal).toBe("8");
 expect(proven.displayedUnitCounts("7","ship")[0]?.count).toBe(5);
});
test("deterministic lifecycle agrees across active archive detail and slots",()=>{
 const {indexer}=fixture("ship"); storedMission(indexer,"1",0);
 setSystemTime(new Date(1010000));
 expect(indexer.fleetMission("1")?.status).toBe("Returning");
 expect(indexer.allActiveFleetMissions()[0]?.status).toBe("Returning");
 expect(indexer.fleetSlots(owner).active).toBe(1);
 setSystemTime(new Date(1020000));
 expect(indexer.fleetMission("1")?.status).toBe("Returned");
 expect(indexer.allActiveFleetMissions()).toHaveLength(0);
 expect(indexer.allCompletedFleetMissions().map(m=>m.missionId)).toEqual(["1"]);
 expect(indexer.fleetMissionVisibility(owner).completedMissions.map(m=>m.missionId)).toEqual(["1"]);
 expect(indexer.fleetSlots(owner).active).toBe(0);
});
test("large production activity stays one batch",()=>{
 const {indexer,db}=fixture("ship");
 db.query("UPDATE contract_production_queues SET quantity=1000000000,original_quantity=1000000000").run();
 expect(indexer.playerActivity(owner,{page:1,pageSize:1,through:1030}).items).toHaveLength(1);
 expect(indexer.playerActivity(owner,{page:1,pageSize:1,through:1030}).items[0]?.metadata.quantity).toBe(1000000000);
});

test("indexed staged lock covers moon target across every nonterminal combat phase",()=>{
 for(const phase of [1,12,14,15,13]) {
  const {indexer,db}=fixture("ship"); db.query("DELETE FROM contract_production_queues").run();
  storedMission(indexer,"9");
  const arrival=storedMission(indexer,"1",0);
  (indexer as any).upsertCanonicalFleetMission({...arrival,targetIsMoon:true});
  indexer.applyLog({blockNumber:"0x2",blockTimestamp:topic(1005n),transactionHash:"0xstage",logIndex:"0x0",topics:[combatStageAdvancedTopic,topic(9n)],data:words(BigInt(phase),1n,0n)});
  setSystemTime(new Date(1010000));
  // Canonical snapshot lacks launch provenance: install an older known moon for this fixture.
  (indexer as any).moon = () => ({owner,blockNumber:"0"});
  // A missing launch anchor must itself fail closed; use a canonical anchor for this seeded fixture.
  (indexer as any).setMetadata("lastReconciledBlock","2");
  expect(indexer.currentFleetResourceCredits("7",true).metal).toBe(phase===13?"8":"0");
 }
});
test("explicit modern timing is preserved even when its numbers match old synthetic timing",()=>{
 const {indexer,db}=fixture("ship");db.query("DELETE FROM contract_production_queues").run();
 indexer.applyLog({blockNumber:"0x2",blockTimestamp:topic(1000n),transactionHash:"0xmodern",logIndex:"0x0",topics:[shipQueuedTopic,topic(7n),topic(0n)],data:words(3n,1030n,0n,0n,0n)});
 indexer.applyLog({blockNumber:"0x2",blockTimestamp:topic(1000n),transactionHash:"0xmodern",logIndex:"0x1",topics:[shipQueueTimingSetTopic,topic(7n),topic(0n),topic(1030n)],data:words(1000n,3n,30n,3n)});
 setSystemTime(new Date(1010000));expect(indexer.displayedUnitCounts("7","ship")[0]?.count).toBe(1);
});
test("legacy retained batch never invents rounded per-unit timing",()=>{
 const {indexer,db}=fixture("ship");db.query("DELETE FROM contract_production_queues").run();
 indexer.applyLog({blockNumber:"0x2",blockTimestamp:topic(1000n),transactionHash:"0xlegacy",logIndex:"0x0",topics:[shipQueuedTopic,topic(7n),topic(0n)],data:words(3n,1031n,0n,0n,0n)});
 setSystemTime(new Date(1029000)); expect(indexer.displayedUnitCounts("7","ship")[0]?.count).toBe(0);
 setSystemTime(new Date(1031000)); expect(indexer.displayedUnitCounts("7","ship")[0]?.count).toBe(3);
});
test("historical queue replay preserves batch identity after queue removal and restart",()=>{
 const {indexer,db}=fixture("ship");db.query("DELETE FROM contract_production_queues").run();
 indexer.applyLog({blockNumber:"0x2",blockTimestamp:topic(1000n),transactionHash:"0xlegacy",logIndex:"0x0",topics:[shipQueuedTopic,topic(7n),topic(0n)],data:words(3n,1031n,0n,0n,0n)});
 const before=indexer.playerActivity(owner,{page:1,pageSize:20,through:1031}).items.find(i=>i.kind==="ship-completed")!;
 indexer.applyLog({blockNumber:"0x3",blockTimestamp:topic(1040n),transactionHash:"0xdone",logIndex:"0x0",topics:["0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785",topic(7n),topic(0n)],data:words(3n,3n)});
 (indexer as any).backfillPlayerActivityFeed();
 const after=indexer.playerActivity(owner,{page:1,pageSize:20,through:1040}).items.find(i=>i.kind==="ship-completed")!;
 expect(after.id).toBe(before.id);expect(after.occurredAt).toBe("1031");expect(after.metadata.quantity).toBe(3);
});
