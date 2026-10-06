import { expect, test } from "bun:test";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters, stringToHex, toHex, type Hex } from "viem";
import { acceptanceReadAbi, readCanonicalAcceptance } from "./proofAcceptance";
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
  const state = { blockHash: hash(1000n), cursor: 0n, phase: 1, staged: 17, root, binding, releaseId, verifierCode,
    approved: 0n, reorgDuringRead: false, corruptCursor: false, count: BigInt(count), unaccepted: false };
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x2105" as T;
    if (method === "eth_getBlockByNumber") return { hash: state.blockHash, number: "0x10" } as T;
    const tag = params.at(-1);
    expect(tag).toEqual({ blockHash: state.blockHash, requireCanonical: true });
    if (state.reorgDuringRead) throw new Error("block no longer canonical");
    if (method === "eth_getStorageAt") return hash(params[1] === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" ? 0n : state.approved) as T;
    if (method === "eth_getCode") return (String(params[0]).toLowerCase() === verifier.toLowerCase() ? state.verifierCode : "0x6002") as T;
    if (method !== "eth_call") throw new Error("unexpected mutation/RPC " + method);
    const decoded = decodeFunctionData({ abi: acceptanceReadAbi, data: (params[0] as { data: Hex }).data });
    if (decoded.functionName === "proofBattleRecord") {
      const words = decoded.args[1] === 0 ? [...versionWords, 3n, 11n, 12n, 13n, BigInt(count)] : [BigInt(engine), 9n, 10n];
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
