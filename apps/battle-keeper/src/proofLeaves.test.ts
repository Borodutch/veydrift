import { expect, test } from "bun:test";
import { planProofLeaves, proofLeafDigest, proofTailDigest, type ProofLeaf, type PersistedProofOutput } from "./proofLeaves";
import type { Hex } from "viem";
const binding = ("0x" + "a".repeat(64)) as Hex;
function fixture(): PersistedProofOutput {
  const leaves: ProofLeaf[] = [];
  let next = proofTailDigest(binding, 33n);
  for (let i = 32; i >= 0; i--) {
    const leaf = { cohortId: 1n, owner: "0x1111111111111111111111111111111111111111" as Hex,
      source: BigInt(i), side: 0, unit: 0, enrolledCount: 1, lost: 0, survivors: 1, next };
    leaves.unshift(leaf); next = proofLeafDigest(binding, BigInt(i), leaf);
  }
  return { binding, root: next, memberCount: 33n, finalTotals: [33n, 0n], leaves };
}
test("authentic suffix batching replays chain cursor after restart/reorg, not host last sent", () => {
  const output = fixture();
  const start = { phase: 1, nextIndex: 0n, memberCount: 33n, expectedDigest: output.root };
  expect(planProofLeaves(output, output, start)).toHaveLength(32);
  const resumed = { ...start, nextIndex: 32n, expectedDigest: output.leaves[31]!.next };
  expect(planProofLeaves(output, output, resumed)).toEqual([output.leaves[32]!]);
  expect(planProofLeaves(output, structuredClone(output), resumed)).toEqual([output.leaves[32]!]);
  expect(planProofLeaves(output, output, start)).toHaveLength(32); // canonical rollback, same immutable manifest
  expect(() => planProofLeaves(output, output, { ...resumed, expectedDigest: output.root })).toThrow("cursor");
  expect(() => planProofLeaves(output, output, { ...resumed, phase: 2 })).toThrow("cursor");
});
test("missing zero-loss row, changed accepted root, duplicate members and absent manifest fail closed", () => {
  const output = fixture();
  const start = { phase: 1, nextIndex: 0n, memberCount: 33n, expectedDigest: output.root };
  expect(() => planProofLeaves(undefined, output, start)).toThrow("unavailable");
  expect(() => planProofLeaves(output, { ...output, root: binding }, start)).toThrow("manifest mismatch");
  expect(() => planProofLeaves(output, { ...output, leaves: output.leaves.slice(1) }, start)).toThrow("incomplete");
  const altered = structuredClone(output); altered.leaves[1]!.source = altered.leaves[0]!.source;
  expect(() => planProofLeaves(output, altered, start)).toThrow();
  expect(() => planProofLeaves(output, output, start, 33)).toThrow("bound");
});
