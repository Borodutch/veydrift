# Combat shot conservation — ticket #10

## Baseline and independent failure

At Base block 52124564 (2026-10-03), runtime bytecode, after normalizing compiler
immutable/link slots, matched release 135269499d79622069d8f3e78850d9f58ae425db:

| Graph node | Live address |
| --- | --- |
| Game proxy | 0xf397910F005151b09644228573a4353818D3755d |
| Game implementation | 0x1f601bDb2dC1657C61ba62DcA5Fcb6423185B078 |
| Gameplay | 0x63c8d02A2E963a58D8cb4550350d125318A76298 |
| Combat router | 0x2C5cEEE853b48bd5bdFbBdDb5777380AeEC2b0Ca |
| Staged combat | 0xbffb7e59e8466e59d77a01012d6c5b886c646327 |
| Staged cohort library | 0x8a7b9266f746e21dd4cc424c3da79e0ea3a8c15e |
| Pre-staged legacy continuation | 0x1684c04a0e07677819f3843c468663f9ac29644a |

The compiler-linked staged library contains the inlined cohort arithmetic.
Game → Gameplay → router links are immutable: updating an unreferenced helper is
not a release. The upgrade must deploy and link the changed closure and switch the
Game proxy. No Moon upgrade is implied by this arithmetic-only change.

The defect is not merely noisy odds: applying ceil(shots/targets) to *every*
target invents energy. The new physical-shot oracle assigns 100 shots individually
to 99 units with 100 shield, 100 hull and 100 attack per shot. Exactly one unit must
die; baseline kills all 99. Three baseline tests fail, including a count above
uint32 and exhaustive small counts. The oracle does not use production allocation
arithmetic to calculate its expected counts.

## Corrected model

Within each target cohort, shots are balanced over min(shots, count) exposed units.
Only the remainder subset receives the extra hit. Low/high groups each resolve
shield absorption, hull threshold and explosion sampling independently. This
retains the pre-existing round-local damage and capped sum across firing cohorts;
it is not a redesign into persistent per-unit hull damage or exact independent
Bernoulli shots.

Across targets, independent rounded shares can also invent/drop shots. The
corrected model uses a shared random-offset cumulative partition. For cumulative
unit count x, define F(x) as floor(shots*x/total) plus one iff the shared draw modulo
total is below the remainder. A cohort receives F(prefix+count)-F(prefix).
F is monotone, F(0)=0 and F(total)=shots, so intervals conserve the total exactly.
Canonical cohort-key order preserves equal-stat ownership partition invariance;
rapidfire target pools use ascending unit order. Rapidfire generation remains the
same bounded continuation sampling and 64-chain cap; each incoming chain is now
conservatively apportioned before continuation probability is applied.

The random ABI domain stays v1. Target allocation shares one targetKey=0 draw per
firing cohort/lane; ordinary shots and rapidfire extras remain separately assigned
on lane0. Rapidfire targeting uses lane1+chain and continuation lane30000+chain.
Low-hit explosion sampling uses lane65536+shots, high-hit sampling lane131072+shots.
The battle cap remains six rounds. These are deterministic aggregate approximations,
not a claim of exact OGame per-unit stochastic odds.

## Compatibility and release requirements

Started staged battles must finish with their saved historical model, including
partial rapidfire/target cursors and subsequent rounds. New battles select corrected
model2 once, before preparation. Pre-staged saved-round battles remain on the exact
legacy continuation. Already final outcomes are never replayed. The nested staged
math State cannot grow in place: it precedes dynamic Battle members. New persistent
math metadata needs separate namespaced storage; Battle-only append must preserve
all previous offsets.

Served forecasts must positively verify live model2 and suppress unavailable,
started or unsupported models rather than presenting corrected results as legacy
continuation. Deploy compatible backend/report consumers before Game, frontend
after verified upgrade; preserve environment, database and worker journals. Actual
required services depend on the final diff. Dedicated QA, not this implementation
worker, owns rendered live proof.

## Validation gates

- Physical-shot small-unit oracle, threshold/probability tests and shot conservation.
- Independent Solidity reference and exact TypeScript vectors, seeded Reaper matrix.
- Same-seed owner/mission partition invariance, simultaneous fire, attribution,
  staged chunk parity and exactly-once settlement suites.
- Full roster through the actual Game proxy with committed/cold transaction probes;
  unchanged 15M cap for every resolver transaction. Aggregate Forge driver budget
  is not a production transaction allowance and establishes no arbitrary-owner cap.
- Inherited and namespaced storage compatibility, semantic upgrade continuation,
  runtime/initcode limits, full affected tests, exact-head independent review and CI.

Integrated evidence: physical-shot regression3/3; staged math7/7 including full independent roster; historical cutover4/4 with recursive88-field/26-type layout guard; full actual proxy114 calls with13,748,535 peak gas under15M; shared Solidity/TS seeded digests30/30 (7,680 exact outcomes). See the [independent reproduction report](../packages/contracts/test/reports/COMBAT10-INDEPENDENT-REPRO.md). The full canonical contract runner passes916 tests with0 failures and2 skips; deployment-dependent fork checks remain separate release gates. Chronology tests explicitly preserve atomic lazy-action rollback and require bounded permissionless continuation with durable progress; they do not treat Progress as completion. Final UI lifecycle review and CI remain separately tracked.

This document records the model and gates, not a claim that release/QA is complete.
