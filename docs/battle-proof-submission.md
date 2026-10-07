# Final22 contract submission (disabled release gate)

## ABI and routing

New selectors are on VeydriftProofSettlementModule, reached through Game fallback → StateMigration fallback → CombatRaid fallback. There is no new Game/Gameplay decoder. The legacy submitBattleProof(uint256,bytes,bytes32) selector still always reverts.

- submitBattleProof(uint256 battleId, bytes proof, uint256[22] inputs), selector **0x3b29d88c**
- proofBattleAcceptedSummary(uint256 battleId), selector **0x23a03b3b**, returns (bytes32 binding, bytes32 release, bytes32 root, uint256 members, uint8 rounds, uint256[2] totals, uint8 outcome, uint32 version)
- Existing proofSettlementProgress(uint256) returns (Phase phase, uint256 nextIndex, uint256 memberCount, bytes32 expectedDigest)
- Existing applyProofBattleLeaves(uint256, Leaf[]) remains bounded to 32 leaves per transaction.

Public inputs: 0..3 ChainRecord; 4..7 root; 8..11 member count; 12 rounds; 13..16 side0 survivors; 17..20 side1 survivors; 21 outcome. Each four-limb word is little-endian uint64, including digest words. Noncanonical limbs are rejected, not reduced modulo Fr. Rounds must be ≤6; outcome is 1 for side0-only survivors, 2 for side1-only survivors, otherwise 0.

Generated verifier ABI is verifyProof(bytes,uint256[22]) external view with **no return value**. Successful non-revert means valid. Current final proof encoding is exactly 384 bytes. The static call runs only after frozen release identity, codehash, phases, full ChainRecord, member-count and scalar checks.

Accepted event:

ProofBattleAccepted(uint256 indexed battleId, bytes32 indexed binding, bytes32 indexed releaseId, bytes32 root, uint256 memberCount, uint8 rounds, uint256 side0, uint256 side1, uint8 outcome, uint32 version)

releaseId = keccak256(abi.encode(Proof.Version(version,rules,catalog,verifier,verifierCodehash))). ChainRecord remains the existing full keccak hash of the authoritative frozen job plus current chain/Game/battle identity, not a user-supplied replacement. Acceptance writes immutable root and summary once and advances staged workDone once. Rejected submissions write nothing. Before acceptance the complete-summary getter returns zeros. Following acceptance its root remains unchanged while expectedDigest and nextIndex advance.

## Admission is OFF

The namespaced settlement layout appends approvedReleases after its jobs mapping. It defaults empty. No production setter, owner shortcut, development key whitelist, or prospective activation change is introduced. Future ceremony/general-runtime/review work must explicitly implement approved release provisioning. The fixture verifier lives only under contracts/test/support and is never imported by production source.

Application readiness requires phase Applying and the accepted root-bound manifest. Acceptance alone is not battle completion. Zero-loss leaves remain mandatory. After all leaves, staged phase11/12 economics must still reach13; application phase Economics is not terminal. Existing root authentication, bounded leaf delivery, raid enrollment order, accounting and legacy paths are unchanged.

## Exact fixture limitation — not end-to-end submission coverage

The genuine finite proof from composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters/final proves a synthetic job: chain8453, Game address(1), battle100, verifier address(7), verifierCodehash bytes32(77). Address7 is an EVM precompile, and 77 is not the generated verifier runtime codehash. The existing proof cannot be submitted against a genuine prepared live job or the deployed fixture verifier while enforcing these identity checks. Approval injection cannot repair this cryptographic mismatch, nor may a test label a replaced ChainRecord as authenticated.

Contract tests therefore distinguish:

1. Genuine proof verification using the actual generated verifier; the 22 publics/proof are copied from receipt.evm.json. Generated Solidity is copied from receipt.sol with forge formatting only (original SHA256 4d6279f22e749e203ac7bf42568254306881310711abb965c80a2645397ec8e9).
2. Real proxy submission rejection, including the genuine-but-wrong-job proof; replacing its ChainRecord with the live job's reaches the genuine verifier and fails cryptographically.
3. A **test-only explicit synthetic-premise injection**, after real verifier success, installs accepted state and bridges the fixture binding solely to test authenticated real-root leaf application/summary/replay. It is not production submission success, an authoritative onchain preparation fixture, or proof that the accepted event path executed.

Positive production submit/accepted-event/workDone+1 coverage remains missing until an identity-correct proof is supplied. No proof regeneration or production promotion is performed here. The real fixture's three authenticated leaves are reconstructed and checked against the actual proven root; no synthetic root replaces it.

## Consumer/runtime handoff

Use the module ABI against the Game address. Archive the complete acceptance event and canonical suffix manifest; read summary/progress at the same canonical block. Refuse a manifest whose immutable root/binding differs from the summary. Resume at nextIndex/expectedDigest; never treat a successful submission receipt or phase Economics as arrival settlement. Only retry rejected submission when an actual job/runtime/proof prerequisite changes. Do not advertise release capability merely because the selectors exist: approval and prospective routing remain disabled.

## Contract validation receipt (2026-10-06)

- Final focused run: **45 passed, 0 failed**, six suites (submission8, lifecycle10, settlement16, plus staged-review/research/live-upgrade regressions). Receipt: /tmp/ticket44-final22-final-tests.log.
- Full build/output warning guard, EIP170 sizes, storage-layout checker, formatter, live-upgrade policy and test-profile gates passed. Final script /tmp/ticket44-final22-final-checks.sh collected exit0 (cool-trail).
- Runtime bytes: Game24491 (85 spare), Gameplay24564 (12 spare), StateMigration22631 (1945 spare), ProofSettlement14472 (10104 spare). Game/Gameplay are unchanged.
- Cold genuine-root first leaf:158627 gross gas. Existing cold32-leaf, economics and return-epoch checks remain green. New explicit verification/submission/application calls are capped at15M less21000; test-wide aggregate gas is not a transaction bound.
- Layout preserves Game v1/reviewed append, resource-token storage and RandomnessEngine live prefix/reviewed append. The only new storage is the appended namespaced approvedReleases mapping; the existing application and proof-job fields are not reordered.
- No production registry approval, activation setter, deployment, commit or proof regeneration. Positive production submission/event coverage remains the identity-correct-fixture gap described above.
