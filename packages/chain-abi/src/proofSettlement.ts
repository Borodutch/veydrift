/** Actual disabled module ABI, deliberately separate from the read-only surface.
 * Encoding these calls is not release approval or authorization to broadcast. */
export const proofSettlementWriteSignatures = [
  "function submitBattleProof(uint256 battleId,bytes proof,uint256[22] inputs)",
  "function applyProofBattleLeaves(uint256 battleId,(uint256 cohortId,address owner,uint256 source,uint8 side,uint8 unit,uint32 enrolledCount,uint32 lost,uint32 survivors,bytes32 next)[] leaves)"
] as const;
export const proofBattleAcceptedEventSignature = "event ProofBattleAccepted(uint256 indexed battleId,bytes32 indexed binding,bytes32 indexed releaseId,bytes32 root,uint256 memberCount,uint8 rounds,uint256 side0,uint256 side1,uint8 outcome,uint32 version)";
