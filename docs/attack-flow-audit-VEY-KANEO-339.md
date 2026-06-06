# VEY-KANEO-339 Attack Flow Audit

Scope: player-facing OGame-style Mission Control and shareable battle reports, excluding espionage. This audit covers the 2026-06-06 rework request from Telegram #9003.

## Result

Status: implemented for the audited attack flow.

The main fix in this pass is contract-side attack resolution. `resolveFleetMission` now snapshots the defender at the mission impact timestamp before combat: resources are settled only through `arrivalAt`, and ship/defense queues that were ready by `arrivalAt` are completed before combat. Resources and queues that become ready after impact are excluded even if somebody resolves the battle late.

## Checklist

- Target, fleet, and speed selection: contract launch validation rejects invalid owners, targets, empty fleets, capacity/cargo overflow, timing, unsupported mission types, and direct-call bypasses. Frontend launch UI is tracked separately by VEY-KANEO-344.
- Attacker visibility: backend reader and DB indexer reconstruct outbound attacks and returning missions from mission logs. Mission Control renders attacker controls including recall, report view, and copy report.
- Defender visibility: backend reader and DB indexer reconstruct incoming hostile attacks against owned planets. Mission Control renders defender controls for group defend and intercept.
- Both-side battle reports: backend reader reconstructs battle reports from combat logs and filters them for either the attacker or the defender owner of the target planet. Mission Control renders inline resolved reports and shareable report detail.
- Raid, debris, moon chance, and loss correctness: combat resolution still emits `AttackBattleResolved`, per-round reports, losses, debris updates, and moon chance request/finalization events. Existing combat parity and moon/debris tests remain the source of truth.
- Direct-call abuse resistance: existing mission entrypoint tests cover non-owner resolve/return/recall, unsupported missions, pending oracle blocking, and caller randomness/request-id abuse.
- Impact-time invariant: added contract tests prove late resolution uses defender resources and ready ship/defense queues from the impact timestamp, while excluding production and queues that become ready after impact.
- Espionage: intentionally out of scope for this ticket.

## Evidence

- Contract: `packages/contracts/src/VeydriftGameplayModule.sol`
  - `resolveFleetMission` calls the attack snapshot path for `FleetMissionType.Attack`.
  - `_settleAttackTargetSnapshot` settles resources through `arrivalAt` and completes ready ship/defense queues through `arrivalAt`.

- Contract tests: `packages/contracts/test/VeydriftGame.t.sol`
  - `testAttackResolutionSettlesTargetResourcesAtImpactNotLateResolverTime`
  - `testAttackResolutionCompletesDefenderQueuesReadyByImpact`
  - `testAttackResolutionExcludesQueuesReadyAfterImpactEvenWhenResolvedLate`
  - Existing mission entrypoint and caller-randomness tests remain in the focused validation set.

- Backend tests:
  - `apps/backend/src/indexer.test.ts`: `indexes attacker and defender fleet mission visibility from mission event logs`
  - `apps/backend/src/evm.test.ts`: `reconstructs attacker and defender mission views plus battle reports from logs`
  - `apps/backend/src/evm.test.ts`: `decodes shareable combat report logs`

- Frontend tests:
  - `apps/frontend/tests/missionControlPage.test.tsx`: `renders attacker and defender attack views with side-specific controls`
  - Existing Mission Control tests cover inline resolved report pagination and shareable report detail fields.

## Notes

The DB indexer currently reconstructs fleet mission visibility from stored mission logs but does not materialize combat battle report rows; its `fleetMissionVisibility` fallback still returns an empty `battleReports` array. Battle reports are served by the live EVM reader from combat logs, which is the path validated for both attacker and defender report access in this pass.
