import { createHash } from "node:crypto";
import type { Hex } from "viem";
import type { EVMFinalBattleArtifact } from "../../../packages/api-types/src/index";
import { decodeFinalArtifact } from "./proofDelivery";

export const maximumEVMArtifactBytes = 16 * 1024 * 1024;
export const maximumEVMArtifactLeaves = 16_384;
export type EVMArtifactLimits = { maxArtifactBytes: number; maxLeaves: number };
export function assertEVMArtifactLimits(limits: EVMArtifactLimits): void {
  if (!Number.isSafeInteger(limits.maxArtifactBytes) || limits.maxArtifactBytes < 1 || limits.maxArtifactBytes > maximumEVMArtifactBytes
    || !Number.isSafeInteger(limits.maxLeaves) || limits.maxLeaves < 1 || limits.maxLeaves > maximumEVMArtifactLeaves)
    throw new Error("invalid bounded EVM artifact limits");
}
function keys(value: unknown, expected: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== expected)
    throw new Error("noncanonical EVM artifact fields");
}
/** Exact frozen ExportEVM json.Marshal bytes, not compressed FinalArtifact and not a proof verifier.
 * Comparing stringify also rejects duplicate keys, alternate numeric/string escapes and whitespace.
 * The complete serialized digest must be supplied by trusted publisher metadata before use. */
export function parseEVMArtifact(serialized: string, limits: EVMArtifactLimits) {
  assertEVMArtifactLimits(limits);
  if (typeof serialized !== "string" || !serialized.length || serialized.length > limits.maxArtifactBytes
    || Buffer.byteLength(serialized, "utf8") > limits.maxArtifactBytes) throw new Error("EVM artifact byte budget exceeded");
  const artifact = JSON.parse(serialized) as EVMFinalBattleArtifact;
  keys(artifact, "schema,proof,public,manifest,leaves");
  keys(artifact.manifest, "VKHash,InputHash,ProofHash,ChainRecord,OutputRoot,MemberCount,Rounds,FinalSide0,FinalSide1,Outcome");
  if (artifact.schema !== "raw-linked-settlement22-v3" || typeof artifact.proof !== "string"
    || !/^0x[0-9a-f]{768}$/.test(artifact.proof)) throw new Error("EVM export requires entire lowercase 384-byte proof");
  if (!Array.isArray(artifact.public) || artifact.public.length !== 22 || !Array.isArray(artifact.leaves)
    || artifact.leaves.length > limits.maxLeaves) throw new Error("EVM artifact public/leaf budget");
  for (const leaf of artifact.leaves) keys(leaf, "Index,Cohort,Owner,Source,Side,Unit,Count,Lost,Survivors,Next");
  for (const hash of [artifact.manifest.VKHash, artifact.manifest.InputHash, artifact.manifest.ProofHash])
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid EVM artifact digest");
  if (JSON.stringify(artifact) !== serialized) throw new Error("noncanonical EVM artifact JSON");
  const decoded = decodeFinalArtifact({ Schema: artifact.schema, Manifest: artifact.manifest,
    Public: artifact.public, Proof: artifact.proof, Leaves: artifact.leaves }, limits.maxLeaves);
  // Detach and freeze every retained value: caller mutation must not alter a later signed plan.
  decoded.output.leaves.forEach(Object.freeze);
  Object.freeze(decoded.output.leaves); Object.freeze(decoded.output.finalTotals); Object.freeze(decoded.output);
  return Object.freeze({ ...decoded, proof: artifact.proof as Hex, public: Object.freeze([...artifact.public]),
    manifest: Object.freeze({ ...artifact.manifest }), sha256: createHash("sha256").update(serialized).digest("hex") });
}
export type ParsedEVMArtifact = ReturnType<typeof parseEVMArtifact>;
