/** Existing read-only contract wire schemas. No viem dependency, signing helpers or submit ABI.
 * Source: VeydriftGame.proofBattleRecord, VeydriftProofSettlementModule,
 * VeydriftProofBattle.Version/record and RandomnessEngine.Request.
 * The leaf application selector is intentionally NOT exported by this read-only surface.
 */
export const proofBattleReadSignatures = [
  "function proofBattleRecord(uint256 id,uint8 kind,uint256 index) view returns (bytes)",
  "function proofSettlementProgress(uint256 id) view returns (uint8 phase,uint256 nextIndex,uint256 memberCount,bytes32 expectedDigest)",
  "function proofBattleAcceptedSummary(uint256 id) view returns (bytes32 binding,bytes32 release,bytes32 root,uint256 members,uint8 rounds,uint256[2] totals,uint8 outcome,uint32 version)"
] as const;

/** These calls target the job's FROZEN engine, not the current Game engine. */
export const proofRandomnessReadSignatures = [
  "function request(uint256 id) view returns ((address requester,bytes32 purposeHash,bytes32 randomnessCommitment,uint64 createdAt,uint64 fulfilledAt,uint256 randomWord))",
  "function battlePurposeContext(uint256 id) view returns (bytes32)"
] as const;

/** kind0: Version, Phase, snapshot, randomnessContext, seed, rowCount (all static). */
export const proofBattleRecordSchema = "(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash),uint8,bytes32,bytes32,uint256,uint256";
/** kind5: engine, requestId, original purpose. kind1/3 remain opaque raw bytes. */
export const proofBattleRequestSchema = "address,uint256,bytes32";
export const proofBattleRowSchema = "(uint256 source,address owner,uint32 count,uint8 side,uint8 unit,uint16 weapons,uint16 shielding,uint16 armor)";
export const proofBattleProspectiveVersionSchema = "uint32";
