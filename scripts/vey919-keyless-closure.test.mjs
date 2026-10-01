import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {keccak256,toHex} from "viem";
import {checkClosure,createdContracts,edges} from "./vey919-keyless-closure.mjs";

function fixture(t) {
  mkdirSync("artifacts",{recursive:true});
  const root=mkdtempSync("artifacts/vey919-closure-fixture-");
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const out=join(root,"out"),oldOut=join(root,"baseline");
  mkdirSync(join(root,"src/libraries"),{recursive:true});
  const graph={VeydriftGame:["Child"],VeydriftMoonSystem:[]};
  for(const name of ["VeydriftGame","VeydriftMoonSystem","Child"]) {
    const source=`contract ${name} { ${name==="VeydriftGame"?"constructor() { new Child(); }":""} }`;
    const file=`src/${name}.sol`;
    writeFileSync(join(root,file),source);
    const artifact={abi:[],bytecode:{object:"0x00",linkReferences:{}},deployedBytecode:{object:"0x00",linkReferences:{},immutableReferences:{}},metadata:{compiler:{version:"fixture"},settings:{compilationTarget:{[file]:name}},sources:{[file]:{keccak256:keccak256(toHex(source))}}},storageLayout:{storage:[{label:"value",slot:"0",offset:0,type:"uint"}],types:{uint:{label:"uint256",encoding:"inplace",numberOfBytes:"32"}}}};
    for(const base of [out,oldOut]) {mkdirSync(join(base,`${name}.sol`),{recursive:true});writeFileSync(join(base,`${name}.sol`,`${name}.json`),JSON.stringify(artifact));}
  }
  return {root,out,oldOut,graph,fresh:new Set()};
}

test("complete closure recursively compares every existing artifact",t=>{
 const report=checkClosure(fixture(t));assert.equal(report.baselineCompared,3);assert.deepEqual(report.explicitFresh,[]);assert.deepEqual(report.embeddedEdges.VeydriftGame,["Child"]);assert.deepEqual(report.blockers,[]);assert.equal(report.sourceManifestSha256.length,64);
});
test("missing baseline argument and container path fail closed",t=>{
 const f=fixture(t);assert.throws(()=>checkClosure({...f,oldOut:undefined}),/baseline artifact root required/);assert.throws(()=>checkClosure({...f,oldOut:f.root}),/baseline artifact root required/);
});
test("one missing pre-existing baseline artifact cannot silently downgrade",t=>{
 const f=fixture(t);rmSync(join(f.oldOut,"Child.sol","Child.json"));assert.throws(()=>checkClosure(f),/missing required pre-existing baseline artifact/);
});
test("only explicitly reviewed fresh artifacts may omit prior layout",t=>{
 const f=fixture(t);rmSync(join(f.oldOut,"Child.sol","Child.json"));const r=checkClosure({...f,fresh:new Set(["Child"])});assert.equal(r.baselineCompared,2);assert.deepEqual(r.explicitFresh,["Child"]);
});
test("omitted constructor-created edge fails even when child artifact exists",t=>{
 const f=fixture(t);assert.throws(()=>checkClosure({...f,graph:{...f.graph,VeydriftGame:[]}}),/uncovered constructor-created module: VeydriftGame -> Child/);
});
test("missing fresh child artifact is a hard failure",t=>{
 const f=fixture(t);rmSync(join(f.out,"Child.sol","Child.json"));assert.throws(()=>checkClosure(f),/ENOENT/);
});
test("recursive type width mismatch fails",t=>{
 const f=fixture(t),p=join(f.oldOut,"Child.sol","Child.json"),a=JSON.parse(readFileSync(p));a.storageLayout.types.uint.numberOfBytes="16";writeFileSync(p,JSON.stringify(a));assert.throws(()=>checkClosure(f),/recursive inherited storage changed/);
});
test("size blockers remain failures including constructor arguments",t=>{
 const f=fixture(t),p=join(f.out,"Child.sol","Child.json"),a=JSON.parse(readFileSync(p));a.abi=[{type:"constructor",inputs:[{type:"address"}]}];a.bytecode.object="0x"+"00".repeat(49140);a.deployedBytecode.object="0x"+"00".repeat(24577);writeFileSync(p,JSON.stringify(a));const r=checkClosure(f);assert.equal(r.blockers.length,2);assert.equal(r.artifacts.Child.initcodeIncludingArgumentsBytes,49172);
});
test("creation scanner ignores comments, strings, siblings and memory arrays",()=>{
 const s=`contract Other { constructor(){new Wrong();} } contract Root { string constant X="new Wrong() { }"; /* new Wrong() */ constructor(){ new Child{salt: bytes32(0)}(); new Child(); } function f() public { uint[] memory a=new uint[](2); bytes memory b=new bytes(3); string memory c=new string(4); } }`;assert.deepEqual(createdContracts(s,"Root"),["Child"]);
});
test("inherited/imported creation omitted from graph fails metadata sweep",t=>{
 const f=fixture(t),p=join(f.out,"VeydriftGame.sol","VeydriftGame.json"),a=JSON.parse(readFileSync(p));
 const source="contract Base { constructor() { new Lost(); } }";
 writeFileSync(join(f.root,"src/Base.sol"),source);a.metadata.sources["src/Base.sol"]={keccak256:keccak256(toHex(source))};writeFileSync(p,JSON.stringify(a));
 assert.throws(()=>checkClosure(f),/uncovered metadata-source creation: .*Base.sol -> Lost/);
});
test("stale source and unsupported qualified construction fail closed",t=>{
 const f=fixture(t);writeFileSync(join(f.root,"src/Child.sol"),"contract Child { uint changed; }");assert.throws(()=>checkClosure(f),/stale artifact Child/);
 assert.throws(()=>createdContracts("contract Root { constructor(){new Alias.Child();} }","Root"),/unsupported creation syntax/);
});
test("reviewed real embedded return/discard edges are present and source-covered",()=>{
 for(const [parent,child] of [["VeydriftLegacyCombatModule","VeydriftLegacyCombatReturnModule"],["VeydriftStateMigrationModule","VeydriftMigrationDiscardModule"]]){assert(edges[parent].includes(child));assert(createdContracts(readFileSync(`packages/contracts/src/${parent}.sol`,"utf8"),parent).includes(child));}
});

function appendFixture(t) {
 const f=fixture(t);
 const names=["_attackReturnScanCursor","_chronologyIndexedThrough","_chronologyGeneration","_chronologyMissionsByBody","_chronologyScans","_chronologyBodyGeneration","_chronologyMissionsByPlayer","_chronologyPlayerCursor","_chronologyMigrationComplete","_chronologyRegistered","_chronologyLegacyCursor"];
 const prefix=Array.from({length:75},(_,i)=>({label:"original"+i,slot:String(i),offset:0,type:"uint"}));
 for(const name of ["VeydriftGame","Child"]) for(const base of [f.oldOut,f.out]) {
  const path=join(base,name+".sol",name+".json"),a=JSON.parse(readFileSync(path));
  a.storageLayout.storage=structuredClone(prefix);
  if(base===f.out)a.storageLayout.storage.push(...names.map((label,i)=>({label,slot:String(77+i),offset:0,type:"uint"})));
  writeFileSync(path,JSON.stringify(a));
 }
 const a=JSON.parse(readFileSync(join(f.out,"VeydriftGame.sol","VeydriftGame.json")));
 a.metadata.sources["src/VeydriftGameStorage.sol"]={keccak256:"0x537454fd0bdf438e46fab02df1e7e0a68847eb727c75ff1f96f632c71b6c7abf"};
 f.appendBaseline=join(f.root,"pinned-main.json");writeFileSync(f.appendBaseline,JSON.stringify(a));return f;
}
function mutate(path,fn){const a=JSON.parse(readFileSync(path));fn(a);writeFileSync(path,JSON.stringify(a));}
test("append mode is explicit and still compares every old artifact",t=>{
 const f=appendFixture(t);assert.throws(()=>checkClosure({...f,appendBaseline:undefined}),/recursive inherited storage changed/);
 const r=checkClosure(f);assert.equal(r.baselineCompared,3);assert.equal(r.mainAppendEvidence.normalizedAppends.length,11);
 assert.equal(r.artifacts.Child.storageCompatibility,"exact-recursive-baseline-plus-pinned-main-appends");
});
test("append artifact must match the pinned source anchor",t=>{
 const f=appendFixture(t);mutate(f.appendBaseline,a=>a.metadata.sources["src/VeydriftGameStorage.sol"].keccak256="0x00");
 assert.throws(()=>checkClosure(f),/not pinned-main/);
});
test("append mode rejects changed original recursive fields",t=>{
 const f=appendFixture(t);mutate(f.appendBaseline,a=>a.storageLayout.storage[0].offset=1);
 assert.throws(()=>checkClosure(f),/changed old recursive fields/);
});
test("append mode rejects unreviewed labels and positions",t=>{
 const f=appendFixture(t);mutate(f.appendBaseline,a=>a.storageLayout.storage[85].slot="88");
 assert.throws(()=>checkClosure(f),/unreviewed storage append positions/);
 mutate(f.appendBaseline,a=>{a.storageLayout.storage[85].slot="87";a.storageLayout.storage[85].label="other";});
 assert.throws(()=>checkClosure(f),/unreviewed storage append labels/);
});
test("candidate cannot append any extra field",t=>{
 const f=appendFixture(t);mutate(join(f.out,"Child.sol","Child.json"),a=>a.storageLayout.storage.push({label:"extra",slot:"88",offset:0,type:"uint"}));
 assert.throws(()=>checkClosure(f),/differs from pinned-main/);
});
test("candidate cannot change even a new tail field width",t=>{
 const f=appendFixture(t);mutate(join(f.out,"Child.sol","Child.json"),a=>{
  a.storageLayout.types.short={label:"uint128",encoding:"inplace",numberOfBytes:"16"};a.storageLayout.storage[85].type="short";
 });assert.throws(()=>checkClosure(f),/differs from pinned-main/);
});
test("append mode never waives a missing old artifact",t=>{
 const f=appendFixture(t);rmSync(join(f.oldOut,"Child.sol","Child.json"));assert.throws(()=>checkClosure(f),/missing required pre-existing baseline/);
});
test("unrelated inherited layouts cannot adopt the Game tail",t=>{
 const f=appendFixture(t);const game=JSON.parse(readFileSync(join(f.out,"VeydriftGame.sol","VeydriftGame.json")));
 mutate(join(f.out,"VeydriftMoonSystem.sol","VeydriftMoonSystem.json"),a=>a.storageLayout=game.storageLayout);
 assert.throws(()=>checkClosure(f),/not the reviewed inherited Game layout/);
});
