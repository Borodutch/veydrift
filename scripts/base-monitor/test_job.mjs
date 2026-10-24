// Real Python persistence; all messaging and receipts are offline mocks.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'job.js'),'utf8');
const execute=new (Object.getPrototypeOf(async function(){}).constructor)('exec','message',source);
const patch=JSON.parse(fs.readFileSync(path.join(root,'scheduler-patch.json')));
assert.equal(patch.payload.script,source);assert.equal(patch.payload.toolBudget,4);
const good={ok:true,messageId:'123',chatId:'76104711',receipt:{threadId:'4030762'}};
const run=async(e,m)=>{let calls=0;const count=f=>async x=>{assert.ok(++calls<=4);return f(x)};const x=await execute(count(e),count(m));assert.deepEqual(Object.keys(x),['state']);assert.ok(Buffer.byteLength(JSON.stringify(x.state))<16384);return x.state};
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-fence-')),state=path.join(dir,'state'),fixture=path.join(dir,'fixture');
 fs.copyFileSync(path.join(root,'fixture-alert.json'),fixture);
 const cli=args=>{const r=spawnSync('python3',[path.join(root,'monitor.py'),'--state',state,...args],{encoding:'utf8'});return {status:'completed',exitCode:r.status,aggregated:r.stdout}};
 const read=()=>JSON.parse(fs.readFileSync(state));
 const exec=async o=>{const w=o.command.split(' ');if(w.includes('--health-dir'))return cli(['--fixture',fixture]);const i=w.findIndex(x=>['--claim','--ack','--finish-send'].includes(x));assert.ok(i>=0);return cli(w.slice(i))};
 const change=()=>{const x=JSON.parse(fs.readFileSync(fixture));x.resources.node_critical_errors='1';fs.writeFileSync(fixture,JSON.stringify(x))};
 return {dir,state,fixture,cli,read,exec,change,close:()=>fs.rmSync(dir,{recursive:true})};
}
let cases=0;
for(const response of [good,{status:'delivery_queued',delivered:false},{ok:false},{...good,chatId:'wrong'},{...good,receipt:{threadId:'wrong'}},{...good,messageId:'$(bad)'},{...good,delivered:false},{...good,status:'failed'},null,'throw']){
 const h=setup();try{
  let sends=0;const message=async()=>{sends++;assert.ok(h.read().sender);if(response==='throw')throw Error('unknown');return response};
  const out=await run(h.exec,message);assert.equal(h.read().sender,null);
  if(response===good){assert.equal(out.status,'delivered');assert.equal(h.read().pending,null);await run(h.exec,message);assert.equal(sends,1)}
  else{
   assert.equal(out.status,'delivery-uncertain');const original=h.read().pending.eventId;
   // Independent custody notice, not resend; one attempt even when it also fails.
   await run(h.exec,message);assert.equal(sends,2);assert.notEqual(h.read().pending.eventId,original);assert.equal(h.read().pending.diagnostic,true);
   for(let i=0;i<15;i++){const tick=await run(h.exec,message);assert.equal(tick.custody.status,'degraded')}
   assert.equal(sends,2);assert.equal(h.read().held.length,2);
   h.change();await run(h.exec,async o=>{assert.ok(o.message.includes('custody degraded'));sends++;return good});assert.equal(sends,3);
   assert.equal(h.read().held[0].eventId,original);
  }cases++;
 }finally{h.close()}
}
// A NEW hold independently alerts the operator on the existing route, exactly once.
{
 const h=setup();try{
  await run(h.exec,async()=>{throw Error('unknown')});const original=h.read().pending.eventId;let notices=0;
  const out=await run(h.exec,async o=>{notices++;assert.equal(o.threadId,'4030762');assert.ok(o.message.includes('DELIVERY CUSTODY UNCERTAIN for '+original));return good});
  assert.equal(out.status,'delivered');assert.equal(h.read().held[0].eventId,original);
  for(let i=0;i<15;i++)await run(h.exec,async()=>{throw Error('no duplicate notice')});
  assert.equal(notices,1);cases++;
 }finally{h.close()}
}
// Async send overlap: second run samples but cannot start another sender.
for(const terminal of [good,'throw']){
 const h=setup();try{
  let resolve,entered;const gate=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);let live=0,peak=0,sends=0;
  const message=async()=>{sends++;live++;peak=Math.max(peak,live);entered();await gate;live--;if(terminal==='throw')throw Error('unknown');return good};
  const a=run(h.exec,message);await started;h.change();const b=await run(h.exec,message);
  assert.equal(b.status,'delivery-degraded');assert.equal(sends,1);assert.equal(h.read().incidents['resource-node_critical_errors'].active,true);
  resolve();await a;assert.equal(h.read().sender,null);
  await run(h.exec,async()=>{sends++;return good});assert.equal(sends,2);assert.equal(peak,1);cases++;
 }finally{h.close()}
}
// Pause before claim, other invocation completes it: no error and no second send.
{
 const h=setup();try{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let sends=0;
  const e=async o=>{if(o.command.includes('--claim')){entered();await gate}return h.exec(o)};
  const a=run(e,async()=>{sends++;return good});await started;await run(h.exec,async()=>{sends++;return good});release();await a;assert.equal(sends,1);cases++;
 }finally{h.close()}
}
// Crash before/after claim, finish or acknowledgment: retained fence is never TTL-cleared.
for(const phase of ['before-claim','after-claim','before-finish','after-finish','before-ack','after-ack']){
 const h=setup();try{
  let sends=0;
  const exec=async o=>{const boundary=phase.split('-').slice(1).join('-');const match=o.command.includes('--'+(boundary==='finish'?'finish-send':boundary));if(match&&phase.startsWith('before'))throw Error('crash');const r=await h.exec(o);if(match&&phase.startsWith('after'))throw Error('crash');return r};
  const m=async()=>{sends++;if(phase.includes('finish'))throw Error('unknown');return good};
  if(phase.includes('ack'))await run(exec,m);else await assert.rejects(run(exec,m));
  const s=h.read();if(s.sender){
   h.change();for(let i=0;i<12;i++)await run(h.exec,async()=>{throw Error('MUST NOT SEND')});assert.ok(h.read().sender);
   assert.notEqual(h.cli(['--abandon-sender',s.sender.eventId]).exitCode,0);
   assert.equal(h.cli(['--abandon-sender',s.sender.eventId,'--evidence','offline:terminated-run']).exitCode,0);
   assert.equal(h.read().sender,null);assert.equal(h.read().pending.delivery.status,'uncertain');
  }cases++;
 }finally{h.close()}
}
console.log('PASS '+cases+' scheduler scenarios, deferred send fences, custody escalation, crashes, bounded diagnostics');
