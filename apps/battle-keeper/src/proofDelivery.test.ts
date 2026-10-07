import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProofFileProvider } from "./proofFileProvider";
import { proofArtifactBasename } from "./proofArtifactFile";
import { validateProofPlan } from "../../backend/src/proofExecution";
import { createHash } from "node:crypto";
import { parseEVMArtifact } from "./proofEvmArtifact";
import { readProofOperation, type ProofArtifactAuthority } from "./proofOperation";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters, stringToHex, toHex, type Hex } from "viem";
import { acceptanceReadAbi, readCanonicalAcceptance } from "./proofAcceptance";
import { readProofBattleStatus } from "../../backend/src/proofBattleProgress";
import { decodeFinalArtifact, parseFinalArtifactFile, encodeFinal22Submission, proofDeliveryAbi, readAndPlanProofDelivery } from "./proofDelivery";
import { proofLeafDigest, proofTailDigest, type ProofLeaf } from "./proofLeaves";
import { ViemMissionResolver } from "./resolver";
import { reviewedProofProgressVersions } from "./proofProgress";
import type { JsonRpcTransport } from "./transport";
import type { FinalBattleArtifact } from "../../../packages/api-types/src/index";
const hash = (n: bigint) => toHex(n, { size: 32 });
const game = toHex(100n, { size: 20 }), verifier = toHex(200n, { size: 20 }), engine = toHex(300n, { size: 20 });
const verifierCode = "0x60016000" as Hex;
const limbs = (value: bigint) => [0n, 1n, 2n, 3n].map(i => (value >> (64n * i) & ((1n << 64n) - 1n)).toString());
function fixture(count = 33) {
  const versionWords = [3n, 1n, 2n, BigInt(verifier), BigInt(keccak256(verifierCode))];
  const bindingWords = [BigInt(keccak256(stringToHex("veydrift.proof-battle.public-record.v1"))), 8453n, BigInt(game), 42n,
    ...versionWords, BigInt(engine), 9n, 10n, 11n, 12n, 13n, BigInt(count), 3n];
  const binding = keccak256(("0x" + bindingWords.map(n => hash(n).slice(2)).join("")) as Hex);
  const releaseId = keccak256(("0x" + versionWords.map(n => hash(n).slice(2)).join("")) as Hex);
  const leaves: ProofLeaf[] = [];
  let root = proofTailDigest(binding, BigInt(count));
  for (let i = count - 1; i >= 0; i--) {
    const leaf = { cohortId: 1n, owner: game, source: BigInt(i), side: 0, unit: 0, enrolledCount: 1, lost: 0, survivors: 1, next: root };
    leaves.unshift(leaf); root = proofLeafDigest(binding, BigInt(i), leaf);
  }
  const outcome = count ? 1 : 0;
  const artifact: FinalBattleArtifact = { Schema: "raw-linked-settlement22-v3", Manifest: {
    VKHash: "a".repeat(64), InputHash: "b".repeat(64), ProofHash: "c".repeat(64), ChainRecord: BigInt(binding).toString(), OutputRoot: BigInt(root).toString(),
    MemberCount: String(count), Rounds: "1", FinalSide0: String(count), FinalSide1: "0", Outcome: String(outcome) },
    Public: [...limbs(BigInt(binding)), ...limbs(BigInt(root)), ...limbs(BigInt(count)), "1", ...limbs(BigInt(count)), ...limbs(0n), String(outcome)],
    Proof: "Zml4dHVyZQ==", // unverified compressed advice; NEVER EVM calldata or proof-validation evidence
    Leaves: leaves.map((v, i) => ({ Index: String(i), Cohort: "1", Owner: BigInt(game).toString(), Source: v.source.toString(), Side: "0", Unit: "0", Count: "1", Lost: "0", Survivors: "1", Next: BigInt(v.next).toString() })) };
  const state = { blockHash: hash(1000n), cursor: 0n, phase: 1, proofPhase: 3, context: 12n, seed: 13n, staged: 17, root, binding, releaseId, verifierCode,
    approved: 0n, reorgDuringRead: false, corruptCursor: false, count: BigInt(count), unaccepted: false, wrongMember: false, paused: false, ordering: true };
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x2105" as T;
    if (method === "eth_getBlockByNumber") return { hash: state.blockHash, number: "0x10" } as T;
    const tag = params.at(-1);
    expect(tag).toEqual({ blockHash: state.blockHash, requireCanonical: true });
    if (state.reorgDuringRead) throw new Error("block no longer canonical");
    if (method === "eth_getStorageAt" && params[1] === hash(52n)) return hash(state.paused ? 1n : 0n) as T;
    if (method === "eth_getStorageAt") return hash(params[1] === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" ? 0n : state.approved) as T;
    if (method === "eth_getCode") return (String(params[0]).toLowerCase() === verifier.toLowerCase() ? state.verifierCode : "0x6002") as T;
    if (method !== "eth_call") throw new Error("unexpected mutation/RPC " + method);
    const decoded = decodeFunctionData({ abi: acceptanceReadAbi, data: (params[0] as { data: Hex }).data });
    if (decoded.functionName === "fleetMissionEligibility") return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: decoded.functionName, result: [false, 0n, state.ordering] }) as T;
    if (decoded.functionName === "proofBattleRecord") {
      if (decoded.args[1] === 2) {
        const i = decoded.args[2];
        const row = encodeAbiParameters(parseAbiParameters("(uint256 source,address owner,uint32 count,uint8 side,uint8 unit,uint16 weapons,uint16 shielding,uint16 armor)"),
          [{ source: i, owner: game, count: state.wrongMember ? 2 : 1, side: 0, unit: 0, weapons: 0, shielding: 0, armor: 0 }]);
        return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: "proofBattleRecord", result: row }) as T;
      }
      const words = decoded.args[1] === 0 ? [...versionWords, BigInt(state.proofPhase), 11n, state.context, state.seed, BigInt(count)] : [BigInt(engine), 9n, 10n];
      return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: "proofBattleRecord", result: ("0x" + words.map(n => hash(n).slice(2)).join("")) as Hex }) as T;
    }
    if (decoded.functionName === "stagedBattleProgress") return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: decoded.functionName, result: [state.staged, 0, 100n] }) as T;
    if (decoded.functionName === "proofBattleAcceptedSummary") return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: decoded.functionName,
      result: state.unaccepted ? [hash(0n), hash(0n), hash(0n), 0n, 0, [0n,0n], 0, 0] : [state.binding, state.releaseId, state.root, state.count, 1, [BigInt(count),0n], outcome, 3] }) as T;
    const digest = state.corruptCursor ? hash(9n) : state.cursor === 0n ? root : leaves[Number(state.cursor) - 1]!.next;
    return encodeFunctionResult({ abi: acceptanceReadAbi, functionName: "proofSettlementProgress", result: state.unaccepted ? [0,0n,0n,hash(0n)] : [state.phase, state.cursor, state.count, digest] }) as T;
  } };
  const plan = (a: unknown = artifact) => readAndPlanProofDelivery(transport, game, 42n, 8453n, JSON.stringify(a), { maxArtifactBytes: 100_000, maxLeaves: 100 });
  return { state, calls, transport, artifact, plan, leaves, root, binding };
}
test("actual selectors, immutable summary and same-hash bounded planning without release enablement", async () => {
  const f = fixture();
  const resolver = new ViemMissionResolver(f.transport, ("0x" + "1".repeat(64)) as Hex, game, 8453);
  const p = await resolver.planProofDelivery("42", JSON.stringify(f.artifact), { maxArtifactBytes: 100_000, maxLeaves: 100 });
  expect(p.leaves).toHaveLength(32); expect(p.deliveryEnabled).toBe(false);
  expect(p.gaps).toContain("proof-runtime-unreviewed"); expect(p.gaps).toContain("release-registry-empty-or-unapproved");
  expect(reviewedProofProgressVersions).toEqual([]);
  expect(p.canonical?.summary.root).toBe(f.root);
  expect(decodeFunctionData({ abi: proofDeliveryAbi, data: p.previewCall!.data }).functionName).toBe("applyProofBattleLeaves");
  const read = f.calls.find(c => c.method === "eth_call" && (c.params[0] as { data: string }).data.startsWith("0x23a03b3b"));
  expect(read).toBeDefined();
  f.state.approved = 1n;
  expect((await f.plan()).deliveryEnabled).toBe(false); // storage flag alone is not code provenance
  const data = encodeFinal22Submission(42n, ("0x" + "00".repeat(384)) as Hex, f.artifact.Public);
  expect(data.slice(0,10)).toBe("0x3b29d88c");
  expect(decodeFunctionData({ abi: proofDeliveryAbi, data }).args?.[0]).toBe(42n);
  expect(() => encodeFinal22Submission(42n, f.artifact.Proof as Hex, f.artifact.Public)).toThrow("384");
  const aliases = [...f.artifact.Public]; aliases[0] = "18446744073709551616";
  expect(() => encodeFinal22Submission(42n, ("0x" + "00".repeat(384)) as Hex, aliases)).toThrow("width");
});
test("restart/resume/replay/reorg always uses canonical cursor while root remains immutable", async () => {
  const f = fixture(); await f.plan();
  f.state.cursor = 32n;
  const resumed = await f.plan(JSON.parse(JSON.stringify(f.artifact)));
  expect(resumed.leaves).toEqual([f.leaves[32]!]); expect(resumed.canonical?.summary.root).toBe(f.root);
  expect((await f.plan()).previewCall).toEqual(resumed.previewCall);
  f.state.blockHash = hash(2000n); f.state.cursor = 0n;
  expect((await f.plan()).leaves).toHaveLength(32);
  f.state.reorgDuringRead = true;
  await expect(f.plan()).rejects.toThrow("canonical");
});
test("wrong root/binding/release/codehash/chain/count and cursor outages fail closed", async () => {
  for (const field of ["binding", "releaseId", "root"] as const) {
    const f = fixture(); f.state[field] = hash(999n);
    await expect(f.plan()).rejects.toThrow();
  }
  const f = fixture(); f.state.verifierCode = "0x6003";
  await expect(f.plan()).rejects.toThrow("codehash");
  const g = fixture(); await expect(readCanonicalAcceptance(g.transport, game, 42n, 1n)).rejects.toThrow("chain");
  g.state.count = 32n; await expect(g.plan()).rejects.toThrow("count");
  const h = fixture(); h.state.corruptCursor = true; await expect(h.plan()).rejects.toThrow("cursor");
  h.state.unaccepted = true; expect((await h.plan()).state).toBe("unaccepted");
});
test("zero-loss omission/duplicate/reorder/tail and manifest substitutions never plan", async () => {
  for (const mutate of [
    (a: FinalBattleArtifact) => { a.Leaves.pop(); },
    (a: FinalBattleArtifact) => { a.Leaves[1]!.Source = a.Leaves[0]!.Source; },
    (a: FinalBattleArtifact) => { a.Leaves.reverse(); },
    (a: FinalBattleArtifact) => { a.Leaves[32]!.Next = "0"; },
    (a: FinalBattleArtifact) => { a.Manifest.ChainRecord = "0"; },
    (a: FinalBattleArtifact) => { a.Leaves[0]!.Count = "01"; },
  ]) { const f = fixture(); mutate(f.artifact); await expect(f.plan()).rejects.toThrow(); }
  expect(() => decodeFinalArtifact(fixture().artifact, 32)).toThrow("oversized");
});
test("canonical persisted artifact rejects duplicate/unknown fields, aliases and byte exhaustion", () => {
  const text = JSON.stringify(fixture().artifact);
  const limits = { maxArtifactBytes: 100_000, maxLeaves: 100 };
  expect(parseFinalArtifactFile(text, limits).output.leaves).toHaveLength(33);
  for (const changed of [text + " ", text.replace('"Schema":', '"extra":true,"Schema":'),
    text.replace('"Proof":', '"Proof":"", "Proof":'), text.replace('"Count":"1"', '"Count":"01"')])
    expect(() => parseFinalArtifactFile(changed, limits)).toThrow();
  expect(() => parseFinalArtifactFile(text, { ...limits, maxArtifactBytes: 10 })).toThrow("budget");
});
test("end cursor validates entire suffix and economics is not terminal; empty tail is plannable", async () => {
  const f = fixture(); f.state.cursor = 33n; f.state.phase = 2; f.state.staged = 11;
  const p = await f.plan(); expect(p.state).toBe("economics"); expect(p.leaves).toEqual([]); expect(p.previewCall).toBeUndefined();
  f.state.corruptCursor = true; await expect(f.plan()).rejects.toThrow("cursor");
  const empty = fixture(0); const plan = await empty.plan();
  expect(plan.leaves).toEqual([]); expect(plan.state).toBe("application-exhausted"); expect(plan.previewCall).toBeDefined();
});

const exportLimits = { maxArtifactBytes: 100_000, maxLeaves: 100 };
function exportedFixture(count = 33) {
  const f = fixture(count);
  // Historical genuine proof bytes only for shape/ABI preservation. These publics/leaves are MOCK
  // authority and do NOT match the historical proof; no cryptographic/chain acceptance is claimed.
  const historical = JSON.parse(readFileSync(new URL("../../../packages/battle-prover/composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters/final/receipt.evm.json", import.meta.url), "utf8"));
  const exported = { schema: f.artifact.Schema, proof: historical.proof as string, public: f.artifact.Public,
    manifest: f.artifact.Manifest, leaves: f.artifact.Leaves };
  const serialized = () => JSON.stringify(exported);
  const authority: ProofArtifactAuthority = { chainId: 8453n, game, battleId: 42n, binding: f.binding, releaseId: f.state.releaseId,
    vkHash: f.artifact.Manifest.VKHash, inputHash: f.artifact.Manifest.InputHash, compressedProofHash: f.artifact.Manifest.ProofHash,
    exportSha256: createHash("sha256").update(serialized()).digest("hex") };
  const acquire = async () => ({ serialized: serialized(), authority });
  const plan = () => readProofOperation(f.transport, game, 42n, 8453n, acquire, exportLimits);
  return { ...f, exported, serialized, authority, acquire, operationPlan: plan };
}
test("frozen lowercase ExportEVM decoder preserves complete genuine historical proof bytes and compressed hash semantics", () => {
  const f = exportedFixture();
  const decoded = parseEVMArtifact(f.serialized(), exportLimits);
  expect(decoded.proof).toHaveLength(770);
  expect(String(decoded.proof)).toBe(f.exported.proof);
  expect(decoded.manifest.ProofHash).not.toBe(createHash("sha256").update(Buffer.from(decoded.proof.slice(2), "hex")).digest("hex"));
  const call = decodeFunctionData({ abi: proofDeliveryAbi, data: encodeFinal22Submission(42n, decoded.proof, decoded.public) });
  expect(call.functionName).toBe("submitBattleProof");
  expect(String(call.args?.[1])).toBe(f.exported.proof);
  expect(Array.from(call.args?.[2] ?? [])).toEqual(f.exported.public.map(BigInt));
  expect(Object.isFrozen(decoded.output.leaves[0])).toBe(true);
  expect(() => parseEVMArtifact(JSON.stringify(f.artifact), exportLimits)).toThrow();
});
test("strict export rejects truncation aliases duplicate keys malformed proof scalar width and budgets", () => {
  const f = exportedFixture(); const text = f.serialized();
  for (const bad of [text.slice(0, -1), text + "\n", text.replace('"schema":', '"schema":"bad","schema":'),
    text.replace('"schema":', '"Schema":'), text.replace('"leaves":', '"extra":1,"leaves":'),
    text.replace(f.exported.proof, f.exported.proof.slice(0,-2)), text.replace(f.exported.proof, f.exported.proof.toUpperCase()),
    text.replace('"Count":"1"', '"Count":"01"'), text.replace('"Count":"1"', '"Count":"4294967296"')])
    expect(() => parseEVMArtifact(bad, exportLimits)).toThrow();
  for (let i = 0; i < 22; i++) {
    const changed = structuredClone(f.exported); changed.public[i] = "18446744073709551616";
    expect(() => parseEVMArtifact(JSON.stringify(changed), exportLimits)).toThrow();
  }
  expect(() => parseEVMArtifact(text, { ...exportLimits, maxLeaves: 32 })).toThrow();
  expect(() => parseEVMArtifact(text, { ...exportLimits, maxArtifactBytes: 32 })).toThrow();
  expect(() => parseEVMArtifact(text, { ...exportLimits, maxArtifactBytes: 17 * 1024 * 1024 })).toThrow();
});
test("approved export plans submit then competitor acceptance resumes canonical 32+1 leaves across restart", async () => {
  const f = exportedFixture(); f.state.unaccepted = true;
  const submit = await f.operationPlan();
  expect(decodeFunctionData({ abi: proofDeliveryAbi, data: submit!.data }).functionName).toBe("submitBattleProof");
  expect(submit!.deliveryEnabled).toBe(false);
  const identity = submit!.operationId;
  f.state.blockHash = hash(2000n);
  expect((await f.operationPlan())!.operationId).toBe(identity);
  f.state.unaccepted = false;
  const first = await f.operationPlan();
  expect(first!.operationId).not.toBe(identity);
  expect((decodeFunctionData({ abi: proofDeliveryAbi, data: first!.data }).args[1] as readonly unknown[]).length).toBe(32);
  expect(JSON.parse(first!.membership).kind).toBe("proof-v1");
  f.state.cursor = 32n;
  const second = await f.operationPlan();
  expect(JSON.parse(second!.membership).cursor).toBe("32");
  expect((decodeFunctionData({ abi: proofDeliveryAbi, data: second!.data }).args[1] as readonly unknown[]).length).toBe(1);
  expect(second!.operationId).not.toBe(first!.operationId);
  expect((await readProofOperation(f.transport, game, 42n, 8453n, f.acquire, exportLimits))!.operationId).toBe(second!.operationId);
  f.state.cursor = 33n; f.state.phase = 2; f.state.staged = 11;
  expect(await f.operationPlan()).toBeUndefined();
  expect(f.calls.every(c => !/send|sign|getTransactionCount/i.test(c.method))).toBe(true);
  expect(reviewedProofProgressVersions).toEqual([]);
});
test("missing external metadata, wrong release/job, changed export, frozen member and reorg never authorize planning", async () => {
  for (const key of ["binding", "releaseId", "vkHash", "inputHash", "compressedProofHash", "exportSha256"] as const) {
    const f = exportedFixture();
    const authority = { ...f.authority, [key]: key === "binding" || key === "releaseId" ? hash(999n) : "d".repeat(64) };
    await expect(readProofOperation(f.transport, game, 42n, 8453n, async () => ({ serialized: f.serialized(), authority }), exportLimits)).rejects.toThrow();
  }
  const f = exportedFixture();
  await expect(readProofOperation(f.transport, game, 42n, 8453n, async () => ({ serialized: f.serialized(), authority: undefined }), exportLimits)).rejects.toThrow("metadata unavailable");
  f.exported.proof = "0x" + "00".repeat(384);
  await expect(f.operationPlan()).rejects.toThrow("metadata mismatch");
  const g = exportedFixture(); g.state.wrongMember = true;
  await expect(g.operationPlan()).rejects.toThrow("member mismatch");
  g.state.wrongMember = false; g.state.root = hash(999n);
  await expect(g.operationPlan()).rejects.toThrow();
  const h = exportedFixture(); h.state.reorgDuringRead = true;
  await expect(h.operationPlan()).rejects.toThrow("canonical");
  const j = exportedFixture();
  await expect(readProofOperation(j.transport, game, 42n, 8453n, async () => {
    j.state.blockHash = hash(999n); return j.acquire();
  }, exportLimits)).rejects.toThrow();
});

test("trusted file digest cannot substitute for full suffix, canonical cursor or frozen ownership authentication", async () => {
  for (const mutate of [
    (f: ReturnType<typeof exportedFixture>) => { f.exported.leaves[32]!.Next = "0"; },
    (f: ReturnType<typeof exportedFixture>) => { f.exported.leaves[0]!.Lost = "1"; },
    (f: ReturnType<typeof exportedFixture>) => { f.exported.leaves[1]!.Source = "0"; },
    (f: ReturnType<typeof exportedFixture>) => { f.exported.leaves.reverse(); },
  ]) {
    const f = exportedFixture(); mutate(f);
    const authority = { ...f.authority, exportSha256: createHash("sha256").update(f.serialized()).digest("hex") };
    await expect(readProofOperation(f.transport, game, 42n, 8453n, async () => ({ serialized: f.serialized(), authority }), exportLimits)).rejects.toThrow();
  }
  const f = exportedFixture(); f.state.corruptCursor = true;
  await expect(f.operationPlan()).rejects.toThrow("cursor");
  f.state.corruptCursor = false; f.state.cursor = 34n;
  await expect(f.operationPlan()).rejects.toThrow();
  const g = exportedFixture();
  await expect(readProofOperation(g.transport, game, 42n, 8453n, g.acquire, { ...exportLimits, batchSize: 33 })).rejects.toThrow("batch");
  await expect(readProofOperation(g.transport, game, 42n, 8453n, g.acquire, { ...exportLimits, maxLeaves: 32 })).rejects.toThrow("budget");
});
test("empty approved output still plans empty apply to authenticate tail; restart reorg resumes actual cursor", async () => {
  const empty = exportedFixture(0);
  const p = await empty.operationPlan();
  const decoded = decodeFunctionData({ abi: proofDeliveryAbi, data: p!.data });
  expect(decoded.functionName).toBe("applyProofBattleLeaves"); expect(decoded.args?.[1]).toEqual([]);
  const f = exportedFixture(); f.state.cursor = 32n;
  const old = await f.operationPlan();
  f.state.cursor = 0n; f.state.blockHash = hash(5000n);
  const reorg = await f.operationPlan();
  expect(JSON.parse(reorg!.membership).cursor).toBe("0");
  expect(reorg!.operationId).not.toBe(old!.operationId);
});

test("approved immutable file provider composes strict decoder canonical planning and backend wire across restart", async () => {
  const f = exportedFixture(); f.state.unaccepted = true;
  const directory = await realpath(await mkdtemp(join(tmpdir(), "proof-provider-")));
  const filename = proofArtifactBasename({ chainId: "8453", battleId: "42", game, binding: f.binding, releaseId: f.state.releaseId });
  const options = { source: { directory, trust: "fixed-readonly-consumer-directory-and-immutable-ancestors" as const }, limits: exportLimits,
    transport: f.transport, game, battleId: 42n, chainId: 8453n, authority: async () => f.authority };
  let provider = await openProofFileProvider(options);
  try {
    // Publisher is NOT implemented here; fixture models final-name publication only.
    await writeFile(join(directory, "unfinished.tmp"), f.serialized().slice(0,-1));
    await expect(provider.plan()).rejects.toThrow();
    await writeFile(join(directory, "unfinished.tmp"), f.serialized());
    await rename(join(directory, "unfinished.tmp"), join(directory, filename));
    const submit = await provider.plan();
    expect(validateProofPlan(submit!, 8453, game).operationId).toBe(submit!.operationId);
    expect(JSON.parse(submit!.membership).action).toBe("submit");
    await provider.close();
    await expect(provider.plan()).rejects.toThrow("closed");
    provider = await openProofFileProvider(options); f.state.unaccepted = false; f.state.cursor = 32n;
    const application = await provider.plan();
    expect(validateProofPlan(application!, 8453, game).operationId).toBe(application!.operationId);
    expect(JSON.parse(application!.membership).cursor).toBe("32");
    f.state.paused = true; await expect(provider.plan()).rejects.toThrow("paused");
    f.state.paused = false; f.state.ordering = false; await expect(provider.plan()).rejects.toThrow("ordering");
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
test("file provider never self-approves absent metadata or accepts stable partial/corrupt final export", async () => {
  const f = exportedFixture();
  const directory = await realpath(await mkdtemp(join(tmpdir(), "proof-provider-reject-")));
  const path = join(directory, proofArtifactBasename({ chainId: "8453", battleId: "42", game, binding: f.binding, releaseId: f.state.releaseId }));
  let available = false;
  const provider = await openProofFileProvider({ source: { directory, trust: "fixed-readonly-consumer-directory-and-immutable-ancestors" },
    limits: exportLimits, transport: f.transport, game, battleId: 42n, chainId: 8453n, authority: async () => available ? f.authority : undefined });
  try {
    await writeFile(path, f.serialized());
    await expect(provider.plan()).rejects.toThrow("metadata unavailable");
    available = true;
    await writeFile(path, f.serialized().slice(0,-1));
    await expect(provider.plan()).rejects.toThrow();
    await writeFile(path, Buffer.from([0xff,0xfe]));
    await expect(provider.plan()).rejects.toThrow();
    await writeFile(path, f.serialized().replace(f.exported.proof, "0x" + "ab".repeat(384)));
    await expect(provider.plan()).rejects.toThrow("metadata mismatch");
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

// Source trace (no contract execution): Proof.Phase enum=AwaitingRandomness2/AwaitingProof3;
// Proof.awaitProof sets context/seed/phase3; PreparationModule40-41 sets stage17 in the
// same call from stage16; SettlementModule57-58 requires phase3+stage17+Unaccepted0.
test("actual readiness transition phase2 stage16 to phase3 stage17 gates acquisition", async () => {
  const f = exportedFixture(); f.state.unaccepted = true;
  f.state.proofPhase = 2; f.state.staged = 16; f.state.seed = 0n; f.state.context = 0n;
  let acquisitions = 0;
  const acquire = async () => { acquisitions++; return f.acquire(); };
  const plan = () => readProofOperation(f.transport, game, 42n, 8453n, acquire, exportLimits);
  expect((await readProofBattleStatus(f.transport, game, 42n))?.state).toBe("randomness-wait");
  await expect(plan()).rejects.toThrow("not awaiting result");
  expect(acquisitions).toBe(0);
  expect(f.calls.some(c => /send|sign|getTransactionCount/i.test(c.method))).toBe(false);
  // The actual atomic preparation transition freezes context and committed seed.
  f.state.proofPhase = 3; f.state.staged = 17; f.state.context = 12n; f.state.seed = 13n;
  expect((await readProofBattleStatus(f.transport, game, 42n))?.state).toBe("proving");
  const ready = await plan();
  expect(acquisitions).toBe(1);
  expect(decodeFunctionData({ abi: proofDeliveryAbi, data: ready!.data }).functionName).toBe("submitBattleProof");
  expect(ready!.deliveryEnabled).toBe(false);
  expect(await readCanonicalAcceptance(f.transport, game, 42n, 8453n)).toBeUndefined();
  expect(f.calls.some(c => /send|sign|getTransactionCount/i.test(c.method))).toBe(false);
});
test("actual readiness rejects incoherent proof and staged phase pairs before acquisition", async () => {
  for (const [proofPhase, staged] of [[2,17], [3,16], [3,11], [3,12], [3,13], [1,16], [1,17]]) {
    const f = exportedFixture(); f.state.unaccepted = true;
    f.state.proofPhase = proofPhase!; f.state.staged = staged!;
    let acquisitions = 0;
    await expect(readProofOperation(f.transport, game, 42n, 8453n, async () => {
      acquisitions++; return f.acquire();
    }, exportLimits)).rejects.toThrow();
    expect(acquisitions).toBe(0);
    expect(f.calls.some(c => /send|sign|getTransactionCount/i.test(c.method))).toBe(false);
  }
});
test("actual readiness correction preserves accepted application economics and retained terminal records", async () => {
  const f = exportedFixture();
  expect((await readProofBattleStatus(f.transport, game, 42n))?.state).toBe("applying");
  expect(JSON.parse((await f.operationPlan())!.membership).action).toBe("apply");
  f.state.phase = 2; f.state.cursor = 33n;
  for (const stage of [11,12,13]) {
    f.state.staged = stage;
    expect((await readCanonicalAcceptance(f.transport, game, 42n, 8453n))?.progress.phase).toBe(2);
    expect(await f.operationPlan()).toBeUndefined();
    const status = await readProofBattleStatus(f.transport, game, 42n);
    if (stage === 13) expect(status).toBeUndefined();
    else expect(status?.state).toBe("economics");
  }
  f.state.proofPhase = 4;
  expect(await f.operationPlan()).toBeUndefined();
});


test("authority commit marker in separate pinned root gates all composed file plans", async () => {
  const { openProofAuthorityResolver } = await import("./proofAuthorityFile");
  const { mkdir } = await import("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "proof-pair-")));
  const trust = "fixed-readonly-consumer-directory-and-immutable-ancestors" as const;
  const source = {directory:join(root,"artifacts"),trust}, metadata = {directory:join(root,"authority"),trust};
  await mkdir(source.directory); await mkdir(metadata.directory);
  const f=exportedFixture(); f.state.unaccepted=true;
  const name=proofArtifactBasename({chainId:"8453",battleId:"42",game,binding:f.binding,releaseId:f.state.releaseId});
  const pins={catalogSha256:"a".repeat(64),publisherConfigSha256:"b".repeat(64)};
  const record={schema:"veydrift.proof-artifact-authority.v1",chainId:"8453",game,battleId:"42",binding:f.binding,
    releaseId:f.state.releaseId,vkHash:f.authority.vkHash,inputHash:f.authority.inputHash,
    compressedProofHash:f.authority.compressedProofHash,exportSha256:f.authority.exportSha256,
    catalogSha256:pins.catalogSha256,jobKey:"1".repeat(64),jobGeneration:"2".repeat(64),jobAnchorNumber:"1",
    jobAnchorHash:"3".repeat(64),artifactBlobSha256:"4".repeat(64),publisherConfigSha256:pins.publisherConfigSha256};
  const authority=await openProofAuthorityResolver({source:metadata,artifactSource:source,pins});
  let provider=await openProofFileProvider({source,limits:exportLimits,transport:f.transport,game,battleId:42n,chainId:8453n,authority:authority.resolve});
  const metadataPath=join(metadata.directory,name.replace(".evm.json",".authority.json"));
  try {
    await writeFile(join(source.directory,name),f.serialized());
    await expect(provider.plan()).rejects.toThrow(); // orphan export, not committed
    await writeFile(join(metadata.directory,"unfinished.tmp"),JSON.stringify(record));
    await expect(provider.plan()).rejects.toThrow();
    await rename(join(metadata.directory,"unfinished.tmp"),metadataPath);
    const planned=await provider.plan();
    expect(JSON.parse(planned!.membership).action).toBe("submit");
    expect(planned!.deliveryEnabled).toBe(false);
    expect(validateProofPlan(planned!,8453,game).operationId).toBe(planned!.operationId);
    await provider.close();
    provider=await openProofFileProvider({source,limits:exportLimits,transport:f.transport,game,battleId:42n,chainId:8453n,authority:authority.resolve});
    expect((await provider.plan())!.operationId).toBe(planned!.operationId);
    await writeFile(metadataPath,JSON.stringify({...record,publisherConfigSha256:"c".repeat(64)}));
    await expect(provider.plan()).rejects.toThrow("pin mismatch");
    await writeFile(metadataPath,JSON.stringify(record));
    await rm(join(source.directory,name));
    await expect(provider.plan()).rejects.toThrow(); // authority-only pair cannot plan either
    expect(f.calls.some(c => /send|sign|getTransactionCount/i.test(c.method))).toBe(false);
    expect(reviewedProofProgressVersions).toEqual([]);
  } finally { await provider.close(); await authority.close(); await rm(root,{recursive:true,force:true}); }
});
