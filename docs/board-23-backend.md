# Board #23 backend current-state coverage

Backend-only repair against integration base 676ac4e6 (second exact-head review follow-up). No contracts, chain transactions, deployment, browser QA, or commit in this lane.

## Shared read contract

| Consumer | Shared source and evidence |
| --- | --- |
| Overview, managed planets, infrastructure, catalogs, research | Effective building/research queues and Terraformer +5 fields. Building/research-only clock invalidation tests. |
| Shipyard, defenses, supply launch inventory | Effective display/launchable production counts, partial/final subtraction; ship/defense and moon variants exercised at unit boundaries. |
| Moon, moon supply, public moon, jump gate destinations | Effective production and proven fleet credits. Rankings uses the same lightweight moon-resource helper, not full moon hydration. |
| Public system, tactical, finder, forecast composition | Shared displayed unit rows; warm full-system HTTP partial-unit test. Summary memory and persisted caches invalidate at Terraformer completion (HTTP regression). |
| Resources, supply, public planet/finder, Rift | Shared indexedCurrentPlanetState/accruedPlanetState, indexed block watermark, canonical snapshots preserved. Rift uses current resources. |
| Fleet slots, active list, detail, archive | One deterministic leg proof determines current lifecycle and credits. Transport becomes Returning at proven delivery, Returned at proven return; Deploy resolves at delivery. Archive pages include effective terminals. |
| Activity | Default effective completions, stable batch/mission-leg IDs, game time; bounded batch representation, SQL grouping/pagination, startup chronological history reconstruction. |

## Repair details

- Scalar Returning reconciliation invalidates retained composition as survivor evidence. Only a same-snapshot composition/status marker or materialized participant survivors authorizes combat-return ships. Existing summary survivors are cleared before this proof selection.
- Staged lock discovery uses indexed CombatStageAdvanced evidence for active missions, not an Attack-only classification. Every nonzero phase except terminal 13 retains the planet-ID lock across planet/moon arrivals. Tests cover 1, 12, 14, 15 and released 13; pure tests cover dependent return suppression.
- Destination/origin moon identity distinguishes false (destroyed/replaced) from unknown. Actual retained FleetMissionLaunched evidence is mandatory; lastReconciledBlock is never a launch/incarnation anchor. Same-block creation uses ordered launch/creation logs. Unknown Deploy destinations reserve the possible return dependency; unknown origin incarnations reserve both moon and parent surfaces.
- Legacy retained queue start/end proves whole-batch readiness only. It no longer invents per-unit rates from rounded duration. Older synthetic timing is normalized conservatively; a retained modern timing event disambiguates genuine identical numeric timing. Malformed timing remains fail-closed. Legacy promoted backlog expectations now reflect batch semantics.
- Activity allocates one object per batch, not per unit (billion-unit fixture). Partial settlements sum by immutable batch ID. Ranked SQL selects a deterministic latest game-time row, avoiding SQLite bare-row/MAX ambiguity. Startup V3 reconstruction uses one ordered SQLite iterator (numeric block, log width/value, stable event-ID tie-break), not repeated OFFSET prefix scans, and retains queue history in a temporary SQLite table. Moon-building queue context includes planetId; two-moon completion IDs survive projection, mining, forced replay, and reader restart without collisions. Original event keys still support removal/reorg rebuilds.
- Resource order follows contracts: BatchTransport._settleScheduledTarget calls FirstPlanetSettlement.settleProductionUntil, then Colonization.completeAttackTargetSnapshotQueues (research, ships, defenses; **not buildings**). Each arrival accrues with the previous canonical/effectively settled rates, then updates ship/research inputs. The final passive collection applies the building two-window behavior. A two-arrival HTTP fixture covers building readiness before/between arrivals and satellite/research completion without retroactive accrual. Return cargo does not create an intermediate accrual/storage-headroom segment.
- Moon resource consumers preserve explicit unknown values instead of falling back to raw snapshots. Rankings includes proven current moon credits without full read-model hydration.

## Fleet horizon follow-up (review #541)

- Every deterministic fleet leg uses the validated fully indexed resource watermark, never the reader wall clock. Missing, stale, revision-mismatched or malformed anchors grant no projected ships/cargo or terminal lifecycle/slot credit. Resource accrual remains unchanged.
- Activity fleet legs are capped by both the requested activity window and this safe horizon; existing queue/activity wall-clock semantics are preserved.
- Wallet, full-system and persisted-summary version tokens include the safe fleet horizon. Actual HTTP keys for all highscores variants, universe systems and finder routes use that version; resource-bearing public payloads are browser no-store. Landing shared stale data cannot cross versions. No-store mission responses retain their numeric indexedRevision format. Public/tactical moon resources use the same effective credit balance as moon inventory.
- `fleetProjectionHorizon.test.ts` covers planet/moon transport, Deploy and known returns before/at/after arrival and return, forward/backward reader clock drift, warm full-system HTTP payloads, wallet shipyard/moon/infrastructure/Rift, mission detail, activity, and absent/unsafe watermark recovery.

## Verification

- Focused new/extended tests: currentState.test.ts, currentFleet.test.ts, server.test.ts; existing indexer legacy semantics and canonical activity clock fixtures updated.
- Second review lane: `bun run check` passed; full `bun test` passed 1,149 tests across 50 files, 6,948 assertions, zero failures (14.32s); `git diff --check` passed. Added missing-launch origin/destination, uncertain possible-return, two-moon identity/restart, and >500 same-block/removed-history replay coverage.
- Reproducible real-schema benchmark: `bun src/activityReplay.bench.ts`. 100k/200k/400k rows: ordered cursor 34/69/140 ms; actual forced V3 migration 178/349/724 ms. Previous reviewed OFFSET query-only times were 2.10/8.02/32.23 seconds. This fixture uses inert logs (actual queue-event work depends on its mix); both scans demonstrate approximately linear scaling.
- Existing production backlog/spend/replay/reorg, moon destruction, resource boosts/segments/caps, resolver and activity suites retained.

## Boundaries, not claims of certainty

- Unknown combat, harvest, linked ACS and hold outcomes remain blockers; no simulated win or loot is promoted into inventory. Indexed lock evidence is not a fresh RPC storage proof; absent relevant historical evidence cannot be reconstructed magically.
- Legacy queues with no trustworthy retained provenance remain excluded; no RPC repair or live data mutation is introduced.
- Activity is bounded in JS by batches/page, but SQL still groups a wallet's indexed history; startup migration is streaming and benchmarked through 400k real-schema rows, not every production event mix/history size.
- Resource tests qualify scheduled target settlement and local rate transitions, not an exhaustive whole-universe cross-owner research/arrival permutation or live reserve-exhaustion proof.
- Coverage is shared-source plus focused HTTP tests, not every route × account switch × reorg × production kind. Independent exact-head review and dedicated live Veydrift QA remain required.

Existing writer-only MissionResolutionService retains ownership of automated due mission/return processing, nonce/retry/receipt reconciliation. No second resolver, player-paid settlement duty, or new transaction path was added.
