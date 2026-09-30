# VEY-919 staged consumer integration checkpoint

Not a release verdict. Parent worker owns this note and backend/frontend edits.

- `CombatStageAdvanced(uint256,uint8,uint256,uint8)` decodes to completed-round progress, including zero rounds. Producer must emit completed rounds, not current work round. Backend restart/reorg/duplicate delivery tests and frontend zero-round render tests pass.
- Staged reports now consume explicit battle/member starting counts, cumulative destroyed counts, repaired defenses, and newly acquired loot across transactions. Mandatory `CombatEvidenceComplete` per-kind counts plus final losses/debris prevent partial reports; side resource losses reconcile exactly to the existing catalog. Historical defender fallback stays separate.
- Authoritative staged participants bypass `attachAttackGroupParticipants` legacy enrichment. The report retains wiped participants and never substitutes carried return cargo for acquired loot. New/removed evidence invalidates canonical and alias reports before regeneration; an indexed canonical-report expression bounds alias invalidation. Wiped allied defenders receive aliases.
- Historical events retain legacy decoding. Backend event-aware readers must deploy before new producer activation; keep frontend after verified contract/manifest.
- Base docs fetched 2026-09-30 confirm 16,777,216 transaction gas maximum; implementation/keeper ceiling stays 15,000,000, including transaction overhead for actual envelope proof. Source: https://docs.base.org/specifications/transactions/troubleshooting-transactions . Pure helper execution is not full transaction proof.
- Verification: full consumer regression594 pass on pinned Bun1.1.42; staged review regressions8 pass; mission UI117 pass; backend/frontend tsc pass. Full backend984 pass/1 unrelated wallet fixture fail; full frontend2051 pass/4 unrelated static-server fail. All5 failures reproduce on pristine baseeda10dbae26d34834037cd2e258877b069e32a5c. Frontend component tests run from `apps/frontend` for preact JSX configuration; pinned Bun is `/Users/borodutch/.bun/bin/bun` locally.
- No release/upgrade approval or historical replay inferred.
