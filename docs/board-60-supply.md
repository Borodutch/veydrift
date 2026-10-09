# Supply planning and review (#60)

## Reproduction, not a claimed historical failure

The Oct 8 reporter capture uses destination New Denver (planet 831, 6:9:12), Robotics Factory level 6 cost 12,800 M / 3,840 C / 6,400 D and shortfall 12,300 M / 3,340 C / 6,400 D. New Zion (planet 1, 6:9:1) has 20 Large Cargo and enough resources. A replay of the captured explicit-destination API data with technology IDs 3=8, 9=6, 10=7 meets the full shortfall with the old nearest-first policy: Astro 4,818 D, Montreal 11,181 M + 3,340 C + 1,582 D, Calgary 1,119 M, three missions and 21 D fuel. Zion alone supplies all cargo with one Large Cargo and 7 D fuel. This newer capture differs from screenshot amounts through accrued production; neither establishes a historical failed transaction.

The old UI selected nearby sources up to the slot limit before looking at the request. Its nearest-first allocation could fragment shipments or, with few slots, omit a farther self-sufficient source. The revised modal evaluates single-source, nearest-prefix, largest-contribution-prefix, greedy residual-contribution and pruned candidate sets, ranking unmet resources first, then blockers, mission count, latest ETA and fuel. This is a deterministic bounded heuristic, explicitly not a global fastest/cheapest optimizer. Names and wallets have no special treatment. The initially suggested source set is retained until the user changes source checkboxes.

## Safety and inventory

The cargo planner and its affine Max interval tracing remain unchanged. Auto suggestions choose a source set outside that planner; Max still searches exactly the rendered selected-source plan. Fresh confirmation rebuilds the exact reviewed cargo per origin and compares cargo, fleet, fuel and travel time before calldata; Transport/Deploy dispatch fuel and moon routing are unchanged.

The production query is keyed by account and explicit destination. Mapping prefers canonical launchableShips over ships, and current as-of-now resource inventory; it does not add lazy credits itself. Existing indexer/API/store tests cover partial/final production credits, debits, lazy arrivals/returns, uncertain combat survivors, earlier-body dependencies and invalid/stale proof horizons. No manual settlement or chain inventory change was introduced.

The modal plans from the newest authoritative server inventory while retaining source selections, requested totals, manual cargo and ship-type choices. Harmless inventory changes need no action; changes to the actual proposed shipment and failed preflight attempts require explicit Review latest inventory consent before launch. This recovery control appears only when needed and disappears after review. It does not refresh a frozen snapshot or reset the draft. Unselected ship production, excluded military ships and reserve decreases that still cover the identical shipment do not disable Launch or cancel Max. Manual inputs show the user's exact quantities, not silently clamped outputs, and any truncated manual order blocks Launch. Exact unmet totals are always shown.

Destination shortfall refresh is explicit. Initial hydration and that explicit action can replace the requested total; preflight updates do not discard reviewed edits, but an increased goal/cost blocks Launch until explicit review and Needed/Remaining always include the actual fresh goal. Preflight independently verifies total cargo covers every fresh level deficit on every attempt, including a second unchanged confirmation after publishing a new preview. Account/destination/new-draft keys remount the dialog. Latest-request guards prevent out-of-order destination refreshes, and the production submit lock prevents overlapping launches.

## Presentation and QA boundary

One scrollport holds editable content; the header and fuel/ETA/mission/Launch footer remain outside it. Proposed contributors are visible by default. Unchecked sources show only their checkbox, name, coordinates and available resources; selection reveals cargo and ship controls. Unavailable-selection reasons remain accessible on the checkbox. Combat fleets remain opt-in, Select all ships remains explicit, and Deploy warns that ships stay at the destination.

Mounted local disposable-browser tests use the real modal at desktop and 390/320×568 viewports, including a Denver-equivalent fixture. These are not live reporter-wallet interactions. Dedicated QA owns deployed visual evidence and wallet verification.

## Local verification

- 78 focused tests pass: planner, modal contract, selection, fleet, mission, Max, level confirmation and effective-inventory suites pass. Existing exact Max tests remain unchanged.
- Frontend TypeScript and playable production build pass. The new mounted production-action suite passes (8.3s), covering goal review, actual launch calldata, deferred reads and all context/duplicate guards.
- Level Supply mounted browser suite passes all eight building/research/moon/binary desktop/mobile cases. The complete batch modal mounted suite passes (158.9s), including exact Denver contributor/payload, production accrual stability, manual stock-loss review and pinned-footer checks and the earlier ship-selection/worker-race coverage. Its trusted touch helper scrolls only the real inner scrollport: scrolling an overflow-hidden ancestor via scrollIntoView produced false off-target taps against the pinned footer.
- Full frontend suite was attempted: 2,185 passed; two unrelated localhost HTTP cases (whitepaper missing-route 404 and trailer range-file 200) received 502 in this execution environment, reproducible on isolated rerun. No trust/proxy settings were changed to bypass it.
- Full touch-browser gate was attempted: sidebar passed; the unchanged planet-picker harness failed its localhost CDP WebSocket connection before assertions, stopping the chained gate. Supply fixtures use the existing DevTools pipe harness. CI must still run the complete gate; this local attempt is not a green full-suite claim.

## Isolated-worktree reconciliation

Reconciled late fix commit `cc9b38b8` with the isolated review work, retaining one production-action fixture. Added destination/body checks to refresh publication, destination-switch protection between preflight and send, selected-stock/lock/drive Max cancellation checks and harmless large reserve decreases/unselected lock coverage. Focused tests: 78 passed / 1,224 assertions; frontend TypeScript and playable Vite build passed. Production-action (7.4s), level (5.4s) and expanded batch (162.4s) browser suites passed locally; the production-action fixture also passed strict TypeScript checking. No live wallet QA.

## Independent-review fixes

- **Two-confirm underfunding:** fresh level cargo coverage is enforced independently of preview-change detection; the mounted modal preserves edits but gates unreviewed goal changes and shows the true remaining 500 M / 500 C in the Denver spend reproduction.
- **Refresh relevance:** compare the actual reviewed shipment against fresh selected-source feasibility, not every resource/ship on every origin. Mounted tests keep a pending Max worker and exact calldata stable for unselected +1 fighter, selected excluded +1 fighter and selected -1 M with abundant reserves; relevant fuel, lock, drive and used-fleet changes still cancel and block.
- **Production handler races:** refresh/submit closures now live in the exported production `useBatchSupplyActions` hook, used by PlayableMvpApp and mounted alongside the real modal in `supplyActions`. Only external query results, coordinated scheduling and the EIP-1193 transport are mocked. Tests cover reversed refresh completion, same-frame duplicate confirmation, deferred reads across close/reopen/account/body/target/unmount, context change after preflight before send, the two-confirm exploit and exact ABI payload. The production send callback checks scope both before entering the wallet launch function and at the actual `eth_sendTransaction` boundary (see the final correction below). This fixture is wired into the required touch-browser gate.
- **Complementary inventory:** the bounded heuristic adds residual-contribution candidates, so 10,000 M + 1,000 C with two slots selects metal-only A plus crystal-only C instead of overlapping metal A+B.

## Final P1 correction: wallet-await invalidation

The last review correctly reproduced a remaining window: the pre-launch scope check ran before async wallet network setup, simulation, gas estimation and final chain verification. A draft invalidated during these reads could still request a wallet transaction.

Supply now reuses the existing per-attempt `transactionWalletProvider` wrapper around the already coordinated provider. Its synchronous before-send callback verifies the captured mounted/account/target/body/generation identity immediately at `eth_sendTransaction`, before delegating to the coordinator's own send-start guard. All launch branches receive this provider. The existing wrapper preserves provider receivers and WeakMap transport configuration; coordinator deadline, network, duplicate-send and disconnect behavior remain intact. No new coordinator API or recovery-identity restriction was added. Once submission starts, there is deliberately no post-send draft check that could discard its hash.

Mounted production-action coverage now includes the real `BackendDataStore.runWriteTransaction` and production wallet encoder, with only wallet/RPC and destination inventory transports mocked:

- 36 races: deferred `eth_call`, `eth_estimateGas` and final `eth_chainId` × close, close/reopen, account, target, body and unmount × provider fallback/configured app RPC. Each obsolete draft produces zero sends and `not-submitted`, not an uncertain send. Configured cases assert simulation/gas never fall back to the wallet provider.
- An unchanged draft whose foreground deadline expires during simulation still sends nothing after the read resumes.
- Six post-send context changes retain a single late hash after foreground returns `unknown`; actual store recovery reaches success without closing a replacement draft.

Verification: 130 focused Supply/lifecycle/recovery tests pass (1,524 assertions); 150 wallet-flow tests pass (513 assertions); frontend TypeScript and separate strict fixture TypeScript pass. Expanded mounted `supplyActions` passes in 19.5s, and `git diff --check` passes. Negative control: temporarily bypassing only the new wrapper makes the first deferred simulation/close regression fail with one send instead of zero; the guard was restored. All transports are local fixtures, not live wallet/deployment evidence.
