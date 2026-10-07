import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createConnection} from "node:net";
export const canonical=(v:any)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x);
export const digest=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const low=(x:string)=>x.toLowerCase();

// No network probing: lsof inspects kernel ownership, not an unrelated HTTP listener.
export function listenerPids(probe:{code:number;out:string;err:string}):number[] {
  assert.equal(probe.err, "", "ambiguous listener inspection");
  if(probe.code===1 && probe.out.trim()==="")return [];
  assert.equal(probe.code,0,"listener inspection failed");
  const lines=probe.out.trim().split(/\r?\n/);
  const pids:number[]=[];
  for(const line of lines){
    if(/^p[1-9][0-9]*$/.test(line))pids.push(Number(line.slice(1)));
    else assert(pids.length>0 && /^f[0-9]+$/.test(line),"ambiguous listener output");
  }
  assert(pids.length>0,"missing listener PID");return [...new Set(pids)];
}
export async function inspectListeners(port:number):Promise<number[]> {
  assert(Number.isInteger(port)&&port>0&&port<65536);
  const p=Bun.spawn(["lsof","-nP","-iTCP:"+port,"-sTCP:LISTEN","-Fp"],{stdout:"pipe",stderr:"pipe"});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},2000);
  try {const [code,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);assert(!timedOut,"ambiguous listener timeout");return listenerPids({code,out,err});}
  finally{clearTimeout(timer);}
}
export function childAlive(child:{pid:number;exitCode:number|null}) {
  assert.equal(child.exitCode,null,"owned child exited");assert(child.pid>0);
}
export async function proveListener(child:{pid:number;exitCode:number|null},probe:()=>Promise<number[]>) {
  childAlive(child);const pids=await probe();childAlive(child);
  assert.deepEqual(pids,[child.pid],"listener is not owned by this child");
}
// All driver RPC uses the child's private 0700-directory IPC socket, never ambient HTTP.
export function ownedIPC(path:string,child:{pid:number;exitCode:number|null},method:string,params:any[]=[]):Promise<any>{
  childAlive(child);
  return new Promise((resolve,reject)=>{
    const socket=createConnection(path);let buf="",done=false;
    const finish=(error?:Error,value?:any)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
    socket.setTimeout(10000,()=>finish(new Error("owned IPC timeout; outcome uncertain")));
    socket.on("error",e=>finish(e));socket.on("end",()=>finish(new Error("owned IPC closed before response")));
    socket.on("connect",()=>{try{childAlive(child);socket.write(canonical({jsonrpc:"2.0",id:1,method,params})+String.fromCharCode(10));}catch(e){finish(e as Error);}});
    socket.on("data",chunk=>{try{
      childAlive(child);buf+=chunk.toString();assert(buf.length<=16*1024*1024,"IPC response budget");
      let value:any;try{value=JSON.parse(buf);}catch{return;}
      assert.equal(value.id,1);assert.equal(value.jsonrpc,"2.0");assert(!value.error,canonical(value.error));assert(Object.hasOwn(value,"result"));
      finish(undefined,value.result);
    }catch(e){finish(e as Error);}});
  });
}
export function receiptIdentity(r:any){
  assert(r && (r.status==="success"||r.status==="0x1"),"missing/failed receipt");
  assert(BigInt(r.gasUsed)>=0n && BigInt(r.gasUsed)<=15_000_000n,"transaction cap");
  return {hash:low(r.transactionHash),blockHash:low(r.blockHash),blockNumber:String(BigInt(r.blockNumber)),gasUsed:String(BigInt(r.gasUsed)),
    logs:r.logs.map((l:any)=>({address:low(l.address),topics:l.topics.map(low),data:low(l.data),logIndex:String(BigInt(l.logIndex))}))};
}
export function checkJournal(journal:any[],file:(name:string)=>Buffer){
  assert(Array.isArray(journal));const transactions=new Set<string>();
  journal.forEach((item,i)=>{
    assert.equal(item.seq,i,"journal position");assert(Object.hasOwn(item,"result"),"uncertain journal result; manual reconciliation required");
    assert(item.head?.hash && item.head?.number!==undefined,"missing journal head");
    if(item.method==="eth_sendTransaction"){
      assert(!transactions.has(low(item.result)),"duplicate transaction journal position");transactions.add(low(item.result));
      assert.equal(item.receiptFile,"receipt-"+item.result.slice(2).toLowerCase()+".json","receipt position");
      const bytes=file(item.receiptFile);assert.equal(digest(bytes),item.receiptSHA256,"receipt hash/position");
      const r=receiptIdentity(JSON.parse(bytes.toString()));assert.equal(r.hash,low(item.result));
      assert.equal(r.blockHash,low(item.head.hash));assert.equal(r.blockNumber,String(BigInt(item.head.number)));
    }
  });
}
export function checkResume(journal:any[],checkpoint:any,snapshot:Buffer,file:(name:string)=>Buffer){
  checkJournal(journal,file);
  assert.equal(checkpoint?.schema,"ticket44.clean-checkpoint.v2","clean checkpoint required");
  assert.equal(checkpoint.position,journal.length,"snapshot/journal position differs; reconcile before any mutation");
  assert.equal(checkpoint.journalSHA256,digest(canonical(journal)),"snapshot journal digest");
  assert.equal(checkpoint.snapshotSHA256,digest(snapshot),"snapshot file differs from checkpoint");
  assert.deepEqual(checkpoint.head,journal.at(-1)?.head??checkpoint.genesisHead,"snapshot head/position");
}
export async function reconcileReceipts(journal:any[],checkpoint:any,file:(name:string)=>Buffer,rpc:(m:string,p?:any[])=>Promise<any>){
  const head=await rpc("eth_getBlockByNumber",["latest",false]);
  assert.equal(low(head.hash),low(checkpoint.head.hash));assert.equal(BigInt(head.number),BigInt(checkpoint.head.number));
  for(const item of journal){if(item.method!=="eth_sendTransaction")continue;
    const saved=receiptIdentity(JSON.parse(file(item.receiptFile).toString()));
    const actual=receiptIdentity(await rpc("eth_getTransactionReceipt",[item.result]));assert.deepEqual(actual,saved,"receipt not present at snapshot position");
    const tx=await rpc("eth_getTransactionByHash",[item.result]);assert(tx,"missing transaction");const want=item.params[0];
    for(const key of ["from","to"])assert.equal(low(tx[key]),low(want[key]),"transaction identity");
    assert.equal(low(tx.input),low(want.data));
    for(const key of ["nonce","gas","gasPrice"])assert.equal(BigInt(tx[key]),BigInt(want[key]),"transaction field "+key);
  }
}
export function expectedAcceptance(id:bigint,publics:bigint[],release:string,version:number){
  assert.equal(publics.length,22);
  const word=(offset:number)=>publics.slice(offset,offset+4).reduce((n,x,i)=>{assert(x>=0n&&x<(1n<<64n));return n|(x<<BigInt(64*i));},0n);
  const hex=(n:bigint)=>"0x"+n.toString(16).padStart(64,"0");
  const totals=[word(13),word(17)];const outcome=totals[0]>0n&&totals[1]===0n?1n:totals[0]===0n&&totals[1]>0n?2n:0n;
  assert(publics[12]>=0n&&publics[12]<=6n);assert.equal(publics[21],outcome);
  return {battleId:id,binding:hex(word(0)),releaseId:low(release),root:hex(word(4)),memberCount:word(8),rounds:publics[12],side0:totals[0],side1:totals[1],outcome,version:BigInt(version)};
}
export function checkAcceptance(event:any,summary:any,expected:any,before:bigint,after:bigint){
  for(const key of ["binding","releaseId","root"])assert.equal(low(event[key]),expected[key],"acceptance "+key);
  for(const key of ["battleId","memberCount","rounds","side0","side1","outcome","version"])assert.equal(BigInt(event[key]),expected[key],"acceptance "+key);
  const actual=[low(summary[0]),low(summary[1]),low(summary[2]),BigInt(summary[3]),BigInt(summary[4]),summary[5].map(BigInt),BigInt(summary[6]),BigInt(summary[7])];
  assert.deepEqual(actual,[expected.binding,expected.releaseId,expected.root,expected.memberCount,expected.rounds,[expected.side0,expected.side1],expected.outcome,expected.version],"complete immutable summary");
  assert.equal(after,before+1n,"acceptance workDone delta");
}
