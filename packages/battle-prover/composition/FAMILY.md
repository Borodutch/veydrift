# Normalized approved-key families — implementation

## Installed-library comparison

Inspected installed gnark0.16.3 and existing aggregation/plonk.go, plonk_key_test.go, STATUS.md, RECURSION_FEASIBILITY.md. Groth16 `SwitchVerificationKey` exists and selects all G1/G2/GT elements, Pedersen commitment keys, and compatible commitment metadata from compile-time catalogs. This implementation uses that established gadget; a witness carries only an index, never a VK. PLONK also provides SwitchVerificationKey/AssertDifferentProofs and reusable universal SRS semantics, so it does NOT require inventing new cryptography. However this repository already measured its first binary recursive PLONK node at14,571,770 sparse constraints, above current4M/circuit budget. It remains an optimization avenue, not proof of impossibility. Current measured route stays Groth16, normalized narrow public schema.

## Public schema and authentication

All approved elementary and aggregation families expose3 BN254 field commitments: first endpoint, last endpoint, uint256 work. Established MiMC gadget commits `(domain440901, length, schema1, phase, role, payloadLength, payload...)`. Endpoint payload is10 native fields, canonical zero padding past phase-specific width. Existing phase statements retained losslessly; all original public input/result/position commitments remain included. Work is4 LE uint64 limbs, checked nonzero, never reduced modulo BN254.

One elementary `FamilyLeaf` contains exactly one real sibling instruction, fixed phase/kind. Generic bridge leaves reject Close. `CompleteClose` executes real Close plus standard recursive verification of approved complete attribution range, then binds exact context/result and completion. All commitments/sibling constraints are actually constrained, not unchecked public structs.

`FamilyNode` uses one or two verified children selected from a fixed compile-time catalog. Binary checks exact sibling links (including combat positions, terminal/result guards); uint256 AddChecked prevents overflow. Unary authenticates/copies a real child without adding work or a phantom transition. Compilation kind depends on phase/level/arity, NOT roster size, ordering or values.

## Concrete protocol-wide bound/key shape

Per phase range:1..2^256-1 elementary work. Five phases. Height256 gives enough binary capacity for every accepted uint256 count. Inputs exceeding this numeric work domain are rejected, not truncated; this is not a small gameplay fleet cap. `CountPlan` handles this domain in O(256) host memory. Materialized `Schedule` is a convenience for real finite traces; `ScheduleTo` adds authenticated unary promotions to a fixed requested root height.

Catalogs:27 elementary keys (prep5, combat11, attribution4, bridge5 including authenticated Close, report2); 5 phases ×256 levels ×2 arities =2560 node keys, plus fixed joins and qualification. Generate attribution tree keys first; then CompleteClose; then bridge tree; other phase trees independently; final joins pin level256 catalogs. Level1 child catalog is its phase leaf family; each higher level catalog is exactly previous-level unary/binary keys. No key ever needs itself, no unknown-VK fixedpoint, no per-roster key generation. A registry/setup builder must validate those DAG roles; arbitrary caller-provided catalogs are not production approval.

This is a finite protocol-wide implementable key plan, NOT a claim that2560 setups have been generated. Setup generation/registry activation, complete highest-level prover and every family’s measured4M check remain implementation work. Development setups used by tests remain IN MEMORY only; no proving keys/toxic waste persisted.

## Current tests and proof scope

`TestFamilyFixedShapes` compiles once per phase/kind and solves all corresponding witnesses from roster sizes1 and2, including every nonzero-shot combat transition. Each has3 public fields and one commitment. Max measured leaf1,062,077. Work/padding/phase hash binds exact native values. Scheduling tests cover1/2/3/5/24/257 leaves; full-domain plan tests include2^255 and2^256-1.

`TestFamilyNonzeroProof` is a bounded genuine-proof experiment: real Damage/Rapidfire of BOTH shots from two-sided battle, same two leaf keys reused and same switched-catalog pair key reused. It is explicitly NOT a complete battle/allocations/final qualification proof. A60min timeout and4M compile guard stop infeasible paths; no original receipts overwritten.

`TestFamilyCloseAuthentication` uses genuine complete attribution proofs for BOTH loss0/loss1 cohorts with one reused four-step development key, then solves the normalized Close verifier twice and attacks context/result/omission/replay/premature/selector. That finite attribution adapter is test-only, not a claim of a production level256 root.

Engineering remains active. Production ceremony is a later release prerequisite, not a reason to stop code work.

## Resource repair superseding the direct two-switch plan

Direct catalog pair actually measured4,360,473 and was stopped before setup. Use dispatch-first DAG from FAMILY-REVIEW.md: D0<-leafcatalog, B_h verifies2 underfixed D_(h-1), D_h verifies1 selected from[B_h,D_(h-1)].513 keys/phase,2565 total plus27leafkeys. This replaces the initial2560-key arity plan above. New dispatched proof run pending; do not claim a recursive nonzero proof until its receipt passes.
