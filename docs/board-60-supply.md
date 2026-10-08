# Supply planning and review (#60)

## Reproduction, not a claimed historical failure

The Oct 8 reporter capture uses destination New Denver (planet 831, 6:9:12), Robotics Factory level 6 cost 12,800 M / 3,840 C / 6,400 D and shortfall 12,300 M / 3,340 C / 6,400 D. New Zion (planet 1, 6:9:1) has 20 Large Cargo and enough resources. A replay of the captured explicit-destination API data with technology IDs 3=8, 9=6, 10=7 meets the full shortfall with the old nearest-first policy: Astro 4,818 D, Montreal 11,181 M + 3,340 C + 1,582 D, Calgary 1,119 M, three missions and 21 D fuel. Zion alone supplies all cargo with one Large Cargo and 7 D fuel. This newer capture differs from screenshot amounts through accrued production; neither establishes a historical failed transaction.

The old UI selected nearby sources up to the slot limit before looking at the request. Its nearest-first allocation could fragment shipments or, with few slots, omit a farther self-sufficient source. The revised modal evaluates single-source, nearest-prefix, largest-contribution-prefix, residual-contribution and pruned candidate sets, ranking unmet resources first, then blockers, mission count, latest ETA and fuel. This is a deterministic bounded heuristic, explicitly not a global fastest/cheapest optimizer. Names and wallets have no special treatment. The chosen set is frozen until an explicit source change or Auto-plan cargo.

## Safety and inventory

The cargo planner and its affine Max interval tracing remain unchanged. Auto suggestions choose a source set outside that planner; Max still searches exactly the rendered selected-source plan. Fresh confirmation rebuilds the exact reviewed cargo per origin and compares cargo, fleet, fuel and travel time before calldata; Transport/Deploy dispatch fuel and moon routing are unchanged.

The production query is keyed by account and explicit destination. Mapping prefers canonical launchableShips over ships, and current as-of-now resource inventory; it does not add lazy credits itself. Existing indexer/API/store tests cover partial/final production credits, debits, lazy arrivals/returns, uncertain combat survivors, earlier-body dependencies and invalid/stale proof horizons. No manual settlement or chain inventory change was introduced.

The modal snapshots inventory for the reviewed draft. Polling updates visible availability without overwriting source selections, manual cargo, Max results or increasing shipments. Only changes that alter the contributing origins’ exact cargo, fleet, fuel or travel time require Review latest inventory. Unselected sources, unselected ships and resource decreases that still cover the reviewed shipment do not disable Launch or Max. Recalculate with latest stock remains available to adopt newly available inventory even when the reviewed plan is empty. Recalculate with latest stock deliberately adopts the current snapshot while preserving source/type/manual choices. Auto-plan cargo explicitly resets cargo/type/fleet overrides to safe defaults. Manual inputs show the user's exact quantities, not silently clamped outputs, and any truncated manual order blocks Launch. Exact unmet totals are always shown.

Destination shortfall refresh is explicit. Initial hydration and that explicit action can replace the requested total; preflight updates do not discard reviewed edits. Account/destination/new-draft keys remount the dialog. Latest-request guards prevent out-of-order destination refreshes, and the production submit lock prevents overlapping launches. A changed goal is not adopted merely because preflight publishes a new preview: Launch stays disabled with the exact unmet totals until explicit destination review. Authoritative confirmation also independently checks total cargo against fresh shortfall on every attempt, including retries.

## Presentation and QA boundary

One scrollport holds editable content; the header and fuel/ETA/mission/Launch footer remain outside it. Proposed contributors are visible by default. Source controls are progressively disclosed, with Use only this source and explanations for excluded/unneeded sources. Combat fleets remain opt-in, Select all ships remains explicit, and Deploy warns that ships stay at the destination.

Mounted local disposable-browser tests use the real modal at desktop and 390/320×568 viewports, including a Denver-equivalent fixture. These are not live reporter-wallet interactions. Dedicated QA owns deployed visual evidence and wallet verification.

## Review correction verification

The mounted `supplyConfirmation.browser.mjs` fixture uses the same `useBatchSupplyActions` hook wired to the production modal, with only indexed reads and the transaction coordinator/provider mocked. It covers increased-shortfall rejection and disabled second confirmation, explicit review followed by exact calldata, out-of-order deferred refreshes, same-tick duplicate clicks, account/destination changes during reads and between preflight/send, obsolete refresh publication and unmount. This is local regression coverage, not live-wallet QA.

## Initial implementation verification

- 76 focused tests pass: planner, modal contract, selection, fleet, mission, Max, level confirmation and effective-inventory suites pass. Existing exact Max tests remain unchanged.
- Frontend TypeScript and playable production build pass.
- Level Supply mounted browser suite passes all eight building/research/moon/binary desktop/mobile cases. The complete batch modal mounted suite passes (161.5s), including exact Denver contributor/payload, production accrual stability, manual stock-loss review and pinned-footer checks and the earlier ship-selection/worker-race coverage. Its trusted touch helper scrolls only the real inner scrollport: scrolling an overflow-hidden ancestor via scrollIntoView produced false off-target taps against the pinned footer.
- Full frontend suite was attempted: 2,182 passed; two unrelated localhost HTTP cases (whitepaper missing-route 404 and trailer range-file 200) received 502 in this execution environment, reproducible on isolated rerun. No trust/proxy settings were changed to bypass it.
- Full touch-browser gate was attempted: sidebar passed; the unchanged planet-picker harness failed its localhost CDP WebSocket connection before assertions, stopping the chained gate. Supply fixtures use the existing DevTools pipe harness. CI must still run the complete gate; this local attempt is not a green full-suite claim.
