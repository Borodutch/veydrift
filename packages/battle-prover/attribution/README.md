# Bounded candidate-2 casualty attribution prerequisite

**Offline solver-tested constraints only. Not chain-qualified, not a battle proof,
not recursive proof aggregation, not an EVM verifier, and not settlement.**
No proving setup, proof generation, deploy, or live state access occurs here.
Uses the existing pinned gnark v0.16.3 / gnark-crypto v0.21.0 dependencies and
shared protocol.Uint256/MulDiv arithmetic (four LE uint64 limbs).

## Implemented relation

One nonempty canonical cohort at a time. Its members have owner160, source256,
positive uint32 quantity. Cohort total, loss, all accumulators and cursors are
uint256. Effective attack/shield/hull values are committed uint256 values, with
positive hull; their preparation/qualification is NOT reproved here.

The oracle's result() rule is implemented exactly: q=floor(L*quantity/T),
r=L*quantity-q*T; allocate one extra to the first L-sum(q) members by decreasing
remainder, then increasing numeric owner, then numeric source. q and per-member
loss/survivors fit uint32. The 288-bit numerator is never truncated to uint256 or
encoded as a BN254 scalar. MulDiv constrains exact integer equality and r<T.
Per-member conservation and the terminal loss sum are constrained, not trusted.
Source 0 is legal. Duplicate owner/source members and source ownership conflicts
within this cohort are rejected. Cross-cohort/source/type consistency belongs to
the upstream boundary below.

There are FOUR fixed-size circuit shapes, independent of roster length:

1. Collect: one member per step; strictly increasing (owner,source); hash complete
   indexed roster; sum all quantities; require final root and total equal context.
2. Units: one authenticated dead/alive bit per anonymous unit index; hash complete
   ordered unit stream and count dead bits; require final root and loss equal context.
3. Floors: rescan the same entire roster, one exact quotient/remainder per step;
   accumulate floors. The floor sum is not arbitrary witness advice.
4. Rank: for each output member, scan the entire roster again, one pair per step;
   compute exact number of members outranking it. The target leaf stays bound
   throughout its scan. Each inner scan must match the input roster commitment;
   the complete outer scan must also match that same commitment. Commit exactly
   one output per member and require terminal total allocated loss equals L.

The quadratic pairwise rank avoids an unauthenticated sort/permutation witness.
It is a correctness prerequisite, NOT an efficient production attribution scheme.
For M members and T units, work is exactly 2M+T+M² elementary steps. No roster-sized
array is in a circuit. No global step counter introduces an artificial total-step
ceiling; phase and lexicographic (outer,index) cursors are monotone. The host witness
builder stores all members and unit bits and uses Go slice indices; it does not
pretend to construct physically impossible uint256-sized host arrays. Full-width
arithmetic is tested separately from small complete traces.

## Explicit commitment boundary

The public ContextRoot commits to Snapshot256, Cohort256, side, type, three
cohort stats, member count, total, loss, roster root, and unit-stream root.
Snapshot256 is **opaque input**, intended to bind chain/game/battle/body/incarnation,
rules, frozen qualified sources/research/catalog, seed protocol, and verifier version.
The allocation circuit does not establish any of those facts.

A consumer MUST pin/authenticate ContextRoot externally, not accept a prover-created
context. In particular it must establish:

- the complete positive-member projection from the qualified immutable manifest;
- rejection of duplicate zero rows and invalid/conflicting source/type/owner/tech
  records before zero quantities are removed (as oracle.initialize does);
- canonical cohort classification and complete cohort coverage across the battle;
- that each indexed unit dead bit is exactly the final hull==0 result of the
  authenticated combat trace for that cohort; no omitted/repeated units;
- the agreed chain/rules/body/source namespace and terminal combat result identity.

This package proves complete coverage relative to its committed lists. It cannot
prove that an externally supplied list includes every real fleet/hold/resident.
It does NOT accept an unconstrained loss scalar in place of scanning unit bits:
claimed total and loss must reconcile to their complete streams. But an attacker
allowed to replace those stream commitments and context can of course invent an
entire different battle input. That is the explicit input-authentication boundary.

**No adapter currently connects memorybattle's per-unit survivor report commitment
to this package's unit-bit stream.** That report is not a per-member allocation
output. A verified projection/bridge and battle-wide cohort-coverage relation are
still required; supplying locally copied report values is not such a proof.

## Hash encoding and result

All hashes use standard BN254 MiMC field hashing, domain then arity then field
values. Domains 440601..440607 cover member, roster, units, context, state, output,
result respectively. Uint256 fields always serialize as four LE uint64 limbs;
owner uses the same encoding with high 96 bits constrained zero. See values()
methods for exact order. Hash roots are BN254 scalars, not arbitrary bytes32.

A member leaf is H(member, owner limbs, source limbs, quantity).
Every stream starts at scalar zero. Append is H(streamDomain, previousRoot,
index limbs, leaf). Unit leaf is the boolean dead bit. An output row is
H(output, memberLeaf, lost, survivors), and its append uses the output domain.
The terminal result is H(result, ContextRoot, OutputRoot). Side/type/cohort and
snapshot are thus bound through ContextRoot, while each member identity and
original quantity are bound through its leaf. Outputs are canonical owner/source
order within this cohort, not remainder rank order.

The five public scalars of each step are ContextRoot, BeforeRoot, AfterRoot,
Finished, Result. Nonterminal Result is zero. AssertLinked authenticates context
and state adjacency and forbids appending after a terminal step. AssertComplete
requires the zero initial state and terminal final statement. These helpers MUST
be applied only to VERIFIED statements under the four pinned elementary keys,
with every adjacency checked. They do not verify proofs themselves. Tests exercise
these relations directly; no recursive wrapper has been built for attribution.

Prepare canonicalizes reordered input rows, giving the same context and output.
Changing an owner/source/quantity changes its commitment; source IDs never affect
combat here, only indivisible remainder ties. Strictly sorted canonical scans reject
reordering/duplicates against a pinned list. All-zero/empty cohorts are absent in
the oracle's cohort projection and intentionally are not accepted here.

## Evidence and remaining settlement semantics

From packages/battle-prover:

~~~sh
GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./attribution -count=1 -v
bun attribution/oracle-fixture.ts > attribution/oracle-candidate2.json
~~~

solver-evidence.txt records compiler constraints and solver tests. Tests cover all
loss totals 0..5, numeric owner/source ties, source256/owner160 maxima, reordered
input canonicalization, source/quantity mutations, duplicate/omitted/reordered
members and steps, quotient/remainder attacks, r==T, width/overflow bounds,
288-bit products with uint256 losses, unit-bit/root attacks, claimed totals/losses,
rank/target changes, forged output/result, partial coverage, and chunk boundaries.
The small JSON fixtures are generated directly from candidate-2 oracle.result();
their terminal unit states are deliberately manufactured to test allocation ONLY,
not evidence of combat execution. The Go sort-based oracle is independent of the
pairwise rank witness machine. Large aggregate native tests are not full huge traces.

No loot/debris/repair/reserve/cargo/return timing/slot cleanup/hold transitions,
resident casualty-delta application, exactly-once state writes, source eligibility,
research chronology, cross-cohort full battle settlement or onchain transaction
bounds are implemented. These are gross losses/survivors, before repairs. No claim
of owner-split-invariant indivisible tie results or production readiness is made.
