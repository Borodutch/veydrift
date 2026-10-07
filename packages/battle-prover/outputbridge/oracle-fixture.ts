// Independent battle oracle + installed Foundry ABI/Keccak, not Go bridge helpers.
import {initialize, advance, result} from '../../battle-oracle/oracle';
import {execFileSync} from 'node:child_process';
import catalog from '../qualification/catalog.json';
const binding = process.argv[2]!;
if (!/^0x[0-9a-f]{64}$/.test(binding)) throw new Error('binding');
const cast=(...args:string[])=>execFileSync('cast',args,{encoding:'utf8',timeout:10000}).trim();
const owner=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
const technology={weapons:0,shielding:0,armor:0};
const groups=[{side:1 as const,owner:owner(3),source:'0',type:0,count:1,technology},
 {side:0 as const,owner:owner(1),source:'100',type:10,count:1,technology},
 {side:0 as const,owner:owner(2),source:'101',type:10,count:1,technology}];
const s=initialize({seed:'0x'+'00'.repeat(31)+'01',groups,
 catalog:[...catalog.ships.map(x=>({...x,type:x.id})),...catalog.defenses.map(x=>({...x,type:x.id+16}))].map(x=>({type:x.type,attack:BigInt(x.attack),shield:BigInt(x.shield),hull:BigInt(x.hull)})),
 rapidfire:[...catalog.shipRapidfire.map(x=>({shooter:x.attacker,target:x.defender,factor:x.value})),...catalog.defenseRapidfire.map(x=>({shooter:x.attacker,target:x.defender+16,factor:x.value}))]});
for(let i=0;!s.done&&i<10000;i++) advance(s,1);
if(!s.done) throw new Error('oracle host budget');
const r=result(s);
const domain=cast('keccak','veydrift.proof-battle.output-leaf.v1');
const tail=cast('keccak',cast('abi-encode','f(bytes32,bytes32,uint256)',cast('keccak','veydrift.proof-battle.output-tail.v1'),binding,String(r.allocation.length)));
let next=tail;
const nodes:any[]=[];
for(let i=r.allocation.length-1;i>=0;i--) {
 const a=r.allocation[i]!;
 const cohort=s.cohorts.findIndex(c=>c.side===a.side&&c.type===a.type);
 const words=cast('abi-encode','f(bytes32,bytes32,uint256,uint256,address,uint256,uint8,uint8,uint32,uint32,uint32,bytes32)',
  domain,binding,String(i),String(cohort),a.owner,a.source,String(a.side),String(a.type),String(a.initial),String(a.lost),String(a.survivors),next);
 const hash=cast('keccak',words);nodes.unshift({...a,index:i,cohort,next,hash,words});next=hash;
}
console.log(JSON.stringify({binding,root:next,tail,outcome:{draw:0,attacker:1,defender:2}[r.outcome],rounds:r.rounds.length,nodes}));
