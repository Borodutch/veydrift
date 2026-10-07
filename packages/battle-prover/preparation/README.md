# Authenticated preparation controller (solver candidate)

This package transforms an immutable raw roster into canonical members/cohorts and the **exact** memorybattle roster Merkle root. It is not a hash of an arbitrary prepared server answer. Five roster-independent elementary circuits are selected by `Shape`: Boot, Pair, Member, Expand, Finish.

* Boot anchors every state field, visited memory and unit memory to fixed zero state.
* Pair scans every ordered pair of raw indices. Authenticated rows establish source/type uniqueness, source owner/side consistency, and owner frozen-tech consistency (including zero rows).
* Member visits each raw index once using authenticated zero-to-one visited writes. Exactly Rows visits at completion plus in-range indices establish complete permutation coverage. Catalog stats are authenticated at type; research at full owner address. Protocol full-width Effective checks checked numerator multiplication and integer division. Raw protocol counts remain uint32; all aggregated counts, IDs, cursors and step counters are uint256.
* Members are ordered by zero-count flag (zeros first), effective key `(side,type,attack,shield,hull)`, then owner/source. Positive equal-key rows retain a cohort ID and aggregate counts independently of owner/source. Zero rows are validated and accounted but do not produce members/cohorts/units.
* Expand writes one immutable memorybattle cell at a time from the authenticated current member/key/cohort, using protocol Expand. Full uint256 address bits and counts are never reduced into one scalar. Finish requires every raw row and every unit accounted, closes the last cohort, and binds manifests/root/count into the terminal result.

`Machine.Chunk(budget)` is a native witness builder with bounded returned work; exhaustion is incomplete, not a result. The native host uses Go slices for the finite supplied roster. Circuit shapes do not depend on roster size. The all-pairs validation intentionally costs O(R²), expansion O(U); this is a minimal correctness integration, not a production performance design. Max uint256 checked increment refuses rather than wraps.

`LinkStatements`, `AssertComplete`, `AssertCombatInput` must only consume verified proofs under authenticated elementary keys. The helpers do not verify proofs themselves. Integration uses standard gnark MiMC; sparse Merkle uses the standard leaf/node algorithm with explicit 4-limb bits because gnark MerkleProof takes a single native scalar index and cannot represent all uint256 addresses.

## Boundary

Chain/game/battle/body/targetIsMoon/incarnation/impact/rules/verifier/catalog/seed-policy identity, raw root/count, catalog root and frozen research root are committed. The externally supplied raw root/count defines the complete roster; onchain eligibility/freeze/publication of that commitment is external. Catalog root is a keyed map, so one type cannot authenticate two different values. Unreferenced catalog entries are not validated. RF catalog commitment validation, seed acquisition/finality/non-adaptivity and policy linkage are **external**; `AssertCombatInput` binds exact root/count and seed/RF values to memorybattle Input, not their provenance. No Groth16/PLONK proof, recursive composition, EVM deployment or production readiness is claimed.

## Tests

Run `GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./preparation -count=1 -v`. Solver only. Ordinary TypeScript oracle fixtures cover split/unsplit/reordering/owner relabeling/mixed tech/zero rows; compare manifests and exact independent memorybattle native root. Complete traces include empty and zero-only input and chunked execution. Adversarial fixtures cover substitution, extra/duplicate rows, visited replay, omission, effective/catalog/research mismatch, source conflicts, public context/result changes, high-bit address/counter/cohort values, overflow and combat input linkage. High-bit synthetic individual steps establish numeric/address domain, not an infeasible 2^255-unit full trace.
