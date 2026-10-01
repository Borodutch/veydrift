// Read-only artifact closure; run from repository root. Never signs or writes chain state.
import {readFileSync, writeFileSync, readdirSync, existsSync} from "node:fs";
import {join, basename, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {keccak256, toHex} from "viem";
export const defaultRoot = "packages/contracts";
const hash = (x) => createHash("sha256").update(x).digest("hex");
export const edges = {
  VeydriftGame: ["VeydriftFirstPlanetSettlementModule", "VeydriftGameplayModule", "VeydriftPlanetManagementModule", "VeydriftAttackProtectionModule", "VeydriftColonizationModule", "VeydriftDefenseHoldModule", "VeydriftStateMigrationModule", "VeydriftAcsAttackModule", "VeydriftBatchTransportModule"],
  VeydriftGameplayModule: ["VeydriftCombatModule"],
  VeydriftCombatModule: ["VeydriftCombatRapidfire", "VeydriftStagedCombatModule", "VeydriftLegacyCombatModule"],
  VeydriftStagedCombatModule: ["VeydriftCombatRapidfire", "VeydriftCombatProtectionModule"],
  VeydriftLegacyCombatModule: ["VeydriftLegacyCombatRapidfire", "VeydriftLegacyCombatReturnModule"],
  VeydriftPlanetManagementModule: ["VeydriftMissileModule"],
  VeydriftColonizationModule: ["VeydriftShipProductionModule", "VeydriftDefenseProductionModule", "VeydriftUniverseRules"],
  VeydriftStateMigrationModule: ["VeydriftRiftModule", "VeydriftCombatRaidModule", "VeydriftMigrationDiscardModule"],
  VeydriftFirstPlanetSettlementModule: ["VeydriftColonizationModule"],
  VeydriftMoonSystem: [],
};
const fileOverrides = {VeydriftCombatRapidfire:"VeydriftCombatModule.sol", VeydriftLegacyCombatRapidfire:"VeydriftLegacyCombatModule.sol"};
// Explicit, reviewed additions relative to the compiled HEAD368fe469 baseline. No
// absent file is implicitly classified as fresh; new graph nodes require review here.
export const freshArtifacts = new Set(["VeydriftScoreSnapshot", "VeydriftCombatProtectionModule", "VeydriftLegacyCombatMutation", "VeydriftLegacyCombatReturnModule", "VeydriftMigrationDiscardModule"]);

// Conservative lexical coverage check: erase comments/strings, retain braces/tokens.
// Inspect the selected contract (not siblings in the same source). A second
// metadata-source sweep below catches inherited/imported creation sites conservatively.
// Array allocations are not contract creations; aliases/qualified creations fail closed.
function stripNonCode(source) {
  let result = "", state = "code";
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === "line") { if (c.charCodeAt(0) === 10) { state = "code"; result += c; } continue; }
    if (state === "block") { if (c === "*" && next === "/") { i++; state = "code"; } continue; }
    if (state !== "code") { if (c.charCodeAt(0) === 92) i++; else if (c === state) state = "code"; continue; }
    if (c === "/" && next === "/") { i++; state = "line"; result += " "; }
    else if (c === "/" && next === "*") { i++; state = "block"; result += " "; }
    else if (c.charCodeAt(0) === 34 || c.charCodeAt(0) === 39) { state = c; result += " "; }
    else result += c;
  }
  assert(state === "code" || state === "line", "unterminated Solidity comment/string");
  return result;
}

export function createdContracts(source, name) {
  const code = stripNonCode(source);
  const start = new RegExp(`\\b(?:contract|library)\\s+${name}\\b`).exec(code);
  assert(start, `missing contract declaration ${name}`);
  const open = code.indexOf("{", start.index);
  let depth = 1, end = open + 1;
  for (; end < code.length && depth; end++) { if (code[end] === "{") depth++; else if (code[end] === "}") depth--; }
  assert.equal(depth, 0, `unbalanced declaration ${name}`);
  const body = code.slice(open + 1, end - 1);
  return creationNames(body);
}

function creationNames(code) {
  const names = [];
  for (const match of code.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*([^\s])/g)) {
    if (match[2] === "[" || match[1] === "bytes" || match[1] === "string") continue;
    assert(match[2] === "(" || match[2] === "{", `unsupported creation syntax: ${match[0]}`);
    names.push(match[1]);
  }
  return [...new Set(names)];
}

export function checkClosure({root=defaultRoot, out, oldOut, graph=edges, fresh=freshArtifacts, appendBaseline}) {
assert(oldOut && existsSync(join(oldOut, "VeydriftGame.sol", "VeydriftGame.json")), "baseline artifact root required: expected <baseline>/VeydriftGame.sol/VeydriftGame.json (not its container directory)");
const artifacts = {};
const sourceFingerprints = {};
const embeddedEdges = {};
const blockers = [];
function load(name, source, dir=out) {
  return JSON.parse(readFileSync(join(dir, basename(source ?? fileOverrides[name] ?? `${name}.sol`), `${name}.json`), "utf8"));
}
function normalize(layout) {
  assert(layout?.storage && layout?.types, "missing compiled storageLayout");
  const type = (id, seen=[]) => {
    const t = layout.types[id];
    assert(t, `missing type ${id}`);
    const label = t.label.replace(/struct [A-Za-z0-9_]+\./g,"struct ");
    if (seen.includes(id)) return {recursive:label};
    const s = [...seen,id];
    return {label, encoding:t.encoding, bytes:t.numberOfBytes, ...(t.key?{key:type(t.key,s)}:{}), ...(t.value?{value:type(t.value,s)}:{}), ...(t.base?{base:type(t.base,s)}:{}), ...(t.members?{members:t.members.map(m=>({label:m.label,slot:m.slot,offset:m.offset,type:type(m.type,s)}))}:{})};
  };
  return layout.storage.map(e=>({label:e.label,slot:e.slot,offset:e.offset,type:type(e.type)}));
}
// An explicit pinned-main artifact may authorize ONLY its eleven reviewed chronology appends.
// Default remains exact equality. No arbitrary tail, changed old field or missing baseline passes.
const mainStorageSource = "0x537454fd0bdf438e46fab02df1e7e0a68847eb727c75ff1f96f632c71b6c7abf";
const appendNames = ["_attackReturnScanCursor","_chronologyIndexedThrough","_chronologyGeneration",
  "_chronologyMissionsByBody","_chronologyScans","_chronologyBodyGeneration","_chronologyMissionsByPlayer",
  "_chronologyPlayerCursor","_chronologyMigrationComplete","_chronologyRegistered","_chronologyLegacyCursor"];
let mainAppendLayout, baselineGameLayout, mainAppendEvidence = null;
if (appendBaseline) {
  const bytes = readFileSync(appendBaseline);
  const artifact = JSON.parse(bytes);
  assert.equal(artifact.metadata?.sources?.["src/VeydriftGameStorage.sol"]?.keccak256, mainStorageSource,
    "append baseline is not pinned-main GameStorage source");
  mainAppendLayout = normalize(artifact.storageLayout);
  baselineGameLayout = normalize(load("VeydriftGame", undefined, oldOut).storageLayout);
  assert.equal(baselineGameLayout.length,75,"unexpected original inherited layout count");
  assert.equal(mainAppendLayout.length,86,"unexpected pinned-main inherited layout count");
  assert.deepEqual(mainAppendLayout.slice(0,75),baselineGameLayout,"pinned main changed old recursive fields");
  const tail=mainAppendLayout.slice(75);
  assert.deepEqual(tail.map(x=>x.label),appendNames,"unreviewed storage append labels");
  assert.deepEqual(tail.map(x=>[x.slot,x.offset]),appendNames.map((_,i)=>[String(77+i),0]),"unreviewed storage append positions");
  mainAppendEvidence={sourceCommit:"936007eca841b62c5e172f97dc64ce11633a96a5",artifactPath:appendBaseline,
    artifactSha256:hash(bytes),gameStorageSourceKeccak256:mainStorageSource,normalizedAppends:tail};
}
function visit(name, source) {
  if (artifacts[name]) return;
  const a = load(name,source);
  const constructor = a.abi.find(x=>x.type==="constructor");
  assert((constructor?.inputs??[]).every(x=>x.type==="address"), `review non-address constructor ${name}`);
  const args = (constructor?.inputs.length??0)*32;
  const runtime = (a.deployedBytecode.object.length-2)/2;
  const initcode = (a.bytecode.object.length-2)/2+args;
  if (runtime>24576) blockers.push(`${name}: EIP170 ${runtime} > 24576`);
  if (initcode>49152) blockers.push(`${name}: EIP3860 ${initcode} > 49152`);
  const target = Object.keys(a.metadata.settings.compilationTarget)[0];
  const current = readFileSync(join(root,target));
  // Reject artifacts from a concurrent build of an earlier source snapshot.
  for (const [file, metadata] of Object.entries(a.metadata.sources)) {
    const bytes = readFileSync(join(root,file));
    assert.equal(keccak256(toHex(bytes)),metadata.keccak256,`stale artifact ${name}: ${file}`);
    sourceFingerprints[file] = {sha256:hash(bytes),keccak256:metadata.keccak256};
  }
  embeddedEdges[name] = createdContracts(current.toString(), name);
  for (const child of embeddedEdges[name]) assert((graph[name] ?? []).includes(child), `uncovered constructor-created module: ${name} -> ${child}`);
  const layout = normalize(a.storageLayout);
  const baselinePath = join(oldOut,basename(target),`${name}.json`);
  let compatibility, baselineArtifactSha256 = null;
  if (existsSync(baselinePath)) {
    const previous = normalize(load(name,target,oldOut).storageLayout);
    if (mainAppendLayout && layout.length !== previous.length) {
      assert.deepEqual(previous,baselineGameLayout, name+" is not the reviewed inherited Game layout");
      assert.deepEqual(layout,mainAppendLayout,name+" differs from pinned-main recursive append layout");
      compatibility="exact-recursive-baseline-plus-pinned-main-appends";
    } else {
      assert.deepEqual(layout,previous,name+" recursive inherited storage changed");
      compatibility="exact-recursive-match-to-baseline";
    }
    baselineArtifactSha256 = hash(readFileSync(baselinePath));
  } else {
    assert(fresh.has(name), `missing required pre-existing baseline artifact: ${baselinePath}`);
    compatibility="explicit-fresh-artifact/no-prior-layout";
  }
  artifacts[name] = {baselineArtifactSha256,source:target,sourceSha256:hash(current), compiler:a.metadata.compiler,settings:a.metadata.settings, runtimeBytes:runtime,initcodeIncludingArgumentsBytes:initcode,constructorArgumentsBytes:args,creationTemplateSha256:hash(a.bytecode.object),runtimeTemplateSha256:hash(a.deployedBytecode.object),creationLinks:a.bytecode.linkReferences,runtimeLinks:a.deployedBytecode.linkReferences,immutables:a.deployedBytecode.immutableReferences,storageEntries:layout.length,storageSha256:hash(JSON.stringify(layout)),storageCompatibility:compatibility};
  for (const references of [a.bytecode.linkReferences,a.deployedBytecode.linkReferences]) {
    for (const [file, libs] of Object.entries(references??{})) for (const lib of Object.keys(libs)) visit(lib,file);
  }
  for (const child of graph[name]??[]) visit(child);
}
visit("VeydriftGame"); visit("VeydriftMoonSystem");
// Compiler metadata includes bases/imports; any creation there must also be in closure.
// Conservative over-inclusion fails rather than silently losing inherited factories.
const metadataCreations = {};
for (const file of Object.keys(sourceFingerprints)) {
  const names = creationNames(stripNonCode(readFileSync(join(root,file),"utf8")));
  if (names.length) metadataCreations[file] = names;
  for (const name of names) assert(artifacts[name], `uncovered metadata-source creation: ${file} -> ${name}`);
}
const namespaces = [];
for (const file of readdirSync(`${root}/src/libraries`).filter(x=>x.endsWith(".sol"))) {
  const source=readFileSync(`${root}/src/libraries/${file}`,"utf8");
  for (const match of source.matchAll(/keccak256\("(veydrift\.storage\.[^"]+)"\)/g)) namespaces.push({file,namespace:match[1],slot:keccak256(toHex(match[1])),sourceSha256:hash(source)});
}
assert.equal(new Set(namespaces.map(x=>x.namespace)).size,namespaces.length,"duplicate namespace string");
assert.equal(new Set(namespaces.map(x=>x.slot)).size,namespaces.length,"duplicate namespace slot");
// Recheck after traversal, so concurrent source edits cannot produce mixed-snapshot evidence.
for (const [file, fingerprint] of Object.entries(sourceFingerprints)) assert.equal(hash(readFileSync(join(root,file))),fingerprint.sha256,`source changed during closure: ${file}`);
const orderedFingerprints = Object.fromEntries(Object.entries(sourceFingerprints).sort(([a],[b])=>a.localeCompare(b)));
const report={mainAppendEvidence,sourceFingerprints:orderedFingerprints,sourceManifestSha256:hash(JSON.stringify(orderedFingerprints)),embeddedEdges,metadataCreations,baselineCompared:Object.values(artifacts).filter(a=>a.baselineArtifactSha256 !== null).length,explicitFresh:Object.keys(artifacts).filter(n=>artifacts[n].storageCompatibility==="explicit-fresh-artifact/no-prior-layout"),blockers,generatedAt:new Date().toISOString(),artifactDirectory:out,baselineDirectory:oldOut??null,syntheticTemplatesNotLiveCode:true,edges:graph,externalReusedDependencies:["Game/Moon proxies and authorities","configured randomness","distinct frozen source referral / finalized target referral","existing storage-wired Alliance and resource tokens"],namespaces,namespacedCompatibility:"Names differ and slots are domain-separated; source/semantic review and deployed historical provenance remain required. Solidity storageLayout does not enumerate assembly namespaces.",artifacts};
return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? "artifacts/vey919-keyless-out-a7";
  const destination = process.argv[3] ?? "artifacts/vey919-keyless-closure-a7.json";
  const oldOut = process.argv[4];
  const report = checkClosure({out,oldOut,appendBaseline:process.argv[5]});
  writeFileSync(destination,JSON.stringify(report,null,2)+"\n");
  console.log(`${Object.keys(report.artifacts).length} graph artifacts; ${report.baselineCompared} recursive baseline comparisons; ${report.explicitFresh.length} explicit fresh; ${report.blockers.length ? "BLOCKED: "+report.blockers.join("; ") : "runtime/initcode gates pass"}; ${destination}`);
  if (report.blockers.length) process.exitCode=1;
}
