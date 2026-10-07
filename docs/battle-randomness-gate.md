# Opt-in battle randomness snapshot gate

This additive RandomnessEngine API activates no game consumer. Existing requestRandomness,
Request storage/ABI, consumeRandomness purpose matching, FIFO inventory and legacy recovery
semantics remain unchanged. Old requests default to ungated policy.

## Integration sequence

1. Before flight/enrollment, the authorized game calls requestBattleRandomness(purposeHash)
   and permanently records that request ID for the battle. This reserves the next active FIFO
   commitment even when global precommitRequired is false; missing/inactive inventory reverts.
2. The game closes enrollment, qualifies the complete roster and freezes its canonical nonzero
   snapshot hash, then calls sealBattleSnapshot(requestId, snapshotHash). Only the original
   requester can seal (even after deauthorization). Identical retries are no-ops, including after
   fulfillment; zero, a different hash or another caller reverts. Pausing blocks sealing.
3. The fulfiller reveals the reserved word. fulfillRandomness rejects every gated request until
   sealed, and still checks the original commitment. No owner recovery/reseed is permitted,
   including after timeout, mode changes, pause/unpause or fulfiller rotation.
4. Resolution authenticates request(requestId), battleRequestPolicy(requestId), and
   battlePurposeContext(requestId) against the game's permanently recorded battle context.
   The latter is zero before sealing or for legacy requests; otherwise it is:

   keccak256(abi.encode(BATTLE_SNAPSHOT_PURPOSE_DOMAIN, block.chainid, address(engine),
   requestId, requester, originalPurposeHash, reservedCommitment, snapshotHash)).

   The domain is keccak256("veydrift.battle-snapshot-purpose.v1"). The legacy purpose remains
   unchanged: consumeRandomness still takes that original purpose, NOT the derived context.
   Proof/result integration must independently require the gated policy and the exact sealed
   snapshot/context; reading the random word alone does not authenticate a proof's snapshot.

## Responsibility and trust

The oracle cannot establish flight timing, enrollment closure, roster completeness, prior losses,
research ownership or snapshot qualification. The game must enforce those facts and prevent
request replacement/retry selection, resealing through another request, and post-seal roster
mutation. A nonzero hash is only the requester's assertion, not proof that the roster is qualified.

The fulfiller knows the secret and can disclose it off-chain or in reverting transaction calldata,
withhold it or censor a battle. The gate prevents successful on-chain fulfillment before sealing;
it does not guarantee secret confidentiality or unbiased entropy. This is NOT a VRF. Lost secrets
permanently stall gated requests. Existing owner upgrade authority remains a trust assumption.

Storage is append-only: battleRequestPolicy occupies slot 11 after recovery state at slot 10;
the six-member Request layout is untouched. Upgrade/layout review must explicitly accept this
append in the repository's strict layout checker before release. No deployment is part of this change.
