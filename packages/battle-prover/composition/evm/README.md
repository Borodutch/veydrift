# Complete settlement22 proof: actual local EVM evidence

**PASS — 2026-10-06. Development fixture only; no production key promotion.**

The byte-identical generated final verifier accepts the genuine 384-byte MarshalSolidity proof from ../staged-public/settlement-phases-v2/full-20261005-v1/adapters/final. This is the complete finite three-unit, two-sided settlement fixture described by ../FULL-SETTLEMENT-EVIDENCE.md, not the earlier combat-only verifier. No new setup/proving, production contract edits, RPC, wallet, chain transaction or service deployment was performed.

## Executed results

| Measurement | Value |
|---|---:|
| Successful verifyProof callee execution, trace | 446,399 gas |
| Successful cold STATICCALL boundary, gasleft delta | 449,486 gas |
| Separate local CREATE boundary, gasleft delta | 1,915,036 gas |
| CREATE child trace (constructor + code deposit) | 1,880,381 gas |
| Runtime / initcode | 9,392 / 9,420 bytes |
| Genuine proof / complete ABI calldata | 384 / 1,156 bytes |
| Cancun intrinsic transaction charge for this calldata | 31,108 gas |

Five tests passed, zero failed/skipped. The positive proof ran alone first. The full suite then accepted it again, deployed the verifier separately, rejected mutations of **each of all 22 public scalars**, rejected on-curve A.y negation with ProofInvalid(), and rejected on-curve commitment.y negation with CommitmentInvalid(). Every scalar mutation is original+1, still below 2^64 and Fr; rounds 1→2 and outcome 1→2 stay in semantic ranges. Python independently confirms the two original/mutated G1 points are canonical and on curve. Pairing precompiles return false in the corruption traces; this is not a malformed-coordinate or field-range-only test.

Every verifier call is capped at 1,000,000 gas. Every test transaction has a 16,777,216 gas limit, including the 22-case loop (~10.15M total). No raised acceptance ceiling, mocked crypto or disabled code-size limit. Runtime and initcode satisfy EIP-170/EIP-3860. Negative cases require the exact four-byte custom error, so OOG/empty reverts cannot pass. Negative gas is never used as successful-verification cost.

Gas excludes payload construction, caller/game storage, settlement, and deployment except where separately labeled. Cold call includes call/return overhead. CREATE measurements exclude external deployment transaction intrinsic/initcode calldata charges. Intrinsic calldata charge is calculated, not a mined transaction. These are local Cancun EVM measurements, not Base fee estimates or whole game settlement gas evidence.

## Exact provenance and reproducibility

Frozen source revision: **4a2b2e79503d876ae096daac493566790c4f993a**.

check_provenance.py checks all 168 final-manifest source entries against both SHA256 and git show at that revision, both direct dependency manifest hashes, final receipt manifest/hash links and five receipt artifact hashes. It byte-compares our copied Solidity/JSON against originals and all 22 scalars against canonical receipt.public binary witness. Originals are never rewritten. Receipt exporter settlement_stage_test.go uses ExportSolidity and MarshalSolidity and is among the checked sources. Native compressed receipt.proof SHA256 is distinct from decoded MarshalSolidity bytes SHA256:

- Verifier source: 4d6279f22e749e203ac7bf42568254306881310711abb965c80a2645397ec8e9
- Exact fixture JSON: 87a298a1d4da8aad5bde12eaf7c35d02dc879ffa2a00b476a9b2716b0a2e6556
- MarshalSolidity bytes: 8c40bcefd450e7cd3d31ba8bb497c596a498b11c600d6903820d2b1eaf5fac7f

Run from repo root:

    sh packages/battle-prover/composition/evm/run.sh

Solc 0.8.28, optimizer 200 runs, no via-IR, Cancun; Forge/Cast 1.7.1 commit 4072e48705af9d93e3c0f6e29e93b5e9a40caed8. Config and toolchain are recorded. Outputs include positive-evidence.txt, forge-evidence.txt, measurements.json, provenance{,-after}.json and artifact checks. public/verifier.abi.json is compiler-derived; runtime/init hex are extracted from the compiled artifact, independently hashed by cast and checked against executed EXTCODEHASH. Build out/cache and Python caches are ignored.

An initial report-extraction script had an escaping SyntaxError after the actual EVM suite passed; it was corrected and the entire runner completed again. This was a harness-reporting error, not a proof rejection.

## Parent contract integration handoff

Authoritative interface:

    function verifyProof(bytes calldata proof, uint256[22] calldata input) external view;

Selector **0x4a2f947d**. It returns **nothing**, not bool. Success is a nonreverting call with empty returndata to a pinned nonempty verifier contract. Proof must be exactly 384 bytes: A/B/C (256), one Pedersen commitment (64), commitment PoK (64); preserve MarshalSolidity point/coordinate ordering, without manually reversing Fp2 coefficients. The generated verifier hashes its commitment with legacy Keccak and enforces canonical Fr scalars; parent encoding must preserve full uint256 digests through LE64 limbs, never reduce them modulo Fr.

Compiler-generated ABI additionally exposes compressProof(bytes) → (uint256[4],uint256[1],uint256) and verifyCompressedProof(uint256[4],uint256[1],uint256,uint256[22]) → (). Those optional compressed methods were **not exercised** here; integration should use the proved uncompressed path. Errors: ProofInvalid 0x7fcdd1f4, CommitmentInvalid 0xa3a93fee, PublicInputNotInField 0xa54f8e27; bad proof length uses Error(string).

Executed runtime codehash (Keccak256, NOT SHA256):

    0x47156a6078910d97b07e6d974a9b6640139fee9aabe37f28983a1056248e14de

Initcode Keccak256:

    0xb465fef175e4124d3dbf0f3c77ac00b11acef941965f53530c930c822b33949b

These identify **this development verifier and exact build** only. Source paths/compiler/metadata/settings can change codehash; a production-key verifier will necessarily need its own build, test evidence and approved codehash. Do not install this development codehash into the production registry. A nonreverting call to an EOA/empty contract also yields empty returndata, so code-length/codehash pinning and frozen-version identity are mandatory independently of return handling.

| Public indexes | Meaning |
|---|---|
| 0..3 | ChainRecord, four LE64 limbs |
| 4..7 | output Root, four LE64 limbs |
| 8..11 | memberCount, four LE64 limbs |
| 12 | rounds (uint8 circuit range) |
| 13..16 | finalSide0 survivors, four LE64 limbs |
| 17..20 | finalSide1 survivors, four LE64 limbs |
| 21 | outcome (0..2) |

For each full-width word x, input[start+i] = uint64(x >> (64*i)), i=0..3. Require each limb <2^64 before combining; Solidity ABI words themselves remain ordinary 32-byte big-endian encodings. Compare the reconstructed ChainRecord to the **chain-derived** Keccak of the seventeen authoritative static words in ../../qualification/LINKED-INTERFACE.md: domain, chainid, game proxy, battle ID, frozen version/rules/catalog/verifier/codehash, engine, request ID, purpose, raw snapshot, randomness context, seed, row count, and AwaitingProof phase=3. Never accept a caller-provided binding in place of recomputation.

Fixture decodes to memberCount=3, rounds=1, finalSide0=2, finalSide1=0, outcome=1. It proves its fixture ChainRecord; it is not a replayable production job for an arbitrary deployed verifier address/codehash. Production proving must use the job's actual frozen deployment identity.

After authenticating the approved verifier and complete statement, the parent still owns lifecycle/version checks, exactly-once root acceptance, bounded canonical leaf settlement and terminal tail/member-count checks under ../../outputbridge/INTERFACE.md, replay rejection, storage/inventory safety and whole game gas evidence. Parent should derive the public inputs from accepted job/output fields rather than permit unbound parallel claims. This deliverable executes cryptographic verification only; it does not claim that missing parent integration, production ceremony/D256 catalog instantiation, independent full-proof review or release gates have passed.
