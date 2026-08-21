# Frontend backend-read boundary

## Purpose

`apps/frontend/src/backendDataStore.ts` is the typed state boundary and canonical runtime owner between UI code, wallet writes, and the Veydrift backend. It owns normalized responses, stable request keys, generation ordering, freshness, failures, the priority read scheduler, the global write gate, and transaction lifecycle state.

Low-level request encoding and response validation remain in `walletFlow.ts` and `entityMedia.ts`. Those modules are transport clients, and UI components must not call their read functions directly.

## Invariants

1. Every covered backend read has a typed boundary method and stable request key.
2. If a request for the same key is already running, another caller receives that exact promise unless an authoritative refresh explicitly supersedes it.
3. Every read has a generation and enqueue-time deadline. Older responses can resolve to their original caller but cannot replace a newer canonical snapshot.
4. UI components contain no raw `fetch()` calls.
5. `GameStateStore` is the canonical owner of response data and `fresh`, `refreshing`, `delayed`, or `failed` freshness. Screen and planet-section state is a render projection, not another authoritative response copy.
6. A failed refresh must not clear the last confirmed view projection. The projection owner records the error while retaining its previous data.
7. A wallet transaction is successful in the UI only after its exact transaction or expected state transition is visible in indexed data.
8. UI components submit writes and request reconciliation through `BackendDataStore`; they do not own a second transaction gate, write lifecycle, or post-write response cache.

Generation, cancellation, priority, cross-screen propagation, and enqueue-time deadline behavior are enforced by `gameStateStore.test.ts`. Boundary/coalescing behavior remains covered by `backendDataStore.test.ts` and `backendDataBoundary.test.ts`.

## Data flow

```text
refresh trigger
  -> BackendDataStore typed method
  -> priority scheduler (transaction, selected planet, Mission Control, background)
  -> stable request key + generation + AbortController
  -> canonical response/freshness snapshot
  -> subscribed screen projections rerender
```

Wallet mutations use the same boundary:

```text
component action
  -> BackendDataStore shared write gate
  -> wallet submission + receipt confirmation
  -> transaction-priority reconciliation of canonical response keys
  -> shared write lifecycle becomes applied/timed-out/failed
  -> all subscribed components rerender from those same store entries
```

`backendDataStoreFor(apiBaseUrl)` returns the shared canonical store for a normalized API URL. Do not construct a component-local coordinator, transaction gate, request mutex, write lifecycle, or authoritative response cache.

Completed responses and freshness changes notify every subscriber. Rankings, Raid Finder, selected-planet modules, the top bar/Overview shell, Mission Control, Galaxy, and planet/moon detail all subscribe to canonical snapshots. Their remaining local state is limited to interaction and render projections such as the selected tab, page, filters, or composed display rows.

## Planet state

`planetSectionStore.ts` remains a render-only cache for derived per-planet universe projections used by mission composition. Indexed settlement, queues, infrastructure, moon, defense, shipyard, research, and rift responses no longer live there; their data and freshness come directly from `GameStateStore` snapshots.

For example, Infrastructure data follows this path:

```text
BackendDataStore.infrastructure(wallet, planetId)
  -> canonical store publishes the indexed response and revision
  -> every subscriber for wallet + planetId rerenders
  -> Overview, Infrastructure, top-bar/resource, and selector projections
```

The planet section store never performs network requests or owns backend loading/error state. The canonical store keeps last-good data on delayed/failed refreshes, and only the current generation can replace it.

## Canonical planet resources

`planetResourceStore.ts` is the only frontend owner of connected-wallet resource balances. It is keyed by wallet, orbit-body kind, and planet ID. Wallet settlement, the planet roster/navigation cache, Infrastructure, Research, Shipyard, Defenses, Rift, moons, the top bar, and mission affordability all overlay resource values from this store instead of retaining competing balance projections.

Every value promoted into the store comes from a backend-indexed response. Receipt confirmation starts a bounded aggressive convergence read; it does not debit, credit, or roll back a balance in the browser. The indexed response must prove inclusion with the transaction hash or receipt block. Poll, EventSource, navigation, and in-flight responses are ordered by indexed block and settlement metadata, and an older response cannot replace the confirmed floor. Same-version responses may only advance backend-computed production accrual; a same-version decrease is rejected.

Resource-affecting action UIs remain in the explicit `indexing` phase until shared convergence promotes the proven backend snapshot. A bounded timeout becomes a visible retryable action error while the last confirmed balance stays rendered.

## Adding a backend read

1. Add or reuse the typed transport function in `walletFlow.ts`.
2. Add a typed method and stable key in `BackendDataStore`.
3. Call that method from refresh triggers and post-transaction reconciliation.
4. Subscribe to the canonical snapshot or adapt it into an existing render projection; do not add another authoritative response cache.
5. Assign the appropriate scheduler priority and navigation/filter scope.
6. Add generation, cancellation, deadline, or propagation coverage when the new read changes those behaviors.

## Refresh behavior

Calling a boundary method means “refresh this canonical key.” Concurrent same-key calls coalesce; authoritative reads advance the generation. Wallet/planet/filter/navigation changes abort their old scope, including work still waiting for one of the three read slots. Deadlines begin at enqueue time, not when `fetch()` starts.

The underlying wallet API client also has a very short recent-response window to collapse immediate duplicate HTTP work. Post-transaction reconciliation still polls until it observes the exact indexed change, so a receipt alone never promotes stale balances or queue state.

## Mutations

Wallet provider calls and receipt confirmation remain transaction-helper concerns, but `BackendDataStore` owns their single global gate and publishes every write phase into `GameStateStore`. Components subscribe to that shared write entry just like read entries. The shared state records wallet submission, confirmation, waiting for index, and the visible terminal outcome (`applied`, `timed-out`, or `failed`). A timeout releases the global write gate while preserving its transaction hash and retry context.

Post-write reconciliation also belongs to this boundary. For example, defense production polls `defenses(wallet, planetId)` and `queues(wallet, planetId)` at transaction priority. Those exact canonical entries drive the Defenses page, Overview, queue widgets, and transaction feedback; the initiating component does not manually copy the response into separate local state or run an additional resource poll.
