# VEY-KANEO-919 — staged coalition checkpoint

**NOT RELEASE-READY. Do not merge, deploy, sign, broadcast or replay battle #94880.**

Nikita's decision (Telegram #21707, 2026-09-30) selects persistent multi-transaction
combat, not participant caps or a raised transaction ceiling. This checkpoint
implements substantial portions but does not satisfy every acceptance gate.

## Implemented

- Canonical type/effective-stat cohorts preserve individual Weapons/Shielding/Armor,
  same-seed side partition parity and deterministic largest-remainder mission losses.
- Persistent stages cover planet/Moon preparation, roster enrollment, sub-round fire
  and rapidfire, attribution, unit mutation, raid capacity/loot, and return cleanup.
  The lead stays Outbound until finalization. Wiped holds clear cargo, slot and hold
  membership exactly once. No new eligibility cap or join-cutoff change.
- Research completion checkpoints and an exact baseline legacy combat continuation
  module are present; their historical activation boundary remains unproven below.
- Authoritative member snapshots/losses/repairs/acquired-loot events and final event
  counts drive indexed reports across transactions. Missing evidence fails closed;
  side resource totals reconcile. Reorgs invalidate cached reports. Reusable defense
  holds use deterministic latest-canonical many-to-many report lookup.
- Keeper persists pending jobs and historical discovery in SQLite WAL; retries use
  canonical status, exact 15M gas preflight and pending-nonce checks. Partial receipts
  are not completion. Deployment needs a managed persistent volume and stop-first
  single replica (see battle-keeper README).

## Verified checkpoint evidence

- Independent reference through real Game: 19/19. It caught and fixed a genuine
  attacker RNG domain mismatch (0 vs required 4); this is not merely repinned goldens.
- Staged math/lifecycle: 10/10 under the canonical isolated per-file runner; independent
  real Game reference19, Moon preparation7, and three new real Game review regressions
  pass together (29/29). Research8 and Moon preparation/core41 passed before this
  scoped follow-up. Normal raw Forge defaults cannot fund the aggregate 6,294-call
  driver; the runner overrides only this test file’s aggregate budget. Every actual
  resolver call remains explicitly capped at15M, and no roster/assertion was removed.
- Original full roster retained: seven distinct-tech owners **per side**, all14
  mobile types at1000 each, W/S/A8..14, resident8 and support/defenses. The adapted
  Gameplay/Combat/Raid facade completed in6294 continuation calls, peak4,494,696 gas.
  Every resolver call retains15,000,000 gas ceiling. **Facade dependencies are
  adapted; this is not the complete production Game proxy transaction proof.**
- Original atomic workload remains an explicit >15M benchmark, not a passing atomic
  gas assertion or an omitted/reduced fixture.
- Base inherited storage layout guard passes. Namespaced layouts still require
  independent compatibility review. Source runtime/initcode sizes and formatting
  passed a fresh warning-denied 125-file source build; staged runtime24,275bytes
  (301bytes EIP170 margin). Source checks are not a deployed-proxy proof.
- Consumer/API regression597 passed; keeper99 passed; mission UI118 passed. Further
  review regressions added deterministic multi-battle defender lookup and complete
  round sequence checks. Backend/frontend TypeScript passed earlier; final checks run.
- Full pinned Bun1.1.42 backend984pass/1fail and frontend2051pass/4fail. All five
  unrelated local HTTP fixture failures reproduce on pristine base
  eda10dbae26d34834037cd2e258877b069e32a5c. They do not excuse actual contract failures.

Local evidence lives in artifacts/vey919-* in the worker worktree. Interface agreement:
[producer events](vey919-event-contract.md); [consumer notes](vey919-consumer-integration-notes.md).

## Remaining blockers (do not weaken acceptance)

1. **Initial protection-score scan is still unbounded.** Phase0 calls raw player
   planet/mission score traversal atomically. It fails closed, but an oversized scan
   can still prevent progress. Implement coherent bounded score preparation or a
   maintained equivalent index with proven freeze semantics. This is an engineering
   gap under the approved design, not another A/B product question.
2. **Historical research/cutover boundary.** Deleted pre-upgrade queues cannot be
   reconstructed. Current lazy history baseline does not prove historical impact
   levels. Establish a reviewed activation/legacy boundary without data migration
   or retroactive replay. Exact deployed legacy arithmetic provenance, all legacy
   holds/returns and terminal continuation remain to be proven.
3. **Real Game/Moon regressions and liveness.** Old focused Game suite12pass/22fail,
   broad Moon suite69pass/13fail were not fully migrated from single-call assumptions.
   Preserve state assertions while adding bounded eventual-completion helpers. Prove
   direct/lazy/keeper, delayed randomness, all mutable-input/lock paths, reserve-backed
   debris/returns and full original roster under cold actual proxy transaction limits.
   The canonical per-file runner executes the long staged fixture with an
   aggregate-driver-only override; full CI and cold actual-proxy lifecycle proof remain.
   Never relax individual transaction limits.
4. **Exact-head independent review and CI** remain required. A review bound to
   `6b85b626` found three additional defects: planet combat could settle later Moon
   defenses before an earlier Moon battle; a protected/missing-Moon bounce awaited
   oracle randomness; linked return deadlines varied with continuation timing.
   Successor tests now prove Moon-only preparation/release, oracle-free bounces and a
   shared persisted return epoch (real Game3/3, staged10/10). Review of the successor
   head and green CI are still required. This is not in-review acceptance.
5. **Keyless upgrade closure and approval.** No full canonical script/fork proof yet.
   Game, Gameplay, Combat router, Staged, Legacy, Raid, StateMigration, fresh linked
   libraries, research-completing consumers and Moon changes must all be accounted
   for. Research checkpoint code in inherited ResourceReserves makes stale module
   reuse unsafe. UpgradeProductionBatchGame reuses live modules and cannot release
   this graph. UpgradeGame has historical referral/private-key prerequisites that
   are not a keyless rehearsal. Do not bypass them.

## Release boundary

After all blockers are fixed: exact-head review and green CI; keyless storage,
constructor/linked-module and live-fork rehearsal; request Nikita's exact-ticket/PR/head
approval in Veydrift upgrades. Deploy compatible event-aware backend/keeper first,
then approved Game/Moon/module upgrades in verified order, manifest/health/smoke,
frontend last, dedicated Testing. Design approval is not broadcast approval.
