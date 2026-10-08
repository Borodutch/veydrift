import { privateKeyToAccount } from "viem/accounts";
import { serializeTransaction } from "viem";
import { RecoveryTrace } from "./recoveryReadiness";
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, encodeAbiParameters, encodeFunctionResult, toHex, keccak256, type Hex } from "viem";
import { prepareRecoveryEnvelope, recoveryReadiness } from "./missionLegacyRecovery";
import { verifyReviewedRecoveryManifest, assertRecoveryJournalReadiness } from "./missionLegacyRecoveryCli";
import { missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";

const actual = verifyReviewedRecoveryManifest(readFileSync(new URL("../../../docs/recovery-58-input.json",import.meta.url), "utf8"));
const abi = parseAbi(["function fleetMission(uint256) view returns (uint8,uint8,address,uint256,uint256,uint64,uint64,uint64,uint128,(uint128 metal,uint128 crystal,uint128 deuterium),uint256)"]);


import { Database } from 'bun:sqlite';
import { ResolverTransactionCoordinator } from './resolverTransactions';
import { ViemMissionResolutionChainClient } from './missionResolution';
import { recoveryBinding } from './missionLegacyRecovery';

for (const phase of [800,1500]) for (const path of ['dry', 'complete', 'persisted', 'persisted-dry', 'wallclock', 'old-path']) for(const failure of ['none','head','reference','nonce','lease','deadline','budget','rpc','paused','freshness','proof-freshness','acquisition-rpc','nonce-rpc','identity-rpc','reference-rpc','fee-rpc','simulation-rpc','lookup-rpc','identity-domain','fee-domain','simulation-domain','simulation-revert','cooldown','early-wait','early-deadline','expired-hold'] as const) {
 if(['wallclock','old-path'].includes(path) && (phase!==800||failure!=='none'))continue;
 if(['cooldown','early-wait','early-deadline','expired-hold'].includes(failure) && !path.startsWith('persisted'))continue;
 if(path==='persisted-dry' && ['lease','budget'].includes(failure))continue;
 if(path==='dry' && ['lease','deadline','budget'].includes(failure))continue;
 test('phase '+phase+' '+path+' '+failure, async()=>{
  const fixtureAccount=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex);
  const input={...actual,...(path.startsWith('persisted')?{address:fixtureAccount.address.toLowerCase() as Hex}:{}),identities:actual.identities.map(i=>({...i,codeHash:keccak256('0x6000')}))};
  const mission=encodeFunctionResult({abi,functionName:'fleetMission',result:[2,0,input.mission.owner,BigInt(input.mission.origin),BigInt(input.mission.target),1n,2n,BigInt(input.mission.returnAt),16n,{metal:0n,crystal:0n,deuterium:0n},0n]});
  const base=BigInt(keccak256(encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[99306n,24n])));
  let reads=0, active=0, peak=0, clock=phase, signs=0, sends=0, waits=0;
  const events:any[]=[];
  const realPerformanceNow=performance.now.bind(performance);
  const started=realPerformanceNow(), originalFetch=globalThis.fetch;
  // Deterministic 40ms RPC waves; acquisition sleeps still advance virtual time.
  const realSetTimeout=globalThis.setTimeout;
  if(path!=='wallclock')performance.now=()=>clock;
  if(path!=='wallclock')globalThis.setTimeout=((handler:TimerHandler,ms?:number,...args:any[])=>realSetTimeout(()=>{if(ms===100)clock+=100; (handler as (...args:any[])=>void)(...args);},ms===100?1:ms)) as unknown as typeof setTimeout;
  const trace=new RecoveryTrace();
  let db:Database|undefined;
  let simulated=false;
  const stamp=BigInt(Math.floor(Date.now()/1000));
  globalThis.fetch=(async(url,init)=>{
   expect(['https://local.invalid',new URL(input.referenceRpcUrl).origin]).toContain(new URL(String(url)).origin);
   const q=JSON.parse(init!.body as string);reads++;active++;peak=Math.max(peak,active);
   const end=clock+40;
   try {
    await new Promise(resolve=>setTimeout(resolve,path==='wallclock'?20:1));clock=path==='wallclock'?phase+realPerformanceNow()-started:Math.max(clock,end);
    let result:unknown;
    const reference=new URL(String(url)).origin===new URL(input.referenceRpcUrl).origin;
    const injected=(failure==='acquisition-rpc'&&trace.stage==='fresh-head')
      || (failure==='nonce-rpc'&&q.method==='eth_getTransactionCount'&&!reference)
      || (failure==='identity-rpc'&&q.method==='eth_getCode')
      || (failure==='reference-rpc'&&reference)
      || (failure==='fee-rpc'&&q.method==='eth_call'&&!q.params[0].data.startsWith('0xf158c946'))
      || (failure==='simulation-rpc'&&q.method==='eth_call'&&q.params[0].data.startsWith('0x5fca0af0'))
      || (failure==='lookup-rpc'&&q.method==='eth_getTransactionByHash');
    if(injected)return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'DO_NOT_PRINT_SECRET_RAW_ENVELOPE'}}),{headers:{'content-type':'application/json'}});
    if(failure==='simulation-revert'&&q.method==='eth_call'&&q.params[0].data.startsWith('0x5fca0af0'))
      return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted',data:'0x'}}),{headers:{'content-type':'application/json'}});
    if(q.method==='eth_chainId')result='0x2105';
    else if(q.method==='eth_getTransactionCount') result=toHex(input.nonce+((simulated&&failure==='nonce') || (simulated&&failure==='reference'&&new URL(String(url)).origin===new URL(input.referenceRpcUrl).origin)?1:0));
    else if(q.method==='eth_getTransactionReceipt'||q.method==='eth_getTransactionByHash') {
      if(simulated&&failure==='lease')db?.exec('UPDATE resolver_transaction_leases SET expires_at_ms=0');
      if(simulated&&failure==='deadline') { if(path.startsWith('persisted'))clock+=5001; else await new Promise(resolve=>setTimeout(resolve,600)); }
      if(simulated&&failure==='rpc')return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'DO_NOT_PRINT_SECRET_RAW_ENVELOPE'}}),{headers:{'content-type':'application/json'}});
      result=null;
    }
    else if(q.method==='eth_getBlockByNumber') {
     const n=q.params[0]==='latest'?Math.floor(clock/2000)+1+(simulated&&failure==='head'?1:0):Number(BigInt(q.params[0]));
     result={number:toHex(n),hash:toHex(n,{size:32}),timestamp:toHex((simulated&&failure==='freshness')||(trace.stage==='proof'&&failure==='proof-freshness')?stamp-31n:stamp),baseFeePerGas:'0x64',gasLimit:'0x1c9c380',transactions:[]};
     events.push({method:q.method,param:q.params[0],n,clock});
    } else if(q.method==='eth_getStorageAt') {
     const slot=q.params[1];result=BigInt(slot)===52n?toHex(failure==='paused'?1n:0n,{size:32}):slot.startsWith('0x360894')?toHex(BigInt(input.implementation),{size:32}):BigInt(slot)===base+7n?input.mission.shipsWords[0]:BigInt(slot)===base+8n?input.mission.shipsWords[1]:input.mission.bodyFlags;
    } else if(q.method==='eth_getCode')result=failure==='identity-domain'?'0x6001':'0x6000';
    else if(q.method==='eth_getBalance')result=toHex(10n**18n);
    else if(q.method==='eth_maxPriorityFeePerGas')result='0xa';
    else if(q.method==='eth_call') {
     const data=q.params[0].data;
     if(data.startsWith('0xf158c946'))result=mission;
     else if(data.startsWith('0x5fca0af0')){simulated=true;result=encodeFunctionResult({abi:missionBatchAbi,functionName:'resolveFleetMissionBatch',result:[[failure==='simulation-domain'?1:0],100000n]});}
     else result=toHex(failure==='fee-domain'?10n**18n:100n,{size:32});
    } else {if(q.method==='eth_sendRawTransaction')sends++;throw new Error('unexpected RPC '+q.method);}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}),{headers:{'content-type':'application/json'}});
   }finally{active--;}
  }) as typeof fetch;
  let error='',history:any[]=[],reservationCount=0;
  try {
   const client=createPublicClient({transport:http('https://local.invalid',{retryCount:0})});
   if(path==='dry') {
    try{await recoveryReadiness(client,input,{...defaultMissionBatchPolicy,enabled:true},trace);}catch(e){error=trace.diagnostic(e).reason;}
   } else {
    const coordinator=new ResolverTransactionCoordinator(':memory:',{reconciliationTimeoutMs:failure==='deadline'&&!path.startsWith('persisted')?500:5000,reconciliationReadLimit:failure==='budget'?5:128,sleep:async ms=>{waits++;expect(ms).toBeGreaterThan(0);clock+=ms;}});
    db=(coordinator as any).database as Database;
    const binding=recoveryBinding(input);
    db.query('INSERT INTO resolver_transaction_attempts VALUES(?,?,?,?,?,?,?)').run(8453,input.address,input.operationId,input.nonce,input.originalHash,'submitted','fixture');
    db.query("INSERT INTO resolver_prepared_intents(chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES(?,?,?,?,?,?,'pending')").run(8453,input.address,input.operationId,input.nonce,input.originalHash,input.membership);
    if(path.startsWith('persisted')) {
      const tx={type:'eip1559' as const,chainId:8453,nonce:input.nonce,to:input.game,data:binding.data,value:0n,gas:BigInt(input.gas),maxFeePerGas:23995423n,maxPriorityFeePerGas:23995423n};
      const raw=await fixtureAccount.signTransaction(tx), alternative=keccak256(raw);
      db.query('INSERT INTO resolver_nonce_recovery(chain_id,resolver_address,nonce,binding,original_hash,alternative_hash,max_fee_wei,reservation_id,unsigned_plan) VALUES(?,?,?,?,?,?,?,?,?)').run(8453,input.address,input.nonce,JSON.stringify(binding),input.originalHash,alternative,input.maxFeeWei,'fixture-reservation',serializeTransaction(tx));
      db.query('INSERT INTO resolver_signing_reservations VALUES(?,?,?,?,?,?,1)').run('fixture-reservation',8453,input.address,input.operationId,input.nonce,input.membership);
      db.query('INSERT INTO resolver_signing_results VALUES(?,?,?)').run('fixture-reservation',alternative,raw);
      db.query("INSERT INTO resolver_prepared_intents(chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,serialized_transaction,replay_state,replay_max_fee_wei) VALUES(?,?,?,?,?,?,'pending',?,'unvalidated',?)").run(8453,input.address,input.operationId,input.nonce,alternative,input.membership,raw,input.maxFeeWei);
      if(['cooldown','early-wait','early-deadline','expired-hold'].includes(failure))
        db.query("UPDATE resolver_prepared_intents SET replay_state='retryable',send_attempts=?,next_retry_ms=? WHERE transaction_hash=?")
          .run(failure.startsWith('early')?1:3,Date.now()+(failure==='cooldown'?60000:failure==='early-wait'?250:failure==='early-deadline'?6000:-1),alternative);
      // Stop after the production synchronous pre-dispatch guard, before even entering sendPrepared.
      (coordinator as any).sendPrepared=async (...args:any[])=>{args[5]();throw new Error('SAFE_DISPATCH_SENTINEL');};
    }
    if(path==='old-path') {
      // Actual coordinator ordering, but the old unaligned envelope callback.
      const originalRecover=coordinator.recoverLegacySameNonce.bind(coordinator);
      coordinator.recoverLegacySameNonce=(b,_prepare,cap,t)=>originalRecover(b,async(sign,assertLease)=>{
        const p={assertActive:assertLease,read:async<T>(fn:()=>Promise<T>)=>{assertLease();return fn();}};
        await p.read(()=>client.getStorageAt({address:input.game,slot:toHex(52n,{size:32})}));
        const prepared=await prepareRecoveryEnvelope(client,input,{...defaultMissionBatchPolicy,enabled:true},p);
        coordinator.recordRecoveryQuote(b,prepared.evidence,assertLease);
        await sign(async()=>{signs++;throw new Error('SAFE_SIGNER_SENTINEL');},serializeTransaction(prepared.transaction),prepared.guard);
      },cap,t);
    }
    const chain={id:8453,name:'fixture',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://local.invalid']}}};
    // No key exists. Deliberate sentinel terminates at signer entry, before any signature.
    const account={address:input.address,signTransaction:async()=>{signs++;throw new Error('SAFE_SIGNER_SENTINEL');}};
    const reader={listResolvableFleetMissions:async()=>[],listReturnableFleetMissions:async()=>[],getCanonicalFleetMission:async()=>({status:'Returning'})};
    const service=new ViemMissionResolutionChainClient(reader as any,input.game,account as any,client as any,undefined,chain,undefined,coordinator,undefined,undefined,{...defaultMissionBatchPolicy,enabled:true});
    try{
      if(path==='persisted-dry') {
        const dump=()=>JSON.stringify(db!.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>{const name=(r as {name:string}).name;return [name,db!.query('SELECT * FROM '+name).all()];}));
        const before=dump();
        const persisted=assertRecoveryJournalReadiness(db,binding,input.maxFeeWei);
        expect(persisted).toBeDefined();
        try { await recoveryReadiness(client,input,{...defaultMissionBatchPolicy,enabled:true},trace,persisted); } finally { expect(dump()).toBe(before); }
      } else await service.recoverLegacyMission(input,trace);
    }catch(e){error=['SAFE_SIGNER_SENTINEL','SAFE_DISPATCH_SENTINEL'].includes((e as Error).message)?(e as Error).message:trace.diagnostic(e).reason;}
    if(failure==='deadline')await new Promise(resolve=>setTimeout(resolve,200));
    history=db.query('SELECT event FROM resolver_nonce_recovery_history').all();
    reservationCount=(db.query('SELECT count(*) n FROM resolver_signing_reservations').get() as any).n;
    expect(db.query('SELECT count(*) n FROM resolver_signing_results').get()).toEqual({n:path.startsWith('persisted')?1:0});
    expect(db.query('SELECT count(*) n FROM resolver_transaction_leases').get()).toEqual({n:0});
    db.close();
   }
   expect(active).toBe(0);expect(sends).toBe(0);expect(peak).toBeLessThanOrEqual(8);
   expect(input.identities).toHaveLength(15);
   const success=failure==='none'||failure==='expired-hold'||(failure==='early-wait'&&path==='persisted');
   const held=failure==='cooldown'||(failure.startsWith('early')&&path==='persisted-dry');
   if(failure.startsWith('early'))expect(waits).toBe(path==='persisted'?1:0);
   if(held) { expect(simulated).toBe(false);expect(reads).toBeLessThan(25); }
   if(!['old-path','wallclock'].includes(path)) {
     const expectedStage=held||failure==='early-deadline'?'retry-hold':success?(path==='persisted'?'dispatch':'final-guard'):
       failure==='acquisition-rpc'?'fresh-head':['nonce-rpc','lookup-rpc','budget'].includes(failure)?'initial-candidates':
       ['proof-freshness','identity-rpc','reference-rpc','fee-rpc','simulation-rpc','identity-domain','fee-domain','simulation-domain','simulation-revert'].includes(failure)?'proof':
       failure==='head'?'final-head':failure==='reference'?'final-identity':failure==='paused'?'pause':'post-quote-candidates';
     expect(trace.stage).toBe(expectedStage);
   }
   if(failure==='none'&&path!=='old-path') {
     expect(reads).toBeGreaterThan(75);
     expect(events.filter(e=>e.param==='latest').length).toBeGreaterThan(3);
   }
   if(path==='old-path'){expect(error).toBe('head-moved');expect(signs).toBe(0);expect(reservationCount).toBe(0);expect(history.map(e=>e.event)).toEqual(['claimed','original-attempt','quote']);}
   else if(success) {expect(error).toBe(['dry','persisted-dry'].includes(path)?'':path==='persisted'?'SAFE_DISPATCH_SENTINEL':'SAFE_SIGNER_SENTINEL');expect(signs).toBe(['complete','wallclock'].includes(path)?1:0);}
   else {
     expect(error).toBe(held?'retry-cooldown':failure==='early-deadline'?'pass-deadline':failure.endsWith('-rpc')?'rpc-unavailable':failure.endsWith('-domain')||failure==='simulation-revert'?'proof-rejected':failure==='proof-freshness'?'quote-expired':({head:'head-moved',reference:'reference-disagreement',nonce:'nonce-changed',lease:'lease-lost',deadline:'pass-deadline',budget:'pass-budget',rpc:'rpc-unavailable',paused:'paused',freshness:'quote-expired'} as Record<string,string>)[failure]!);
     expect(signs).toBe(0);expect(reservationCount).toBe(path.startsWith('persisted')?1:0);
     if(path==='complete'&&['head','reference','nonce','lease','rpc'].includes(failure))expect(history.map(e=>e.event)).toEqual(['claimed','original-attempt','quote']);
   }
   expect(JSON.stringify(trace.diagnostic(new Error('DO_NOT_PRINT_SECRET_RAW_ENVELOPE')))).not.toContain('DO_NOT_PRINT');
  }finally{globalThis.fetch=originalFetch;performance.now=realPerformanceNow;globalThis.setTimeout=realSetTimeout;}
 },10000);
}
