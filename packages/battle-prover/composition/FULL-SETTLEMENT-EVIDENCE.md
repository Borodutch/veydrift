# Complete settlement proof evidence — 2026-10-06

## Result

Run full-20261005-v1 (settlement-phases-v2) completed all seven phase families and seven integration adapters. BATCH COMPLETE final: **2026-10-06T21:10:26Z**. Original process vivid-mist collected exit 0. Separate attack gate and final receipt re-verification PASS. This supersedes incomplete-integration statements in historical handoffs.

This is an actual complete **finite, three-unit, two-sided, nonzero-shot development fixture**, not D256, an instantiated production key catalog, deployment or ceremony approval. It includes a lethal shot and the dead defender's zero-damage return shot; not every shot has positive damage.

The proof authenticates the complete raw journal plus genuine qualification.LinkedCircuit, preparation/combat, both complete attribution cohorts, both recursive CompleteClose obligations, allocation bridge/report, output accumulator, and final 22-public settlement. The old SHA-layout QualifiedFinal is not substituted for LinkedQualification.

## Actual roots

| Phase | Elementary work | Root |
|---|---:|---|
| Raw | 7 | D3 |
| Preparation | 17 | D5 |
| Combat | 36 | D6 |
| Attribution | 10 and 4 | both D4, shared keys |
| Bridge | 11, including both Close | D4 |
| Report | 3 | D2 |
| Output | 9 | D4 |

Dispatch-first DAG: D0 <- complete leaf catalog; B_h <- D_(h-1); D_h <- [B_h,D_(h-1)]. Leaf keys are shared per kind, aggregation keys per phase/level, including across attribution groups. Genuine unary promotions carry the shorter cohort to D4. No fake leaf proofs, arbitrary witness VKs, repeated transitions or padding transitions. Unused kinds receive genuine setup but no fabricated proof.

Planned phase inventory: 42 checkpoints / 390 proofs / 99 in-memory setups; actual logs and immutable manifests are authoritative. Raw leaf/D0 and qualification used separately audited pinned imports: real prior proofs, not new proof claims. Imported CCS and public receipts were verified before independent development approvals.

## Final batch measurements

| Adapter | Constraints | Public | Wall seconds | Max RSS bytes |
|---|---:|---:|---:|---:|
| prepared-combat | 3,355,595 | 8 | 948.96 | 5,907,038,208 |
| bridge-report | 3,356,582 | 8 | 849.50 | 5,794,791,424 |
| pipeline | 3,454,146 | 8 | 854.52 | 6,323,437,568 |
| output-pipeline | 3,411,146 | 1 | 875.25 | 6,022,545,408 |
| final | 3,362,421 | 22 | 952.75 | 6,471,696,384 |

Earlier raw-qualified: 3,397,328 constraints, 836.78 seconds. All proof stages stayed below 4M constraints and individual 60-minute timeouts. Final batch took 75 minutes; whole pipeline took many hours. **No 60-minute total-workflow claim.** GOMAXPROCS=2 and soft GOMEMLIMIT=6GiB unchanged. Observed phase peak RSS reached **8,418,787,328 bytes (~7.84 GiB)** during combat D3; this is not a hard-RSS-cap pass.

Final attacks: 13.62s test / 14.665s package. All 22 public mutations rejected against the actual proof. Separate recursive solver attacks using genuine bundles rejected swap, omitted raw result, omitted output result and wrong chain. These four checks are solver attacks, not newly generated invalid proofs. Final re-verification: 1.33s test / 1.901s package. Both used separate 2GiB soft routine budgets with 10-/5-minute deadlines.

## Artifacts

Relative to packages/battle-prover:
- Logs: composition/pipeline-runs/full-20261005-v1/
- Final: composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters/final/
- Local development approvals: composition/stage-approvals/full-20261005-v1/

| Artifact | SHA-256 |
|---|---|
| receipt.proof | 2f737b89540723d81292c78f2c196c883cb9ad6dcdb911c2ff549e6ba3a8888a |
| receipt.vk | bb99dcb236243b696f0cb812ccc16df40e50659f769168a5458df861473d6505 |
| receipt.public | 45ab58ee9f9af6971bb106c821b7c54bb359cbceeac3dffbae94765b284e6226 |
| receipt.sol | 4d6279f22e749e203ac7bf42568254306881310711abb965c80a2645397ec8e9 |
| attacks.json | 336a0b91ac415795a856ecf57dbbda66d466058b177859528490c9e402afbbde |
| manifest.json | 69ecc5f7db0b3ce0a2e027fac14ff0edb23b6c5473d874ca27c2b294d78f3553 |

receipt.evm.json has developmentOnly=true, schema raw-linked-settlement22-v3, 22 public scalars and MarshalSolidity proof bytes. receipt.sol is the generated Solidity-target verifier. Native proving/verification used Solidity-target options; **EVM execution and parent contract integration are separate evidence**, not inferred from export. attacks.json binds the exact manifest and 168-entry source map. Public checkpoints contain no proving keys, private witnesses or toxic waste.

## Generalization and backend comparison

FAMILY.md and FAMILY-REVIEW.md document installed gnark 0.16.3 inspection. Standard Groth16 SwitchVerificationKey selects audited compile-time catalogs; no invented cryptographic primitive. Installed PLONK also supports switched verification and reusable universal SRS semantics, but the repository measured its binary recursive PLONK node at **14,571,770 sparse constraints**, above current 4M budget. This is an implementation comparison, not an impossibility claim.

Work is four little-endian uint64 limbs with checked nonzero uint256 addition, not field-reduced counts. Earlier host planning and fixed-shape one-/two-unit witness tests are separate evidence. The dispatch-first acyclic height-256 plan is implementable (513 dispatch/binary keys per phase), but this run generates only fixture heights above. Domain: 1..2^256-1 elementary work, **not every uint256 roster size**; quadratic preparation/attribution can exceed it. Production D256 key instantiation, ceremony/promotion and production prover integration remain outside this proof claim; no hidden small fleet cap is proposed.

## Ownership

All worker writes stayed inside composition/. No git, board, deployment, activation or production promotion. No source edits during frozen run. Observer provider interruptions recovered without restarting proofs. All original proof handles collected; redundant paused observer canceled after replacement collection. Parent owns repository review, EVM/contract integration, release and ticket closure.
