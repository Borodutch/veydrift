# Bounded recursive combat prerequisite — genuine proof PASS

Scope: aggregation/ only. No deployment, board, git or battle implementation writes.

## Recovered evidence

- `combat-recursive.log` has terminal PASS: the old real 30-transition combat trace was one batch plus one RangeFinal wrapper, 196-byte final proof, 951.67s test time, 6,252,593,152-byte max RSS. **Not multi-chunk.**
- `proof-depth3.log` is **incomplete**: ends at level-three compile (3,511,634 constraints); process is gone and there is no terminal PASS/final proof receipt. No depth-three completion claim; not restarted because it is countdown, not battle.
- PLONK first binary node measured 14,571,770 sparse constraints above its 7.5M ceiling. Aborted SRS generation is not proof evidence. Preserved behind plonk_experiment.
- Default route remains fixed-key levelled Groth16 with fresh development setup, not a universal-SRS production solution.

## Completed bounded proof

`sh aggregation/run-multichunk.sh` from packages/battle-prover completed exit0; process `crisp-shoal` collected. Go timeout45m, tool timeout2800s; GOMAXPROCS2, soft GOMEMLIMIT6GiB, unchanged4M constraints per circuit. Terminal PASS in combat-multichunk.log: 2112.12s test, 2113.22s wall; 196-byte compressed final proof, seven public scalars. Both 15-transition chunks each 1,333,086 constraints; RangePair 3,426,219; RangeFinal 1,748,260. Genuine chunk proofs, genuine pair proof, and genuine final proof all verified.

**Measured maximum RSS 8,332,034,048 bytes (~7.76GiB), exceeding the 6GiB soft GC budget; no OS hard RSS bound was claimed.** The GOMEMLIMIT setting and4M ceiling were not raised. Pair setup was the slowest stage (12m44.56s). Same-host unrelated countdown ran concurrently for part of this measurement; no throughput isolation claim.

Final proof SHA256: `0c6b5580a7556448b7ded9a2822f0a63376f50a5b4597a0adc1ba2b51daa7a9c`. Source manifest combat-multichunk-source-sha256.txt rechecked after completion: all27 listed files unchanged, receipt combat-multichunk-source-check.txt. New isolated negative-test sources added after the proof started have a separate attacks manifest; they did not change the running proof sources.

TestActualCombatMultiChunkRecursiveProof splits the actual complete trace into [0,15] and [15,30], with every private transition invoking battle.CommittedStep. Generates/verifies both chunk proofs, then a RangePair proof and a Solidity-target RangeFinal proof. Seven public fields throughout; fixed keys, genesis/terminal constraints, complete memory commitments. Development setup/key/proof objects stay memory-only. Same-circuit unapproved-key real proof, result mutation and recursive solver attacks included. Separate cheap authenticated-range adversarial fixtures isolate continuity and final guards from mere signature mismatch.

## Precise missing production gate

This is one fixed four-slot roster, one fixed RNG schedule, one 30-transition battle and two compiled 15-transition chunks. No claim of arbitrary fleets, arbitrary chunk schedule/height, variable authenticated battle memory, production qualified roster/seed/catalog, production key lifecycle, universal SRS, EVM gas or settlement integration. Those remain engineering work, not a human-only blocker or impossibility claim.

## Review and next gate

Two independent Astra/high review passes completed and collected; see REVIEW.md. No blocking source-level soundness finding. Coverage confounding fixed by additional genuine cheap-child adapter tests and consistently rehashed actual-combat result forgeries.

Actual EVM verification/gas for this generated final proof remains **unmeasured**. Solidity-target native verification is not EVM evidence. Current run did not persist public verifier/proof and was not restarted merely to export. EVM-NEXT.md records the available Forge integration path and exact missing gate. No production or deployment claim.

## Collected validation receipts

- `sh aggregation/run-attacks.sh`: exit0; consistent actual outcome/survivor/shot-accounting forgeries rejected (4.26s), authenticated-range continuity/genesis/terminal attacks and positive identity controls PASS (23.11s); total27.984s, two threads/soft4GiB/timeout3m. These isolated adapter checks use genuine child proofs but solver-only outer constraints.
- `GOMAXPROCS=2 GOMEMLIMIT=4GiB go test ./aggregation -short -count=1 -timeout=2m`: PASS0.286s.
- Both independent review children and every owned process collected. No running owned test or review remains; unrelated countdown in original checkout left untouched.
- `.log` is ignored by repository policy, so byte-identical trackable receipts are `combat-multichunk-evidence.txt`, `combat-multichunk-attacks-evidence.txt`, `combat-multichunk-short-evidence.txt`. Two source manifests plus completed source-check receipt retained.
- One initial shell selector used an unquoted pipe and exited127; it did not invalidate the proof, was corrected with the task-scoped run-attacks.sh, and both named tests then passed.
