# Supply fleets (#56)

## Selection semantics

Supply retains the Transport/Deploy toggle and the existing Large Cargo, Small Cargo and Colony Ship defaults. Recycler and all ten combat/mobile types start unselected. Satellites are not mission ships and are never offered.

Automatic mode allocates the existing smallest practical cargo fleet for resources, but sends every available ship of each explicitly enabled combat type. Per-source **Select all ships** selects only currently available mobile types and switches that source to sending all selected ships. Types can then be deselected without leaving all-ships mode; **Reset to automatic cargo** restores the original defaults. Selecting a type never selects an otherwise deselected source. Resource amounts remain independent, so zero-resource fleets launch without dummy cargo. Fuel must fit in the fleet hold and be paid from source deuterium; an unaffordable selected fleet is blocked, never silently reduced.

Preview, resource Max and fresh confirmation share the planner and fleet mode. Fresh confirmation rejects changed amounts, fuel, travel time, stock or available slots. Planet Transport returns ships; planet Deploy stations them. Moon targets use the existing single-source body entrypoint (including parent-to-moon distance 5); sources remain planets.

## Release dependency

Atomic multi-source Deploy was impossible with the old Transport-only entrypoint: there is no general-purpose multicall on the Game facade. This change adds `launchDeployBatch(uint256,TransportBatchOrder[])` (`0xc47915ea`) through the same bounded module and canonical child launch delegatecalls. Both planet batches allow 1–15 distinct owned origins, subject to available fleet slots. Failed children revert the whole transaction. No sequential wallet-send fallback or storage migration is introduced.

**Upgrade Game before deploying the frontend.** The new Game implementation embeds the updated batch module and routes its selector. Follow the canonical contract upgrade procedure; do not expose this UI against the old implementation. Single-source Deploy retains its canonical launch selector. No live transactions or production QA were performed during implementation.

## Regression commands

From `apps/frontend`:

```sh
bun test tests/batchSupplyFleets.test.ts tests/batchSupplyMission.test.ts tests/batchSupplyMax.test.ts tests/batchSupplySelection.test.ts tests/deployBatchWallet.test.ts tests/levelSupplyConfirmation.test.ts src/batchSupplyPlanner.test.ts src/components/BatchSupplyModal.test.ts
node --test tests/batchSupply.browser.mjs
bunx tsc --project tsconfig.json --noEmit
```

The browser fixture is isolated, wallet-free and exercises desktop/mobile pointer interactions. Its normal Vite startup prepares animation variants, which can take several minutes on a cold worktree.

From `packages/contracts`, run the Game suite (including `testLaunchDeployBatch*`), storage-layout and production size gates. Tests cover zero-resource mixed fleets, 15 orders, ownership, slots, pause/delegation, atomic rollback and actual arrival stationing.

Implementation verification: 64 focused frontend tests passed; the mounted desktop/mobile Supply fixture passed; TypeScript and Vite production build passed. The full frontend run (`bun test tests src/*.test.ts --timeout 30000`) passed 2,149 tests and failed two unrelated local HTTP tests (whitepaper 404 and trailer byte ranges received 502). Their server code was unchanged. The complete Game suite passed 316 tests, including eight new Deploy cases; storage layout, formatting/profile and production size gates passed. The 15-source Deploy call used 14,508,131 gas in the fixture; Game runtime is 24,134 bytes (442 bytes below the limit), and the batch module is 20,673 bytes.
