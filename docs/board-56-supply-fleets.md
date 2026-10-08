# Supply fleets (#56)

## Selection semantics

Supply retains the Transport/Deploy toggle and the existing Large Cargo, Small Cargo and Colony Ship defaults. Initial source selection uses only origins with these default ships, so nearer combat/recycler-only origins do not consume cargo-supply slots. Those origins remain available for explicit selection. Recycler and all ten combat/mobile types start unselected. Satellites are not mission ships and are never offered.

Automatic mode allocates the existing smallest practical cargo fleet for resources, but sends every available ship of each explicitly enabled combat type. Per-source **Select all ships** selects only currently available mobile types and switches that source to sending all selected ships. Types can then be deselected without leaving all-ships mode; **Reset to automatic cargo** restores the original defaults. Selecting a type never selects an otherwise deselected source. Resource amounts remain independent, so zero-resource fleets launch without dummy cargo. Fuel must fit in the fleet hold and be paid from source deuterium; an unaffordable selected fleet is blocked, never silently reduced.

Preview, resource Max and fresh confirmation share the planner and fleet mode. Max accepts only plans with no blocked sources and preserves the current request if no launchable total exists. Fresh confirmation rejects changed amounts, fuel, travel time, stock or available slots. Planet Transport returns ships; planet Deploy stations them. Moon targets use the existing single-source body entrypoint (including parent-to-moon distance 5); sources remain planets.

## Release dependency

Atomic multi-source Deploy was impossible with the old Transport-only entrypoint: there is no general-purpose multicall on the Game facade. This change adds `launchDeployBatch(uint256,TransportBatchOrder[])` (`0xc47915ea`) through the same bounded module and canonical child launch delegatecalls. Both planet batches structurally allow 1–15 distinct owned origins, subject to available fleet slots and exact-call gas admission. Fifteen is not a gas-safe fleet bound. Failed children revert the whole transaction. No sequential wallet-send fallback or storage migration is introduced.

Immediately before wallet submission, both batch selectors use the shared app-RPC preflight to estimate the exact account, destination and complete calldata with a 16,777,216 gas ceiling. This includes currently due settlement, rather than estimating from origin or ship count. Over-cap, invalid or failed estimates stop before submission with a reduce-sources message. The submitted gas limit includes 20% headroom, capped at the chain ceiling. State can still change before inclusion; estimation cannot reserve state or guarantee arbitrary future settlement fits. No ships or sources are silently removed, and no batch is split.

**Upgrade Game before deploying the frontend.** The new Game implementation embeds the updated batch module and routes its selector. Follow the canonical contract upgrade procedure; do not expose this UI against the old implementation. Single-source Deploy retains its canonical launch selector. No live transactions or production QA were performed during implementation.

## Regression commands

From `apps/frontend`:

```sh
bun test tests/batchSupplyFleets.test.ts tests/batchSupplyMission.test.ts tests/batchSupplyMax.test.ts tests/batchSupplySelection.test.ts tests/deployBatchWallet.test.ts tests/levelSupplyConfirmation.test.ts src/batchSupplyPlanner.test.ts src/components/BatchSupplyModal.test.ts src/walletFlow.test.ts
node --test tests/batchSupply.browser.mjs
bunx tsc --project tsconfig.json --noEmit
```

The browser fixture is isolated, wallet-free and exercises desktop/mobile pointer interactions. Its normal Vite startup prepares animation variants, which can take several minutes on a cold worktree.

From `packages/contracts`, run `forge test --match-path test/VeydriftGame.t.sol -vv` (including `testLaunchDeployBatch*`), storage-layout and production size gates. Tests cover zero-resource mixed fleets, 15 orders, ownership, slots, pause/delegation, atomic rollback and actual arrival stationing.

Initial implementation verification: 64 focused frontend tests passed; the mounted desktop/mobile Supply fixture passed; TypeScript and Vite production build passed. The full frontend run (`bun test tests src/*.test.ts --timeout 30000`) passed 2,149 tests and failed two unrelated local HTTP tests (whitepaper 404 and trailer byte ranges received 502). Their server code was unchanged. The complete Game suite passed 316 tests, including eight new Deploy cases; storage layout, formatting/profile and production size gates passed. The original warm, single-ship 15-source gas figure was not a production gas bound and has been removed. Isolated tests with committed storage and optimized production contracts cover all 14 mobile types, heterogeneous manifests, an over-cap 15-source call and atomic rejection at Base’s cap, plus an eight-source call with due ship/defense/building/research settlement. Game runtime remains 24,134 bytes (442 bytes below the limit), and the batch module is 20,673 bytes.

Review-fix verification: 242 focused planner/modal/wallet tests passed, including provider/app-RPC ceiling rejection and exact calldata checks. The mounted desktop/mobile fixture passed with nearest-combat-only source regressions for one and multiple slots; one prior run had an intermittent touch-toggle failure and the unchanged rerun passed. The full frontend suite passed 2,177 tests with only the same two unrelated local HTTP 502 failures. TypeScript and Vite production build passed. The complete Game suite passed 319 tests, including the three isolated gas regressions: 15 heterogeneous full manifests used 20,025,346 gross transaction gas and reverted atomically at the Base cap; eight full manifests with due ship, defense, building and research queues used 12,228,785 gross gas and launched within the cap. These are representative regressions, not a universal eight-origin guarantee; exact RPC estimation remains mandatory. Contract formatting and profile/upgrade-policy checks passed; production contract source and storage are unchanged by the review fixes.
