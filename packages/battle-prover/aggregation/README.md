# Variable-length recursive aggregation experiment

**Development only.** Pinned parent module: gnark v0.16.3 / gnark-crypto v0.21.0. The original variable-length VM is a uint32 countdown, **not battle execution**. Separate combat fixtures now exercise actual `battle.CommittedStep`; distinguish their receipts below.

## Current route and measured PLONK limit

The default build uses **levelled Groth16**, deliberately requiring a fresh development setup at every level. This is a bounded genuine-proof fallback, **not the universal-SRS production solution**. The PLONK route remains available only with `-tags plonk_experiment`. Its first binary node measured **14,571,770 sparse constraints**, exceeding the predeclared 7.5M budget and 2^23 SRS capacity (`plonk-resource-ceiling.log`). The larger SRS generation was stopped once this measurement established it could not fit; `plonk-srs-aborted.log` is not successful proof evidence. No resource/safety ceiling was silently enlarged.

Default Groth16 uses explicit complete arithmetic/subgroup checks and recursive transcript options for each inner level, then Solidity-compatible final transcript options. All keys and setup material remain memory-only. The tested API/semantics are otherwise the same as the PLONK implementation.

## PLONK route (implemented, resource-limited)

A levelled BN254 PLONK binary tree, then one BN254 Groth16 final proof. Every node embeds its entire previous-level verification key as compile-time constants (`gnark:"-"`), including domain, selectors, KZG key and commitment metadata. The final wrapper embeds the root key. No prover-supplied VK, unbound key root, self-key circularity, or conditional proof-verification bypass. Compile/setup proceeds bottom-up.

All PLONK levels derive domain-specific Lagrange SRS from prefixes of **one random development canonical SRS** via gnark-crypto `kzg.ToLagrangeG1`. Its toxic scalar is used only to generate the initial SRS, overwritten afterward, and never printed or persisted; Go is not a secure-erasure environment. No SRS, proving key, verification key, proof or verifier source is written by the harness. Only test receipts/hashes are retained. No production ceremony or production security is claimed.

Each node verifies two actual PLONK proofs using `AssertSameProofs`, with ten public uint32 values fixed across all levels. Both child identities must match; both counter and state endpoints must join exactly; counts add. Step count equals counter distance. Conservation and range checks avoid field-wrap interpretations. Only terminal state zero admits an identity step, which does not advance the counter/count. All appended padding is therefore terminal identity; no nonterminal idle chunk can conceal unfinished execution. The final wrapper additionally enforces counter zero / initial state at the beginning and exact terminal counter / zero state at the end.

The harness pads each execution to the selected power-of-two capacity, so one compiled final key handles all tested lengths at that capacity. Length three includes one terminal identity at depth two. Larger padding suffixes are permitted only as the same constrained terminal identity. They are not counted as real transitions.

All inner proofs use recursive PLONK transcript options. Final Groth16 uses Solidity-compatible prover **and** verifier options; Solidity is exported in memory only. There is no EVM verification/gas claim. Upstream v0.16.3 KZG verifier checks raw adversarial G1 points before folding; fixed G2 SRS points are not witness-controlled. `WithCompleteArithmetic` is explicitly requested (upstream now makes it a no-op because complete arithmetic is default).

## Run

From `packages/battle-prover`:

```sh
GOMAXPROCS=2 GOMEMLIMIT=6GiB go test ./aggregation -short -count=1
GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_AGGREGATION_PROBE=1 AGGREGATION_DEPTH=2 go test ./aggregation -run TestVariableTreeProofs -count=1 -v -timeout=55m
# Optional third aggregation level, 1/2/3/4/5/8 real transitions:
GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_AGGREGATION_PROBE=1 AGGREGATION_DEPTH=3 go test ./aggregation -run TestVariableTreeProofs -count=1 -v -timeout=90m
```

Default Groth16 R1CS ceiling is 4M per circuit. GOMAXPROCS is enforced at <=2; GOMEMLIMIT is a soft GC budget, not an OS hard RSS cap. PLONK constraint ceiling 7.5M, SRS degree capacity 2^23+3, final R1CS ceiling 4M, bounded test timeouts. These are experiment resource limits, not battle fleet/protocol limits.

## Remaining scope

The bounded combat fixture replaces countdown with complete execution/state commitments for its four-slot trace. General variable-memory battle execution and scheduling remain unfinished. Production full-width identity encoding, reviewed SRS provenance/conversion, independent soundness review, target-host sizing, deployed final verifier and gas are not supplied by this probe.

This levelled design supports varying lengths **within a compiled maximum height**, not one universal key for arbitrary height. Increasing height needs another approved level and another final wrapper/key. With the default Groth16 fallback it also needs another circuit-specific setup, unlike the intended universal-SRS route. A production height must be derived from protocol numeric/address/step bounds, not guessed from the small test fixtures. The homogeneous approved-key-root alternative is intentionally not implemented: it requires canonical complete-key hashing/membership, authenticated shared root propagation, and a well-founded base/termination argument. Missing production work is unfinished engineering, not an impossibility finding or human-only blocker.

## Actual combat composition

`combat_test.go` imports the separately owned `battle` package and invokes `battle.CommittedStep.Define` on every private elementary transition in a bounded batch. The complete trace is constrained; this is not a proof of an unconstrained claimed result. Public output is exactly seven scalars compatible with `battle.CommittedStep`: context commitment, before/after full-state commitments, start/end uint64 step counters, before/after terminal flags. A `RangeFinal` recursively verifies the real batch proof with a compile-time approved key, pins the genesis commitment, and requires a nonempty terminal execution. `RangePair` can merge two such seven-field proofs under separate compile-time approved keys. Full-width native scalar commitments are preserved through canonical bit conversion, not one-limb truncation.

```sh
GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_COMBAT_AGGREGATION=1 go test ./aggregation -run TestActualCombatRecursiveProof -count=1 -v -timeout=25m
GOMAXPROCS=2 GOMEMLIMIT=4GiB go test ./aggregation -run TestCombatBatchRejectsForgery -count=1 -v -timeout=3m
GOMAXPROCS=2 GOMEMLIMIT=4GiB go test ./aggregation -run TestCommittedRangeComposition -count=1 -v -timeout=3m
```

This specific combat fixture fixes four unit slots, its roster and RNG/non-RNG schedule in the approved batch key. It proves actual battle logic for that bounded fixture, not arbitrary fleets, dynamically scheduled chunks, production input qualification, or variable-length combat aggregation. The multi-depth variable-length test still uses the countdown VM; do not conflate the two receipts. Seven-field adapters are the composition seam, not evidence that the remaining generalization is finished.

## Fast evidence versus genuine proofs

`key-rejection.log`: genuine child proofs, compiled recursive constraint solving, different approved-key rejection. `committed-range.log`: genuine child proofs and compiled seven-field adapter solving with >64-bit commitments, altered context/replay/terminal rejection. `combat-negative.log`: full actual batch solver, altered output/context/replay/counter/terminal/private-memory rejection. These are **not** standalone generated recursive outer proof receipts. `combat-recursive.log` has terminal PASS for **one** complete batch plus wrapper. `proof-depth3.log` is incomplete (ends at level-three compile, process gone); it is not successful final-proof evidence and was not rerun. New multi-chunk evidence is separately recorded in `combat-multichunk.log` and requires terminal PASS.

## Genuine two-chunk combat prerequisite

`combat_multichunk_test.go` splits the complete 30-transition real trace into 15+15. It generates and verifies both chunk proofs, a `RangePair` proof, then a Solidity-target `RangeFinal` proof. Run `sh aggregation/run-multichunk.sh` from packages/battle-prover (macOS `/usr/bin/time -l` resource receipt; 45m timeout; two threads; soft6GiB; unchanged4M constraint ceiling). No keys/proofs/setup material are persisted. See STATUS.md for terminal outcome and measured resources.

`committed_attack_test.go` uses genuine cheap permissive-leaf proofs to isolate state/counter/context/terminal continuity, terminal identity padding, and final genesis/start/completion guards. These are compiled recursive **solver** checks, not actual-combat or generated recursive proof evidence. `combat_multichunk_negative_test.go` tests a forged result with consistent recomputed commitment against actual battle execution.

Public output binds the **full result commitment**, not a separate public outcome scalar. The fixture pins four slots, config and RNG schedule; changing the roster/schedule requires new development setups. This establishes multi-chunk recursion for one complete bounded battle, not arbitrary fleets or a universal production key.

### Measured completion

Multi-chunk **PASS**: 30 real transitions, two15-step chunks, genuine RangePair and RangeFinal proofs; 35m12s; 196-byte compressed final proof/seven public scalars. Constraints: chunks1,333,086 each, pair3,426,219, final1,748,260 (all under4M). GOMAXPROCS2/soft GOMEMLIMIT6GiB unchanged; measured max RSS **8,332,034,048 bytes (~7.76GiB)**, so this is not a6GiB hard-RSS claim. Source manifest recheck PASS.

Run isolated attacks with `sh aggregation/run-attacks.sh` (two threads/soft4GiB/3m timeout): PASS27.984s. Portable non-ignored receipt copies: `combat-multichunk-evidence.txt`, `combat-multichunk-attacks-evidence.txt`, `combat-multichunk-short-evidence.txt`. Independent reviews: `REVIEW.md`. Actual final-proof local-EVM verification/gas remains unmeasured; see `EVM-NEXT.md`.
