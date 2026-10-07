# Cryptographic feasibility findings (2026-10-05)

## Version and advisory evidence

Pinned **gnark v0.16.3 / gnark-crypto v0.21.0** in go.mod/go.sum;
minimum Go 1.25.7, local toolchain Go 1.27.0 darwin/arm64.
gnark tag source: cfc7b2f907cc4212ec152077e022c6d0b4805759.
Go module checksum: h1:S7BtIQSX2WLHV2857HrLmrQ5xIl0ZRL8kT6rcLn8gow=.

Initial v0.14 investigation was superseded, not accepted as soundness evidence.
The live upstream advisory list was inspected on 2026-10-05:

- [GHSA-3mvx-pp85-pm65](https://github.com/Consensys-Incorporated/gnark/security/advisories/GHSA-3mvx-pp85-pm65):
  versions below v0.16.2 affected, patched >=v0.16.2. Includes unconstrained carries
  in emulated arithmetic, broken pairing/GLV relations, unconstrained hash lookup
  outputs, and zero-point Miller loop issues. These reach recursive verifiers.
- [GHSA-fwf3-jmp7-gmrj](https://github.com/Consensys-Incorporated/gnark/security/advisories/GHSA-fwf3-jmp7-gmrj):
  <=v0.15.0 affected, patched >v0.15.0; discarded G2 on-twist check result.

The initial old-version expensive test was explicitly stopped. Its archived
aborted log is historical failure evidence only; it is not a successful proof
receipt. The final probe uses patched versions and explicit complete arithmetic
and subgroup checks. This advisory check is not an independent audit or a
permanent guarantee that no new vulnerability exists.

## Solidity and recursion transcript distinction

Final Groth16 proving and native verification use
`solidity.WithProverTargetSolidityVerifier(backend.GROTH16)` and
`solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)`. gnark's default
Groth16 commitment hash-to-field differs from exported Solidity's default Keccak;
merely exporting a verifier after default native verification is insufficient.
The probe exports verifier source in memory only. No EVM verification or gas
measurement is claimed.

A proof intended as an inner recursive proof instead needs
`std/recursion/groth16.GetNativeProverOptions(outer, field)` and matching native
verifier options when commitment extensions are present. The elementary probe
has no commitments; the aggregate circuit does. One must not take this final
Solidity-target aggregate proof and assume it is a drop-in recursive inner proof.
A genuine further level needs the correct inner transcript and a distinct
Solidity-compatible final wrapper/proof.

## Concrete variable-aggregation route (investigated, not implemented)

Source inspected at v0.16.3:

- `std/recursion/plonk/verifier.go:233–270` defines BaseVerifyingKey and
  CircuitVerifyingKey. The base holds KZG, public-variable count, coset shift;
  the per-circuit part holds domain size/inverse/generator, permutation and
  selector commitments, commitment-constraint indices.
- `AssertDifferentProofs` (line976) and `SwitchVerificationKey` (line1111)
  support selecting circuit keys and batched KZG verification. These are useful
  building blocks, not a complete variable-length authenticated battle VM.
- `backend/plonk/bn254/setup.go:95–127` requires canonical SRS length >=domain+3
  and an exactly domain-sized Lagrange SRS. Domain-specific circuit keys can be
  deterministically derived from one adequately sized, reviewed universal SRS;
  another per-circuit toxic-waste ceremony is not intrinsically required.
- Upstream `std/recursion/plonk/verifier_test.go` uses `test/unsafekzg`, not a
  production ceremony. `TestBLS12InBW6MultiHashed` hashes inner public witnesses,
  **not approved circuit keys**; its CircuitKeys remain witnesses. Copying that
  example without key authentication would let a prover choose another circuit.
  These examples mostly call `test.IsSolved`, which is not a generated outer proof.

A practical next experiment is a small *levelled* PLONK binary tree using a
shared test-only SRS, two-input fixed aggregators, explicit allowed previous-level
key/domain, public identity and contiguous state/counter statements, and a final
BN254 Groth16 wrapper. First demonstrate 1/2/3/4 chunks with odd-leaf identity
proofs constrained to real terminal state, then depth beyond two. For protocol
coverage, derive tree height from numeric/address/step limits, not a tiny fleet
cap. An attacker cannot truncate RF: a nonterminal execution remains nonterminal
no matter how many empty leaves it tries to append.

This route avoids a per-circuit Groth16 ceremony at every intermediate level,
but it still requires compiling/proving each approved level, a correctly sized
universal SRS, wrapper setup, canonical key-domain authentication, integer bounds,
termination/padding, and target-host measurements. Published powers-of-tau data
cannot be assumed compatible without validating curve, powers, degree,
contributions, transcript and conversion. No SRS was obtained or blessed here.

Alternatively, a homogeneous PLONK recursive circuit can carry an approved-key
root as public input, require both children carry that same root, verify key
membership, and let the final wrapper pin the root after compilation/setup.
This avoids embedding a circuit's own unknown verification key in its source.
The real base case and finite counters must prevent arbitrary cyclic proof
claims. Hashing keys must cover **all** verification parameters including domain,
KZG/SRS identity and commitment metadata, with canonical encodings. This is a
research/design avenue, not proven sound here. Passing arbitrary keys through a
witness is not the solution.

## Engineering status, not an impossibility claim

The implemented Pair proves two constrained increments, not any part of combat.
It establishes a real same-curve recursive proving plumbing measurement only.
There is **no observed external environment blocker** to continuing the above
experiments; missing full combat/variable recursion is unfinished engineering,
not proof gnark cannot do it and not by itself a human-only product decision.
Production activation is nevertheless prohibited until the complete battle,
variable recursion and independent soundness/setup evidence actually exist.
