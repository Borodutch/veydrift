> Historical investigation against e8c6e1fe. The follow-on implementation now adds complete bounded legacy inventory, body/player indexes, shared eligibility and guarded lazy paths; this is no longer an unresolved design-only blocker. Retained as prior evidence/motivation. See vey-905-upgrade-handoff.md and final verification for current status.

# VEY-905 all-event continuation: design blocker (not acceptance evidence)

Status: contract implementation is NOT complete for the 09:31 owner clarification. Do not publish the existing partial implementation as meeting all-event/body-independent ordering.

## Why extending the existing attack/return scan is not sufficient

The existing resolution index is deliberately incomplete, not an authoritative active-event inventory:

- VeydriftResourceReserves._isResolutionTrackedMissionType includes Transport/Deploy/Colonize/Attack/Harvest and MissileAttack only. DefenseHold/AcsAttack/AcsDefend/Intercept are excluded.
- VeydriftDefenseHoldModule.launchDefenseHold records the hold in _stationedDefenseMissions[target] but never in a return-origin index. endHold removes it and clears holdUntil at expiry/recall, so a returning legacy hold becomes undiscoverable by either proposed body scan.
- ACS/counterplay stores the hostile attack ID at the participant origins, not the participant mission IDs. _returnJoinedAttackMissions / _returnCounterplayMissions changes participants to Returning without indexing their return legs. _untrackLinkedCounterplayMissionResolutions eventually removes the only indirect hostile entry. There is no complete per-owner/global active mission array; the phalanx array is an unused storage declaration.
- Existing recalled direct missions were untracked before this branch; fixing future recalls cannot reconstruct live legacy recalled returns.
- Simply changing the tracking predicate fixes future launches only, not active pre-upgrade fleets. Counting an empty index as eligibility is therefore unsafe on the live proxy.

This is an implementation/design blocker, not a claim that the requested behavior is impossible or needs a scope reversal. This child has not implemented the required migration-backed replacement. A safe all-event implementation needs an append-only complete body-event index plus a bounded, resumable migration/backfill of legacy active mission IDs (or equivalent proven inventory), with fail-closed activation until complete. It must hook all launches, recalls, linked battle transitions, hold expiry, moon-destruction fallback and terminal untracks; invalidate cached scans on status/time changes as well as array membership changes. That is a new migration-backed chronology subsystem, not a small generalization of the existing attack-only cursor. It needs exact rollout/checkpoint/storage tests and greenlight handoff; none exists in the current partial branch.

## Concrete continuation path

1. Build one body-scoped scheduled-event queue ordered by (effective timestamp, explicit event-kind tie priority, source/group ID). Include both target arrivals and origin return reservations; grouped battle participants must not become independent cyclic blockers.
2. Introduce a bounded migration cursor over a captured nextFleetId boundary, replaying only active legacy missions into that index. Require completion before claiming chronology readiness; new launches/recalls must maintain the new index atomically. Do not rely on trusted off-chain omission-free lists without an on-chain completeness check.
3. Use one preparer/eligibility implementation from permissionless arrival, return and lazy paths. Guard cached scan state against every status/time change, not merely add/remove.
4. Prove legacy-return coverage, hold/linked battles, no cycles, body independence, reverse IDs, deterministic ties, late randomness, no double credit and bounded gas; update append-only storage and exact migration rollout handoff.
5. Existing Gameplay size is reported at 24,554 bytes (22 bytes below EIP-170), so put substantive chronology in a dedicated linked/delegated module rather than inlining it into every inherited module. Re-run actual size checks after integration.

Source anchors: ResourceReserves.sol:418/435/606/670; DefenseHoldModule.sol:57/159/397; CombatModule.sol:1508/1541; BatchTransportModule.sol:58; PlanetManagementModule.sol:244; UpgradeGameFork.t.sol:113.

## Event semantics that must be settled in that implementation

- Arrival affects target body; return affects origin body; projected return from an unresolved outbound round trip creates a dependency at returnAt but does not move its earlier target arrival onto the origin body.
- Hold arrival is already materialized by the stationed roster/time predicate; hold end is an event at holdUntil. Removing that roster before an earlier delayed battle loses a defender. Tie policy must account for existing inclusive holdUntil >= attack.arrivalAt combat eligibility.
- Linked AcsAttack/defend/intercept arrivals are settled by their hostile battle. Treating the linked ID as an independent earlier unresolved target arrival creates a cycle (battle waits for participant, participant waits for battle). Group them under the battle event while keeping each origin return independently indexed.
- Current linked return timestamps are shifted to actual battle resolution time in CombatModule, unlike direct attack returnAt. Preserve or deliberately normalize this with explicit tests; never infer projected return ordering from an obsolete timestamp.
- Harvest uses the planet's debris field; identify that shared-resource conflict separately from ordinary planet/moon fleet independence.

## Readiness integration warning

No new eligibility selector was added. A successful eth_call(resolveFleetMission) is NOT sufficient proof of terminal eligibility: bounded preparers return success while the leg remains Outbound, and unseeded linked branches can also return without resolving. Do not advertise those calls as definitively ready merely from the 0x result. A shared authoritative view should fail closed for an incomplete index and expose actual blocker/event ordering; alternatively simulate and inspect the resulting canonical mission status, not only revert/success.

## Fork scope

test/UpgradeGameFork.t.sol currently calls _upgradeMoonSystem() after the Game upgrade. The existing VEY-905 handoff says Game-only and UpgradeGame.s.sol is Game-only. Its current test is not an exact Game-only rollout proof; separate or remove the unrelated Moon upgrade before claiming that proof.

## Validation

Confirmed three red behavioral regressions against the untouched e8c6e1fe runtime implementation (compiler successful; 0 passed, 3 failed):

- testAmendedScopeEarlierTransportPrecedesAttack: later attack resolved before earlier transport (the transport has the higher mission ID but the earlier arrival).
- testAmendedScopeMoonReturnIndependentOfPlanetAttack: unrelated planet attack wrongly rejects matured moon return with FleetMissionNotResolved(1790592549).
- testAmendedScopePlanetReturnIndependentOfMoonAttack: reciprocal body-isolation failure, same revert.

Evidence: manifests/vey-905-amended-scope-red.log. Reproducible patch: manifests/vey-905-amended-scope-regressions.patch. From repository root: git apply packages/contracts/manifests/vey-905-amended-scope-regressions.patch; then cd packages/contracts && forge test --match-path test/VeydriftScheduledReturns.t.sol --match-test testAmendedScope -vv. The patch is intentionally not applied in the working tree so the known-red probes do not silently become CI acceptance tests; apply it while implementing the replacement and make all three green. Test source was restored byte-for-byte after preserving the patch.

Two intermediate transport probe failures were harness issues (fleet slot limit, then foreign-owner Transport prohibition); fixture capacity and ownership were corrected before the final behavioral failure above. No runtime contract changes, migration, proxy upgrade, signing or broadcast performed by this continuation child.
