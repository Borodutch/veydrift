import {initialize,advance,result} from '../../battle-oracle/oracle';
const n=6, scale=1n<<220n;
const s=initialize({seed:'0x'+'00'.repeat(32),catalog:Array.from({length:n},(_,type)=>({type,attack:45n*scale,shield:5n*scale,hull:100n*scale})),groups:Array.from({length:n},(_,type)=>({side:(type<n/2?0:1) as 0|1,type,count:1,owner:'0x'+(type+1).toString(16).padStart(40,'0'),source:String(type+1),technology:{weapons:0,shielding:0,armor:0}})),rapidfire:[{shooter:0,target:n/2,factor:2}]});
for(let i=0;!s.done&&i<10000;i++)advance(s,1);
const r=result(s);console.log(JSON.stringify({counter:s.counter.toString(),hull:s.units.map(u=>u.hull.toString()),shield:s.units.map(u=>u.shield.toString()),round:s.round,outcome:{draw:0,attacker:1,defender:2}[r.outcome]}));
