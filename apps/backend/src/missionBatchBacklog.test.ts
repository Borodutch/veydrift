import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { VeydriftGameReader, HttpJsonRpcTransport, RpcRetryAfterError } from "./evm";
import { MissionResolutionService, ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { BatchQuoteExpiredError } from "./missionBatchFees";
import { defaultMissionBatchPolicy, missionBatchAbi } from "./missionBatch";
import type { BackendConfig } from "./config";
const account = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex);
const game = ("0x" + "22".repeat(20)) as Hex;
const base = 1_800_000_000_000;
const words = (values: (bigint | number | string)[]) => "0x" + values.map(x => BigInt(x).toString(16).padStart(64,"0")).join("");
const hash = (n: bigint) => ("0x" + n.toString(16).padStart(64,"0")) as Hex;
const config = { chainId:8453, rpcUrl:"https://fixture.invalid", gameContractAddress:game, indexFromBlock:0n,
  indexDbPath:":memory:", missionResolutionEnabled:true, missionBatch:{...defaultMissionBatchPolicy,enabled:true,maxItems:16} } as BackendConfig;

async function scenario(options: { signingDelay?:number; canonicalDelay?:number; expireCandidates?:boolean; presignDelay?:number; simulationDelay?:number }, check: (f:any)=>Promise<void>) {
 const dir=mkdtempSync(join(tmpdir(),"backlog61-")),path=join(dir,"journal.sqlite");
 const originalNow=Date.now, originalFetch=globalThis.fetch; let now=base;
 Date.now=()=>now;
 let signs=0,sends=0,mined=false,raw:Hex="0x",receiptBlock=0n; const settled=new Set<string>();
 const requests:Array<{count:number;tag:string;at:number}>=[];
 let expired=options.expireCandidates??false;
 globalThis.fetch=(async (url:any,init:any)=>{
  if(String(url)!==config.rpcUrl)throw Error("unexpected real network");
  const payload=JSON.parse(init.body);const batch=Array.isArray(payload)?payload:[payload];
  requests.push({count:batch.length,tag:batch[0].params[1],at:now});
  now+=expired?31_000:350; // real transport pacing remains enabled; synthetic RPC latency advances its clock
  const results=batch.map((q:any)=>{
   const data=q.params[0].data;const id=String(BigInt("0x"+data.slice(10)));
   const result=data.startsWith("0xce02abe2")?words([1,0,1]):words([settled.has(id)?4:1,0,account.address,1,2,1,2,3,0,0,0,0,0]);
   return {jsonrpc:"2.0",id:q.id,result};
  });
  return new Response(JSON.stringify(Array.isArray(payload)?results:results[0]),{headers:{"content-type":"application/json"}});
 }) as unknown as typeof fetch;
 const reader=new VeydriftGameReader(config,undefined,{hydrateQueueStartedAt:false});
 const block=(n:bigint)=>({number:n,hash:hash(n),timestamp:BigInt(base/1000)+n*2n,baseFeePerGas:100n,gasLimit:30_000_000n});
 const head=()=>BigInt(Math.floor((now-base)/2000));
 let signed=false,signingReady=false,simulationCount=0;
 const publicClient={
  getStorageAt:async()=>"0x00", getChainId:async()=>8453,
  getTransactionCount:async()=>mined?5:4,
  getBlock:async({blockNumber}:any)=>{const n=blockNumber??head();if(blockNumber!==undefined&&signed)now+=options.canonicalDelay??0; if(blockNumber!==undefined&&!signed&&signingReady)now+=options.presignDelay??0;now+=25;return block(n)},
  estimateMaxPriorityFeePerGas:async()=>10n,
  readContract:async()=>100n,
  call:async({data,blockNumber,gas}:any)=>{expect(blockNumber).toBeDefined();expect(gas).toBeLessThanOrEqual(16_777_216n);now+=options.simulationDelay??150; if(++simulationCount===34)signingReady=true;
   const decoded=decodeFunctionData({abi:missionBatchAbi,data});return {data:encodeFunctionResult({abi:missionBatchAbi,functionName:"resolveFleetMissionBatch",result:[decoded.args![0].map(()=>0),BigInt(decoded.args![0].length)*500_000n]})};},
  sendRawTransaction:async({serializedTransaction}:any)=>{sends++;raw=serializedTransaction;const tx=parseTransaction(raw);expect(tx.gas!).toBeLessThanOrEqual(16_777_216n);expect(tx.gas!*tx.maxFeePerGas!+400n).toBeLessThanOrEqual(200_000_000_000_000n);receiptBlock=head();mined=true;for(const item of decodeFunctionData({abi:missionBatchAbi,data:tx.data!}).args![0])settled.add(String(item.missionId));return keccak256(raw)},
  waitForTransactionReceipt:async()=>({status:"success"}),
  getTransaction:async()=>{throw new TransactionNotFoundError({})},
  getTransactionReceipt:async({hash:h}:any)=>{if(!mined)throw new TransactionReceiptNotFoundError({hash:h});return {status:"success",transactionHash:h,from:account.address,to:game,blockNumber:receiptBlock,blockHash:hash(receiptBlock),logs:[],gasUsed:100_000n,effectiveGasPrice:100n,l1Fee:100n,operatorFee:0n}}
 };
 const sender={address:account.address,signTransaction:async(tx:any)=>{signs++;now+=options.signingDelay??300;signed=true;raw=await account.signTransaction(tx);return raw}};
 const make=()=>new ViemMissionResolutionChainClient(reader,game,sender as any,publicClient as unknown as PublicClient,undefined,{id:8453} as any,undefined,new ResolverTransactionCoordinator(path),undefined,undefined,config.missionBatch);
 const client=make();const items=Array.from({length:39},(_,i)=>({missionId:String(i+1),leg:"arrival" as const,dueAt:2}));
 const source={missionResolutionCandidates:()=>({arrivals:items.filter(i=>!settled.has(i.missionId)).map(i=>({...i,missionType:"Transport",arrivalAt:"2",originPlanetId:"1",targetPlanetId:"2"})),returns:[]})};
 const service=new MissionResolutionService(config,{chainClient:client,candidateSource:source as any,now:()=>now,logger:{warn(){},error(){}}});
 const rows=()=>{const db=new Database(path);try{return db.query("SELECT status FROM resolver_prepared_intents").all()}finally{db.close()}};
 try{await check({client,service,items,requests,rows,restart:make,counts:()=>({signs,sends}),settled,clock:()=>now,advance:(ms:number)=>{now+=ms},healthy:()=>{expired=false}})}
 finally{Date.now=originalNow;globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true})}
}

test("39 candidates use <=50-call real-reader waves, two-second heads and a full 16-leg productive signed batch",async()=>{
 await scenario({},async f=>{await f.service.tick();expect(f.counts()).toEqual({signs:1,sends:1});expect(f.settled.size).toBe(16);expect(f.service.snapshot().resolvedCount).toBe(16);expect(f.requests.slice(0,2).map((r:any)=>r.count)).toEqual([50,28]);expect(f.requests.every((r:any)=>r.count<=50)).toBe(true);expect(f.requests[0].tag).toBe(f.requests[1].tag);expect(f.clock()-base).toBeLessThan(30_000);});
});
test("expired actual candidate wave stops before next wave and retries all39 next interval, not300 seconds",async()=>{
 await scenario({expireCandidates:true},async f=>{await f.service.tick();expect(f.counts()).toEqual({signs:0,sends:0});expect(f.requests).toHaveLength(1);expect(f.service.snapshot().sharedAdmission.blocked).toBe(true);f.healthy();f.advance(5000);await f.service.tick();expect(f.requests[1].count).toBe(50);expect(f.counts()).toEqual({signs:1,sends:1});});
});
test("39-candidate postpersist signing or presend expiry remains prevented across restart without resend",async()=>{
 for(const options of [{signingDelay:31_000},{canonicalDelay:31_000}])await scenario(options,async f=>{await expect(f.client.resolveMissionBatch(f.items)).rejects.toBeInstanceOf(BatchQuoteExpiredError);expect(f.counts()).toEqual({signs:1,sends:0});expect(f.rows()).toEqual([{status:"prevented"}]);await expect(f.restart().resolveMissionBatch([])).rejects.toThrow("locally prevented");expect(f.counts()).toEqual({signs:1,sends:0});});
});
test("HTTP Retry-After holds the real reader transport without retry/failover or queued burst",async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let now=base,calls=0;Date.now=()=>now;
 globalThis.fetch=(async()=>{calls++;return calls===1?new Response("busy",{status:429,headers:{"Retry-After":"60"}}):new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"0x1"}))}) as unknown as typeof fetch;
 try{const transport=new HttpJsonRpcTransport(["https://fixture.invalid","https://fallback.invalid"]);await expect(transport.request("eth_blockNumber",[])).rejects.toBeInstanceOf(RpcRetryAfterError);now+=5000;await expect(transport.request("eth_blockNumber",[])).rejects.toBeInstanceOf(RpcRetryAfterError);expect(calls).toBe(1);now+=55000;expect(await transport.request<string>("eth_blockNumber",[])).toBe("0x1");expect(calls).toBe(2)}finally{globalThis.fetch=originalFetch;Date.now=originalNow}
});

test("final canonical presign expiry retains no signature, nonce envelope or unsafe send",async()=>{
 await scenario({presignDelay:31_000},async f=>{await expect(f.client.resolveMissionBatch(f.items)).rejects.toBeInstanceOf(BatchQuoteExpiredError);expect(f.counts()).toEqual({signs:0,sends:0});expect(f.rows()).toEqual([])});
});

test("slow productive packing stops at bounded prefix rather than refreshing fees against stale candidates",async()=>{
 await scenario({simulationDelay:800},async f=>{await f.service.tick();expect(f.counts()).toEqual({signs:1,sends:1});expect(f.settled.size).toBeGreaterThan(0);expect(f.settled.size).toBeLessThan(16)});
});

test("repeated shared fee expiry never escalates39 candidates and Retry-After retains its server deadline",async()=>{
 let now=base,fail=true,seen:number[]=[];
 const client={listResolvableFleetMissions:async()=>Array.from({length:36},(_,i)=>({missionId:String(i+1),arrivalAt:"2",missionType:"Transport",originPlanetId:"1",targetPlanetId:"2"})),listReturnableFleetMissions:async()=>Array.from({length:3},(_,i)=>({missionId:String(i+37),returnAt:"3",missionType:"Transport",originPlanetId:"1",targetPlanetId:"2"})),resolveFleetMission:async()=>"",completeFleetMissionReturn:async()=>"",isMissionLegComplete:async()=>true,resolveMissionBatch:async(items:any[])=>{seen.push(items.length);if(fail)throw new BatchQuoteExpiredError();return {hash:null,items,exclusions:[]}}};
 const service=new MissionResolutionService(config,{chainClient:client,now:()=>now,logger:{warn(){},error(){}}});
 for(let i=0;i<6;i++){await service.tick();now+=5000;}
 expect(seen).toEqual([39,39,39,39,39,39]);fail=false;await service.tick();expect(seen.at(-1)).toBe(39);expect(service.snapshot().resolvedCount).toBe(36);expect(service.snapshot().returnedCount).toBe(3);
 let calls=0;client.resolveMissionBatch=async()=>{calls++;throw new RpcRetryAfterError(now+60_000)};
 await service.tick();now+=5000;await service.tick();expect(calls).toBe(1);now+=55000;await service.tick();expect(calls).toBe(2);
});

test("batched canonical holds retain fixed-block deadline storage and malformed support fails closed",async()=>{
 const tags:string[]=[];let reads=0;
 const transport={request:async<T>(method:string,params:unknown[]):Promise<T>=>{reads++;expect(method).toBe("eth_getStorageAt");tags.push(String(params[2]));return words([99]) as T},requestBatch:async<T>(requests:Array<{method:string;params:unknown[]}>):Promise<T[]>=>requests.map(q=>{reads++;tags.push(String(q.params[1]));const data=(q.params[0] as {data:string}).data,id=BigInt("0x"+data.slice(10));return (data.startsWith("0xce02abe2")?(id===1n?words([0,77,1]):"0x"):words([1,id===1n?9:0,account.address,1,2,1,2,3,0,0,0,0,0])) as T})};
 const reader=new VeydriftGameReader(config,transport);const snapshots=await reader.getCanonicalFleetMissionBatch([1n,2n],25n,()=>{});
 expect(snapshots[0]?.mission?.defenseHoldUntil).toBe("99");expect(snapshots[0]?.orderingReady).toBe(true);expect(snapshots[1]?.orderingReady).toBe(false);expect(tags.every(t=>t==="0x19")).toBe(true);
 const before=reads;await expect(reader.getCanonicalFleetMissionBatch(Array.from({length:101},(_,i)=>BigInt(i+1)),25n,()=>{})).rejects.toThrow("100 candidates");expect(reads).toBe(before);
});
