import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { toHex, type PublicClient } from "viem";
import { classifyRecoveryReadError, RecoveryReadinessError, acquireRecoveryHead, readOnlyRecoveryPass, RecoveryTrace } from "./recoveryReadiness";
import { assertRecoveryJournalReadiness, verifyReviewedRecoveryManifest } from "./missionLegacyRecoveryCli";
import { recoveryBinding } from "./missionLegacyRecovery";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
const block=(n:bigint)=>({number:n,hash:toHex(n,{size:32}),timestamp:BigInt(Math.floor(Date.now()/1000))});
const pass={assertActive:()=>{},read:<T>(fn:()=>Promise<T>)=>fn()};
test("acquisition is bounded before any whole proof and slow RTT fails margin",async()=>{
 let reads=0;
 const client={getBlock:async()=>{reads++;return block(1n);}} as unknown as PublicClient;
 await expect(acquireRecoveryHead(client,pass)).rejects.toMatchObject({reason:"head-timeout"});
 expect(reads).toBeLessThanOrEqual(32);
 reads=0;
 const slow={getBlock:async()=>{await new Promise(r=>setTimeout(r,60));return block(BigInt(++reads));}} as unknown as PublicClient;
 await expect(acquireRecoveryHead(slow,pass)).rejects.toMatchObject({reason:"latency-margin"});
 expect(reads).toBe(2);
},5000);
test("read-only reconciliation charges exactly 128 reads and drains expired operation",async()=>{
 let reads=0;
 await expect(readOnlyRecoveryPass(async p=>{for(let n=0;n<129;n++)await p.read(async()=>{reads++;});})).rejects.toMatchObject({reason:"pass-budget"});
 expect(reads).toBe(128);
 let active=0;
 await expect(readOnlyRecoveryPass(p=>p.read(async()=>{active++;try{await new Promise(r=>setTimeout(r,5050));}finally{active--;}}))).rejects.toMatchObject({reason:"pass-deadline"});
 expect(active).toBe(0);
},7000);
test("SELECT-only journal admission preserves every table and rejects outstanding signing",()=>{
 const coordinator=new ResolverTransactionCoordinator(":memory:");
 const db=(coordinator as unknown as {database:Database}).database;
 const input=verifyReviewedRecoveryManifest(readFileSync(new URL("../../../docs/recovery-58-input.json",import.meta.url),"utf8"));
 const binding=recoveryBinding(input);
 db.query("INSERT INTO resolver_prepared_intents(chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES(?,?,?,?,?,?,'pending')").run(input.chainId,input.address,input.operationId,input.nonce,input.originalHash,input.membership);
 const dump=()=>db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>{const name=(r as {name:string}).name;return [name,db.query('SELECT * FROM '+name).all()];});
 const before=JSON.stringify(dump());
 expect(assertRecoveryJournalReadiness(db,binding,input.maxFeeWei)).toBeUndefined();
 expect(JSON.stringify(dump())).toBe(before);
 db.query("INSERT INTO resolver_signing_reservations VALUES('held',?,?,?,?,?,0)").run(input.chainId,input.address,input.operationId,input.nonce,input.membership);
 expect(()=>assertRecoveryJournalReadiness(db,binding,input.maxFeeWei)).toThrow("journal-mismatch");
 db.close();
});
test("diagnostic never copies arbitrary transport exception fields or messages",()=>{
 const trace=new RecoveryTrace();
 expect(trace.diagnostic(Object.assign(new Error("credential raw envelope"),{reason:"credential",request:"raw envelope"}))).toMatchObject({stage:"journal",reason:"proof-rejected",reads:0});
 expect(JSON.stringify(trace.diagnostic(new Error("credential raw envelope")))).not.toContain("credential");
});

// Exercise nested viem wrappers without consulting provider-controlled messages.
import { BaseError, HttpRequestError, RpcRequestError, TimeoutError, ContractFunctionRevertedError, ExecutionRevertedError } from "viem";
import { BatchQuoteExpiredError } from "./missionBatchFees";
test("typed read diagnostics preserve domain, lease, deadline and freshness errors", async()=>{
 const trace=new RecoveryTrace();
 for(const error of [new HttpRequestError({url:"https://local.invalid",details:"DO_NOT_PRINT"}),
   new RpcRequestError({url:"https://local.invalid",body:{},error:{code:-32000,message:"DO_NOT_PRINT"}}),
   new TimeoutError({url:"https://local.invalid",body:{}})]) {
   const wrapped=new BaseError("DO_NOT_PRINT",{cause:error});
   const classified=classifyRecoveryReadError(wrapped);
   expect(trace.diagnostic(classified).reason).toBe("rpc-unavailable");
   expect(JSON.stringify(trace.diagnostic(classified))).not.toContain("DO_NOT_PRINT");
 }
 for(const error of [new RecoveryReadinessError("lease-lost"),new RecoveryReadinessError("pass-deadline"),
   new BatchQuoteExpiredError(),new Error("domain rejection"),new ExecutionRevertedError(),
   new ContractFunctionRevertedError({abi:[],functionName:"fixture",cause:new RpcRequestError({url:"https://local.invalid",body:{},error:{code:3,message:"DO_NOT_PRINT"}})})])expect(classifyRecoveryReadError(error)).toBe(error);
 const deadline=new RecoveryReadinessError("pass-deadline");
 const wrapped=trace.wrap({assertActive:()=>{throw deadline;},read:async()=>{throw new HttpRequestError({url:"https://local.invalid"});}});
 await expect(wrapped.read(async()=>0)).rejects.toBe(deadline);
});
