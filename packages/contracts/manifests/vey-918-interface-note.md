# VEY-918 contract / keeper interface

Function: `resolveFleetMissionBatch((uint256 missionId,uint8 leg)[] items) returns (uint8[] outcomes, uint256 executionGasUsed)`.
Leg 0 = arrival / DefenseHold expiry, leg 1 = return. Maximum 32, nonempty. Empty/oversize atomically revert InvalidQuantity; paused atomically reverts. Existing single-leg ABIs unchanged.

| Ordinal | Outcome | Meaning |
|---|---|---|
| 0 | Settled | Requested leg transitioned canonically in this child |
| 1 | Pending | Leg unresolved with no observed canonical preparation or combat-round advancement |
| 2 | AlreadySettled | Stale/duplicate/terminal leg; no credit attempted |
| 3 | Invalid | Unknown mission / leg >1 |
| 4 | NotDue | Scheduled leg deadline not reached |
| 5 | Failed | Isolated child reverted; reason selector or zero for empty/OOG |
| 6 | GasLimited | Child not attempted within remaining gas envelope |
| 7 | Progress | Requested leg unresolved, but persisted canonical scan/prerequisite/round state advanced |

Event: `FleetMissionBatchItem(uint256 indexed index,uint256 indexed missionId,uint8 leg,uint8 outcome,bytes4 errorSelector)`. Game ABI includes the event; index is zero-based calldata occurrence. Every occurrence emits one outcome. Only four revert bytes copied, not arguments. Re-query eligibility for blocker ID. Canonical status reconciliation remains mandatory: another item can settle a previously Pending leg; a successful receipt may settle none.

Limits: child maximum 15,000,000 gas; measured shared work window 15,500,000 plus bounded outcome tails; maximum 32 items. Per-remainder outcome reserve 12,000 plus 60,000; caller-gas allowances shrink, EIP-150 applies. Explicitly simulate candidate gas; a cheap eth_estimateGas success may only be Pending/GasLimited. Do not treat that estimate as full completion cost. Persisted combat rounds must be distinguished from zero-progress Pending. An indivisible round/finalization can exceed a smaller estimate: surface a policy blocker rather than retry that gas forever or silently raise USD cap.

Sender-preserving delegatecall to canonical Game resolution; original chronology and legacy/new boundary preserved. Independent bodies can proceed after failed items. Gas-poison may exhaust the envelope: select unrelated work on subsequent polling rather than starvation by fixed poison-first retries. No storage changes; no Moon upgrade. See vey-918-upgrade-handoff.md for graph, rollout, limitations and evidence.

## Productive gas simulation contract

The function selector and input layout are unchanged. Return data now decodes as `(uint8[],uint256)`; coordinated consumer deployment is required. Ordinals 0–6 are unchanged. `executionGasUsed` is gross (pre-refund) gas from the first statement of the module body through all child attempts, bounded progress reads and outcome events. It includes reverted/failed child work: a positive measurement is **not** proof of productivity. It excludes intrinsic/calldata gas, proxy/facade entry dispatch, final ABI encoding/return-copy, and external caller overhead. Add those margins, EIP-150 headroom and fee components off-chain; never equate this number to transaction gas limit or a USD quote.

`Progress` compares fixed-size persisted chronology scan fields (generation, cursor, blocker, blocker time/kind), completed combat rounds, and the pre-call blocker’s scan/status. Newly discovered blockers change the requested scan; unchanged blockers can advance their own bounded return scan or finish returning. No arrays or fleet/resource digests are traversed. Temporary writes restored before return and gas spent alone do not count. Child failure rolls back and reports Failed, not Progress. The comparison is per occurrence; later occurrences can settle earlier Pending/Progress legs, so canonical status reconciliation remains mandatory.

Use an exact-calldata, explicit-gas `eth_call` at the supported maximum to discover measured productive work (at least one Settled or Progress). Calculate a candidate gas/fee budget including margins, then **simulate that exact candidate gas again** and require a productive outcome before sending. Plain `eth_estimateGas` can find a successful all-GasLimited/Pending transaction. A fee-cap-constrained candidate can lose productive outcomes or stall at an indivisible round; report a blocker/reselect rather than sending repeated no-ops or silently increasing the cap. Do not count AlreadySettled as new work.
