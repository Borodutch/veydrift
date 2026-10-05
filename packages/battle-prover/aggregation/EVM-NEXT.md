# Next gate: actual local-EVM verification

Not executed by the current multi-chunk proof run. Native Groth16 verification with Solidity-target transcript options is not EVM execution or gas evidence. Current running test intentionally keeps final verifier/proof memory-only; no export was added during the run and no expensive setup was restarted merely to export.

Available local toolchain: forge on PATH; repository contracts use solc0.8.28. gnark v0.16.3 BN254 VerifyingKey.ExportSolidity emits contract Verifier with `verifyProof(bytes calldata proof, uint256[7] calldata input) public view` for this seven-field schema (returns normally on success, reverts on failure). BN254 Proof.MarshalSolidity emits EIP197 uncompressed A/B/C plus any Pedersen commitment/PoK bytes; the compressed WriteTo receipt is NOT that calldata. Commitment-bearing final proofs require the exact generated variable proof length and Solidity-target transcript options already used by the harness.

Bounded follow-through when a new genuine run is otherwise required:
1. Add an explicit opt-in export after final native verification: only generated public verifier source, MarshalSolidity proof bytes and seven canonical public scalar values. Never write proving keys, setup randomness or private witness. Store under aggregation/ only. Keep source manifest separate for the changed harness.
2. Use an isolated aggregation/ Foundry project (no broadcast, no RPC, no main contracts config changes). Deploy generated verifier locally, call verifyProof with the actual final fixture; fail on unexpected revert.
3. Log verification-call gas separately from deployment/test-harness gas, compiler/optimizer/EVM target and calldata bytes; run changed-result/context and corrupted-proof negatives. Do not label these transaction-envelope/live-Base measurements.
4. Record terminal forge PASS and actual gas. Until then, missing gate is **actual generated combat final proof verified in EVM with gas receipt**. Exportability or a different toy proof cannot substitute.

This gate is unfinished engineering, not an external access or product-decision blocker.
