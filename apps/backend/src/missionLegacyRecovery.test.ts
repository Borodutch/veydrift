import { test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, custom, encodeAbiParameters, encodeFunctionResult, keccak256, parseTransaction, serializeTransaction, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { missionBatchAbi, batchCalldata, defaultMissionBatchPolicy } from "./missionBatch";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { runMissionRecovery } from "./missionLegacyRecoveryCli";
import { recoveryBinding, type MissionRecoveryInput } from "./missionLegacyRecovery";
const account = privateKeyToAccount(("0x"+"11".repeat(32)) as Hex);
const game = ("0x"+"22".repeat(20)) as Hex, implementation=("0x"+"33".repeat(20)) as Hex;
const original=("0x"+"44".repeat(32)) as Hex, blockHash=("0x"+"aa".repeat(32)) as Hex;
const chain = {id:8453,name:"fixture",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:["http://invalid.test"]}}};
const originalFetch=globalThis.fetch;
let referenceNonce=4;
beforeAll(()=>{globalThis.fetch=(async (url: string|URL|Request, init?:RequestInit)=>{
 if(String(url)!=="https://reference.invalid/" && String(url)!=="https://reference.invalid") throw new Error("unexpected real network");
 const q=JSON.parse(init!.body as string);
 const result=q.method==="eth_chainId"?"0x2105":q.method==="eth_getTransactionCount"?"0x"+referenceNonce.toString(16):{number:"0x1",hash:blockHash,timestamp:"0x1",transactions:[]};
 return new Response(JSON.stringify({jsonrpc:"2.0",id:q.id,result}),{headers:{"content-type":"application/json"}});
}) as typeof fetch;});
afterAll(()=>{globalThis.fetch=originalFetch;});
function plan(binding: ReturnType<typeof recoveryBinding>) {return serializeTransaction({type:"eip1559",chainId:8453,nonce:4,to:game,data:binding.data,value:0n,gas:1000000n,maxFeePerGas:23995623n,maxPriorityFeePerGas:23995423n});}
function fixture() {
 referenceNonce=4;
 const dir=mkdtempSync(join(tmpdir(),"recovery58-")), path=join(dir,"journal.sqlite");
 const items=[{missionId:"99306",leg:"return" as const,dueAt:1791480343}];
 const data=batchCalldata(items);
 const input: MissionRecoveryInput={chainId:8453,address:account.address,nonce:4,originalHash:original,
  operationId:"mission-batch:"+game+":"+keccak256(data),membership:JSON.stringify(items),game,calldataHash:keccak256(data),implementation,
  identities:[implementation,game,("0x"+"55".repeat(20)) as Hex].map(address=>({address,codeHash:keccak256("0x6000")})),
  originalFee:{gas:"10414604",totalWei:"199999983326886",l1ReserveWei:"77724806734",operatorReserveWei:"0",maxFeePerGas:"19196338",priority:null,source:"fixture signed-prepared log",sourceDigest:keccak256("0x01")},mission:{owner:account.address,origin:"783",target:"210",returnAt:"1791480343",shipsWords:[("0x"+"00".repeat(31)+"0d") as Hex,("0x"+"00".repeat(32)) as Hex],bodyFlags:("0x"+"00".repeat(32)) as Hex},gas:"1000000",allowAlreadySettled:false,referenceRpcUrl:"https://reference.invalid",recoveryId:"fixture-58",maxFeeWei:"200000000000000"};
 let now=1000, winner:Hex|null=null, finalized=false, nonce=4, signCount=0, outcome=0;
 let afterSign:()=>void=()=>{};
 let receiptStatus="success", completed=true, reportedBoth=false;
 let onSend:(raw:Hex)=>Promise<Hex>=async raw=>{throw new Error("lost response");};
 const bytes:Hex[]=[];
 const signedAccount={...account,signTransaction:async (...args:Parameters<typeof account.signTransaction>)=>{signCount++; const raw=await account.signTransaction(...args); afterSign(); return raw;}};
 const transport=createPublicClient({transport:custom({request:async({method,params})=>{if(method!=="eth_sendRawTransaction")throw new Error("unexpected RPC");const raw=(params as [Hex])[0];bytes.push(raw);return onSend(raw);}}, {retryCount:0})});
 const missionSlot=BigInt(keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[99306n,24n])));
 const publicClient={
  getChainId:async()=>8453,getCode:async()=>"0x6000",getBalance:async()=>10n**18n,
  getStorageAt:async({slot}:{slot:Hex})=>slot.startsWith("0x360894")?"0x"+"0".repeat(24)+implementation.slice(2):slot==="0x"+"0".repeat(62)+"34"?"0x00": BigInt(slot)===missionSlot+7n?input.mission.shipsWords[0]:input.mission.bodyFlags,
  getTransactionCount:async()=>nonce,
  getBlock:async({blockTag}:{blockTag?:string})=>({number:blockTag==="finalized"&&!finalized?0n:1n,hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000)),baseFeePerGas:100n,gasLimit:30000000n}),
  estimateMaxPriorityFeePerGas:async()=>10n,
  readContract:async({functionName}:{functionName:string})=>functionName==="fleetMissionEligibility"?[true,0n,true]:functionName==="fleetMission"?[winner||outcome===2?4:2,0,account.address,783n,210n,1n,2n,1791480343n,16n,{metal:0n,crystal:0n,deuterium:0n},0n]:100n,
  call:async()=>({data:encodeFunctionResult({abi:missionBatchAbi,functionName:"resolveFleetMissionBatch",result:[[outcome],100000n]})}),
  sendRawTransaction:transport.sendRawTransaction,
  getTransaction:async({hash}:{hash:Hex})=>{if(hash!==winner&&!reportedBoth)throw new TransactionNotFoundError({});return {hash,chainId:8453,from:account.address,nonce:4,to:game,value:0n,input:data,blockNumber:1n,blockHash};},
  getTransactionReceipt:async({hash}:{hash:Hex})=>{if(hash!==winner&&!reportedBoth)throw new TransactionReceiptNotFoundError({hash});return {transactionHash:hash,status:receiptStatus,blockNumber:1n,blockHash,logs:[],gasUsed:100000n,effectiveGasPrice:100n,l1Fee:100n,operatorFee:0n};}
 };
 const create=()=>{
  const coordinator=new ResolverTransactionCoordinator(path,{now:()=>now,sleep:async ms=>{now+=ms;},leaseWaitMs:1,reconciliationTimeoutMs:5000});
  const client=new ViemMissionResolutionChainClient({listResolvableFleetMissions:async()=>[],listReturnableFleetMissions:async()=>[],getCanonicalFleetMission:async()=>({status:winner&&completed?"Returned":"Returning",returnAt:String(items[0]!.dueAt)}) as never},game,signedAccount,publicClient as unknown as PublicClient,undefined,chain,undefined,coordinator,undefined,undefined,{...defaultMissionBatchPolicy,enabled:true});
  return {coordinator,client};
 };
 const current=create(), db=new Database(path);
 db.query("INSERT INTO resolver_transaction_attempts VALUES(?,?,?,?,?,?,?)").run(8453,account.address.toLowerCase(),input.operationId,4,original,"submitted","original-time");
 db.query("INSERT INTO resolver_prepared_intents(chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES(?,?,?,?,?,?,'pending')").run(8453,account.address.toLowerCase(),input.operationId,4,original,input.membership);
 return {...current,input,db,path,dir,bytes,publicClient,create,setReceipt:(status:string,complete:boolean)=>{receiptStatus=status;completed=complete;},both:()=>{reportedBoth=true;},setNonce:(n:number)=>{nonce=n;referenceNonce=n;},afterSign:(fn:()=>void)=>{afterSign=fn;},signs:()=>signCount,setOutcome:(v:number)=>{outcome=v;},advance:()=>{now+=60000;},win:(hash:Hex,final=true)=>{winner=hash;nonce=5;referenceNonce=5;finalized=final;},reorg:()=>{winner=null;nonce=4;referenceNonce=4;finalized=false;},send:(fn:typeof onSend)=>{onSend=fn;},cleanup:()=>{db.close();rmSync(dir,{recursive:true,force:true});}};
}
test("original wins before signing; original receipt only and finality releases admission",async()=>{
 const f=fixture();try{f.win(original);await f.client.recoverLegacyMission(f.input);expect(f.signs()).toBe(0);expect(f.bytes).toHaveLength(0);
 expect(f.db.query("SELECT finalized,winner_hash FROM resolver_nonce_recovery").get()).toEqual({finalized:1,winner_hash:original});
 await f.client.resolveMissionBatch([]);}finally{f.cleanup();}
});
test("three exact attempts, restart without resign, alternative finalizes and loser remains legacy",async()=>{
 const f=fixture();try{await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("read budget exhausted");
 await expect(f.client.resolveMissionBatch([])).rejects.toThrow("cooling down");expect(f.bytes).toHaveLength(3);expect(new Set(f.bytes).size).toBe(1);expect(f.signs()).toBe(1);
 const tx=parseTransaction(f.bytes[0]!);expect(tx.nonce).toBe(4);expect(tx.gas).toBe(1000000n);expect(tx.maxPriorityFeePerGas).toBe(23995423n);expect(tx.data).toBe(batchCalldata(JSON.parse(f.input.membership)));
 const resumed=f.create();await expect(resumed.client.recoverLegacyMission(f.input)).rejects.toThrow("cooling down");expect(f.signs()).toBe(1);f.win(keccak256(f.bytes[0]!));await resumed.client.resolveMissionBatch([]);
 expect(f.db.query("SELECT status,receipt_block_hash FROM resolver_prepared_intents WHERE transaction_hash=?").get(original)).toEqual({status:"pending",receipt_block_hash:null});
 expect(f.db.query("SELECT finalized FROM resolver_nonce_recovery").get()).toEqual({finalized:1});
 expect(f.db.query("SELECT transaction_hash,status,updated_at FROM resolver_transaction_attempts").get()).toEqual({transaction_hash:original,status:"submitted",updated_at:"original-time"});
 }finally{f.cleanup();}
});
test("provisional winner holds signer, reorg retains history, original may win replacement fork",async()=>{
 const f=fixture();try{f.send(async raw=>{f.win(keccak256(raw),false);return keccak256(raw);});await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("provisional");
 await expect(f.client.resolveMissionBatch([])).rejects.toThrow("provisional");f.reorg();f.advance();f.send(async()=>{f.win(original);throw new Error("old won");});await f.client.resolveMissionBatch([]);
 expect(f.db.query("SELECT winner_hash,finalized FROM resolver_nonce_recovery").get()).toEqual({winner_hash:original,finalized:1});
 expect(f.db.query("SELECT count(*) AS n FROM resolver_nonce_recovery_history WHERE event='provisional-reorg'").get()).toEqual({n:1});
 f.reorg();await expect(f.client.resolveMissionBatch([])).rejects.toThrow("finalized recovery contradiction");
 }finally{f.cleanup();}
});
test("binding, provenance and deployed identity mismatch prevent signing",async()=>{
 const f=fixture();try{expect(()=>recoveryBinding({...f.input,calldataHash:original})).toThrow("calldata");
 expect(()=>recoveryBinding({...f.input,originalFee:{...f.input.originalFee,maxFeePerGas:"1"}})).toThrow("provenance");
 f.input.identities[0]!.codeHash=original;await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("code changed");expect(f.signs()).toBe(0);
 }finally{f.cleanup();}
});
test("AlreadySettled is recovery opt-in, never general validator relaxation",async()=>{
 const f=fixture();try{f.setOutcome(2);await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("AlreadySettled");expect(f.signs()).toBe(0);
 }finally{f.cleanup();}
 const g=fixture();try{g.input.allowAlreadySettled=true;g.setOutcome(2);g.send(async raw=>{g.win(keccak256(raw));return keccak256(raw);});await g.client.recoverLegacyMission(g.input);expect(g.signs()).toBe(1);}finally{g.cleanup();}
});

test("original wins after signing before dispatch; retained alternative is never sent",async()=>{
 const f=fixture();try{f.afterSign(()=>f.win(original));await f.client.recoverLegacyMission(f.input);expect(f.signs()).toBe(1);expect(f.bytes).toHaveLength(0);
 expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE receipt_block_hash IS NULL AND serialized_transaction IS NOT NULL").get()).toEqual({n:1});
 }finally{f.cleanup();}
});
test("unknown consumed nonce and cap-exceeding bumped envelope never sign",async()=>{
 const f=fixture();try{f.setNonce(5);await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("identify canonical hash");expect(f.signs()).toBe(0);}finally{f.cleanup();}
 const g=fixture();try{g.input.gas="10414604";await expect(g.client.recoverLegacyMission(g.input)).rejects.toThrow("ETH cap");expect(g.signs()).toBe(0);}finally{g.cleanup();}
});
test("claim crash resumes, unknown signing result fences without resign",async()=>{
 const f=fixture();try{const binding=recoveryBinding(f.input);
 await expect(f.coordinator.recoverLegacySameNonce(binding,async()=>{throw new Error("claim crash");},"200000000000000")).rejects.toThrow("claim crash");
 expect(f.db.query("SELECT reservation_id FROM resolver_nonce_recovery").get()).toEqual({reservation_id:null});
 await expect(f.coordinator.recoverLegacySameNonce(binding,async sign=>{await sign(async()=>{throw new Error("sign crash");},plan(binding));},"200000000000000")).rejects.toThrow("sign crash");
 await expect(f.create().client.recoverLegacyMission(f.input)).rejects.toThrow("result unknown");expect(f.signs()).toBe(0);
 f.win(original);await expect(f.create().client.recoverLegacyMission(f.input)).rejects.toThrow("result unknown");await expect(f.client.resolveMissionBatch([])).rejects.toThrow("reservation not transferred");
 }finally{f.cleanup();}
});
test("signed result survives pre-transfer crash and resumes identical bytes without signing",async()=>{
 const f=fixture();try{const binding=recoveryBinding(f.input);
 await expect(f.coordinator.recoverLegacySameNonce(binding,async sign=>{await sign(()=>account.signTransaction({type:"eip1559",chainId:8453,nonce:4,to:game,data:binding.data,value:0n,gas:1000000n,maxFeePerGas:23995623n,maxPriorityFeePerGas:23995423n}),plan(binding));throw new Error("transfer crash");},"200000000000000")).rejects.toThrow("transfer crash");
 const result=f.db.query("SELECT serialized_transaction AS raw FROM resolver_signing_results").get() as {raw:Hex};
 f.send(async raw=>{expect(raw).toBe(result.raw);f.win(keccak256(raw));return keccak256(raw);});await f.create().client.recoverLegacyMission(f.input);expect(f.signs()).toBe(0);expect(f.bytes).toHaveLength(1);
 }finally{f.cleanup();}
});
test("canonical authentication mismatch and receipt conflict stay fail closed",async()=>{
 const f=fixture();try{f.win(original);const real=f.publicClient.getTransaction;f.publicClient.getTransaction=async args=>({...await real(args),nonce:5});
 await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("full transaction mismatch");expect(f.signs()).toBe(0);
 }finally{f.cleanup();}
});
test("foreign outstanding transport blocks recovery claim and all signing",async()=>{
 const f=fixture();try{f.db.query("INSERT INTO resolver_send_fences VALUES(?,?,?,?,?,?)").run(8453,account.address.toLowerCase(),"foreign","foreign-host",123,original);
 await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("foreign-host orphan");expect(f.signs()).toBe(0);expect(f.db.query("SELECT count(*) AS n FROM resolver_nonce_recovery").get()).toEqual({n:0});
 }finally{f.cleanup();}
});

test("reverted winner releases nonce at finality without inventing domain completion",async()=>{
 const f=fixture();try{f.setReceipt("reverted",false);f.send(async raw=>{f.win(keccak256(raw));return keccak256(raw);});await f.client.recoverLegacyMission(f.input);
 const row=f.db.query("SELECT outcomes FROM resolver_prepared_intents WHERE status='finalized'").get() as {outcomes:string};expect(JSON.parse(row.outcomes)[0]).toMatchObject({complete:false,outcome:"Reverted"});await f.client.resolveMissionBatch([]);
 }finally{f.cleanup();}
});
test("Progress simulation remains full-intent and receipt missing outcome is not completion",async()=>{
 const f=fixture();try{f.setOutcome(7);f.setReceipt("success",false);f.send(async raw=>{f.win(keccak256(raw));return keccak256(raw);});await f.client.recoverLegacyMission(f.input);
 const row=f.db.query("SELECT outcomes FROM resolver_prepared_intents WHERE status='finalized'").get() as {outcomes:string};expect(JSON.parse(row.outcomes)[0]).toMatchObject({complete:false,outcome:"MissingOutcome"});expect(parseTransaction(f.bytes[0]!).data).toBe(batchCalldata(JSON.parse(f.input.membership)));
 }finally{f.cleanup();}
});
test("two reported canonical candidates do not finalize or release the group",async()=>{
 const f=fixture();try{await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("read budget exhausted");f.both();await expect(f.client.resolveMissionBatch([])).rejects.toThrow("conflicting canonical");expect(f.db.query("SELECT finalized,winner_hash FROM resolver_nonce_recovery").get()).toEqual({finalized:0,winner_hash:null});
 }finally{f.cleanup();}
});
test("competing coordinator cannot prepare while original owner signs",async()=>{
 const f=fixture();try{let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
 const binding=recoveryBinding(f.input);const owner=f.coordinator.recoverLegacySameNonce(binding,async sign=>{await sign(async()=>{entered();await held;throw new Error("injected sign interruption");},plan(binding));},"200000000000000");
 await ready;await expect(f.create().client.recoverLegacyMission(f.input)).rejects.toThrow("waiting for resolver transaction lease");release();await expect(owner).rejects.toThrow("sign interruption");expect(f.bytes).toHaveLength(0);
 }finally{f.cleanup();}
});

test("reject unsupported multi-member and nonempty access list plans",async()=>{
 const f=fixture();try{const items=JSON.parse(f.input.membership);items.push({...items[0],missionId:"99307"});expect(()=>recoveryBinding({...f.input,membership:JSON.stringify(items)})).toThrow("membership");
 const binding=recoveryBinding(f.input);const tx=parseTransaction(plan(binding));await expect(f.coordinator.recoverLegacySameNonce(binding,async sign=>{await sign(async()=>{throw new Error("must not sign");},serializeTransaction({...tx,type:"eip1559",accessList:[{address:game,storageKeys:[]}]}));},"200000000000000")).rejects.toThrow("unsigned plan mismatch");expect(f.signs()).toBe(0);
 }finally{f.cleanup();}
});
test("asset mismatch, stale quote and independent chain disagreement do not sign",async()=>{
 const f=fixture();try{f.input.mission.origin="784";await expect(f.client.recoverLegacyMission(f.input)).rejects.toThrow("prestate mismatch");expect(f.signs()).toBe(0);}finally{f.cleanup();}
 const g=fixture();try{const real=g.publicClient.getBlock;g.publicClient.getBlock=async args=>({...await real(args),timestamp:1n});await expect(g.client.recoverLegacyMission(g.input)).rejects.toThrow("expired");expect(g.signs()).toBe(0);}finally{g.cleanup();}
 const h=fixture();try{referenceNonce=9;await expect(h.client.recoverLegacyMission(h.input)).rejects.toThrow("nonce disagreement");expect(h.signs()).toBe(0);}finally{h.cleanup();}
});

test("finalized exclusion permits next nonce without changing original history",async()=>{
 const f=fixture();try{f.send(async raw=>{f.win(keccak256(raw));return keccak256(raw);});await f.client.recoverLegacyMission(f.input);
 let allocated=-1;await f.coordinator.submit({chainId:8453,address:account.address,operationId:"randomness-next",getTransactionCount:async()=>5,submit:async nonce=>{allocated=nonce;return ("0x"+"77".repeat(32)) as Hex;},confirm:async()=>{}});expect(allocated).toBe(5);
 expect(f.db.query("SELECT transaction_hash,status FROM resolver_transaction_attempts WHERE operation_id=?").get(f.input.operationId)).toEqual({transaction_hash:original,status:"submitted"});
 }finally{f.cleanup();}
});

test("dry run opens journal read-only even when network preflight fails; no signing",async()=>{
 const f=fixture();const keys=["VEYDRIFT_RPC_URL","VEYDRIFT_CHAIN_ID","VEYDRIFT_GAME_CONTRACT_ADDRESS","VEYDRIFT_RESOLVER_TRANSACTION_STORE_PATH","VEYDRIFT_MISSION_BATCH_ENABLED"];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{process.env.VEYDRIFT_RPC_URL="https://local.invalid";process.env.VEYDRIFT_CHAIN_ID="8453";process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS=game;process.env.VEYDRIFT_RESOLVER_TRANSACTION_STORE_PATH=f.path;process.env.VEYDRIFT_MISSION_BATCH_ENABLED="true";
 const inputPath=join(f.dir,"input.json");writeFileSync(inputPath,JSON.stringify(f.input));
 const files=[f.path,f.path+"-wal"].filter(existsSync);const before=files.map(path=>readFileSync(path).toString("hex"));
 await expect(runMissionRecovery(["--input",inputPath])).rejects.toThrow();expect(files.map(path=>readFileSync(path).toString("hex"))).toEqual(before);expect(f.signs()).toBe(0);expect(f.db.query("SELECT count(*) AS n FROM resolver_nonce_recovery").get()).toEqual({n:0});
 await expect(runMissionRecovery(["--input",inputPath,"--force"])).rejects.toThrow("usage");
 }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}f.cleanup();}
});
