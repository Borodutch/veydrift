# Complete battle-result bridge (solver-only)

This package connects the **actual preparation, memorybattle and attribution
encodings**, not an alternate roster manifest. It is a constrained witness
relation plus host witness builders, **not a recursive verifier or production
battle proof**. No proving setup, proof generation or deployment is performed.

## Data flow

1. The preparation terminal result is opened as its exact exported ResultDomain
hash: context, complete positive-member manifest, complete cohort manifest,
roster root, and full-width unit count. Member/cohort hashing calls preparation's
exported native/circuit helpers; member rows retain owner, source, quantity,
side/type, frozen tech and effective key. Source quantities are uint32 to match
attribution; aggregates, IDs and cursors use protocol.Uint256.
2. memorybattle Snapshot is the **canonical little-endian uint256 encoding of
the preparation context field hash**. Both limb ranges and a strict BN254 modulus
bound are constrained, so a +field-modulus alias cannot represent another snapshot.
Battle Input and terminal Result are recomputed exactly, including seed, RF root,
final memory root, original complete report, rounds, survivors and outcome.
3. Five fixed bridge shapes consume Begin, one Member, one Unit, Close, Finish.
IDs start at zero and all cursors advance with checked uint256 arithmetic.
Complete preparation manifests are reconstructed without an invented second
encoding. Each unit opens depth-258 MiMC memory in domain zero at the monotone
global index. Its immutable key/cohort must match the active prepared cohort;
dead is constrained to all four final-hull limbs being zero. Local unit order
reconstructs attribution's exact dead stream. Final side counts and all global
counts/manifests must match before Finish can emit a result.
4. Close recomputes attribution Context and terminal Result commitments from
those derived member/dead streams. It preserves **every cohort**, including
zero-survivor cohorts, in the battle allocation-output stream. The native builder
runs the existing attribution machine; its terminal output is not trusted by the
circuit absent the required attribution proof obligation below.
5. Two fixed report shapes reconstruct the **entire** original combat report:
one unit row per round in monotone round/index order, or a zero-round terminal
case. Every row's cohort/key comes from authenticated final memory. Shots must
be identical throughout a round; final-round alive is constrained to final hull.
Intermediate alive/shots advice is authenticated by the exact terminal report
hash. Projection commits round/index/key/cohort/shots/alive for every unit,
including dead units. No claimed record can be omitted or replaced independently.
6. AssertCombinedResult binds terminal allocation and report-projection results
to the same context, battle Input and battle Result.

No roster-size-dependent circuit shapes or fixed gameplay roster cap. Native
builders necessarily materialize finite slices and may exhaust caller resources;
that is not a successful proof or an alternate truncated result. Hash security
and externally pinned keys are assumed, as in sibling relations.

## Runnable APIs

- FromMachines(prepared, combat, canonicalGroups) checks actual package outputs,
  snapshot convention and manifests, then returns a projection Machine.
- Machine.Next constructs one bounded bridge witness and exposes AttrSteps for
  each cohort. New is a lower-level witness constructor, not authentication.
- ReportWitnesses(context, completeReportAdvice, finalMemoryOpening) constructs
  the complete bounded report witnesses. Tests extract advice from actual
  memorybattle Scan transitions; the circuit authenticates it independently.
- Shape / ReportShape are fixed elementary circuits.
- AssertLinked / AssertComplete, AssertInputs, AssertAttribution,
  AssertReportLinked / AssertReportComplete, AssertCombinedResult constrain
  **already-verified public statements only**. None verifies a proof.

## Exact remaining glue / acceptance obligations

1. Authenticate elementary circuit keys and proofs for preparation, combat,
   bridge, report and attribution. Build recursive composition that checks EVERY
   adjacency and canonical first/terminal boundaries; solve-only tests are not
   proof authentication. Every bridge Close must discharge its attribution
   obligation against a **complete verified** attribution trace. Passing a free
   scalar to AssertInputs or calling equality helpers is not sufficient.
2. Bind the preparation context/raw roster/catalog/frozen-tech roots and eligible
   source enrollment to canonical chain state and the requested impact snapshot.
   The current sibling preparation relation starts from supplied roots.
3. Authenticate RF table derivation against the selected catalog/rules and seed
   provenance/policy. RF and seed are preserved exactly in battle Input here,
   not established as the correct chain values by this bridge.
4. Pin this snapshot encoding convention and all versioned commitment domains
   in the final public proof ABI/key registry and chain acceptance path.
5. Implement/verify downstream settlement, exactly-once source/member application,
   loot/debris/refunds and production recursive/EVM verification. Per-round
   report output here is per-unit; any additional aggregated presentation format
   needs its own constrained projection or verified decoding of this commitment.
6. Independent security review and production release gates remain outside this
   package. This work changes no on-chain behavior and supplies no production claim.

## Verification

Run from packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./resultbridge -count=1 -v -timeout 300s
    GOMAXPROCS=2 GOMEMLIMIT=2GiB go vet ./resultbridge

The integration fixtures use real preparation and combat native machines, compare
exact cross-package roots/results and solve bridge plus attribution transitions.
A one-sided fixture additionally solves ALL actual preparation/combat elementary
transitions. Mixed-battle full256 combat solvers are owned by memorybattle tests;
this package does not relabel native execution alone as a combat proof.

Adversarial tests cover mixed cohorts/members, annihilation and empty sides,
omitted/duplicate/reordered manifests and links, altered source/owner/tech/count,
wrong final-memory index/cohort/hull/path, report bits/shots/coverage, substituted
context/result/dependency, 200-bit stats, 255-bit source/address and a field-alias
snapshot. Identical unit leaves are intentionally indistinguishable; their
positions/counts are still completely enumerated, so swapping identical advice
is not a forged battle result.
