# Board #23 backend current-state coverage

Backend-only repair against integration base ad12e062. No contracts, chain transactions, deployment, browser QA, or commit in this lane.

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
- Destination/origin moon identity distinguishes false (destroyed/replaced) from unknown. Same-block creation uses ordered launch/creation logs; absent launch provenance stays unknown rather than treating the moon as destroyed.
- Legacy retained queue start/end proves whole-batch readiness only. It no longer invents per-unit rates from rounded duration. Older synthetic timing is normalized conservatively; a retained modern timing event disambiguates genuine identical numeric timing. Malformed timing remains fail-closed. Legacy promoted backlog expectations now reflect batch semantics.
- Activity allocates one object per batch, not per unit (billion-unit fixture). Partial settlements sum by immutable batch ID. Ranked SQL selects a deterministic latest game-time row, avoiding SQLite bare-row/MAX ambiguity. Startup V3 reconstruction streams 500 raw logs per batch and retains queue history in a temporary SQLite table. Original event keys still support removal/reorg rebuilds.
- Resource order follows contracts: BatchTransport._settleScheduledTarget calls FirstPlanetSettlement.settleProductionUntil, then Colonization.completeAttackTargetSnapshotQueues (research, ships, defenses; **not buildings**). Each arrival accrues with the previous canonical/effectively settled rates, then updates ship/research inputs. The final passive collection applies the building two-window behavior. A two-arrival HTTP fixture covers building readiness before/between arrivals and satellite/research completion without retroactive accrual. Return cargo does not create an intermediate accrual/storage-headroom segment.
- Moon resource consumers preserve explicit unknown values instead of falling back to raw snapshots. Rankings includes proven current moon credits without full read-model hydration.

## Verification

- Focused new/extended tests: currentState.test.ts, currentFleet.test.ts, server.test.ts; existing indexer legacy semantics and canonical activity clock fixtures updated.
- Final lane run: `bun run check` passed; `bun test` passed 1,145 tests across 50 files, 6,934 assertions, zero failures (13.19s). `git diff --check` passed. Rerun after integration edits.
- Existing production backlog/spend/replay/reorg, moon destruction, resource boosts/segments/caps, resolver and activity suites retained.

## Boundaries, not claims of certainty

- Unknown combat, harvest, linked ACS and hold outcomes remain blockers; no simulated win or loot is promoted into inventory. Indexed lock evidence is not a fresh RPC storage proof; absent relevant historical evidence cannot be reconstructed magically.
- Legacy queues with no trustworthy retained provenance remain excluded; no RPC repair or live data mutation is introduced.
- Activity is bounded in JS by batches/page, but SQL still groups a wallet's indexed history; startup migration is bounded-memory, not a benchmark of every production history size.
- Resource tests qualify scheduled target settlement and local rate transitions, not an exhaustive whole-universe cross-owner research/arrival permutation or live reserve-exhaustion proof.
- Coverage is shared-source plus focused HTTP tests, not every route × account switch × reorg × production kind. Independent exact-head review and dedicated live Veydrift QA remain required.

Existing writer-only MissionResolutionService retains ownership of automated due mission/return processing, nonce/retry/receipt reconciliation. No second resolver, player-paid settlement duty, or new transaction path was added.
