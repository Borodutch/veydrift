# Authenticated composition experiment

Uses gnark v0.16.3 BN254 Groth16 recursion (complete arithmetic and subgroup checks); keys are compiled constants, never witness-selected. Private wrappers call unchanged sibling Define methods. No custom cryptography.

## Proof DAG

Preparation(5 real steps) + combat(3) -> prepared-combat proof. Attribution(4 real steps) -> bridge(5 steps including authenticated Close). Bridge + report(1 real step) -> bridge-report proof. Those two joins -> final proof with8 public scalars.

Every elementary transition is constrained. Phase chunks assert every adjacency, canonical genesis and actual terminal. The bridge microprogram counts exactly one Close and authenticates its entire attribution trace, context and output, then proves manifest scans, final-memory scan and finish. Complete result compares report context, combat input/result and terminal report fold. Final joins prep result to bridge prepared root and combat result/input to bridge result/input. The bridge snapshot equality binds preparation identity to combat input.

Generic Chunk **rejects Close**. General schedules must use AuthenticatedClose (verified attribution) and Pair (verified children + adjacency), with an approved key DAG. Bare resultbridge.Step is NOT an approved bridge leaf.

Public final: `[preparationContext, preparationResult, combatInput, combatResult, bridgeContext, allocationResult, reportResult, completeResult]`. A consumer must compare expected inputs, not simply accept any valid proof.

## Bounded fixture and limitations

Actual positive raw row: owner=1/source=1/count=1/side=0/type=0, stats20/5/100. Canonical unit is initialized in combat; no defenders, zero rounds/shots, attacker win; allocation owner/source gets lost0/survivors1. Real nonempty **one-sided** battle, NOT a two-sided/nonzero-shot demonstration.

Fixed phase microprograms are reused independently of roster values, but instruction lengths/schedules are fixed. Finite test DAG **does not meet production arbitrary-height/variable-roster support**. No hidden fleet cap is offered as a production solution. A general fixed-family chunk scheduler, approved level-key catalog and arbitrary-height authenticated root remain missing. Generic Pair/Close primitives alone do not establish that result.

`QualifiedFinal` additionally authenticates a seven-public qualification proof and complete pipeline proof, compares context/input and emits canonical chainSHA256 limbs plus version1. Current proof fixture does NOT use its pinned catalog or policy and cannot be presented as qualified. Chain/RF/seed provenance and on-chain settlement remain external for recorded unqualified run.

## Run and resource receipts

- `GOMAXPROCS=2 GOMEMLIMIT=6GiB go test ./composition -run TestCompilePhases -v`
- `sh composition/run-proof.sh` (60-minute total test timeout (prior90-minute run exceeded current authorization; see RECOVERY.md), <=4M constraints per circuit; local development setup, not ceremony keys).
- Proofs/VKs/public witnesses persisted under `receipts/`, never proving keys.
- `source-sha256.txt` pins source before proof process; later test-only files separately documented.
- `compile-evidence.txt`, `proof-evidence.txt` contain actual outcomes. Running/setup is NOT success.

Production Base verifier deployment, audited ceremony, EVM verification/export of this final circuit, and multi-owner/nonzero-shot end-to-end recursive evidence are not claimed.
