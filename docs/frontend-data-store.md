# Frontend backend-data store

## Purpose

`apps/frontend/src/backendDataStore.ts` is the only read-side boundary between UI code and the Veydrift backend. Components and app shells request data through a shared `BackendDataStore` for the active API base URL.

Low-level request encoding and response validation remain in `walletFlow.ts` and `entityMedia.ts`. Those modules are transport clients, not UI state stores, and UI components must not call their read functions directly.

## Invariants

1. Every backend read has a typed store method and stable cache key.
2. The store keeps the latest confirmed response, loading state, error, and update time.
3. If a request for the same key is already running, another refresh returns that exact promise. It does not start a second request.
4. A refresh error keeps the last confirmed response available.
5. UI components contain no raw `fetch()` calls.
6. A wallet transaction is successful in the UI only after its exact transaction or expected state transition is visible in indexed data.
7. Event-stream, polling, navigation, and post-transaction triggers all call the same store methods.

These rules are enforced by `backendDataStore.test.ts` and `backendDataBoundary.test.ts`.

## Data flow

```text
refresh trigger
  -> BackendDataStore typed method
  -> stable request key
  -> existing in-flight promise, or one transport request
  -> store response and notify subscribers
  -> project into the relevant UI view state
```

`backendDataStoreFor(apiBaseUrl)` returns the shared store for a normalized API URL. Do not construct a component-local store.

## Planet state

Planet views also use `planetSectionStore.ts`. Its job is narrower: it projects shared backend responses into per-planet presentation snapshots so the selected planet can change without clearing already rendered state.

For example, Infrastructure data follows one path:

```text
BackendDataStore.infrastructure(wallet, planetId)
  -> planet section snapshot for planetId
  -> Overview
  -> Infrastructure
  -> planet detail and selector progress consumers
```

The planet section store must never become a second network client.

## Adding a backend read

1. Add or reuse the typed transport function in `walletFlow.ts`.
2. Add a typed method and stable key in `BackendDataStore`.
3. Call that method from refresh triggers and post-transaction reconciliation.
4. Feed every surface from the stored result or its shared view projection.
5. Add a coalescing or boundary test when the data category or transport path is new.

Do not add a component-local request mutex. Coalescing belongs in `BackendDataStore`.

## Refresh behavior

Calling a store method always means “refresh this key.” The latest response remains readable while the request is in progress. Concurrent calls coalesce; a later call after completion starts a new request.

The underlying wallet API client has a very short recent-response window to collapse immediate duplicate HTTP work. Post-transaction reconciliation still polls until it observes the exact indexed change, so a receipt alone never promotes stale balances or queue state.

## Mutations

Wallet transactions remain in the transaction helpers because the wallet provider, receipt confirmation, and chain switching are not backend reads. Signed backend mutations may use their existing transport helpers, but any response that becomes shared UI data must be written to or refreshed through `BackendDataStore`.
