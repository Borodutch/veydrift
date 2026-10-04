# Board #23 backend current-state coverage

Base: 6c8d3de0d18bd160720640f142649cb581abe1c1. Backend-only lane; no contracts, production transactions, deploy, or browser QA.

## Shared read contract

| Consumer | Shared source / coverage |
| --- | --- |
| Overview, managed planets, infrastructure, catalogs, research | effective building/research queues, Terraformer +5 fields; canonical remote research labs intentionally unchanged |
| Shipyard, defenses, supply launch inventory | one effective production count for displayed/launchable rows; old unproven planet queue artifacts cannot authorize inventory |
| Moon, moon supply, public moon, jump gate destinations | per-unit moon production and deterministic fleet effects share displayed/launchable rows; Lunar Base +3 preserved |
| Public planet/system, tactical, finder, current combat intel/forecast composition | displayedUnitCounts/shipRows/defenseRows now include trustworthy matured production; full-system cache invalidates at per-unit boundaries |
| Resources, overview, supply, public planet/finder, Rift | indexedCurrentPlanetState / accruedPlanetState; Rift no longer reads stale snapshot; original resources and snapshot remain unchanged |
| Fleet launch slots and availability | same terminal deterministic effect proof as inventory, not needsResolution/timers alone |
| Fleet history/detail | canonical lifecycle remains internal source; deterministic effects appear in current inventory/resources and default activity; uncertain mission status remains unaltered |
| Activity | completions included by default, game-time ordering, stable per-unit occurrence IDs retained through partial/final mined completions, mission leg IDs shared before/after indexing |

## Implemented

- Planet defenses and moon ships advance at trustworthy completion boundaries once, with existing partial completion subtraction retained. Display, available rows, productionInventory and displayedUnitCounts agree.
- Planet legacy provenance reuses the existing retained-log timing normalization. Missing provenance is rejected for both displayed and launchable inventory. Malformed modern timing cannot fall back to elapsed whole-batch credit.
- Deterministic Transport arrival credits only cargo; return credits ships and frees slot. Deploy credits destination ships/cargo and frees slot. Known Returning/Recalled cargo requires return evidence; combat requires proven survivor composition (canonical storage or materialized participant), never launch composition.
- A pure fleet-leg chronological sweep uses timestamp, arrival/return/hold priority, mission ID. Unknown earlier body events block later credits; unclassified body flags reserve both surfaces. Remote transport arrival dependencies use the full active graph. Missing/replaced origin moons land on parent; moon creation after launch rejects destination identity.
- Cargo/production ordering preserves arrival-target settlement before cargo, return cargo before later passive collection; no retroactive satellites/crawlers/energy research. Passive collection caps at pending Attack/Harvest/MissileAttack arrivals per ResourceReserves._isPendingResolutionMission.
- Projection fingerprints include partial unit quantities and next unit boundaries, global building/research/moon-building boundaries and fleet leg boundaries. State-version changes continue invalidating immediately.
- Terraformer field capacity projects +5 per new level on managed and public metadata. Rift shares current resources once.
- Activity uses per-unit game times rather than request/settlement time; canonical DB event keys remain distinct from public occurrence IDs for reorg removal. Existing saved occurrence identities survive startup feed repair when their raw logs remain canonical.

## Contract trace and automation ownership

Compared VeydriftBatchTransportModule.prepareFleetChronology/_earlierEvent/_before, GameplayModule Transport/Deploy resolution, PlanetManagementModule._landFleetReturn/_creditResources, DefenseProductionModule missing-moon arrival, ResourceReserves passive collection, and existing queue projection/event decrement code. No contract guard changed.

Existing writer-only MissionResolutionService is started in server.ts; it owns due mission/return progress, bounded batches, nonce/retry/receipt reconciliation. No second writer, player-funded settlement action, or production sweep was introduced. Production settles permissionlessly/lazily in existing contract actions; effective reads do not require a player to buy a completion.

## Tests

- New currentState.test.ts: planet/moon ship/defense exact first/middle/end boundaries, identical displayed/action counts, warm global/wallet fingerprint boundaries, building/research-only invalidation, Terraformer fields, default per-unit activity/incremental times and stable IDs, partial/final mined completion plus duplicate delivery, corrupt timing.
- New currentFleet.test.ts: Transport legs, planet/moon Deploy, earlier unknown attack vs later return and body isolation, unknown attacks/harvest/holds/ACS/interception, survivor/cargo proof, stale terminal legs, missing body flags, destroyed origin moon fallback.
- Added warm HTTP wallet/full-system cache regression across partial production without events; Rift versus current infrastructure resource equality.
- Updated existing intentional canonical/effective split assertions. Existing extensive backlog, launch/spend, replay/reorg, moon destruction, resource segments/boost/order and resolver suites retained.
- Final lane run: 1134 tests passed, zero failures (50 files, 6890 assertions); backend TypeScript check and git diff --check passed. Final integration run must rerun after cherry-pick.

## Remaining exact gaps / review flags

This is not a claim of full acceptance or live contract equivalence:

1. Legacy normalization inherited from baseline infers per-unit rate from retained batch start/end/quantity. Exact modern work/rate evidence is stronger; historical ceil-rounding equivalence needs independent contract fixture qualification. Queues without retained proof are conservatively excluded, not repaired by RPC.
2. Moon recreation in the same block as launch cannot be distinguished by block number alone; a generation/pointer or ordered-log proof is still needed for that rare identity edge. Missing-destination moon Transport/Deploy preserves original cargo/ships for its scheduled return rather than crediting ghost moon state.
3. Conservative chronology treats linked ACS/hold legs as blockers instead of fully simulating battle grouping/body locks. It does not guess these outcomes. Mission lifecycle list counts remain canonical while inventory/slots/activity use effective effects.
4. Historical activity completions whose original queue context is already gone retain their old aggregate IDs; no retrospective full queue-event reconstruction migration was added. New and retained context completions have stable per-unit IDs. Per-unit activity expansion is linear in due units; large queues need bounded SQL occurrence pagination before claiming scale parity.
5. Resource accrual after an earlier deterministic arrival that itself completes production still uses existing canonical satellite/crawler/research inputs; it intentionally does not invent rates. Exact multi-arrival settlement-induced rate changes require further independent parity work. No new live pending-battle/Rift/cargo-cap matrix beyond unit chronology and existing resource suites is claimed.
6. The complete requested cross-product matrix (all HTTP routes x account switches x reorg/restart x every production kind x deterministic fleet events) is not exhaustively added; focused shared-source and route regressions plus the pre-existing suite pass. Dedicated QA and independent exact-head review remain required.
