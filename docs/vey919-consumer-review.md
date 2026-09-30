# VEY-919 consumer intermediate review

Astra high review 2026-09-30 identified four defects in the in-progress consumer change: stale materialized reports/aliases after reorg; terminal-first logs publishing missing aggregate losses; no proof of complete per-member evidence; missing wiped-defender alias.

Implemented regressions and fixes:
- Canonical/alias report invalidation for new and removed evidence, cross-process cache version; canonical-ID expression index guards malformed historical JSON.
- Mandatory `CombatEvidenceComplete` unique counts for snapshots/loss/loot/repair; staged progress without evidence never falls back to legacy carried cargo. Final `CombatLosses` and `CombatDebrisSignaled` required.
- Both side resource losses reconcile exactly against member ship casualties and existing catalog costs.
- Defender mission aliases and immutable resident/wiped-allied snapshots survive full report materialization.
- Eight targeted tests pass; complete indexer/decoder/report/API suite594 tests pass on pinned Bun1.1.42.

This is an intermediate consumer review, NOT an independent exact-head whole-PR verdict. Contract/full-lifecycle/release blockers remain governed by the main handoff. A re-review is being collected before checkpoint publication.
