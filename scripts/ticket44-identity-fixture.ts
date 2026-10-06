/** #44 DEV ONLY. No forks, keys, public RPC or production deployment.
 * Code prepared before key availability. Modes: prepare | serve | replay | settle.
 * Requires separately approved final creationCode/runtimeCodehash and exported pre-job genesis.
 */
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import type {Hex} from "viem";

const BASE = new URL("../packages/contracts/", import.meta.url);
const DIR = new URL("manifests/ticket44-identity/", BASE).pathname;
const URL_LOCAL = "http://127.0.0.1:18444";
const GAS = 15_000_000n;
const json = (x: any) => JSON.stringify(x, (_,v) => typeof v === "bigint" ? v.toString() : v);
const load = (p: string) => JSON.parse(readFileSync(p,"utf8"));
const save = (name: string, x: any) => {
  const path=join(DIR,name);writeFileSync(path+".tmp",json(x)+String.fromCharCode(10));renameSync(path+".tmp",path);
};
const sha = (x: string|Buffer) => createHash("sha256").update(x).digest("hex");
const artifact = (name: string) => load(new URL("out/"+name+".sol/"+name+".json",BASE).pathname);
const strip = (s:string) => s.toLowerCase().replace(/^0x/,"");


export function checkLocalURL(url: string) {
  const u=new URL(url);assert.equal(u.protocol,"http:");assert.equal(u.hostname,"127.0.0.1");assert.equal(u.port,"18444");
  assert.equal(u.username,"");assert.equal(u.password,"");assert.equal(u.search,"");assert.equal(u.pathname,"/");
}
export function validateKey(key:any,meta:any) {
  assert.equal(key.developmentOnly,true);assert.equal(key.parentApproved,true);assert.equal(meta.developmentOnly,true);
  assert.equal(key.version,3);assert.equal(meta.chainId,31344);
  for(const k of ["rules","catalog","manifestSHA256"])assert.equal(meta[k].toLowerCase(),key[k].toLowerCase());
  assert.match(key.manifestSHA256,/^0x[0-9a-f]{64}$/);assert(!/^0x0+$/.test(key.manifestSHA256));
  assert.equal(meta.verifierCodehash.toLowerCase(),key.runtimeCodehash.toLowerCase());
  assert(BigInt(meta.verifier)>255n && BigInt(meta.game)>255n,"no precompile/old synthetic identity");
}

async function main(mode:string) {
  const {createPublicClient,http,encodeFunctionData,encodeAbiParameters,decodeAbiParameters,decodeEventLog,parseAbiParameters,keccak256,toHex}=await import("viem");
const rowABI = parseAbiParameters("(uint256 source,address owner,uint32 count,uint8 side,uint8 unit,uint16 weapons,uint16 shielding,uint16 armor) row");
const statusABI = parseAbiParameters("(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash) frozen,uint8 phase,bytes32 snapshot,bytes32 randomnessContext,uint256 seed,uint256 count");
  assert(["prepare","serve","replay","settle"].includes(mode),"mode required");
  checkLocalURL(URL_LOCAL);
  const key=load(join(DIR,"approved-key.json")), meta=load(join(DIR,"genesis-meta.json"));validateKey(key,meta);
  const alloc=load(join(DIR,"genesis-alloc.json"));
  assert.equal(keccak256(alloc[meta.verifier.toLowerCase()].code),meta.verifierCodehash.toLowerCase());
  const game=meta.game as Hex, engine=meta.engine as Hex;
  const gameABI=artifact("VeydriftGame").abi, engineABI=artifact("RandomnessEngine").abi;
  const proofABI=artifact("VeydriftProofBattle").abi, settleABI=artifact("VeydriftProofSettlementModule").abi;
  const genesis={config:{chainId:31344},timestamp:toHex(meta.timestamp),alloc};
  const genesisText=json(genesis), genesisHash=sha(genesisText);
  if(mode==="prepare") {
    assert(!existsSync(join(DIR,"journal.json")) && !existsSync(join(DIR,"node-state.json")),"new namespace required; no overwrite");
    writeFileSync(join(DIR,"genesis.json"),genesisText);
  } else assert.equal(sha(readFileSync(join(DIR,"genesis.json"))),genesisHash,"genesis changed");
  // Never attach to an existing endpoint, even if it resembles our chain.
  let occupied=false;try{await fetch(URL_LOCAL,{signal:AbortSignal.timeout(300)});occupied=true;}catch{}
  assert(!occupied,"local port already occupied");
  const state=join(DIR,mode==="replay"?"replayed-node-state.json":"node-state.json");
  if(!["prepare","replay"].includes(mode))assert(existsSync(state),"saved chain required");
  const args=["anvil","--host","127.0.0.1","--port","18444","--chain-id","31344","--gas-limit","15000000",
    "--base-fee","100","--preserve-historical-states","--dump-state",state,"--state-interval","30","--silent",
    ...(["prepare","replay"].includes(mode)?["--init",join(DIR,"genesis.json")]:["--load-state",state])];
  const child=Bun.spawn(args,{stdout:Bun.file(join(DIR,"anvil.log")),stderr:"inherit"});
  const client=createPublicClient({transport:http(URL_LOCAL,{retryCount:0,timeout:10000})});
  const rpc=async(method:string,params:any[]=[]) => client.request({method,params} as any) as Promise<any>;
  const journal:any[]=mode==="prepare"?[]:load(join(DIR,"journal.json"));
  let clock=Number(meta.timestamp);
  async function mutate(method:string,params:any[]) {
    // Persist intent before dispatch; uncertain tail is reconciled/replayed, never blindly resent.
    const item:any={method,params};journal.push(item);save("journal.json",journal);
    const result=await rpc(method,params);item.result=result;save("journal.json",journal);return result;
  }
  async function read(address:Hex,abi:any,name:string,args:any[]=[],blockNumber?:bigint):Promise<any>{
    return client.readContract({address,abi,functionName:name,args,blockNumber} as any);
  }
  async function tx(from:Hex,to:Hex,abi:any,name:string,args:any[]) {
    const head=await client.getBlock();clock=Math.max(clock+1,Number(head.timestamp)+1);
    await mutate("evm_setNextBlockTimestamp",[clock]);
    const nonce=await client.getTransactionCount({address:from});
    const hash=await mutate("eth_sendTransaction",[{from,to,nonce:toHex(nonce),data:encodeFunctionData({abi,functionName:name,args}),gas:toHex(GAS),gasPrice:"0x3b9aca00"}]);
    const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,"success",name);assert(receipt.gasUsed<=GAS);
    save("receipt-"+strip(hash)+".json",receipt);return receipt;
  }
  const progress=(id:bigint)=>read(game,gameABI,"stagedBattleProgress",[id]);
  async function until(id:bigint,phase:number) {
    for(let i=0;i<128;i++) { const p=await progress(id);if(Number(p[0])===phase)return;
      assert(Number(p[0])!==17 || phase===13,"cannot resolve through proof wait");
      await tx(meta.owners[0],game,gameABI,"resolveFleetMission",[id]); }
    throw new Error("bounded lifecycle steps exhausted");
  }
  async function verifyFrozen() {
    const bundle=load(join(DIR,"frozen.json"));assert.equal(bundle.genesisSHA256,genesisHash);
    assert.equal(await client.getCode({address:meta.verifier}),alloc[meta.verifier.toLowerCase()].code);
    for(const b of bundle.jobs) {
      const anchor=await client.getBlock({blockNumber:BigInt(b.anchor.Number)});assert.equal(strip(anchor.hash!),b.anchor.Hash,"saved anchor lost");
      assert.equal(await read(game,gameABI,"proofBattleRecord",[BigInt(b.id),0,0]),b.statusABI,"frozen status changed");
      const logs=await client.getLogs({address:game,fromBlock:BigInt(b.anchor.Number),toBlock:BigInt(b.anchor.Number)});
      assert(logs.some(l=>l.transactionHash===b.sealTransaction),"seal receipt/log history lost; use replay");
    }
    return bundle;
  }
  async function exportDocument(id:bigint,release:any,head:bigint) {
    const record=(kind:number,index:bigint=0n)=>read(game,gameABI,"proofBattleRecord",[id,kind,index],head) as Promise<Hex>;
    const status=await record(0),header=await record(1),eng=await record(5);
    const [v,phase,snapshot,context,seed,count]=decodeAbiParameters(statusABI,status);
    assert.equal(phase,3);assert(count<=8n,"fixture row budget, never truncation");
    const [engineAddress,requestId,purpose]=decodeAbiParameters(parseAbiParameters("address,uint256,bytes32"),eng);
    assert.equal(engineAddress.toLowerCase(),engine.toLowerCase());
    const callRaw=async(name:string)=> (await client.call({to:engine,data:encodeFunctionData({abi:engineABI,functionName:name,args:[requestId]}),blockNumber:head})).data!;
    const request=await callRaw("request"),policy=await callRaw("battleRequestPolicy");
    const logs=await client.getLogs({address:game,fromBlock:0n,toBlock:head});assert(logs.length<10000);
    const entries:any[]=[];let anchor:any,sealTransaction:Hex|undefined;
    let raw=keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,uint256,(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash),address,uint256,bytes32,bytes"),
      [keccak256(toHex("veydrift.qualified-raw-battle.v1")),31344n,game,id,v,engine,requestId,purpose,header]));
    let rows=0n;
    for(const l of logs) {let e:any;try{e=decodeEventLog({abi:proofABI,data:l.data,topics:l.topics});}catch{continue;}
      if(e.args.battleId!==id)continue;
      if(e.eventName==="ProofBattleSource") {
        const bytes=e.args.mission as Hex;assert.equal(await record(3,e.args.source),bytes);
        entries.push({Kind:"source",Index:String(e.args.source),ABI:bytes});
        raw=keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,uint256,bytes"),[raw,1,e.args.source,bytes]));
      } else if(e.eventName==="ProofBattleRow") {
        assert.equal(e.args.index,rows);const bytes=encodeAbiParameters(rowABI,[e.args.row]);assert.equal(await record(2,rows),bytes);
        entries.push({Kind:"row",Index:String(rows),ABI:bytes});
        raw=keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,uint256,(uint256 source,address owner,uint32 count,uint8 side,uint8 unit,uint16 weapons,uint16 shielding,uint16 armor)"),[raw,2,rows,e.args.row]));rows++;
      } else if(e.eventName==="ProofBattleSealed") {
        assert(!anchor,"duplicate seal");assert.equal(e.args.snapshot,snapshot);assert.equal(e.args.rows,count);
        anchor={Number:Number(l.blockNumber),Hash:strip(l.blockHash!)};sealTransaction=l.transactionHash!;
      }
    }
    assert(anchor && rows===count);assert.equal(keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,uint256"),[raw,3,count])),snapshot);
    const words=[BigInt(keccak256(toHex("veydrift.proof-battle.public-record.v1"))),31344n,BigInt(game),id,BigInt(v.version),BigInt(v.rules),BigInt(v.catalog),BigInt(v.verifier),BigInt(v.verifierCodehash),BigInt(engine),requestId,BigInt(purpose),BigInt(snapshot),BigInt(context),seed,count,BigInt(phase)];
    const chainRecord=strip(keccak256(encodeAbiParameters(parseAbiParameters("uint256[17]"),[words])));
    const doc={Schema:"veydrift.finalized-public-input.v1",ChainID:"31344",Game:game.toLowerCase(),BattleID:String(id),Release:release,Anchor:anchor,StatusABI:status,HeaderABI:header,EngineABI:eng,RequestABI:request,PolicyABI:policy,Journal:entries,ChainRecord:chainRecord};
    // Go Document canonical field order; no trailing newline in content-addressed bytes.
    const bytes=json(doc);writeFileSync(join(DIR,"battle-"+id+".document.json"),bytes);
    return {id:String(id),anchor,sealTransaction,statusABI:status,chainRecord,inputSHA256:sha(bytes),rows:String(count)};
  }
  try {
    let ready=false;for(let i=0;i<100;i++){try{assert.equal(await rpc("eth_chainId"),toHex(31344));ready=true;break;}catch{await Bun.sleep(100);}}assert(ready,"owned node not ready");
    if(mode==="replay") {
      for(const item of journal){assert(Object.hasOwn(item,"result"),"uncertain journal tail needs manual reconciliation");const result=await rpc(item.method,item.params);assert.deepEqual(result,item.result,"deterministic RPC replay mismatch");}
      await verifyFrozen();console.log("REPLAY PASS; frozen anchors and raw status unchanged");return;
    }
    if(mode==="prepare") {
      for(const [address,state] of Object.entries(alloc) as any){if(state.code!=="0x")assert.equal(await client.getCode({address}),state.code,"genesis code missing");}
      assert.equal(await read(game,gameABI,"nextFleetId"),1n,"no pre-existing jobs");
      for(const a of [...meta.owners,meta.fulfiller])await mutate("anvil_impersonateAccount",[a]);
      const ids:bigint[]=[];
      for(let i=0;i<2;i++) {
        const seed=BigInt(i+1);const commitment=await read(engine,engineABI,"randomnessCommitment",[seed]);
        await tx(meta.fulfiller,engine,engineABI,"commitRandomness",[commitment]);
        const id=await read(game,gameABI,"nextFleetId");ids.push(id);
        const ships={smallCargo:0,lightFighter:0,recycler:0,colonyShip:0,largeCargo:0,heavyFighter:0,cruiser:0,battleship:0,bomber:0,destroyer:i===0?2:1,deathstar:0,battlecruiser:0,reaper:0,pathfinder:0};
        await tx(meta.owners[i*2],game,gameABI,"launchBodyFleetMission",[BigInt(meta.planets[i*2]),BigInt(meta.planets[i*2+1]),3,ships,{metal:0,crystal:0,deuterium:0},100,false,false]);
        const mission=await read(game,gameABI,"fleetMission",[id]);
        clock=Math.max(clock,Number(mission[6]));await mutate("evm_setNextBlockTimestamp",[clock]);await mutate("evm_mine",[]);
        await until(id,16);
        const en=await read(game,gameABI,"proofBattleRecord",[id,5,0]);const [,requestId]=decodeAbiParameters(parseAbiParameters("address,uint256,bytes32"),en);
        await tx(meta.fulfiller,engine,engineABI,"fulfillRandomness",[requestId,seed]);
        await until(id,17);
      }
      // Fresh finalized head on this local chain; anchor remains the original seal, not this head.
      await mutate("anvil_mine",["0x80","0x1"]);
      const head=await client.getBlock({blockTag:"finalized"});assert(head.number!==null);
      const release={Version:3,Rules:strip(meta.rules),Catalog:strip(meta.catalog),Verifier:meta.verifier.toLowerCase(),VerifierCodehash:strip(meta.verifierCodehash),Engine:engine.toLowerCase(),VerifierManifest:strip(meta.manifestSHA256)};
      const jobs=[];for(const id of ids)jobs.push(await exportDocument(id,release,head.number));
      assert.notEqual(jobs[0].chainRecord,jobs[1].chainRecord);
      save("frozen.json",{schema:"ticket44.local-frozen.v1",genesisSHA256:genesisHash,release,jobs,head:{number:String(head.number),hash:head.hash}});
      save("source-config.json",{URL:URL_LOCAL,ChainID:"31344",Game:game.toLowerCase(),DeploymentBlock:0,Release:release,BlockPage:128,FleetPage:16,MaxPages:32,MaxFleetReads:64,MaxLogs:10000,MaxRows:8,MaxInputBytes:1048576,MaxResponseBytes:4194304});
      console.log("Frozen two real local jobs; no proof acceptance claimed");
    } else {
      const frozen=await verifyFrozen();
      if(mode==="serve") {console.log("Owned local Source endpoint "+URL_LOCAL+"; SIGINT to persist and stop");await new Promise<void>(resolve=>{process.once("SIGINT",resolve);process.once("SIGTERM",resolve);});}
      else {
        // Wire format intentionally separate from runtime internals: parent supplies authenticated result exports.
        for(const job of frozen.jobs) {
          const result=load(join(DIR,"battle-"+job.id+".proof.json"));
          assert.equal(result.chainRecord,job.chainRecord);assert.equal(result.manifestSHA256,strip(meta.manifestSHA256));
          const inputs=result.public.map((x:string)=>BigInt(x));assert.equal(inputs.length,22);assert.equal((result.proof.length-2)/2,384);
          const id=BigInt(job.id),before=await progress(id);
          await rpc("anvil_impersonateAccount",[meta.owners[0]]);
          let receipt:any=null;
          let application=await read(game,settleABI,"proofSettlementProgress",[id]);
          if(Number(application[0])===0) {
            assert.equal(Number(before[0]),17);
            receipt=await tx(meta.owners[0],game,settleABI,"submitBattleProof",[id,result.proof,inputs]);
            const accepted=receipt.logs.filter((l:any)=>{try{return decodeEventLog({abi:settleABI,data:l.data,topics:l.topics}).eventName==="ProofBattleAccepted";}catch{return false;}});
            assert.equal(accepted.length,1);assert.equal((await progress(id))[2],before[2]+1n);
          }
          const summary=await read(game,settleABI,"proofBattleAcceptedSummary",[id]);assert.equal(strip(summary[0]),job.chainRecord);
          const word=(offset:number)=>inputs.slice(offset,offset+4).reduce((v:bigint,x:bigint,i:number)=>v|(x<<BigInt(64*i)),0n);
          assert.equal(summary[2],toHex(word(4),{size:32}));assert.equal(summary[3],word(8));
          assert.equal(BigInt(result.leaves.length),summary[3]);
          application=await read(game,settleABI,"proofSettlementProgress",[id]);
          assert(application[1]<=BigInt(result.leaves.length));
          for(let start=Number(application[1]);start<result.leaves.length;start+=32)await tx(meta.owners[0],game,settleABI,"applyProofBattleLeaves",[id,result.leaves.slice(start,start+32)]);
          const finalSummary=await read(game,settleABI,"proofBattleAcceptedSummary",[id]);assert.deepEqual(finalSummary,summary);
          await until(id,13);let mission=await read(game,gameABI,"fleetMission",[id]);assert.notEqual(Number(mission[0]),1);
          if(Number(mission[0])===2) {
            clock=Math.max(clock,Number(mission[7]));await mutate("evm_setNextBlockTimestamp",[clock+1]);await mutate("evm_mine",[]);
            for(let step=0;step<32 && Number(mission[0])===2;step++){
              await tx(meta.owners[0],game,gameABI,"completeFleetMissionReturn",[id]);mission=await read(game,gameABI,"fleetMission",[id]);
            }
          }
          assert([3,4].includes(Number(mission[0])),"terminal return required");
          const expectedAttack=result.leaves.filter((l:any)=>Number(l.side)===0).reduce((n:bigint,l:any)=>n+BigInt(l.survivors),0n);
          const expectedResident=result.leaves.filter((l:any)=>Number(l.side)===1).reduce((n:bigint,l:any)=>n+BigInt(l.survivors),0n);
          assert.equal(BigInt(await read(game,gameABI,"shipCount",[mission[3],10])),expectedAttack,"returned destroyers");
          assert.equal(BigInt(await read(game,gameABI,"shipCount",[mission[4],0])),expectedResident,"resident cargo ships");
          assert.equal(BigInt(await read(game,gameABI,"activeFleetMissionCount",[mission[2]])),0n,"fleet slot released");
          save("battle-"+id+".settled.json",{receipt,summary,progress:await progress(id),mission});
        }
      }
    }
  } finally {child.kill("SIGTERM");await child.exited;}
}
if(import.meta.main)await main(process.argv[2]??"");
