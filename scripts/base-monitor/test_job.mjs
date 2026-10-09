// All receipts here are offline mocks; no real message tool or production state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'job.js'),'utf8');
const run=new (Object.getPrototypeOf(async function(){}).constructor)('exec','message',source);
const patch=JSON.parse(fs.readFileSync(path.join(root,'scheduler-patch.json')));
assert.equal(patch.payload.script,source); assert.equal(patch.payload.toolBudget,4);
assert.equal(patch.payload.timeoutSeconds,210); assert.deepEqual(patch.payload.toolsAllow,['exec','message']);
const good={ok:true,messageId:'123',chatId:'76104711',receipt:{threadId:'4030762'}};
const done=x=>({status:'completed',exitCode:0,aggregated:JSON.stringify(x)});
function setup(mode='ok',response=good){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-hold-'));
 const state=path.join(dir,'state.json'),fixture=path.join(dir,'sample.json');
 fs.copyFileSync(path.join(root,'fixture-alert.json'),fixture);
 let calls=[],sends=0;
 function cli(args){const r=spawnSync('python3',[path.join(root,'monitor.py'),'--state',state,...args],{encoding:'utf8'});return {status:'completed',exitCode:r.status,aggregated:r.stdout};}
 const read=()=>JSON.parse(fs.readFileSync(state));
 const exec=async opts=>{
  assert.equal(opts.host,'gateway');assert.equal(opts.awaitResults,true);calls.push(opts.command);
  if(opts.command.includes('--health-dir'))return cli(['--fixture',fixture]);
  const words=opts.command.split(' ');
  if(words.includes('--claim')){
   if(mode==='before-claim')throw Error('crash before commit');
   const r=cli(['--claim',words.at(-1)]);
   if(mode==='after-claim')throw Error('crash after claim commit');
   return r;
  }
  assert.ok(words.includes('--ack'));
  if(mode==='before-ack')throw Error('crash before ack');
  const r=cli(['--ack',words.at(-3),'--receipt',words.at(-1)]);
  if(mode==='after-ack')throw Error('crash after ack commit');
  return r;
 };
 const message=async opts=>{
  assert.equal(read().pending.delivery.status,'uncertain');
  assert.equal(opts.target,'76104711');assert.equal(opts.threadId,'4030762');
  sends++;if(mode==='send-throw')throw Error('ambiguous network failure');return response;
 };
 return {dir,state,fixture,read,cli,exec,message,get sends(){return sends},get calls(){return calls},close(){fs.rmSync(dir,{recursive:true})}};
}
let cases=0;
for(const [mode,response] of [['ok',good],['before-claim',good],['after-claim',good],['before-ack',good],['after-ack',good],['send-throw',good],['queued',{status:'delivery_queued',delivered:false}],['failed',{ok:false,delivered:false}],['wrong-thread',{...good,receipt:{threadId:'wrong'}}],['wrong-chat',{...good,chatId:'other'}],['contradictory',{...good,delivered:false}],['bad-id',{...good,messageId:'$(evil)'}],['suppressed',{status:'suppressed'}]]){
 const h=setup(mode,response);
 try{
  if(['before-claim','after-claim'].includes(mode))await assert.rejects(run(h.exec,h.message));else await run(h.exec,h.message);
  const s=h.read();
  if(mode==='ok'||mode==='after-ack'){
   assert.equal(s.pending,null);assert.equal(s.lastAck.receipt,'123');assert.equal(h.calls.length,3);
   await run(h.exec,h.message);assert.equal(h.sends,1);
  }else if(mode==='before-claim'){
   assert.equal(s.pending.delivery.status,'ready');assert.equal(h.sends,0);
  }else{
   assert.equal(s.pending.delivery.status,'uncertain');assert.equal(s.lastAck,undefined);
   const before=h.sends;for(let i=0;i<15;i++){const out=await run(h.exec,h.message);assert.equal(out.custody.status,'degraded');}assert.equal(h.sends,before);
   // New observations still advance while the identical outbox stays held.
   const x=JSON.parse(fs.readFileSync(h.fixture));x.resources.node_critical_errors='1';fs.writeFileSync(h.fixture,JSON.stringify(x));
   if(mode==='after-claim') await assert.rejects(run(h.exec,h.message));else await run(h.exec,h.message);
   assert.equal(h.read().incidents['resource-node_critical_errors'].active,true);assert.equal(h.sends,before+(mode==='after-claim'?0:1));
   assert.equal(h.read().held[0].eventId,s.pending.eventId);assert.ok(h.read().lastObservedAt);
  }
  cases++;
 }finally{h.close()}
}
// Definitive non-delivery is an operator-verified transition, never inferred from a return.
{
 const h=setup('failed',{ok:false,delivered:false});
 try{
  await run(h.exec,h.message);const e=h.read().pending.eventId;
  assert.notEqual(h.cli(['--release-not-delivered',e]).exitCode,0);
  assert.equal(h.read().pending.delivery.status,'uncertain');
  assert.equal(h.cli(['--release-not-delivered',e,'--evidence','offline-test:proven-no-custody']).exitCode,0);
  assert.equal(h.read().pending.delivery.status,'ready');assert.equal(h.read().lastAck,undefined);
  await run(h.exec,async opts=>{assert.ok(opts.message);return good});
  assert.equal(h.read().lastAck.eventId,e);assert.equal(h.read().pending,null);cases++;
 }finally{h.close()}
}
// A legacy pending event (including the real held fixture's old schema) cannot be sent.
{
 const h=setup();try{
  h.cli(['--fixture',h.fixture]);const s=h.read();delete s.pending.delivery;fs.writeFileSync(h.state,JSON.stringify(s));
  await run(h.exec,h.message);assert.equal(h.sends,0);
  assert.notEqual(h.cli(['--claim',s.pending.eventId]).exitCode,0);cases++;
 }finally{h.close()}
}
// A held recovery stays fenced; unrelated new incident can deliver with real receipt shape.
{
 const h=setup('send-throw');try{
  await run(h.exec,h.message);const original=h.read().pending.eventId;
  const x=JSON.parse(fs.readFileSync(h.fixture));x.resources.node_critical_errors='1';fs.writeFileSync(h.fixture,JSON.stringify(x));
  const out=await run(h.exec,async opts=>{assert.ok(opts.message.includes('custody degraded'));return good});
  assert.equal(out.status,'delivered');assert.equal(h.read().held[0].eventId,original);
  assert.notEqual(h.read().lastAck.eventId,original);assert.equal(h.read().pending,null);
 }finally{h.close()}
}
// Separate scheduled invocations race on the same state: only one durable claim authorizes send.
{
 const h=setup();try{
  await Promise.all([run(h.exec,h.message),run(h.exec,h.message)]);
  assert.equal(h.sends,1);assert.equal(h.read().lastAck.receipt,'123');
 }finally{h.close()}
}
for(const status of ['quiet','busy'])await run(async()=>done({status}),async()=>{throw Error('unexpected send')});
await assert.rejects(run(async()=>({status:'running',sessionId:'x'}),async()=>{throw Error('unexpected send')}));
console.log('PASS: '+cases+' real Python state / mocked message boundary scenarios, quiet/busy/running, exact budget and payload');
