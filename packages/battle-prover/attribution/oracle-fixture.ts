// Pure allocation parity, NOT combat evidence: terminal units intentionally set.
import { initialize, result, RULES } from "../../battle-oracle/oracle";
const owner = (n: bigint) => "0x" + n.toString(16).padStart(40, "0");
const fixtures = [];
for (const loss of [0,1,2,3,4,5]) {
 const groups = [[1n,10n,2], [1n,2n,2], [1n,20n,1]].map(([o,s,q])=>({side:0 as const,owner:owner(BigInt(o)),source:String(s),type:7,count:Number(q),technology:{weapons:0,shielding:0,armor:0}}));
 const s=initialize({seed:"0x"+"00".repeat(32),catalog:[{type:7,attack:100n,shield:20n,hull:300n}],groups,rapidfire:[]});
 for(let i=0;i<loss;i++) s.units[i]!.hull=0n;
 fixtures.push({rules:RULES,loss,members:groups.map(g=>({owner:g.owner,source:g.source,quantity:g.count})),allocation:result(s).allocation});
}
console.log(JSON.stringify(fixtures,null,2));
