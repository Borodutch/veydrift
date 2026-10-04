import { afterEach, expect, test, setSystemTime } from "bun:test";
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "./indexer";
import { settleQueueAsOfNow } from "./asOfNow";
import type { SettledPlanetEvent } from "./evm";
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
test("default activity uses stable per-unit identities and completion times for incremental reads",()=>{
 const {indexer}=fixture("ship");
 const first=indexer.playerActivity(owner,{page:1,pageSize:20,through:1010});
 const later=indexer.playerActivity(owner,{page:1,pageSize:20,through:1030});
 expect(first.items).toHaveLength(1);expect(later.items).toHaveLength(3);
 expect(later.items[2]?.id).toBe(first.items[0]?.id);
 expect(later.items.map(x=>x.occurredAt)).toEqual(["1030","1020","1010"]);
 expect(indexer.playerActivity(owner,{page:1,pageSize:20,since:1010,through:1030}).items).toHaveLength(2);
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
