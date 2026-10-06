import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, type Hex } from "viem";

export type ProofLeaf = {
  cohortId: bigint; owner: Hex; source: bigint; side: number; unit: number;
  enrolledCount: number; lost: number; survivors: number; next: Hex;
};
/** Must come from the canonical accepted-summary event/getter, not a prover's claim.
 * No production adapter exists yet: the present progress getter does not expose root/binding. */
export type AcceptedProofManifest = {
  binding: Hex; root: Hex; memberCount: bigint; finalTotals: readonly [bigint, bigint];
};
export type PersistedProofOutput = AcceptedProofManifest & { leaves: readonly ProofLeaf[] };
const leafDomain = keccak256(stringToHex("veydrift.proof-battle.output-leaf.v1"));
const tailDomain = keccak256(stringToHex("veydrift.proof-battle.output-tail.v1"));
export function proofLeafDigest(binding: Hex, index: bigint, leaf: ProofLeaf): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint256,uint256,address,uint256,uint8,uint8,uint32,uint32,uint32,bytes32"),
    [leafDomain, binding, index, leaf.cohortId, leaf.owner, leaf.source, leaf.side, leaf.unit,
      leaf.enrolledCount, leaf.lost, leaf.survivors, leaf.next]));
}
export function proofTailDigest(binding: Hex, memberCount: bigint): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint256"), [tailDomain, binding, memberCount]));
}

/** Read-only planning. Full persisted output is authenticated before slicing; zero-loss members
 * cannot be skipped. Always resume from CHAIN cursor/digest, never a host's last sent batch.
 * Returned leaves are not authorization to sign; submission remains unavailable. */
export function planProofLeaves(accepted: AcceptedProofManifest | undefined, output: PersistedProofOutput,
  progress: { phase: number; nextIndex: bigint; memberCount: bigint; expectedDigest: Hex }, limit = 32): readonly ProofLeaf[] {
  if (!accepted) throw new Error("canonical accepted manifest unavailable; submission disabled");
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("invalid leaf batch bound");
  if (accepted.binding !== output.binding || accepted.root !== output.root || accepted.memberCount !== output.memberCount
    || accepted.finalTotals.some((total, side) => total !== output.finalTotals[side])) throw new Error("accepted manifest mismatch");
  if (BigInt(output.leaves.length) !== accepted.memberCount || progress.memberCount !== accepted.memberCount
    || progress.phase !== 1 || progress.nextIndex < 0n || progress.nextIndex >= accepted.memberCount)
    throw new Error("invalid application cursor or incomplete output");
  let digest = proofTailDigest(accepted.binding, accepted.memberCount);
  let cursorDigest = digest;
  const totals = [0n, 0n];
  const seen = new Set<string>();
  for (let i = output.leaves.length - 1; i >= 0; i--) {
    const leaf = output.leaves[i]!;
    if (![leaf.enrolledCount, leaf.lost, leaf.survivors].every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)
      || leaf.enrolledCount === 0 || leaf.lost + leaf.survivors !== leaf.enrolledCount
      || !Number.isInteger(leaf.side) || leaf.side < 0 || leaf.side > 1
      || !Number.isInteger(leaf.unit) || leaf.unit < 0 || leaf.unit >= 24 || leaf.next !== digest)
      throw new Error("invalid output leaf/suffix");
    const key = leaf.source + ":" + leaf.unit;
    if (seen.has(key)) throw new Error("duplicate output member");
    seen.add(key);
    totals[leaf.side] = totals[leaf.side]! + BigInt(leaf.survivors);
    digest = proofLeafDigest(accepted.binding, BigInt(i), leaf);
    if (BigInt(i) === progress.nextIndex) cursorDigest = digest;
  }
  if (digest !== accepted.root || cursorDigest !== progress.expectedDigest
    || totals.some((total, side) => total !== accepted.finalTotals[side])) throw new Error("unauthenticated output/root/cursor");
  return output.leaves.slice(Number(progress.nextIndex), Number(progress.nextIndex) + limit);
}
