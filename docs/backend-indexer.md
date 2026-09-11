# Backend and indexer

The [public-state decision](public-onchain-state-architecture.md) defines gameplay
authority. This guide describes the current data path, not a contract-upgrade plan.

## Responsibilities

- Contracts enforce ownership, spending, progression, fleet and combat rules.
- The indexing writer ingests public logs into the durable SQLite event ledger and
  materialized read models. Log identities, ordering and reorg/removal handling
  matter; repeated logs must not apply a spend or credit twice.
- Gameplay APIs read indexed snapshots and deterministic time projections.
  They do not repair missing state by reading every planet from RPC on demand.
- Profile/media and other explicitly off-chain metadata use their authenticated
  write paths; public gameplay does not imply that every backend field is onchain.
- The frontend consumes these APIs through its [single data store](frontend-data-store.md).

See [chainSync.ts](../apps/backend/src/chainSync.ts),
[indexer.ts](../apps/backend/src/indexer.ts) and
[server.ts](../apps/backend/src/server.ts) for implemented behavior.

## Ingestion and time

The chain-sync service polls HTTP RPC for heads and logs. Websocket logs wake a
canonical HTTP scan; they do not fetch timestamps or directly publish game state.
Health reports websocket subscriptions separately from HTTP readiness. Losing
the socket does not make healthy, current HTTP ingestion unavailable.
SSE `sync-status.ready` combines HTTP connectivity with the indexer's safe-to-serve
state; the frontend consumes this signal without interpreting subscription flags.
SSE status frames contain only readiness; diagnostics remain in `/health`. Broadcast
frames are encoded once. A client that exceeds its 64 KiB stream queue is disconnected
and recovers through normal reconnect/resync, without blocking other clients.

Transport failures and index-integrity failures have separate persisted reasons.
A successful verified scan clears transport failure, not an outstanding repair.
A temporarily inconsistent RPC anchor recovers only when its original hash is
verified again and the indexed event revision has not changed. A real reorg or
changed event history stays blocked for explicit reconciliation.

Absolute resource/unit events provide post-mutation values. Apply ordered events
rather than fabricating deltas or resolving competing frontend snapshots.
Elapsed production and due queues are projected from indexed data by
[asOfNow.ts](../apps/backend/src/asOfNow.ts) and
[readModels.ts](../apps/backend/src/readModels.ts). Time-sensitive reads can change
without a new chain event.

Projection does not authorize pretending that pending randomness, unresolved
combat or an incomplete index is successful. Keep impact-time ordering and
availability gates. Do not remove finish/resolve entrypoints, keeper services or
randomness workers based on a historical lazy-settlement proposal. Their necessity
depends on the actual deployed contracts and configured responsibilities.

## Consistent reads and transaction application

Structured `api_request` logs include `requestBodyBytes` (declared Content-Length,
zero for no body, `null` when unknown) and `responseBodyBytes` (payload bytes read
from the response stream). `responseBodyComplete` is false on cancellation or a
body-stream error; those sizes are partial. SSE is logged immediately with a
`null` response size. Other responses are logged when consumed or cancelled,
while `durationMs` still measures handler time, not download time. Sizes exclude
HTTP headers, network overhead and any later proxy compression; no bodies are logged.

Gameplay builders use SQLite read snapshots so one response does not mix commits.
Ownership lookup does not project resources; each endpoint computes the resource
view it actually returns once, within that snapshot.
Unavailable state must remain distinguishable from valid zero/empty state.
Retain readiness/availability and source/projection fields used for correctness;
full operational diagnostics belong in `/health`.

Shared JSON contracts for resources, queues, mission archive envelopes, pagination,
and alliance diplomacy live in `packages/api-types/src/index.ts`, without runtime
dependencies. Resource-readiness requirements are explicit route options, not display labels.

`GET /highscores` defaults to the Total category. Request a specific `category`
for another tab, or `category=all` for an intentional multi-category export.
`view=scoreboard` omits planet tactical details when only player scores are needed.

`GET /transactions/:hash/status` distinguishes submitted, confirmed, applied and
reverted. A successful receipt is not proof that the index has applied it.
Known transactions with indexed events avoid RPC: they remain `confirmed` until
the durable resource-projection watermark proves their block was fully scanned and
materialized at the current revision, then become `applied`. Transactions without
indexed events still need receipt checks, comparing exact log identities/content
and that watermark within a consistent read. A process-local cursor or matching
log count is insufficient; an unknown hash is not proof of success.

Gameplay hydration, including Supply, must not fall back to RPC on a user read.
Cold or unsafe indexed state returns a retryable unavailable response. Existing
unproven transaction-status receipt checks and active-war attack preflight are separate RPC
exceptions: the compact index does not yet contain everything those checks need.
Do not replace them with a guessed confirmation or permissive attack decision.

Chain notifications are published after specialized history scans and the durable
projection checkpoint. Failed scans retain notification intent for a later
successful pass. Known complete wallet/planet scopes allow narrower frontend
invalidation; unknown/global events remain conservative. Do not treat optional
resource hints as an exhaustive list of effects.

Timed-missile history checkpoints include the verified block hash. On restart,
a matching canonical hash permits a bounded overlap scan; missing, malformed,
unanchored, or changed checkpoints require full verification from the configured
upgrade block. Incremental scans reuse the generic scan's Game logs and fetch
only the missing prefix. A head change or failed scan cannot advance the checkpoint.
Old databases still need one successful full verification; this does not bypass
missing/pruned RPC history or other readiness checks.

## Workers and caches

The RPC transport spaces request starts, not response completion. Independent reads
overlap; identical in-flight reads share work even beyond the successful-value TTL.
The HTTP deadline covers the response body too. Single and batch reads share retry
and fallback handling; submissions and mixed write batches are never replayed.
Cache hits inspect only their own entry. New work periodically sweeps expired
values rather than scanning the entire cache for every lookup.

[index.ts](../apps/backend/src/index.ts) supervises the process pool;
[workerPool.ts](../apps/backend/src/workerPool.ts) defines sizing and forwarding.
In multi-worker mode, one writer owns ingestion and serves its private loopback
listener. Readers serve the public port, read the shared WAL database, and forward
mutating requests and SSE to the writer. A single-worker deployment combines roles.

The default worker limit is two. Explicit sizing is bounded by configured caps,
hardware concurrency and the hard ceiling in `workerPool.ts`; do not assume that
adding readers increases SQLite write throughput. Configure signer services
deliberately so multiple deployments/services cannot race the same nonce stream.

Gameplay HTTP responses default to `no-store`. Only an explicit informational
allowlist (rankings, stats, CCA, raid-finder and universe lists) uses response caching.
Retained versioned caches observe committed state across processes; clearing only
the writer's memory cannot make reader caches fresh. View/filter/pagination options
belong in cache identity. Cold and stale refreshes share one local promise and an
owner-token lease per key; unrelated keys remain independent. An expired owner
cannot release its replacement's lease. Cold callers briefly wait for a peer and
receive retryable `503 cache_refresh_pending` if that peer still owns the work;
stale informational reads return immediately. Failed refreshes release waiting
callers and ownership. Do not add stale-while-revalidate gameplay behavior to hide
an indexing problem.

## Efficient read models

Planet and moon state are separate bodies, even when they share a coordinate/parent planet ID.
Keep `bodyKind`, moon-generation identity, resources, units and queues isolated. Destruction and
recreation must not revive an earlier moon's events. Missing history for a funded moon is an indexing
problem, not permission to zero it or copy its parent balances. Jump Gate movement uses moon ships.

- Preserve separate gameplay endpoints. A focused supply batch is appropriate;
  fetching every planet section for every refresh is not.
- Supply reads launchable `{id, count}` ship inventory directly from the index,
  sharing queue-completion rules without building and discarding catalog rows.
- Battle-report defender composition also reads counts directly, but uses display
  timing rules, not Supply's launchable inventory rules.
- Summary/list reads should avoid constructing detail that is immediately discarded.
  Full detail remains separately available when consumers need it.
- Alliance summaries avoid foreign roster hydration; member scores are calculated
  once and reused in totals. Public alliance invite aggregates are scoped.
- Player headers reuse the ranked leaderboard entry, including moon-aware score
  calculation; unranked wallets retain the direct-score fallback.
- Battle lists paginate durable report rows using the ordered index, excluding ACS
  aliases before pagination. Do not return to scanning raw history per list request.
- Global active counts share the same visibility rules as full mission rows,
  including time/randomness handling; a naive SQL status count is not equivalent.

Read-model changes require backend tests and frontend consumer checks. Useful
regressions live in `indexer.test.ts`, `server.test.ts`, and `chainSync.test.ts`.

## Operations

Use [Development](development.md#index-repair) for explicit replay/repair and
[Deployment](deployment.md) for startup/readiness. Repair is an operator action,
not a frontend request side effect or an automatic periodic full-state sweep.
See the [randomness guide](randomness-engine.md) and
[battle keeper guide](../apps/battle-keeper/README.md) for their distinct roles.
