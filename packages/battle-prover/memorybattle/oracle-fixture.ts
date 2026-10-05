import {initialize,advance,result} from '../../battle-oracle/oracle';
const n=Number(process.argv[2]);
const s=initialize({seed:'0x'+'00'.repeat(32),catalog:Array.from({length:n},(_,type)=>({type,attack:45n,shield:5n,hull:100n})),groups:Array.from({length:n},(_,type)=>({side:(type<Math.floor(n/2)?0:1) as 0|1,type,count:1,owner:'0x'+(type+1).toString(16).padStart(40,'0'),source:String(type+1),technology:{weapons:0,shielding:0,armor:0}})),rapidfire:[{shooter:0,target:Math.floor(n/2),factor:2}]});
for(let i=0;!s.done&&i<10000;i++)advance(s,1);
const r=result(s);
console.log(JSON.stringify({counter:s.counter.toString(),hull:s.units.map(u=>Number(u.hull)),shield:s.units.map(u=>Number(u.shield)),round:s.round,outcome:{draw:0,attacker:1,defender:2}[r.outcome],rounds:r.rounds.map(r=>({shots:r.shots.map(Number),survivors:r.survivors}))}));
