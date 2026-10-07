# Actual combat final proof: local EVM receipt

**PASS, 2026-10-05. Development-only, no production setup or Base fee claim.**

The genuine 30-transition battle was proved as two 15-step combat chunks, a RangePair recursive proof, then a RangeFinal proof. The exact exported generated verifier accepts that final proof in Foundry's local EVM; changed context, changed result commitment, and corrupted proof all explicitly revert ProofInvalid(). No RPC, broadcast, main-contract configuration changes, proving keys, setup entropy, or private witness export.

## Measured result

| Measurement | Gas / bytes |
|---|---:|
| Successful verifyProof callee execution (trace) | 348,734 gas |
| Successful STATICCALL gasleft delta, including call/return overhead | 351,722 gas |
| Full successful test function, including loads/encoding/logging | 406,586 gas |
| Local CREATE gasleft delta, measured separately | 1,509,024 gas |
| CREATE child trace | 1,474,939 gas |
| Full separate deployment test function | 1,511,346 gas |
| MarshalSolidity proof | 384 bytes |
| ABI call payload including selector and seven scalars | 676 bytes |
| Verifier deployed runtime | 7,367 bytes |

Compiler: solc 0.8.28; optimizer enabled, 200 runs; EVM target Cancun. Forge 1.7.1 (4072e48705af9d93e3c0f6e29e93b5e9a40caed8). No via-IR override. See config-effective.json and ../combat-evm-toolchain.txt. The successful measurement excludes deployment/setup, payload construction, transaction intrinsic/calldata envelope charges, and rollup L1 fees. It is not live Base transaction gas or fees. Negative tests cap each call at 1M gas and require the verifier's explicit ProofInvalid selector; this prevents out-of-gas from masquerading as rejection. Invalid curve points may consume nearly all forwarded precompile gas; their cost is not successful-verification cost.

Proof generation PASS in 34m27.073s; GOMAXPROCS=2, soft GOMEMLIMIT=6GiB, 60m timeout. Constraints unchanged: chunks 1,333,086 each; pair 3,426,219; final 1,748,260, each <=4M. Max RSS 7,876,542,464 bytes (~7.34GiB): soft GC limit is NOT a hard RSS cap.

## Public artifacts and provenance

- public/Verifier.sol: exact gnark ExportSolidity output, public VK constants embedded.
- public/fixture.json: MarshalSolidity proof hex and seven canonical decimal scalars ordered Context, Before, After, Start, End, BeforeDone, AfterDone. Result is a full-state commitment, not a separate public outcome.
- Proof SHA256: 2e0d81afb52fbb7d2840147c6f7f05d26de43423a4cd1cd5965f541a3aa2d05f.
- Verifier SHA256: 93bc7100bddc14b3526dab28b32ea2612ac576bc85a80cb4d9c0f1cd5a28d8c8.
- Fixture SHA256: 83596bee974419b2c666392b2436562d33b9ba9d755d98075f43cee3093e997e.
- ../combat-evm-proof-evidence.txt: genuine proof/native negatives/export/terminal/resource receipt; its 196-byte compressed WriteTo hash is NOT the 384-byte Solidity encoding.
- ../combat-evm-source-sha256.txt + ../combat-evm-source-check.txt: exact run sources (31 checks passed before changes).
- export-run-source.go.txt: original exporter snapshot matching that manifest. After the proof finished, independent review's canonical serialization fix replaced fr.Element.String() with BigInt.String(). The original fixture never had signed values; scalar-regression-evidence.txt independently reconstructs all seven combat scalars and confirms original/fixed serialization equality. No proof/artifact was changed or regenerated. ../combat-evm-final-source-sha256.txt describes corrected sources separately.
- forge-evidence.txt + artifact-sha256.txt + artifact-check.txt: final five-test PASS and exact public/harness/config hashes. forge-initial-evidence.txt preserves the initial successful test run before tightening negative calls; test-initial-source.sol.txt preserves that harness.

## Reproduce

From packages/battle-prover:

	export GOMAXPROCS=2 GOMEMLIMIT=6GiB
	go test ./aggregation -run '^Test(CanonicalEVMScalars|ExportedCombatEVMScalars)$' -count=1 -v
	sh aggregation/run-evm-test.sh

For a fresh expensive proof, preserve this evidence elsewhere first: run-evm-proof.sh deliberately refuses an existing evm/public directory instead of mixing random setups. EXPORT_COMBAT_EVM=1 opts into only the public export after final native verification. Default test execution does not export. Never use these random development setups as production ceremony material.

Scope remains one fixed four-slot roster/RNG schedule, bounded recursive levels, circuit-specific development keys—not arbitrary-fleet aggregation, production protocol qualification, universal SRS, deployed verifier, or soundness certification.
