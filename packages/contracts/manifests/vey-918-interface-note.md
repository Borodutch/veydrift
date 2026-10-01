# VEY-918 contract / keeper interface

Function: `resolveFleetMissionBatch((uint256 missionId,uint8 leg)[] items) returns (uint8[] outcomes)`.
Leg 0 = arrival / DefenseHold expiry, leg 1 = return. Maximum 32, nonempty. Empty/oversize atomically revert InvalidQuantity; paused atomically reverts. Existing single-leg ABIs unchanged.

| Ordinal | Outcome | Meaning |
|---|---|---|
| 0 | Settled | Requested leg transitioned canonically in this child |
| 1 | Pending | Leg still unresolved; may or may not have committed preparatory work |
| 2 | AlreadySettled | Stale/duplicate/terminal leg; no credit attempted |
| 3 | Invalid | Unknown mission / leg >1 |
| 4 | NotDue | Scheduled leg deadline not reached |
| 5 | Failed | Isolated child reverted; reason selector or zero for empty/OOG |
| 6 | GasLimited | Child not attempted within remaining gas envelope |

Event: `FleetMissionBatchItem(uint256 indexed index,uint256 indexed missionId,uint8 leg,uint8 outcome,bytes4 errorSelector)`. Game ABI includes the event; index is zero-based calldata occurrence. Every occurrence emits one outcome. Only four revert bytes copied, not arguments. Re-query eligibility for blocker ID. Canonical status reconciliation remains mandatory: another item can settle a previously Pending leg; a successful receipt may settle none.

Limits: child maximum 15,000,000 gas; measured shared work window 15,500,000 plus bounded outcome tails; maximum 32 items. Per-remainder outcome reserve 12,000 plus 60,000; caller-gas allowances shrink, EIP-150 applies. Explicitly simulate candidate gas; a cheap eth_estimateGas success may only be Pending/GasLimited. Do not treat that estimate as full completion cost. Persisted combat rounds must be distinguished from zero-progress Pending. An indivisible round/finalization can exceed a smaller estimate: surface a policy blocker rather than retry that gas forever or silently raise USD cap.

Sender-preserving delegatecall to canonical Game resolution; original chronology and legacy/new boundary preserved. Independent bodies can proceed after failed items. Gas-poison may exhaust the envelope: select unrelated work on subsequent polling rather than starvation by fixed poison-first retries. No storage changes; no Moon upgrade. See vey-918-upgrade-handoff.md for graph, rollout, limitations and evidence.
