# Full-width authenticated combat controller — not production-ready

Eleven fixed gnark elementary circuits execute candidate-2 combat over sparse
MiMC/Merkle memory, independent of roster size, values and seed. This evolves
the existing controller; no second VM or new cryptographic dependency.

## Numeric and authentication guarantees

Every address, effective attack/shield/hull, cohort ID, roster/live count,
scan cursor, target rank, shot total, step position and RNG counter is uint256
encoded as four canonical little-endian uint64 limbs. No protocol integer is
reduced to a native BN254 scalar. Side/pool are Boolean and type/RF uint16.
Each sparse key is domain2 || index256 (depth258); namespaces distinguish
mutable units, immutable roster and RF. Standard MiMC leaf/node hashing and
left/right Merkle folding are retained. The standard single-native-index
VerifyProof cannot express 258-bit indices, so its fold receives limb bits
instead. See LAYOUT.md for the exact shared preparation/result encoding.

The controller integrates protocol.Arithmetic checked add/sub/select/comparison
and Sample directly. SHA256(domain || seed32 || counter32-BE) binds all 256 word
bits to protocol.Sample's full-width Euclidean rejection sampler. Rejections
consume a transition; RF has no chain cap; factor-one RF consumes no RNG word.
Damage uses standard 512-bit emulation for mathematical attack*100 and missing
hull*10 comparisons, and checked uint256 subtraction for actual shield/hull.

Initialization opens each next immutable roster cell and predecessor, enforces
lexicographic (side,type,attack,maxShield,maxHull) ordering and contiguous cohort
IDs, and initializes exact hull/shield/pool. Every read is against latest memory;
writes preserve immutable fields and authenticate old/new cells with identical
siblings. Round-start membership permits destroyed shooters/targets for the
remainder of their round. Ordered scans rebuild counts and rolling per-unit
cohort/survival reports with full-width round shot totals. Terminal is only an
empty side or six rounds, with a derived winner and bound final result.

All uint256 overflow is rejected, never a new combat termination rule. Host
writes are staged until arithmetic succeeds. NewCheckpoint validates supplied
tree roots and supports high-index sparse witnesses; it is NOT prefix proof
authentication. A complete accepted battle must link back to zero-state Boot.
The ordinary New input slice is only a convenient finite witness constructor,
not a circuit bound; sparse checkpoints do not materialize all preceding slots.

## Public statement and recursion

Eight public scalars in exact order: Input, BeforeRoot, AfterRoot, Start, End,
BeforeDone, AfterDone, Result. Input binds roster/RF roots, uint256 N, version3,
seed and snapshot. Start/End are domain-separated commitments to uint256 step
positions; zero is reserved for initial step zero. They are NOT scalar step
numbers. Every elementary relation proves checked increment internally.
AssertLinked compares Input, roots and position commitments; AssertComplete
requires zero start and terminal finish. Caller MUST verify proofs and bind
all eleven phase-specific keys before using these helpers. A solver transcript
or linkage helper is not recursive proof verification.

## Boundary still outside this package

Prepared stats/counts are full-width here, but catalog/research effective-stat
preparation, source IDs, 160-bit owners, enrollment and source membership are
NOT proved by this controller. preparation/ and resultbridge/ consume the
shared layout; their complete verified proof linkage is a separate obligation.
RF qualification and seed/snapshot lifecycle remain upstream requirements.
Per-source largest-remainder attribution, all settlement economics and
exactly-once application are not combat-memory outputs. No generated combat
proof, setup, recursive accumulator or EVM activation claim is made.

## Verification and costs

GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./memorybattle -count=1 -v -timeout=900s

Only compile/solver tests, no setups/proving. The Go memory limit is soft.
Two complete 6/10-unit traces reuse the same eleven compiled systems (one key
retained at a time to avoid retaining all R1CS in memory) and compare
the independent TypeScript oracle. Tests cover high-bit addresses/stats/counts/
steps/shots/RNG, checkpoint transitions, stale roots/openings, domain confusion,
seed/rank/report tampering, initialization, terminal and overflow refusal.
Sparse witness storage is O(258*N); ordered rank/shooter scans remain O(N).
Larger fleets need more transitions, never a larger elementary key.
