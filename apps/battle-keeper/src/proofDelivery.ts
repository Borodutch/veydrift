import { encodeFunctionData, parseAbi, toHex, type Hex } from "viem";
import { proofSettlementWriteSignatures } from "../../../packages/chain-abi/src/proofSettlement";
import type { FinalBattleArtifact } from "../../../packages/api-types/src/index";
import { readCanonicalAcceptance, type CanonicalAcceptance } from "./proofAcceptance";
import { planProofLeaves, type PersistedProofOutput, type ProofLeaf } from "./proofLeaves";
import type { JsonRpcTransport } from "./transport";

export const proofDeliveryAbi = parseAbi(proofSettlementWriteSignatures);
const decimal = (v: unknown, bits = 256): bigint => {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v) || v.length > 78) throw new Error("noncanonical artifact integer");
  const n = BigInt(v);
  if (n >= 1n << BigInt(bits)) throw new Error("artifact integer width");
  return n;
};
export function final22Values(values: readonly string[]) {
  if (values.length !== 22) throw new Error("Final22 public count");
  const limbs = values.map(v => decimal(v, 64));
  const word = (at: number) => limbs.slice(at, at + 4).reduce((n, limb, i) => n | limb << BigInt(64 * i), 0n);
  const totals = [word(13), word(17)] as const;
  const outcome = totals[0] > 0n && totals[1] === 0n ? 1n : totals[1] > 0n && totals[0] === 0n ? 2n : 0n;
  if (limbs[12]! > 6n || limbs[21] !== outcome) throw new Error("Final22 rounds/outcome");
  return { binding: toHex(word(0), { size: 32 }), root: toHex(word(4), { size: 32 }), memberCount: word(8),
    rounds: Number(limbs[12]), finalTotals: totals, outcome: Number(outcome), limbs };
}

/** Decodes the Go runtime FinalArtifact file contract (artifact_notes.md), NOT a private
 * outputbridge.Manifest. Does not verify gnark proof or claim the artifact's VK/input hashes trusted.
 * Allocation advice becomes usable only after full suffix comparison to canonical chain acceptance. */
export function decodeFinalArtifact(value: unknown, maxLeaves: number): { output: PersistedProofOutput; rounds: number; outcome: number } {
  if (!Number.isSafeInteger(maxLeaves) || maxLeaves < 1) throw new Error("positive artifact leaf budget required");
  if (!value || typeof value !== "object") throw new Error("missing final artifact");
  const artifact = value as FinalBattleArtifact;
  if (artifact.Schema !== "raw-linked-settlement22-v3" || !artifact.Manifest || !Array.isArray(artifact.Public)
    || !Array.isArray(artifact.Leaves) || artifact.Leaves.length > maxLeaves || typeof artifact.Proof !== "string") throw new Error("invalid/oversized final artifact");
  const manifest = artifact.Manifest;
  const publics = final22Values(artifact.Public);
  if (BigInt(publics.binding) !== decimal(manifest.ChainRecord) || BigInt(publics.root) !== decimal(manifest.OutputRoot)
    || publics.memberCount !== decimal(manifest.MemberCount) || BigInt(publics.rounds) !== decimal(manifest.Rounds, 8)
    || publics.finalTotals[0] !== decimal(manifest.FinalSide0) || publics.finalTotals[1] !== decimal(manifest.FinalSide1)
    || BigInt(publics.outcome) !== decimal(manifest.Outcome, 8) || publics.memberCount !== BigInt(artifact.Leaves.length))
    throw new Error("artifact manifest/public mismatch");
  const leaves = artifact.Leaves.map((leaf, index) => {
    if (!leaf || decimal(leaf.Index) !== BigInt(index)) throw new Error("artifact leaf order");
    return { cohortId: decimal(leaf.Cohort), owner: toHex(decimal(leaf.Owner, 160), { size: 20 }), source: decimal(leaf.Source),
      side: Number(decimal(leaf.Side, 8)), unit: Number(decimal(leaf.Unit, 8)), enrolledCount: Number(decimal(leaf.Count, 32)),
      lost: Number(decimal(leaf.Lost, 32)), survivors: Number(decimal(leaf.Survivors, 32)), next: toHex(decimal(leaf.Next), { size: 32 }) };
  });
  return { output: { binding: publics.binding, root: publics.root, memberCount: publics.memberCount, finalTotals: publics.finalTotals, leaves },
    rounds: publics.rounds, outcome: publics.outcome };
}

/** Exact Go json.Marshal wire: rejects duplicate/unknown fields and noncanonical encodings.
 * Caller owns bounded file acquisition; byte/leaf budgets reject instead of truncating output. */
export function parseFinalArtifactFile(serialized: string, limits: { maxArtifactBytes: number; maxLeaves: number }) {
  if (!Number.isSafeInteger(limits.maxArtifactBytes) || limits.maxArtifactBytes < 1
    || serialized.length > limits.maxArtifactBytes || new TextEncoder().encode(serialized).length > limits.maxArtifactBytes)
    throw new Error("artifact byte budget exceeded");
  const artifact = JSON.parse(serialized) as FinalBattleArtifact;
  const exactKeys = (row: unknown, keys: string[]) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).join(",") !== keys.join(","))
      throw new Error("noncanonical artifact fields");
  };
  exactKeys(artifact, ["Schema", "Manifest", "Public", "Proof", "Leaves"]);
  exactKeys(artifact.Manifest, ["VKHash", "InputHash", "ProofHash", "ChainRecord", "OutputRoot", "MemberCount", "Rounds", "FinalSide0", "FinalSide1", "Outcome"]);
  if (!Array.isArray(artifact.Leaves) || artifact.Leaves.length > limits.maxLeaves) throw new Error("artifact leaf budget exceeded");
  for (const leaf of artifact.Leaves) exactKeys(leaf, ["Index", "Cohort", "Owner", "Source", "Side", "Unit", "Count", "Lost", "Survivors", "Next"]);
  for (const digest of [artifact.Manifest.VKHash, artifact.Manifest.InputHash, artifact.Manifest.ProofHash])
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("invalid artifact hash encoding");
  if (typeof artifact.Proof !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.Proof)
    || JSON.stringify(artifact) !== serialized) throw new Error("noncanonical artifact JSON");
  return decodeFinalArtifact(artifact, limits.maxLeaves);
}

/** Typed encoding only. Caller must obtain real MarshalSolidity bytes; the persisted gnark
 * compressed/base64 proof cannot be substituted. This does not authenticate a proof or enable send. */
export function encodeFinal22Submission(battleId: bigint, proof: Hex, inputs: readonly string[]): Hex {
  if (!/^0x[0-9a-f]{768}$/i.test(proof)) throw new Error("Final22 requires 384 MarshalSolidity proof bytes");
  const { limbs } = final22Values(inputs);
  type Publics = readonly [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint];
  return encodeFunctionData({ abi: proofDeliveryAbi, functionName: "submitBattleProof", args: [battleId, proof, limbs as unknown as Publics] });
}

export type ProofDeliveryPlan = {
  deliveryEnabled: false;
  state: "unaccepted" | "application-planned" | "application-exhausted" | "economics";
  gaps: readonly string[]; canonical?: CanonicalAcceptance; leaves?: readonly ProofLeaf[];
  previewCall?: { to: Hex; data: Hex; blockHash: Hex };
};

/** Restart/reorg safe by construction: each plan rereads chain summary and cursor; no local
 * last-sent watermark is used. Returns preview calldata only, NEVER an executable transaction. */
export async function readAndPlanProofDelivery(transport: JsonRpcTransport, game: Hex, battleId: bigint,
  chainId: bigint, artifactJson: string, limits: { maxArtifactBytes: number; maxLeaves: number; batchSize?: number }): Promise<ProofDeliveryPlan> {
  const canonical = await readCanonicalAcceptance(transport, game, battleId, chainId);
  if (!canonical) return { deliveryEnabled: false as const, state: "unaccepted" as const, gaps: ["canonical-acceptance-missing"] };
  const { output, rounds, outcome } = parseFinalArtifactFile(artifactJson, limits);
  if (rounds !== canonical.summary.rounds || outcome !== canonical.summary.outcome) throw new Error("accepted artifact scalar mismatch");
  const leaves = planProofLeaves(canonical.summary, output, canonical.progress, limits.batchSize ?? 32);
  const state = canonical.progress.phase === 2 ? "economics" : leaves.length ? "application-planned" : "application-exhausted";
  return { deliveryEnabled: false as const, state, canonical, gaps: canonical.gaps, leaves,
    // Empty outputs still require the contract's empty apply call to authenticate tail/start economics.
    ...(canonical.progress.phase === 1 ? { previewCall: { to: game, data: encodeFunctionData({ abi: proofDeliveryAbi,
      functionName: "applyProofBattleLeaves", args: [battleId, leaves] }), blockHash: canonical.blockHash } } : {}) };
}
