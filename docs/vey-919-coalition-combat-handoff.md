# VEY-KANEO-919 — coalition combat implementation checkpoint

**Not release-ready. Do not merge, deploy or broadcast this branch.**

This is one coupled ticket for coherent ACS attack/defense semantics, not an
approval to change production or replay battle #94880.

## Implemented model

- Build round-start cohorts by unit kind/type and effective attack/shield/hull.
  Each owner's Weapons/Shielding/Armor scales that owner's units; no averaging.
- Merge equal-stat units before targeting, stochastic rounding and loss sampling.
  Resident ships and eligible allied defenders use the same side representation.
- Side RNG uses canonical stat keys, never mission/link order. Rapidfire target
  continuation pools by unit type (technology does not alter the rapidfire matrix).
- Apportion each cohort's casualties by proportional floors and largest remainder.
  Owner address then numeric mission ID breaks indivisible attribution ties; these
  identities never enter combat randomness. Side totals remain invariant when
  equal-tech fleets are partitioned, even though individuals receive integer losses.
- Counts are uint256 in combat math, preserving sums above one mission's uint32 limit.
- The frontend independently mirrors the arithmetic. Historical laneGroup fields
  remain compatibility metadata, not random lanes.
- Repeated resolver calls link each qualified stationed hold only once. Arrival,
  inclusive hold end, body isolation and recalled status guards remain intact.

## Blocking evidence

The all-mobile-type stress case with seven distinct-tech owners per side plus
resident ships/support/defenses consumed **186,390,251 gas in pure round math**
after scratch-memory RNG optimization. The unchanged test ceiling is 15,000,000,
leaving headroom below Base's transaction cap. This test intentionally fails;
do not raise the ceiling, skip it, remove types, or reduce owner diversity.
A small three-type fixture passing does not establish real roster safety.

There is no aggregate eligible participant cap in existing ACS admission. Per-owner
fleet slots do not bound a coalition. Current chunking checkpoints whole rounds;
a single too-large round can repeatedly fail without progress. Supporting all
eligible rosters requires resumable sub-round computation, including bounded
roster construction, attribution and final settlement. A gameplay roster cap is
an alternative only with an explicit product decision; never silently exclude
already-qualified fleets.

## Remaining coupled acceptance work

1. Resolve the gas architecture, then prove actual proxy progress and final
   settlement under the real transaction cap, not only standalone math.
2. Research timing: the current patch preserves stored round-time reads. Existing
   target research is settled through impact, but attacker/joiner/held-owner reads
   are not a frozen common historical snapshot. Establish an explicit consistent
   cutoff and test due-before-impact, due-after-impact, delayed resolution and
   inter-round actions. Historical completed research cannot simply be inferred
   from today's level after its queue has been deleted.
3. Wiped DefenseHold fleets still need terminal hold removal, cargo accounting,
   exactly-once slot release and event evidence; surviving holds must remain.
4. Semantic cutover must not combine legacy rounds with cohort rounds in one
   already-started battle. Add a tested version/legacy-continuation strategy;
   an operational drain without a race-proof gate is not sufficient.
5. Mission-specific reports need authoritative casualties/loot evidence; do not
   call pre-carried return cargo acquired loot or include recalled joiners. Verify
   side resources/debris against all eligible mission results.
6. Complete direct/lazy/keeper, delayed randomness, moon and hold integration,
   storage checks, exact-head independent review and CI.

## Contract upgrade handoff (incomplete; not approval)

The Game implementation embeds Gameplay, which embeds Combat, which embeds the
Rapidfire helper. Releasing this change requires a fresh compatible chain of those
modules and an in-place Game proxy upgrade preserving storage. The modified
DefenseHoldStorage library must be freshly linked in its consumers.

Do not use UpgradeProductionBatchGame to release this change: it reuses live
module addresses. Inspect and adapt the current approved upgrade path instead;
UpgradeGame's full deployment path also has unrelated historical migration
prerequisites that must be live-checked, not bypassed. The existing fork smoke
alone is not proof of coalition gas, timing or in-flight semantic continuity.

After the blockers are fixed: keyless exact-head fork dry-run, explicit upgrades-
topic approval for this exact ticket/PR/head, compatible backend/keeper first,
approved Game/module upgrade, verified manifest/health, frontend last, then
handoff to dedicated Testing. No transaction is authorized by this document.
