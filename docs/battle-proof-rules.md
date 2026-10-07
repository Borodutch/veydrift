# Individual-shot reference candidate (ticket #44)

**Status: offline reference only; not activated, not a battle circuit, not a verifier,
not a release-ready settlement implementation.** Production remains model 2. This
candidate exists to make subsequent circuit parity testable without calling a
production combat helper. Its rules identifier is
`veydrift-individual-shot-candidate-2` (backticks in this document denote identifiers).
No proof or deployment result is implied by passing these ordinary tests.

## Inputs and canonical identity

The oracle consumes an already qualified, immutable roster, a bytes32 seed, pinned
catalog stats/RF lanes, and each owner's frozen Weapons/Shielding/Armor levels.
It does **not** perform impact chronology, hold qualification, planet/moon selection,
research history, queue cutoff, or snapshot-before-reveal enforcement. Those are
required upstream protocol/circuit work. A valid local Input is not an onchain input
commitment: chain/game/battle/body/incarnation/rules/verifier/settlement data still
must be authenticated by the future pipeline. The seed is separate from that commitment.

Each member has side (0 attacker, 1 defender), lowercase 20-byte owner, canonical
unsigned decimal source ID, type, uint32 quantity, and uint16 W/S/A. Source IDs fit
uint256. Within one battle, one source cannot change side, owner or tech; one owner
cannot have conflicting frozen tech. Repeated source/type rows are rejected, even
when quantity is zero. Source 0 conventionally represents the resident manifest;
mission/source namespace disambiguation belongs to the future authenticated input.

Base stats and scaled numerators must fit uint256. Stats are exact integers:

- attack = floor(baseAttack * (10 + W) / 10)
- maxShield = floor(baseShield * (10 + S) / 10)
- maxHull = floor(baseHull * (10 + A) / 10), strictly positive

The frozen catalog is copied from source revision
4a017cc9772c1bd6bcba6bdad7b12221e71c63e9, with SHA-256
86290965991ad030826bb0ae7d65f767940d1cbf7c37f0f76fcaaf11309e8ae1.
Types 0–15 are ships; 16–23 are battlefield defenses (including shield domes).
Missiles are not combat targets. The general oracle permits synthetic catalog types
for unit tests; that does not authorize new production types or arbitrary input stats.
The arithmetic implementation imports no Solidity/frontend combat helper.

Canonical cohorts sort by (side, type, effective attack, effective maxShield,
effective maxHull), numerically. Matching rows merge before expanding one record
per individual unit. Owner, mission ID, original roster order, and same-effective-stat
partitions never determine firing/target order or randomness. Each cohort has stable
anonymous unit indices; each individual retains its **own** hull and shield. Cohorts
are a canonicalization device, not shared HP, averaged tech, or pooled damage.

## Rounds, hits, explosions, rapidfire

1. At the beginning of each round, all surviving units on both sides form immutable
   ordered firing and target pools. Reset surviving shields to maxShield; never reset
   hull. Run at most six rounds. If either side is empty, stop without an extra round.
2. Resolve all attacker firing chains in canonical unit order, then all defender
   chains. This is deterministic serialization of simultaneous round eligibility:
   a defender killed this round still fires its scheduled ordinary/RF shots.
3. **Destroyed units remain targetable until round end.** A shot into an already dead
   unit is wasted, with no new damage/explosion draw, but its type still controls RF.
   Every ordinary and RF shot independently selects uniformly from the opposing
   round-start pool, with replacement. No balanced allocation or live-only retargeting.
4. If currentShield > 0 and attack * 100 < maxShield, the entire hit bounces. This
   threshold uses **full** shield, not remaining shield; exact equality does not bounce.
   Otherwise shieldAbsorption = min(attack, currentShield); subtract that exact integer
   amount; hullDamage = attack - shieldAbsorption. Subtract hullDamage from hull,
   saturating at zero. No percentage health buckets or quantized shield subtraction.
5. If hull reaches zero, destruction is certain and consumes no explosion draw.
   Otherwise, every non-bouncing positive-power hit checks accumulated hull damage,
   **including a hit absorbed entirely by shields**. Once missingHull * 10 > maxHull * 3,
   sample uniform(maxHull); explode iff sample < missingHull. The chance is the exact
   rational missingHull/maxHull, not a rounded percentage. Exactly 30% damage does
   not check. Each later qualifying hit checks independently. Bounces, zero-power
   hits and hits into dead units consume no explosion draw.
6. RF uses the type of the unit actually selected, including a wreck. Missing RF lane
   means factor 1. For factor r > 1, sample uniform(r); another shot from the same
   shooter occurs iff sample != 0, probability (r-1)/r. Factor 1 consumes no RF draw.
   New targets are independently sampled for each extra shot. There is **no 64-shot
   chain cap or silent truncation**. A killed shooter remains eligible until its chain
   and round finish.
7. After both sides finish, record exact cohort survivors and physical shot counts;
   the next round excludes dead units. After six rounds, surviving sides draw. Both
   sides empty also draw. A sole surviving side wins.

### Classical evidence and candidate differences

The official archived OGame guide [How a fight works](https://board.en.ogame.gameforge.com/index.php?thread/151317-how-a-fight-works/),
Cassandra Vandales, 17 September 2006, explicitly says a damaged unit can explode
when it absorbs a shot with **shield or hull**, with a full-shield/40%-hull-damage
example and an ineffectualness exception. Candidate 1's hull-damage-only guard was
incorrect for this classical behavior; candidate 2 fixes it. A target with maxHull
100, hull 40 and shield 100 hit with power 20 now loses 20 shield and checks a 60%
explosion chance, despite taking no new hull damage.

This is still **not byte-for-byte parity with every historical OGame server**. The
2006 post says "1% or less" is ineffectual; we retain a **strict below-1%** full-shield
bounce (equality damages). The 29 September 2008 reply in that same thread describes
integer-percentage shield subtraction; we retain exact, non-quantized absorption.
Skipping zero-power explosion checks is an explicit **older-guide interpretation /
candidate choice**, not an assertion that the archive proves all zero-power cases
(in particular when no shield remains), or a claim about current server behavior.
Round-start wreck targeting and deterministic side serialization also remain explicit
rules for independent review. Exact ordinary integer damage and Veydrift catalog values
are retained. Any rule change requires a new candidate identifier, expected traces and
replays before activation; this is not a quiet migration of production model 2.
Candidate 2 also changes the random-stream domain, so old checkpoints are rejected and
historical result differences cannot be attributed solely to the corrected hit guard.

## Random stream and resumption

The reference uses standard SHA-256, not custom cryptography:

word = SHA256(UTF8("veydrift-individual-shot-candidate-2:random:") || seed32 || counter32BE)

Counter starts at zero and increments for **every word**, including rejected words.
For positive bound n < 2^256, limit = 2^256 - (2^256 mod n). Reject word >= limit,
otherwise return word mod n. This avoids modulo bias assuming uniform hash output.
A bound of one still consumes one word. Per shot draw order is target, optional
explosion, optional RF. Neither owner identity nor source ID is added to the stream.
The stream consumes the supplied seed unchanged; this implementation does not prove
that seed was unbiased, unknown before enrollment, or unrevealable during flight.

advance(state, shotBudget) resumes at physical-shot boundaries, including inside RF
chains. Budget exhaustion leaves a visibly incomplete state; result(state) refuses it.
Zero work and terminal calls do nothing. Round transitions scan local arrays; one
physical shot can require multiple rejected hash words. This is **not** a bounded
circuit-step implementation. A future circuit must make RNG rejection and round
initialization individually resumable elementary operations. Counter exhaustion
throws; it never reseeds or accepts a partial result.

checkpoint/restore are trusted local JSON transport for deterministic ordinary
reference tests. They are not authenticated checkpoints or adversarial witness
validation. A forged state can forge a local result; the future circuit must constrain
initialization, each latest memory read/write, complete transitions and terminal state.
Low-level hit/result helpers assume valid locally produced state.

## Attribution and settlement boundary

At terminal state, count exact casualties per canonical cohort. Allocate those losses
back to member quantities proportionally by largest remainder: floor(L * member / total),
then one extra loss per largest remainder, ties by numeric owner address then numeric
source ID. This conserves losses, bounds each loss by its original member quantity and
is independent of input row order. Anonymous damaged units are not assigned to owners
before nonlinear combat. Side totals/round traces are partition invariant; per-owner
indivisible tie results are **not** guaranteed invariant under arbitrary owner/source
splits. Surviving units start future independent battles at full stats; the oracle does
not persist damage between separate battles.

Outputs are gross combat survivors/losses **before** ship/defense repairs. The oracle
implements no loot, debris, reserve debits, moon formation, repairs, cargo, return time,
slot indexes, stationed hold transitions or resident casualty-delta application.
Production activation requires independently authenticated, conserving exactly-once
settlement and body/source identity coverage; these tests are not that evidence.

## Bounds and verification commands

Run from the repository root:

~~~sh
bun test packages/battle-oracle
bun packages/battle-oracle/historical.ts
~~~

No dependency or workspace package/lockfile change is required. The oracle expands
individual units and defaults to a configurable 100,000-unit **host safety budget**.
Exceeding it throws before a result; this is neither a new gameplay fleet cap nor an
implementation of arbitrary-size authenticated memory. RF is not bounded by a hidden
rule. Tests/runners impose explicit work limits and fail incomplete rather than declare
victory on timeout. A future service requires real CPU/RAM/backpressure and takeover;
this reference is not such a service.

## Four historical planet-1 counterfactuals

fixtures/planet1.json (under packages/battle-oracle) was imported offline from the
planet1-audit-22492 artifacts. The importer checks staged membership **bidirectionally**
against the prior source-audited input; the complete flag alone is insufficient. Every
expected attacker and resident defender must appear exactly once with the exact source
ID, owner and side. Every nonzero source lane must appear with its exact starting count;
the archive is sparse, so absent zero lanes are allowed. Duplicate lanes and lanes outside
the source's ship/defense manifest are rejected, even if their count is zero. Pure validation
of all four battles completes before any output write. It uses onchain frozen research
captures; checks the historical seed; records source file
hashes, chain/game, impact/final block and canonical receipt. It does not query current
planet inventory or substitute present-day tech. The frozen catalog has its own hash.
Reimport (requires the original private local audit directory) with:

~~~sh
bun packages/battle-oracle/import-historical.ts /path/to/planet1-audit-22492
~~~

Each replay uses **that battle's historical starting state independently**, not survivors
from the new preceding counterfactual. These are one-seed scenarios, not odds, guarantees,
or a replacement sequence of history. Reusing historical seed bytes with the new SHA-256
stream does not reuse the old model-2 draws. No repair/loot/economy result is inferred.

| Battle | Candidate result | Rounds | Attacker start → survivors | Defender start → survivors | Physical shots |
|---|---|---:|---:|---:|---:|
| 97808 | Draw | 6 | 319 → 94 | 2373 → 305 | 10095 |
| 97839 | Attacker | 4 | 319 → 279 | 1580 → 0 | 5935 |
| 97876 | Defender | 3 | 50 → 0 | 1089 → 395 | 3095 |
| 97881 | Defender | 2 | 30 → 0 | 759 → 289 | 1902 |

Full per-round/mission output is fixtures/planet1-candidate-results.json and tested as
an exact replay golden. It is not independent proof of algorithm correctness; separate
hand-derived damage, explosion boundary, bounce, mixed-tech, simultaneous-fire,
repeated-target, RF, partition/attribution and restart tests exercise those invariants.
The two defender wins are observed only in these candidate replays, not a promised
production outcome or a balance recommendation.
