import { sep } from "node:path";
import { realpath } from "node:fs/promises";
import { openProofAuthorityDirectory, proofArtifactBasename, type TrustedProofArtifactDirectory } from "./proofArtifactFile";
import type { CanonicalProofJob } from "./proofAcceptance";
import type { ProofArtifactAuthority } from "./proofOperation";

const fields = ["schema", "chainId", "game", "battleId", "binding", "releaseId", "vkHash", "inputHash",
  "compressedProofHash", "exportSha256", "catalogSha256", "jobKey", "jobGeneration", "jobAnchorNumber",
  "jobAnchorHash", "artifactBlobSha256", "publisherConfigSha256"] as const;
export type ProofPublisherPins = Readonly<{ catalogSha256: string; publisherConfigSha256: string }>;
function digest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function pinsValid(pins: ProofPublisherPins): void {
  if (!digest(pins.catalogSha256) || !digest(pins.publisherConfigSha256)) throw new Error("independent publisher pins required");
}
/** Exact Go json.Marshal(Authority) wire. Pins are deployment-owner inputs, never record-derived.
 * Provenance is an attestation, not release enrollment or current chain authority. */
export function parseProofAuthority(serialized: string, job: CanonicalProofJob, pins: ProofPublisherPins): ProofArtifactAuthority {
  pinsValid(pins);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 16384) throw new Error("authority byte budget");
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid authority object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some(k => typeof record[k] !== "string"))
    throw new Error("invalid authority fields");
  // Rebuilding in schema order rejects duplicates, extras, escaping, whitespace and reordering.
  const canonical = Object.fromEntries(fields.map(k => [k, record[k]]));
  if (JSON.stringify(canonical) !== serialized) throw new Error("noncanonical authority JSON");
  const a = record as Record<typeof fields[number], string>;
  if (a.schema !== "veydrift.proof-artifact-authority.v1") throw new Error("invalid authority schema");
  if (!/^[1-9][0-9]{0,77}$/.test(a.chainId) || !/^[1-9][0-9]{0,77}$/.test(a.battleId) || BigInt(a.game) === 0n)
    throw new Error("invalid positive authority identity");
  proofArtifactBasename(a); // strict uint256/address/bytes32 validation, no filename input
  if (!/^(0|[1-9][0-9]{0,19})$/.test(a.jobAnchorNumber) || BigInt(a.jobAnchorNumber) >= 1n << 64n)
    throw new Error("invalid authority anchor number");
  for (const field of fields.slice(6)) {
    if (field !== "jobAnchorNumber" && !digest(a[field])) throw new Error("invalid authority digest");
  }
  if (a.catalogSha256 !== pins.catalogSha256 || a.publisherConfigSha256 !== pins.publisherConfigSha256)
    throw new Error("authority publisher/catalog pin mismatch");
  if (a.chainId !== job.chainId.toString() || a.battleId !== job.battleId.toString() || a.game !== job.game ||
      a.binding !== job.binding || a.releaseId !== job.releaseId) throw new Error("authority frozen job mismatch");
  // Historical job anchor/provenance is NOT substituted for the current canonical observation.
  return Object.freeze({ chainId: BigInt(a.chainId), battleId: BigInt(a.battleId), game: job.game,
    binding: job.binding, releaseId: job.releaseId, vkHash: a.vkHash, inputHash: a.inputHash,
    compressedProofHash: a.compressedProofHash, exportSha256: a.exportSha256 });
}

/** Pair with openProofFileProvider({source: artifactSource, authority: resolver.resolve,...}).
 * Roots must be disjoint, independently approved and readonly to the consumer/prover.
 * Filesystem trust still requires immutable parents; this is not anchored openat protection. */
export async function openProofAuthorityResolver(options: {
  source: TrustedProofArtifactDirectory; artifactSource: TrustedProofArtifactDirectory;
  pins: ProofPublisherPins; maxMetadataBytes?: number;
}) {
  const pins = Object.freeze({ ...options.pins }); pinsValid(pins);
  const source = { ...options.source }, artifact = { ...options.artifactSource };
  if (typeof source.directory !== "string" || typeof artifact.directory !== "string" || artifact.directory === sep ||
      await realpath(source.directory) !== source.directory || await realpath(artifact.directory) !== artifact.directory)
    throw new Error("canonical authority/artifact roots required");
  if (artifact.trust !== "fixed-readonly-consumer-directory-and-immutable-ancestors" ||
      source.directory === artifact.directory || source.directory.startsWith(artifact.directory + sep) ||
      artifact.directory.startsWith(source.directory + sep)) throw new Error("disjoint trusted authority/artifact roots required");
  const directory = await openProofAuthorityDirectory(source, options.maxMetadataBytes);
  let active = false, closed = false;
  return {
    async resolve(job: CanonicalProofJob): Promise<ProofArtifactAuthority> {
      if (closed || active) throw new Error("authority resolver closed or already reading");
      active = true;
      try {
        const bytes = await directory.read({ chainId: job.chainId.toString(), battleId: job.battleId.toString(),
          game: job.game, binding: job.binding, releaseId: job.releaseId });
        return parseProofAuthority(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), job, pins);
      } finally { active = false; }
    },
    async close() {
      if (active) throw new Error("authority resolver read in progress");
      closed = true; await directory.close();
    },
  };
}
