# Frontend backend-read boundary

## Ownership

`BackendDataStore` is the canonical runtime owner of backend response entries and
pending actions. Views subscribe through typed query descriptors. Low-level HTTP
encoding and validation remain in `walletFlow.ts` and `entityMedia.ts`; components
must not call raw `fetch` or create another authoritative cache.

The ongoing migration is documented in
[the refactoring proposal](frontend-state-refactoring-proposal.md). Aggregate
fan-out, resource promotion between endpoints, and several legacy refresh plans
still exist; they are not the final ownership model.

## Reads

- Independent keys start concurrently. There is no global request scheduler.
- All consumers of a running key share its transport, including callers requesting
  a fresh read. Invalidation during that request schedules one trailing refresh.
- Generations prevent invalidated, replaced, or disposed requests from publishing.
- Last-good data survives loading and failure.
- A transport timeout covers the actual HTTP request and response-body parsing,
  not time spent waiting behind unrelated requests.
- Disabled queries do not subscribe. Inactive registered resources can be retained
  briefly without being polled.
- API-base stores are reference-counted through `retainBackendDataStore` and are
  disposed after their final owner releases them.

Priority arguments remain as compatibility metadata in some readers and polling
leases. They do not allocate transport slots or delay another key.

## Writes and recovery

The same store owns the complete operation:

1. Check conflicting pending actions and acquire the short wallet submission gate.
2. Prepare required signatures and submit through the existing EIP-1193 wallet path.
3. Save the hash, wallet, chain, action, affected planet IDs, and conflict keys before
   beginning status observation or releasing the submission gate.
4. Observe the backend's submitted/confirmed/applied/reverted status.
5. Complete required auxiliary API writes and refresh active affected endpoints.
6. Remove the journal and publish success only after those reads succeed.

A prior in-flight read cannot satisfy step 5: it must settle before a new
post-application read starts. Refreshes retain last-good data. A failed refresh,
HTTP timeout, or indexing delay keeps the action in **Processing…** and retains
its recovery record. Only an explicit reverted receipt is a post-submission
failure. There is no overall two-minute deadline or wait/discard dialog.

Different planets can progress concurrently after submission. Shared fleet,
research, alliance, and wallet-resource actions declare additional conflict keys.
Older journals without scope conservatively lock that wallet until resolved.
Per-action progress includes planet identity, so identical buttons on different
planets cannot overwrite one another.

Hidden/offline tabs and inactive wallets pause observation. Visibility return,
online, pageshow, context restoration, and SSE connection wake existing observers;
there remains one observer per hash. Recovery never submits again or requests a
new signature. A journal from another chain is retained, not queried on the
current chain or silently discarded.

Paid-invite and referral completion authorizations are obtained before submission.
Their narrowly scoped signatures and required invite data live in the pending
browser journal only until completion; this is not encrypted browser storage.
No wallet private keys are stored. Recovery retries the signed API operation
without reopening the wallet. If browser storage is unavailable, the current page
still keeps hashes and conflict protection in memory, but reload recovery cannot
be guaranteed.

## Backend completion boundary

Transaction status checks receipt-log identities and contents together with the
durable resource-projection watermark inside one SQLite read transaction.
An in-memory sync cursor or matching event count alone cannot report **applied**.
The watermark must cover the receipt block and match the committed index revision.
Gameplay still uses separate endpoints; this change does not introduce whole-planet
snapshot polling.

## Validation and remaining work

`gameStateStore.test.ts`, `backendDataStore.test.ts`, and
`transactionRecovery.test.ts` exercise concurrency, generations, disposal, recovery,
and full-cycle completion. Backend transaction-status coverage checks missing
watermarks, wrong log identities/content, and same-block revision changes.

The draft migration still needs single authoritative field ownership, removal of
aggregate publication and broad tag invalidation, scoped post-commit SSE events,
and receipt replacement/nonce recovery. Do not describe those as implemented.
