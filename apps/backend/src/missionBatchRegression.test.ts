import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, parseAbi, decodeFunctionData, type PublicClient } from "viem";
import { SettlementIndexer } from "./indexer";
import { ResolverTransactionCoordinator, type PreparedReceipt } from "./resolverTransactions";
import { MissionResolutionService, ViemMissionResolutionChainClient } from "./missionResolution";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy, packMissionBatch, BatchCapacityError, type BatchLeg } from "./missionBatch";
const address = "0x1111111111111111111111111111111111111111" as const;
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
function queue() {
 const db=new Database(":memory:");
 const indexer=new SettlementIndexer({listDebrisFieldEvents:async()=>[],listMoonChanceReportEvents:async()=>[],listSettledPlanetEvents:async()=>[]},100n,{database:db});
 const insert=db.query("INSERT INTO contract_fleet_missions (mission_id,status_id,mission_type_id,owner,origin_planet_id,target_planet_id,departure_at,arrival_at,return_at,fuel_cost,metal_cargo,crystal_cargo,deuterium_cargo,ships_json,randomness_request_id,event_json) VALUES (?, ?, ?, ?, '85','86','1',?,?,'0','0','0','0','{}',NULL,?)");
 return {db,indexer,insert};
}
test("confirmed unfinalized membership protects every writer and nonce recovery across restart/reorg",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"vey918-")); const path=join(dir,"intent.sqlite");
 try {
  let nonce=7, canonical=true, finalized=false, sends=0, checks=0;
  const membership=JSON.stringify([{missionId:"12",leg:"return",dueAt:5}]);
  const reconcile=async(h: string, members: string): Promise<PreparedReceipt>=>{
   checks++; expect(h).toBe(hash(7)); expect(members).toBe(membership);
   if(!canonical) throw new Error("orphaned canonical receipt");
   return {finalized,blockNumber:"100",blockHash:hash(100),outcomes:'[{"outcome":"Progress"}]'};
  };
  const c=new ResolverTransactionCoordinator(path);
  await c.submit({chainId:8453,address,operationId:"batch:A",getTransactionCount:async()=>nonce,submit:async()=>hash(7),
   prepare:async()=>({hash:hash(7),membership,broadcast:async()=>{sends++;nonce++;return hash(7);}}),confirm:async()=>{},reconcilePrepared:reconcile});
  const restarted=new ResolverTransactionCoordinator(path);
  const different={chainId:8453,address,operationId:"randomness:B",getTransactionCount:async()=>nonce,
   submit:async()=>{sends++;return hash(8);},confirm:async()=>{}};
  await expect(restarted.submit(different)).rejects.toThrow("durable batch intent");
  canonical=false; nonce=7;
  await expect(restarted.submit({...different,reconcilePrepared:reconcile})).rejects.toThrow("orphaned");
  await expect(restarted.submit({...different,operationId:"batch:C",reconcilePrepared:reconcile,
   prepare:async()=>({hash:hash(9),membership:"[]",broadcast:async()=>{sends++;return hash(9);}})})).rejects.toThrow("orphaned");
  await expect(restarted.recoverNonceGap({...different,fromNonce:7,throughNonce:7,broadcast:true,
   reconcilePrepared:reconcile,submitCancellation:async()=>{sends++;return hash(9);}})).rejects.toThrow("orphaned");
  await expect(restarted.reconcilePrepared(8453,address,reconcile)).rejects.toThrow("orphaned");
  expect(sends).toBe(1); expect(checks).toBe(5);
  const db=new Database(path); expect(db.query("SELECT membership,status FROM resolver_prepared_intents").get()).toEqual({membership,status:"confirmed"});
  canonical=true; finalized=true; nonce=8;
  await restarted.reconcilePrepared(8453,address,reconcile);
  await restarted.submit(different); expect(sends).toBe(2);
  expect(db.query("SELECT membership,status,outcomes FROM resolver_prepared_intents").get()).toEqual({membership,status:"finalized",outcomes:'[{"outcome":"Progress"}]'});
  nonce=7;
  await expect(restarted.submit({...different,operationId:"randomness:C"})).rejects.toThrow("nonce regression");
  db.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test("real SQL pages beyond 500 blocked legs and real service backoff cannot starve unrelated ID601",async()=>{
 const {db,indexer,insert}=queue(); for(let n=1;n<=601;n++)insert.run(String(n),1,0,address,String(n),"0",null);
 let now=1_000_000; const seen:string[]=[]; const reconciled:string[]=[];
 const client={listResolvableFleetMissions:async()=>[],listReturnableFleetMissions:async()=>[],resolveFleetMission:async()=>"",completeFleetMissionReturn:async()=>"",
  isMissionLegComplete:async(id:string)=>id==="601",
  resolveMissionBatch:async(items:BatchLeg[])=>{seen.push(...items.map(x=>x.missionId));const p=await packMissionBatch(items,16,async(xs)=>{if(xs.some(x=>x.missionId!=="601"))throw new BatchCapacityError("indivisible");return 1;},()=>{});return {hash:null,items:p.items,exclusions:p.exclusions};}};
 const service=new MissionResolutionService({missionResolutionEnabled:true,missionResolverAddress:address,missionBatch:{...defaultMissionBatchPolicy,enabled:true}} as never,
  {candidateSource:{missionResolutionCandidates:(_t,limit,cursor)=>indexer.missionResolutionCandidates(1000,limit,cursor),reconcileMissionResolutionCandidate:async(id)=>{reconciled.push(id);}},chainClient:client,now:()=>now,logger:{warn:()=>{},error:()=>{}}});
 for(let n=0;n<7;n++){await service.tick();now+=5_000;}
 expect(seen).toContain("601"); expect(seen.length).toBe(601);expect(reconciled.length).toBe(601);
 expect(service.snapshot().resolvedCount).toBe(1);db.close();
});
test("SQL hold projection survives pinned canonical refresh and three-way calldata tie ordering",async()=>{
 const {db,indexer,insert}=queue();
 insert.run("1",1,9,address,"100","1200",JSON.stringify({missionId:"1",transactionHash:"0x",blockNumber:"100",launchBlockNumber:"100",returnCargo:null,ships:{},attackGroupId:null,joinedAttackMissionIds:[],counterplayDefenderMissionIds:[],defendsMissionId:null,needsResolution:true,defenseHoldUntil:"950"}));
 insert.run("2",2,0,address,"50","950",null);insert.run("3",1,0,address,"950","1200",null);
 const candidates=indexer.missionResolutionCandidates(1000);expect(candidates.arrivals[0]!.arrivalAt).toBe("950");
 const client=new ViemMissionResolutionChainClient({listResolvableFleetMissions:async()=>[],listReturnableFleetMissions:async()=>[],
  isFleetChronologyOrderingReady:async(_id,block)=>{expect(block).toBe(100n);return true;},
  getCanonicalFleetMission:async(id,block)=>{expect(block).toBe(100n);return {missionId:String(id),missionType:id===1n?"DefenseHold":"Transport",defenseHoldUntil:id===1n?"950":undefined,status:id===2n?"Returning":"Outbound",arrivalAt:id===1n?"100":id===2n?"50":"950",returnAt:id===2n?"950":"1200"} as never;}},address,address);
 const items:BatchLeg[]=[...candidates.arrivals.map(x=>({missionId:x.missionId,leg:"arrival" as const,dueAt:Number(x.arrivalAt)})),...candidates.returns.map(x=>({missionId:x.missionId,leg:"return" as const,dueAt:Number(x.returnAt)}))];
 const fresh=await (client as unknown as {freshBatchCandidates(items:BatchLeg[],block:bigint):Promise<BatchLeg[]>}).freshBatchCandidates(items,100n);
 expect(fresh.map(x=>[x.missionId,x.dueAt])).toEqual([["3",950],["2",950],["1",950]]);
 const packed=await packMissionBatch(fresh,16,async()=>1,()=>{});
 const calldata=decodeFunctionData({abi:missionBatchAbi,data:batchCalldata(packed.items)});
 expect(calldata.args[0].map(x=>[x.missionId,x.leg])).toEqual([[3n,0],[2n,1],[1n,0]]);db.close();
});

test("production receipt decoder restores per-leg membership, selector, blocker and raw Base fees before a sibling writer", async () => {
 const dir=mkdtempSync(join(tmpdir(),"vey918-receipt-")); const path=join(dir,"intent.sqlite");
 const logged:Record<string,unknown>[]=[];const original=console.info;
 console.info=(line)=>{try{logged.push(JSON.parse(String(line)));}catch{}};
 try {
  let canonical=true, reads=0, nonce=7;
  const item:BatchLeg={missionId:"12",leg:"return",dueAt:5};
  const receipt={status:"success",blockNumber:100n,blockHash:hash(100),gasUsed:100n,effectiveGasPrice:2n,l1Fee:"0x10",
   logs:[{address,topics:encodeEventTopics({abi:parseAbi(["event FleetMissionBatchItem(uint256 indexed index,uint256 indexed missionId,uint8 leg,uint8 outcome,bytes4 errorSelector)"]),
    eventName:"FleetMissionBatchItem",args:{index:0n,missionId:12n}}),data:encodeAbiParameters([{type:"uint8"},{type:"uint8"},{type:"bytes4"}],[1,5,"0xb3439205"])}]};
  const rpc={getTransactionReceipt:async()=>receipt,getBlock:async(args:{blockTag?:string})=>args.blockTag==="finalized"?{number:90n,hash:hash(90)}:{number:100n,hash:canonical?hash(100):hash(101)},
   readContract:async(args:{functionName:string;blockNumber:bigint})=>{expect(args.blockNumber).toBe(100n);return args.functionName==="getOperatorFee"?5n:[false,11n,true];}} as unknown as PublicClient;
  const attach=(coordinator:ResolverTransactionCoordinator)=>new ViemMissionResolutionChainClient({listResolvableFleetMissions:async()=>[],listReturnableFleetMissions:async()=>[],
   getCanonicalFleetMission:async(id,block)=>{reads++;expect(id).toBe(12n);expect(block).toBe(100n);return {status:"Returning"} as never;}},address,address,rpc,undefined,
   {id:8453} as never,undefined,coordinator);
  const c=new ResolverTransactionCoordinator(path);attach(c);
  await c.submit({chainId:8453,address,operationId:"batch",getTransactionCount:async()=>nonce,submit:async()=>hash(7),confirm:async()=>{},
   prepare:async()=>({hash:hash(7),membership:JSON.stringify([item]),broadcast:async()=>{nonce++;return hash(7);}})});
  const restarted=new ResolverTransactionCoordinator(path);attach(restarted);
  await restarted.submit({chainId:8453,address,operationId:"randomness",getTransactionCount:async()=>nonce,submit:async()=>hash(8),confirm:async()=>{}});
  expect(reads).toBe(2);
  const db=new Database(path); const stored=db.query("SELECT outcomes FROM resolver_prepared_intents").get() as {outcomes:string};
  expect(JSON.parse(stored.outcomes)).toEqual([{item,complete:false,blockedDependency:"11",errorSelector:"0xb3439205",outcome:"Failed"}]);db.close();
  const event=logged.find(x=>x.kind==="mission_batch_receipt")!;
  expect(event.actualTotalFeeWei).toBe("221");expect(event.l1FeeWei).toBe("16");expect(event.operatorFeeSource).toBe("canonical-block-oracle");
  canonical=false;
  await expect(restarted.submit({chainId:8453,address,operationId:"randomness-next",getTransactionCount:async()=>7,submit:async()=>{throw new Error("must not send");},confirm:async()=>{}})).rejects.toThrow("not canonical");
 } finally {console.info=original;rmSync(dir,{recursive:true,force:true});}
});
