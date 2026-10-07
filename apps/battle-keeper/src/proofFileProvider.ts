import type { Hex } from "viem";
import { openProofArtifactDirectory, type TrustedProofArtifactDirectory } from "./proofArtifactFile";
import { assertEVMArtifactLimits, type EVMArtifactLimits } from "./proofEvmArtifact";
import { readProofOperation, type ProofArtifactAuthority } from "./proofOperation";
import type { CanonicalProofJob } from "./proofAcceptance";
import type { JsonRpcTransport } from "./transport";

/** Explicit future startup composition, not production configuration or a publisher.
 * Uses one approved source and trusted metadata resolver. Each plan rereads both file and chain;
 * never caches acceptance/cursor or derives trusted metadata from file contents. */
export async function openProofFileProvider(options: {
  source: TrustedProofArtifactDirectory; limits: EVMArtifactLimits & { batchSize?: number };
  transport: JsonRpcTransport; game: Hex; battleId: bigint; chainId: bigint;
  authority: (job: CanonicalProofJob) => Promise<ProofArtifactAuthority | undefined>;
}) {
  const { transport, game, battleId, chainId, authority } = options;
  const limits = Object.freeze({ ...options.limits });
  assertEVMArtifactLimits(limits);
  if (limits.batchSize !== undefined && (!Number.isInteger(limits.batchSize) || limits.batchSize < 1 || limits.batchSize > 32))
    throw new Error("invalid proof batch bound");
  const directory = await openProofArtifactDirectory({ ...options.source }, limits.maxArtifactBytes);
  let active = false, closed = false;
  return {
    async plan() {
      if (closed || active) throw new Error("proof file provider closed or already reading");
      active = true;
      try {
        return await readProofOperation(transport, game, battleId, chainId, async job => {
          const trusted = await authority(job);
          if (!trusted) throw new Error("trusted artifact job/release metadata unavailable");
          const pinnedAuthority = Object.freeze({ ...trusted });
          const bytes = await directory.read({ chainId: job.chainId.toString(), battleId: job.battleId.toString(),
            game: job.game, binding: job.binding, releaseId: job.releaseId });
          const serialized = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          return { serialized, authority: pinnedAuthority };
        }, limits);
      } finally { active = false; }
    },
    async close() {
      if (active) throw new Error("proof file provider read in progress");
      closed = true;
      await directory.close();
    },
  };
}
