# Authenticated variable-roster foundation — NOT production-ready

This package is an elementary-circuit/controller prerequisite for ticket #44.
It does not modify production combat, provide a prover service, or implement a
settlement verifier. It uses the pinned gnark 0.16.3 / gnark-crypto 0.21.0 MiMC
and standard Merkle and SHA-256 gadgets. No new cryptographic primitive or
dependency is introduced.

## Implemented statement

For an externally authenticated prepared roster root, RF-table root, roster
length, frozen snapshot digest and seed, a contiguous sequence beginning at
step zero proves:

- Boot is the unique all-zero controller, standard empty memory root and empty
  report. Empty rosters are supported.
- Each initialization step opens precisely the next immutable roster slot,
  opens its predecessor, enforces candidate-2 lexicographic order
  (side,type,effective attack,shield,hull), and enforces contiguous cohort IDs
  starting at zero. Equal tuples share a cohort. It opens an empty mutable slot
  and initializes exact max hull/shield and pool membership. No skipped slot or
  prover-selected hull enters via an arbitrary initial-state hash.
- Each subsequent operation opens the latest memory root. A write authenticates
  the old and new cell with the same siblings/index, preserves all immutable
  fields, and binds the resulting root into the next controller commitment.
  There is no full-roster witness or roster-specific circuit/key.
- Counts/pools are built incrementally. Round-start pool membership remains
  unchanged while shooting: destroyed units still fire their scheduled shots,
  and destroyed targets remain selectable that round, matching the oracle.
  Ordered scans find the next shooter and the uniformly sampled target rank.
- Each hit updates only its exact target hull/shield. Full-shield 1% bounce,
  shield absorption, overkill, strictly-more-than-30%-missing explosion, and
  positive-power shield-only explosion eligibility match candidate-2. Shields
  reset only when another round actually starts.
- SHA-256(domain || seed32 || counter32-BE), all 256 digest bits, exact rejection
  sampling, target-dependent authenticated RF, and all four uint64 RNG-counter
  limbs are constrained. Rejection is another elementary step; RF has **no
  chain-length truncation**. Factor-one RF consumes no random word.
- Full end-of-round scans rebuild live pools/counts and commit the ordered
  per-unit cohort/survivor stream plus round shot totals into a report hash.
  Terminal requires an empty side or six completed rounds. The result commitment
  binds context, final memory, report, round, live side totals and derived winner;
  nonterminal steps expose zero result. Post-terminal steps are refused.

Eleven operation kinds have fixed circuit shapes, independent of fleet size,
roster contents and seed. Each witness has at most three 64-level memory
openings. The eight public scalars are context, before/after controller
commitments, start/end step numbers, before/after terminal flags, and result.
The same compiled systems solve both six-unit and ten-unit full battles.

AssertLinked / AssertComplete provide constrained adjacency/endpoint rules.
They MUST consume **verified** statements under authenticated operation keys.
They are not themselves proof verification. Tests solve every elementary
transition and check every adjacency; no memorybattle proof or recursive
aggregate has yet been generated. Existing aggregation/battle proofs are for a
different circuit and are not evidence for this package.

## Explicit domain; NOT protocol-complete

The deployed protocol has uint256 cohort counts/stats/source IDs, uint32 counts
per source, uint16 technology and 160-bit owners. **This prerequisite does not
support that full numeric/input domain.**

- Sparse memory has a fixed 64-bit address space; roster length, cohort IDs and
  effective stats are uint64. Valid unit indices are below N (N <= 2^64-1).
  This is an explicit address/numeric limitation, not a small fleet fixture cap.
  Wider protocol values require a limb-based extension, not silent narrowing or
  a per-roster key. The host builder takes uint64 values; a future protocol bridge
  must range-check before conversion. No such bridge currently exists.
- Type IDs and RF factors match uint16 (RF 1..65535). Hull maxima must be positive.
  Damage intermediate comparisons use an 80-bit bound, covering all uint64
  inputs including attack*100 and hull*10 without field wrapping.
- RNG counter is 256 bits. An increment that would overflow is refused without
  emitting a result. Step/shot transport counters are uint64 and likewise cannot
  wrap into an accepted transition. These are incomplete-computation refusals,
  not an alternate victory/draw rule or RF cap.
- The snapshot digest is four 64-bit limbs, not an owner/source parser. Owner
  addresses and uint256 source identities must remain in the externally
  authenticated snapshot/preparation proof; this package does not truncate them
  into cohort IDs or pretend to prove their association.

## Remaining engineering

Preparation must still prove complete on-chain enrollment, catalog and frozen
research, exact effective-stat multiplication/division in the full protocol
numeric domain, owner/source membership, expanded roster/count correspondence,
RF-table qualification and the snapshot/seed lifecycle. The current initializer
proves execution **from** the prepared authenticated data, not correctness of
those upstream inputs. Canonical tuple ordering is proved here, but source group
canonicalization and attribution are not.

The report/result is a combat-memory commitment, **not** a settlement output.
Per-cohort reduction, largest-remainder per-source allocation, full member
coverage, loot/debris/repair/moon/returns and exactly-once application still need
bounded authenticated derivation. The recursive accumulator must authenticate
all eleven keys, every adjacency, initial anchor and final result; reviewed
setup, actual generated proofs, independent review and adversarial scaling are
still required. No production security or activation claim follows from solver
success.

The ordinary sparse witness builder retains O(64*N) nodes. Target/shooter lookup
currently scans O(N) slots; this is deliberately simple and exact, but expensive.
An authenticated rank/select pool tree is the scaling replacement, not a
semantic change. More units require more transitions, not a larger circuit.

## Verification / resource discipline

Run from packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./memorybattle -count=1 -v -timeout=300s

GOMEMLIMIT is a Go soft limit, not a hard OS memory isolation guarantee. This
worker runs compile/solver tests only; no Setup, proving or recursion benchmark
competes with the separate aggregation worker. See solver-evidence.txt for the
collected full run. Tests cover live TypeScript oracle comparison, every phase,
recomputed malicious commitments, stale valid openings/writes, wrong index/path,
initialization and ordering, premature terminal/result forgery, changed seed and
snapshot, link skipping/replay, uint64 damage extremes, 64-bit high addresses,
full-digest rejection and 256-bit RNG carry/refusal.
