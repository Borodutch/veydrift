# Battle prover prerequisites — NOT a battle prover

Development-only feasibility work for agentboard #44. No production path imports
this module. No service, verifier address, migration, resolver switch, or trusted
setup artifacts are produced. Do not activate proof-settled battles from this code.

## What the recursion probe establishes

`recursion/Step` constrains one uint32 counter increment and one uint32 state
increment; `recursion/Pair` recursively verifies two genuine BN254 Groth16 proofs
with a compile-time fixed, approved leaf verification key. It binds seven public
scalars (probe job/seed/rules labels, start/before/end/after), both transitions and
continuity. Complete arithmetic and subgroup checks are explicitly enabled. A
single genuine BN254 Groth16 proof authenticates this pair. This uses gnark's
non-native BN254 pairing verifier, not homegrown cryptography.

**These are arithmetic probes, not combat chunks.** The labels are only uint32
values, not real chain/game/input/seed commitments. They do not model cryptographic
randomness. There is no authenticated unit memory, initial roster derivation,
PRNG, shot, explosion, RF, combat terminal predicate, output attribution or
settlement proof. Rejecting a wrong pair end is not proof of battle termination.
The oracle elsewhere in this package does not change what this circuit proves.

## Measured evidence

The [completed benchmark](evidence/README.md) passed a genuine two-chunk recursive
proof and 12 adversarial cases: 2,513,157 constraints, 16.819 s proving after
342.628 s development setup, ~5.86 GiB maximum RSS locally. This does not satisfy
the required full-battle or variable-depth release gate.

## Reproduction

Pinned gnark v0.16.3 / gnark-crypto v0.21.0, requiring Go >=1.25.7.
See [version/advisory and recursion research](RECURSION_FEASIBILITY.md).
From this directory, with Go 1.27.0 (the locally tested toolchain):

```sh
go mod verify
GOMAXPROCS=2 go test -short -p 1 ./...
GOMAXPROCS=4 GOMEMLIMIT=4GiB RUN_RECURSION_PROBE=1 \
  /usr/bin/time -l go test ./recursion -run TestRecursivePair -count=1 -v -timeout=20m
```

The second command runs cheap positive/negative step constraints and a genuine
leaf proof with serialization and altered-statement rejection. The last
command is intentionally opt-in and generates actual inner and outer proofs;
it is not just a circuit solver smoke test. Groth16 Setup occurs in memory in the
test and is **development setup only**. No proving/verification keys, entropy or
toxic waste are persisted. `GOMEMLIMIT` is a Go GC target, not an OS hard RSS cap;
compile rejects above four million constraints before expensive setup. Do not run
multiple instances, or infer production host limits from this local probe.

## Variable-size recursion: still an engineering prerequisite

The fixed pair key verifies leaf proofs only. Feeding the pair output back as a
leaf proof fails key authentication; increasing an array length recompiles the
circuit and is NOT reusable variable-depth recursion. This is a two-chunk
feasibility measurement, never a two-chunk fleet cap or accepted end-to-end design.

Two design routes remain to evaluate and prove (neither is implemented here):

1. A bounded-height recursive tree spanning protocol counter/address limits,
   with level-specific fixed keys, rigorous identity/padding semantics, and one
   final BN254 wrapper. This can support variable battles without a small fleet
   cap, but needs multiple large circuits/setups and a fixed final key even for
   short battles. Each level must verify previous-level proofs, not merely leaf
   proofs. Treat setup count, proof cost, terminal padding and final key
   provenance as real costs; no claim this is ready or economical.
2. A homogeneous recursive statement with a propagated commitment to the
   approved leaf/aggregation keys, pinned by the final wrapper. This requires a
   reviewed key encoding/membership circuit and a genuine recursive base case;
   merely accepting witness-supplied keys is unsound. gnark commitment counts,
   public witness shape, hash-to-field options and curve arithmetic must match
   across recursive levels. No self-referential fixed-key shortcut is assumed.

BLS12-377 into BW6-761 supports native recursive verification, but a final BW6
proof is not itself a Base BN254 verifier. Wrapping it in BN254 requires costly
non-native verification and actual measurements. The direct BN254-in-BN254 probe
avoids claiming native curve-cycle performance or assuming a free wrapper.

## Remaining release evidence

The paired increment proof is not the ticket's required small complete battle
proof. Full combat and initialization/result circuits, recursive variable-length
composition, independent circuit audit, production ceremony/provenance,
permissionless proxy integration, EVM verification and full gas/fees, target-host
performance, durable proving service and dedicated live QA remain required.
Library audits do not audit our circuit. Exporting Solidity text does not prove
EVM correctness or gas. Development Setup must never be relabelled a production
ceremony. This checkpoint does not establish an impossibility result or authorize
scope reduction.
