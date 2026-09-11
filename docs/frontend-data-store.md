# Frontend state and API consumption

This is the implemented frontend architecture. Backend ingestion and commit
guarantees are documented in [Backend and indexer](backend-indexer.md); local
setup lives in [Development](development.md). Superseded migration proposals
must not be used to restore browser-persisted transaction journals or schedulers.

## Ownership

`BackendDataStore` is the canonical runtime owner of backend response entries and
pending actions. Views subscribe through typed query descriptors. Low-level HTTP
encoding and validation remain in `walletFlow.ts` and `entityMedia.ts`; components
must not call raw `fetch` or create another authoritative cache.

The playable shell activates each endpoint independently; Overview is not a
bootstrap dependency and aggregate responses cannot publish into endpoint keys.
Planet balances, production, caps and energy come from one infrastructure response;
moon balances come from the moon response. Header and affordability use that same
economy response. Roster and unit/research responses do not overwrite it.

## Reads

Supply uses `GET /wallet/:wallet/supply-sources?planetId=:target` on open and again
before confirmation. One consistent indexed snapshot returns all other owned
planets' resources and launchable ship counts, plus wallet-wide technology and
fleet-slot state once. The modal subscribes only while open, using the existing
scoped invalidation/fallback refresh rather than its own timer. It never uses stale
HTTP response caching or publishes into individual planet/shipyard cache entries.
Sources and fleet slots are projections of this query; only the user's draft and
submission feedback are local. Closing or switching wallets invalidates the modal
submission context without cancelling unrelated resource requests.

`useBackendDataQuery` exposes per-key `isInitialLoading` and `isRefreshing`.
Skeletons use the former; a background refresh leaves last-good data visible.
Neither is an application-wide action lock. The transaction coordinator guards
duplicate submissions, independently of presentation loading.

The visible route is one `InspectRoute` value. Page, detail IDs, and inspected
coordinates derive from it; gameplay planet selection and transient dialogs remain
separate. Planet/moon/player/alliance links use internal navigation rather than
full page reloads. API reads and mutations share timeout/error/JSON transport handling,
but only the store deduplicates reads, and mutations are never automatically retried.

- Independent keys start concurrently. There is no global request scheduler.
- All consumers of a running key share its transport, including callers requesting
  a fresh read. Invalidation during that request schedules one trailing refresh.
- Generations prevent invalidated, replaced, or disposed requests from publishing.
- Last-good data survives loading and failure.
- A transport timeout covers the actual HTTP request and response-body parsing,
  not time spent waiting behind unrelated requests.
- Disabled queries do not subscribe. Inactive registered resources can be retained
  briefly without being polled. All read paths schedule eviction after completion,
  including failed or slow registered refetches.
- API-base stores are reference-counted through `retainBackendDataStore` and are
  disposed after their final owner releases them.

Reads have no priorities, configurable deduplication, or queue deadlines. Each
key always shares its running request; timeout handling lives in the HTTP adapter.

`startGameplaySync` owns the refresh cadence. Infrastructure, moon, queue,
active fleet/count and mission-detail queries refresh on the ten-second policy;
entries with active production also use that cadence. Archive and other mounted
reads have a two-minute safety refresh. Hidden/offline
tabs retain data and resynchronize on resume. Cached unmounted planets are not
polled. This handles time-based changes even when the chain emits no new log.

SSE `sync-status.ready` is the backend's indexed-readiness signal; websocket
subscription flags are diagnostics, not a frontend readiness gate. The first ready
frame and recovery trigger a resync; ordinary heartbeats do not. One-shot refreshes
(such as referral deadlines) target an exact query key, not broad wallet tags.
Static infrastructure state is derived on API updates; clock ticks advance queue
displays, while resource animations react to new indexed balances.
Resource conversion and multi-query projections retain object identity until their
inputs change. Preact's external-store hook handles subscription rechecks, including
updates between render and subscribing; this does not introduce another data cache.

SSE ready/recovery triggers a catch-up; heartbeat revisions do not trigger reads.
Overlapping browser resume signals and deferred refresh tags are coalesced.
A ready/reconnected stream remains a read barrier: requests started before it
cannot replace the required catch-up. Genuine events during reads retain one
trailing refresh. The display clock pauses while hidden and catches up on return;
visible resource-number animations and countdowns remain presentation only.
Known planet-only commit events include wallet/planet scope. Events with unknown
or global impact deliberately retain conservative invalidation. Scope expansion
can be added as individual event families acquire complete impact information.
Complete planet scopes skip off-chain profile/media/runtime-config reads, but
still invalidate alliance scores and resource-bearing rosters. Mutation
invalidation uses exact keys or intersected scope matching, not wallet OR kind.

## Endpoint selection

Keep domain endpoints separate. Use compact summaries or a focused batch when
the screen needs them; do not make every refresh fetch a whole-planet snapshot.
Each response owns its own canonical key and never populates another endpoint's cache.

| Consumer | Read policy |
| --- | --- |
| Header and affordability | Infrastructure economy for a planet; moon economy for a moon. Never promote roster/unit resources over these. |
| Supply | One `supply-sources` batch while open and before submission; no per-source resources/ships fan-out. |
| Home queues | Wallet-wide and home consumers pass the same explicit home planet ID to share a request; colony queues remain independent. Query identity never depends on previously loaded settlement data. |
| Player details | Targeted wallet highscore header includes rank/profile; planets load independently. No full leaderboard or extra profile request. |
| Landing rankings | `highscores?view=scoreboard` omits tactical planet hydration; tactical consumers keep their detailed view. |
| Alliance | `alliance?view=summary` keeps the viewer's roster; foreign details use `/alliance/:id`. Treasury readiness is separate from private invite capabilities. |
| Mission Control | Global count loads without opening All; full global rows load only for All/filters. Subscribe to count OR rows, and use the newest cached source for the badge. |
| Archives | Paginated history and compact battle summaries; full report detail on demand. Keep mission detail polling while outcomes remain pending. |
| Launch inventories | `{id, count}` availability overlays the base catalog; do not lose cost/duration/energy data. |

Background refreshes do not replace loaded panels with skeletons, reset drafts,
or turn a known empty section into a new loading block. Disabled requests do not
poll. Profile/media/watch mutations refresh their actual dependencies, not every
gameplay endpoint for the wallet.

Route bodies load on demand inside `PageContent`; navigation, resource displays,
and the data store stay mounted. `LoadingSkeletons` owns page-shaped layouts shared
by route and initial-data loading. Do not use a planet-detail skeleton for unrelated
pages. Shared utilities belong outside lazy page modules so importing a helper does
not eagerly load the page. First-planet indexing uses the active settlement query
and the store's normal synchronization, not a page-owned retry countdown.

Profile, watch, and media saves use the shared timeout and cancellation transport.
Only the signature prompt holds the wallet gate; HTTP saving locks that entity,
not unrelated actions. Failed mutations are not automatically retried.

Normalize pagination defaults and wallet/address casing before creating query keys;
keep arbitrary identifiers such as invite codes case-sensitive. Transport
options are not query identity. Referral and invite reads propagate cancellation
from the store. RPC preflight and ownership reads use the same bounded transport.

Presentation countdowns share `useUiClock`, which pauses in hidden tabs and catches
up when visible. Subscribe in display components, not the application shell. This
clock never fetches data or changes indexed state.

## Writes and recovery

Feature notices subscribe to store-owned transaction groups scoped by wallet and
planet. Pages keep only validation feedback and dismissal state, not copied
transaction phases. Mission Control likewise renders tabs and pagination from
one controlled view, with URL/session persistence at the application boundary.

Query descriptors and explicit reads share one key/scope/loader definition.
Shipyard, defenses, and research reuse backend snapshot assembly helpers while
keeping their separate payloads and endpoint-specific availability checks.

Research preflight uses one fresh research response for levels and the active
queue; it does not merge captured queues or request a second queue endpoint.

The same store owns the complete operation:

1. Guard the initiating action against duplicate clicks; there is no wallet-wide contract-write gate.
2. Prepare required signatures and submit through the existing EIP-1193 wallet path.
   Only the actual send request publishes **Awaiting wallet**; preparation has its own phase.
3. Track the hash, wallet, chain, action, affected query keys, planet IDs, and conflict keys in memory before
   beginning status observation. Playable actions return the hash and release their initiating UI immediately.
4. Observe the backend's submitted/confirmed/applied/reverted status in the background.
5. On application, refresh active affected endpoints. Stop checking transaction status.
6. Finish any required invite/referral API saves independently, then refresh their affected data and publish success.
   Save retries retain their authorization in session memory without holding gameplay locks;
   neither a read failure nor a save failure turns an applied transaction back into pending.

A prior in-flight read cannot satisfy step 5: it must settle before a new
post-application read starts. Refreshes retain last-good data. A status-request
timeout or indexing delay keeps a non-blocking **Processing…** notice during this session.
Failed post-application reads retain last-good data and are retried by normal query synchronization, not transaction recovery. Only an explicit reverted receipt is a post-submission
failure. There is no overall two-minute deadline or wait/discard dialog.

Plans contain deduplicated query keys, not nested refresh runners or endpoint
expectations. Auxiliary writes are checkpointed before reads, so a failed read
does not repeat a successful invite/referral operation. Unmounted affected keys
are invalidated without transport and load normally when next needed.

Unrelated actions can progress even while a wallet request is outstanding.
Foreground waiting is bounded to 60 seconds, not transaction lifetime. Expired
preparation cannot send later; an unresponsive send becomes **outcome unknown**,
never a false failure or automatic retry. An explicit repeat of an uncertain
action requires a duplicate-risk confirmation. Late hashes are still tracked.
Monotonic attempt IDs keep older progress out of newer action/group notices.
`isActionBusy` distinguishes preparation/approval from background tracking;
screens must not use a Processing notice or outstanding transaction count as a lock.
Subsequent submissions retain fresh indexed preflights and app-RPC simulation;
backend reads do not make request-time RPC calls.
Old persisted transaction locks are removed when the store starts.
Per-action progress includes planet identity, so identical buttons on different
planets cannot overwrite one another.
The stored transaction `phase` is the progress authority; labels and semantic
outcomes are derived rather than maintained as independent state fields.

Hidden/offline tabs and inactive wallets pause observation. Visibility return,
online, pageshow, window focus and context restoration wake existing observers;
there remains one observer per hash. Recovery never submits again or requests a
new signature. Session entries from another chain are not queried on the current chain.
API errors preserve HTTP status, backend code, and `Retry-After`. Transient errors
back off; non-retryable responses pause observation until a lifecycle recovery wake.
Neither is evidence that a submitted transaction reverted.
Reload creates a new session: it fetches backend state without restoring pending UI or automatically submitting transactions.

Paid-invite and referral completion authorizations are obtained before submission.
Their narrowly scoped signatures and required invite data live in the pending
session memory only until completion. No wallet private keys are stored. In-session recovery retries the signed API operation
without reopening the wallet. Reload recovery is deliberately not provided, including for unfinished auxiliary API writes.

## Validation and remaining work

`gameStateStore.test.ts`, `backendDataStore.test.ts`, and
`transactionRecovery.test.ts` exercise concurrency, generations, disposal, recovery,
and full-cycle completion. Backend transaction-status coverage checks missing
watermarks, wrong log identities/content, and same-block revision changes.

`requestOptimization.test.ts` and the isolated browser fixtures also cover
summary/count selection, scoped refreshes, reconnect races, independent public
details and hidden-clock behavior. Receipt replacement/nonce recovery and complete
event-family scoping remain limitations, not reasons to restore durable UI locks.
