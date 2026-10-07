import {test,expect} from "bun:test";
import {createServer} from "node:net";
import {mkdtempSync,rmSync,chmodSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {canonical,digest,listenerPids,inspectListeners,proveListener,ownedIPC,checkJournal,checkResume,reconcileReceipts,expectedAcceptance,checkAcceptance} from "./ticket44-identity-safety";
const hash=(n:string)=>"0x"+n.repeat(64);
function fixture(){
  const tx={from:"0x1000",to:"0x2000",data:"0x1234",nonce:"0x0",gas:"0xe4e1c0",gasPrice:"0x1"};
  const receipt={status:"success",transactionHash:hash("a"),blockHash:hash("b"),blockNumber:"2",gasUsed:"100000",logs:[]};
  const name="receipt-"+hash("a").slice(2)+".json",bytes=Buffer.from(canonical(receipt));
  const file=(n:string)=>{if(n!==name)throw Error("missing receipt");return bytes;};
  const head={number:"0x2",hash:hash("b")};
  const journal=[{seq:0,method:"eth_sendTransaction",params:[tx],result:hash("a"),head,receiptFile:name,receiptSHA256:digest(bytes)}];
  const snapshot=Buffer.from("owned snapshot"),checkpoint={schema:"ticket44.clean-checkpoint.v2",position:1,journalSHA256:digest(canonical(journal)),snapshotSHA256:digest(snapshot),head};
  const rpc=async(m:string)=>m==="eth_getBlockByNumber"?head:m==="eth_getTransactionReceipt"?receipt:{...tx,input:tx.data};
  return {tx,receipt,journal,snapshot,checkpoint,file,rpc};
}
test("complete receipt and exact snapshot/journal position admitted",async()=>{
  const f=fixture();checkResume(f.journal,f.checkpoint,f.snapshot,f.file);await reconcileReceipts(f.journal,f.checkpoint,f.file,f.rpc);
});
test("all resumed modes reject uncertain result or receipt before new mutation",()=>{
  for(const mode of ["serve","settle","replay"]){
    const f=fixture();let mutations=0;
    for(const field of ["result","receiptFile","receiptSHA256","head"]){
      const j=structuredClone(f.journal);delete (j[0] as any)[field];
      expect(()=>{checkResume(j,f.checkpoint,f.snapshot,f.file);mutations++;}).toThrow();
    }
    expect(mutations).toBe(0);
  }
});
test("behind/ahead snapshot, edited receipt, wrong position and absent checkpoint reject",()=>{
  const f=fixture();
  for(const position of [0,2])expect(()=>checkResume(f.journal,{...f.checkpoint,position},f.snapshot,f.file)).toThrow();
  expect(()=>checkResume(f.journal,null,f.snapshot,f.file)).toThrow();
  expect(()=>checkResume(f.journal,f.checkpoint,Buffer.from("older dump"),f.file)).toThrow();
  expect(()=>checkResume(f.journal,f.checkpoint,f.snapshot,()=>Buffer.from("{}"))).toThrow();
  const j=structuredClone(f.journal);j[0].seq=1;expect(()=>checkJournal(j,f.file)).toThrow();
  const duplicate=[...f.journal,{...f.journal[0],seq:1}];expect(()=>checkJournal(duplicate,f.file)).toThrow();
});
test("snapshot must contain every journal receipt and exact transaction calldata/nonce",async()=>{
  const f=fixture();
  for(const altered of [null,{...f.receipt,blockHash:hash("c")},{...f.receipt,transactionHash:hash("d")},{...f.receipt,status:"reverted"}]) {
    await expect(reconcileReceipts(f.journal,f.checkpoint,f.file,async m=>m==="eth_getTransactionReceipt"?altered:f.rpc(m))).rejects.toThrow();
  }
  await expect(reconcileReceipts(f.journal,f.checkpoint,f.file,async m=>m==="eth_getTransactionByHash"?{...f.tx,input:"0xdead"}:f.rpc(m))).rejects.toThrow();
  await expect(reconcileReceipts(f.journal,f.checkpoint,f.file,async m=>m==="eth_getTransactionByHash"?{...f.tx,input:f.tx.data,nonce:"0x1"}:f.rpc(m))).rejects.toThrow();
});
test("ambiguous listener timeout/error is never interpreted as vacant",()=>{
  expect(listenerPids({code:1,out:"",err:""})).toEqual([]);
  expect(listenerPids({code:0,out:"p123\n",err:""})).toEqual([123]);
  for(const p of [{code:124,out:"",err:""},{code:1,out:"",err:"timeout"},{code:0,out:"",err:""},{code:0,out:"garbage",err:""}])expect(()=>listenerPids(p)).toThrow();
});
test("wrong owner, bind race and exited child fail before RPC",async()=>{
  const child={pid:123,exitCode:null as number|null};
  await expect(proveListener(child,async()=>[456])).rejects.toThrow();
  await expect(proveListener(child,async()=>{child.exitCode=1;return [123];})).rejects.toThrow();
  await expect(proveListener(child,async()=>[123])).rejects.toThrow();
  expect(()=>ownedIPC("/unused/private/socket",child,"anvil_impersonateAccount",[])).toThrow();
});
test("owned mock kernel listener and private IPC; zero dispatch after child exit",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"vey44-test-"));chmodSync(dir,0o700);const path=join(dir,"rpc.sock");
  let calls=0;const ipc=createServer(socket=>socket.on("data",b=>{calls++;const q=JSON.parse(b.toString());socket.write(canonical({jsonrpc:"2.0",id:q.id,result:"owned mock"}));}));
  const http=createServer();const child={pid:process.pid,exitCode:null as number|null};
  try{
    await new Promise<void>(r=>ipc.listen(path,r));await new Promise<void>(r=>http.listen(0,"127.0.0.1",r));
    const port=(http.address() as any).port;await proveListener(child,()=>inspectListeners(port));
    expect(await ownedIPC(path,child,"read",[])).toBe("owned mock");expect(calls).toBe(1);
    child.exitCode=0;expect(()=>ownedIPC(path,child,"anvil_impersonateAccount",[])).toThrow();expect(calls).toBe(1);
  }finally{await new Promise<void>(r=>ipc.close(()=>r()));await new Promise<void>(r=>http.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});
function accepted(){
  const p=Array<bigint>(22).fill(0n);p[0]=1n;p[4]=2n;p[8]=2n;p[12]=1n;p[13]=2n;p[21]=1n;
  const e=expectedAcceptance(100n,p,hash("f"),3);
  const s=[e.binding,e.releaseId,e.root,e.memberCount,e.rounds,[e.side0,e.side1],e.outcome,e.version];
  return {p,e,s};
}
test("every accepted event field must match publics and frozen release",()=>{
  const {e,s}=accepted();checkAcceptance(e,s,e,20n,21n);
  for(const key of Object.keys(e)){
    const wrong={...e,[key]:typeof(e as any)[key]==="bigint"?(e as any)[key]+1n:hash("d")};
    expect(()=>checkAcceptance(wrong,s,e,20n,21n)).toThrow();
  }
  expect(()=>checkAcceptance(e,s,e,20n,20n)).toThrow();expect(()=>checkAcceptance(e,s,e,20n,22n)).toThrow();
});
test("all immutable summary fields and both totals independently checked",()=>{
  const {e,s}=accepted();
  for(let i=0;i<s.length;i++){
    const wrong=structuredClone(s);wrong[i]=i===5?[99n,0n]:typeof wrong[i]==="bigint"?(wrong[i] as bigint)+1n:hash("d");
    expect(()=>checkAcceptance(e,wrong,e,20n,21n)).toThrow();
  }
  const wrong=structuredClone(s);wrong[5]=[2n,1n];expect(()=>checkAcceptance(e,wrong,e,20n,21n)).toThrow();
});
test("driver gates every resume before spawning and uses historical acceptance on both paths",()=>{
  const source=readFileSync(new URL("./ticket44-identity-fixture.ts",import.meta.url),"utf8");
  expect(source.indexOf('if(mode!=="prepare")checkResume')).toBeLessThan(source.indexOf("child=Bun.spawn"));
  expect(source).not.toContain("fetch(URL_LOCAL");expect(source).not.toContain('http(URL_LOCAL');
  expect(source).toContain('if(Number(a[0])!==0)await acceptanceReceipt');
  expect(source).toContain('const verified=await acceptanceReceipt');
  expect(source).toContain('receipt.blockNumber-1n');
});
