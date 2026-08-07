# Frontend backend-read boundary

## Purpose

`apps/frontend/src/backendDataStore.ts` is the typed read-side boundary between UI code and the Veydrift backend. Despite the legacy filename and class name, it is a request coordinator, not a second UI state store: it owns stable request keys and in-flight promises only.

Low-level request encoding and response validation remain in `walletFlow.ts` and `entityMedia.ts`. Those modules are transport clients, and UI components must not call their read functions directly.

## Invariants

1. Every covered backend read has a typed boundary method and stable request key.
2. If a request for the same key is already running, another caller receives that exact promise instead of starting a second request.
3. A call made after the request settles starts a fresh request; the coordinator does not cache response data, loading/error status, or freshness metadata.
4. UI components contain no raw `fetch()` calls.
5. Consumer-visible data and refresh status have one explicit owner: `planetSectionStore` for shared planet projections, `planetResourceStore` for wallet-scoped per-planet balances, or the screen's existing local projection for screen-specific non-resource data.
6. A failed refresh must not clear the last confirmed view projection. The projection owner records the error while retaining its previous data.
7. A wallet transaction is successful in the UI only after its exact transaction or expected state transition is visible in indexed data.

The request-coalescing rules are enforced by `backendDataStore.test.ts` and `backendDataBoundary.test.ts`. Shared planet data/status behavior is enforced by `planetSectionStore.test.ts`; screen-specific stale-data behavior remains covered by the relevant feature tests.

## Data flow

```text
refresh trigger
  -> BackendDataStore typed method
  -> stable request key
  -> existing in-flight promise, or one transport request
  -> caller applies the result to its explicit view projection
```

`backendDataStoreFor(apiBaseUrl)` returns the shared request coordinator for a normalized API URL. Do not construct a component-local coordinator or request mutex.

Coalescing does not itself propagate a completed response into other screens. Concurrent callers receive the same promise and each applies the result to its declared projection. Cross-screen response, status, and freshness propagation exists only where callers consume the same shared view projection.

## Planet state

`planetSectionStore.ts` is the consumer-visible shared state layer for planet surfaces. It owns per-planet presentation snapshots, section loading/error status, and the last successful refresh time so the selected planet can change without clearing already rendered state.

For example, Infrastructure data follows this path:

```text
BackendDataStore.infrastructure(wallet, planetId)
  -> apply the confirmed response to the planet section for planetId
  -> Overview, Infrastructure, planet detail, and selector consumers
```

The planet section store never performs network requests. Starting or failing a refresh changes section status but does not discard its last confirmed data; only a confirmed response replaces the projection.

## Canonical planet resources

`planetResourceStore.ts` is the only frontend owner of connected-wallet resource balances. It is keyed by wallet, orbit-body kind, and planet ID. Wallet settlement, the planet roster/navigation cache, Infrastructure, Research, Shipyard, Defenses, Rift, moons, the top bar, and mission affordability all overlay resource values from this store instead of retaining competing balance projections.

Every value promoted into the store comes from a backend-indexed response. Receipt confirmation starts a bounded aggressive convergence read; it does not debit, credit, or roll back a balance in the browser. The indexed response must prove inclusion with the transaction hash or receipt block. Poll, EventSource, navigation, and in-flight responses are ordered by indexed block and settlement metadata, and an older response cannot replace the confirmed floor. Same-version responses may only advance backend-computed production accrual; a same-version decrease is rejected.

Resource-affecting action UIs remain in the explicit `indexing` phase until shared convergence promotes the proven backend snapshot. A bounded timeout becomes a visible retryable action error while the last confirmed balance stays rendered.

## Adding a backend read

1. Add or reuse the typed transport function in `walletFlow.ts`.
2. Add a typed method and stable key in `BackendDataStore`.
3. Call that method from refresh triggers and post-transaction reconciliation.
4. Apply the result to the existing shared or screen-local view projection; do not add another hidden cache.
5. Add a coalescing or boundary test when the data category or transport path is new, plus a projection test when shared view behavior changes.

## Refresh behavior

Calling a boundary method means “read this key now.” Concurrent same-key calls coalesce; a later call after completion starts a new request. The boundary rejects failed requests so the projection owner can expose the error while retaining already confirmed data.

The underlying wallet API client also has a very short recent-response window to collapse immediate duplicate HTTP work. Post-transaction reconciliation still polls until it observes the exact indexed change, so a receipt alone never promotes stale balances or queue state.

## Mutations

Wallet transactions remain in the transaction helpers because the wallet provider, receipt confirmation, and chain switching are not backend reads. Signed backend mutations may use their existing transport helpers. Their confirmed result must be applied to an explicit view projection or followed by a boundary refresh; the request coordinator does not retain mutation results.
