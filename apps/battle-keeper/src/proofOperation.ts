import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, keccak256, parseAbiParameters, stringToHex, type Hex } from "viem";
import { proofBattleRowSchema } from "../../../packages/chain-abi/src/proofBattle";
import { acceptanceReadAbi, readCanonicalProofJob, type CanonicalProofJob } from "./proofAcceptance";
import { parseEVMArtifact, assertEVMArtifactLimits, type EVMArtifactLimits, type ParsedEVMArtifact } from "./proofEvmArtifact";
import { encodeFinal22Submission, proofDeliveryAbi } from "./proofDelivery";
import { planProofLeaves } from "./proofLeaves";
import type { JsonRpcTransport } from "./transport";

/** Independent approved publisher/job metadata, NEVER populated from an artifact's own claims.
 * No production metadata provider is wired. Export digest authenticates the complete immutable file;
 * compressedProofHash is provenance, not a hash of the 384-byte EVM proof. */
export type ProofArtifactAuthority = Readonly<{
  chainId: bigint; game: Hex; battleId: bigint; binding: Hex; releaseId: Hex;
  vkHash: string; inputHash: string; compressedProofHash: string; exportSha256: string;
}>;
export type ProofOperationMembership = {
  kind: "proof-v1"; chainId: string; game: Hex; battleId: string; binding: Hex; release: Hex;
  root: Hex; cursor: string; cursorDigest: Hex; action: "submit" | "apply"; dataHash: Hex;
};
export type ProofOperationPlan = Readonly<{
  operationId: string; membership: string; to: Hex; data: Hex; blockHash: Hex; blockNumber: bigint;
  deliveryEnabled: false; gaps: readonly string[];
}>;
export function authenticateEVMArtifact(job: CanonicalProofJob, artifact: ParsedEVMArtifact, authority: ProofArtifactAuthority | undefined): void {
  if (!authority) throw new Error("trusted artifact job/release metadata unavailable");
  if (authority.chainId !== job.chainId || authority.game !== job.game || authority.battleId !== job.battleId
    || authority.binding !== job.binding || authority.releaseId !== job.releaseId)
    throw new Error("artifact authoritative job/release mismatch");
  for (const digest of [authority.vkHash, authority.inputHash, authority.compressedProofHash, authority.exportSha256])
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("trusted artifact metadata digest unavailable");
  if (artifact.manifest.VKHash !== authority.vkHash || artifact.manifest.InputHash !== authority.inputHash
    || artifact.manifest.ProofHash !== authority.compressedProofHash || artifact.sha256 !== authority.exportSha256)
    throw new Error("artifact trusted metadata mismatch");
  if (artifact.output.binding !== job.binding || artifact.output.memberCount !== job.memberCount)
    throw new Error("artifact frozen job mismatch");
}
/** Read every frozen row at the SAME hash, bounded by the prevalidated artifact leaf cap.
 * Export order is cohort order, not necessarily enrollment order; compare exact source/unit membership. */
async function authenticateMembers(transport: JsonRpcTransport, job: CanonicalProofJob, artifact: ParsedEVMArtifact): Promise<void> {
  const members = new Map(artifact.output.leaves.map(leaf => [leaf.source + ":" + leaf.unit, leaf]));
  if (members.size !== artifact.output.leaves.length) throw new Error("duplicate artifact member");
  for (let index = 0; index < artifact.output.leaves.length; index++) {
    const data = await transport.request<Hex>("eth_call", [{ to: job.game,
      data: encodeFunctionData({ abi: acceptanceReadAbi, functionName: "proofBattleRecord", args: [job.battleId, 2, BigInt(index)] }) },
      { blockHash: job.blockHash, requireCanonical: true }]);
    const encoded = decodeFunctionResult({ abi: acceptanceReadAbi, functionName: "proofBattleRecord", data });
    const [row] = decodeAbiParameters(parseAbiParameters(proofBattleRowSchema), encoded);
    const key = row.source + ":" + row.unit;
    const leaf = members.get(key);
    if (!leaf || leaf.owner.toLowerCase() !== row.owner.toLowerCase() || leaf.enrolledCount !== row.count || leaf.side !== row.side)
      throw new Error("artifact frozen member mismatch");
    members.delete(key);
  }
  if (members.size) throw new Error("incomplete frozen artifact membership");
}
/** Always reacquire canonical job, immutable export and external metadata; never retain a sent cursor.
 * Callback must use the approved bounded file reader. It receives only authoritative job identity.
 * This returns disabled calldata, not a capability: backend owns all fee/nonce/sign/receipt control. */
export async function readProofOperation(transport: JsonRpcTransport, game: Hex, battleId: bigint, chainId: bigint,
  acquire: (job: CanonicalProofJob) => Promise<{ serialized: string; authority: ProofArtifactAuthority | undefined }>,
  limits: EVMArtifactLimits & { batchSize?: number }): Promise<ProofOperationPlan | undefined> {
  assertEVMArtifactLimits(limits);
  const job = await readCanonicalProofJob(transport, game, battleId, chainId);
  if (!job) return undefined;
  if (job.memberCount > BigInt(limits.maxLeaves)) throw new Error("frozen job exceeds artifact leaf budget");
  const tag = { blockHash: job.blockHash, requireCanonical: true };
  const [pause, eligibility] = await Promise.all([
    transport.request<Hex>("eth_getStorageAt", [game, "0x" + (52n).toString(16).padStart(64, "0"), tag]),
    transport.request<Hex>("eth_call", [{ to: game, data: encodeFunctionData({ abi: acceptanceReadAbi,
      functionName: "fleetMissionEligibility", args: [battleId] }) }, tag]),
  ]);
  if (!/^0x[0-9a-f]{64}$/i.test(pause) || BigInt(pause) !== 0n) throw new Error("proof game paused or pause unavailable");
  const [, , orderingReady] = decodeFunctionResult({ abi: acceptanceReadAbi, functionName: "fleetMissionEligibility", data: eligibility });
  if (!orderingReady) throw new Error("proof chronology ordering unavailable");
  const acquired = await acquire(job);
  const artifact = parseEVMArtifact(acquired.serialized, limits);
  authenticateEVMArtifact(job, artifact, acquired.authority);
  const output = artifact.output;
  const accepted = job.acceptance;
  if (accepted && (artifact.rounds !== accepted.summary.rounds || artifact.outcome !== accepted.summary.outcome))
    throw new Error("accepted export scalar mismatch");
  const progress = accepted?.progress ?? { phase: 1, nextIndex: 0n, memberCount: job.memberCount, expectedDigest: output.root };
  const leaves = planProofLeaves(accepted?.summary ?? output, output, progress, limits.batchSize ?? 32);
  await authenticateMembers(transport, job, artifact);
  // Re-check the observed anchor after file IO and all bounded row reads. No fallback to latest.
  const block = await transport.request<{ hash?: Hex } | null>("eth_getBlockByNumber", ["0x" + job.blockNumber.toString(16), false]);
  if (block?.hash !== job.blockHash) throw new Error("artifact plan anchor is no longer canonical");
  if (progress.phase === 2) return undefined; // economics still ordinary canonical lifecycle, not terminal proof completion
  const operation = accepted ? "apply" : "submit";
  const data = accepted
    ? encodeFunctionData({ abi: proofDeliveryAbi, functionName: "applyProofBattleLeaves", args: [battleId, leaves] })
    : encodeFinal22Submission(battleId, artifact.proof, artifact.public);
  const membership: ProofOperationMembership = { kind: "proof-v1", chainId: chainId.toString(), game,
    battleId: battleId.toString(), binding: job.binding, release: job.releaseId, root: output.root,
    cursor: progress.nextIndex.toString(), cursorDigest: progress.expectedDigest, action: operation, dataHash: keccak256(data) };
  // Shared backend proof-v1 wire; no anchor or mutable fee input can create another nonce.
  const serialized = JSON.stringify(membership);
  return Object.freeze({ operationId: "proof-v1:" + keccak256(stringToHex(serialized)), membership: serialized,
    to: game, data, blockHash: job.blockHash, blockNumber: job.blockNumber, deliveryEnabled: false,
    gaps: Object.freeze([...job.gaps, "trusted-publisher-production-wiring-unavailable"]) });
}
