import { initialize } from "../../battle-oracle/oracle.ts";
const owner=(n:number)=>"0x"+n.toString(16).padStart(40,"0");
const row=(o:number,s:number,n:number,t=0)=>({owner:owner(o),source:String(s),count:n,side:0 as const,type:0,technology:{weapons:t,shielding:t,armor:t}});
const variants=[[row(1,1,3)],[row(2,8,1),row(1,9,2)],[row(1,9,2),row(2,8,1)],[row(9,9,2),row(8,8,1)],[row(1,1,1,1),row(2,2,2,0)],[row(1,1,0),row(2,2,2)]];
console.log(JSON.stringify(variants.map(groups=>{const s=initialize({seed:"0x"+"00".repeat(32),groups,catalog:[{type:0,attack:20n,shield:5n,hull:100n}],rapidfire:[]});return {groups,cohorts:s.cohorts.map(c=>({side:c.side,type:c.type,attack:c.attack,shield:c.shield,hull:c.hull,count:c.count,groups:c.groups})),units:s.units};}),(_,v)=>typeof v==="bigint"?v.toString():v));
