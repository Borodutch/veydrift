import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for (const [name,command,args] of [
 ['collector and durable custody','python3',['-m','unittest','discover','-s','scripts/base-monitor','-p','test_*.py','-v']],
 ['complete scheduled script','node',['scripts/base-monitor/test_job.mjs']],
]) test(name,{timeout:90000},()=>{
 const r=spawnSync(command,args,{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:85000,maxBuffer:1024*1024});
 assert.equal(r.error,undefined,String(r.error));assert.equal(r.status,0,r.stdout+r.stderr);
});
