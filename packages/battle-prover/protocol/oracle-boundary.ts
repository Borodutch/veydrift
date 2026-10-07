import { effective, hit } from "../../battle-oracle/oracle.ts";
const top=1n<<256n, max=top-1n;
const effectiveRows:any[]=[];
for(const tech of [0,1,65535]) {
 const edge=max/(10n+BigInt(tech));
 for(const base of [1n,1n<<64n,1n<<128n,edge,edge+1n]) {
  let result:bigint|undefined;
  try {result=effective({attack:base,shield:base,hull:base},{weapons:tech,shielding:tech,armor:tech}).attack;} catch {}
  effectiveRows.push({base,tech,result:result??0n,valid:result!==undefined});
 }
}
const hitRows:any[]=[];
const cases:bigint[][]=[
 [1n,101n,100n,101n,100n,0n], // bounce
 [1n,100n,100n,100n,100n,0n], // strict equality is not bounce
 [30n,0n,100n,0n,100n,0n], // exactly 30% is not eligible
 [31n,0n,100n,0n,100n,30n],
 [31n,0n,100n,0n,100n,31n], // strict explosion draw boundary
 [1n,50n,100n,50n,60n,0n], // shield-only hit can explode
 [0n,0n,100n,0n,60n,0n],
 [max,max,max,max,max,0n], // attack*100 > uint256, no overflow/bounce
 [max,0n,max,0n,max,0n], // exact lethal
 [1n<<128n,0n,max,0n,max,0n],
 [1n<<64n,0n,max,0n,1n<<128n,max-1n],
 [1n,0n,max,0n,1n<<128n,1n<<128n],
 [max,max,max,max,0n,0n], // dead target stays untouched
];
for(const [attack,maxShield,maxHull,shield,hull,draw] of cases){
 const target={cohort:0,shield:shield!,hull:hull!};let eligible=false;
 const flags=hit(target,{attack:0n,shield:maxShield!,hull:maxHull!},attack!,bound=>{if(bound!==maxHull)throw Error("wrong bound");eligible=true;return draw!;});
 hitRows.push({attack,maxShield,maxHull,shield,hull,draw:eligible?draw:0n,afterShield:target.shield,afterHull:target.hull,...flags,eligible});
}
console.log(JSON.stringify({effectiveRows,hitRows},(_,v)=>typeof v==="bigint"?v.toString():v));
