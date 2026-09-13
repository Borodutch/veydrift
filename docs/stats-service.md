# Isolated stats service

`apps/stats/scripts/serve.mjs` serves the stats frontend and `/api/stats`. In API mode,
only its short-lived `snapshot-worker.mjs` child opens the backend SQLite database,
**read-only**. The web server serves a completed JSON snapshot, including while the
worker refreshes, fails, catches up, or reconciles a reorg. The unused synchronous
`SettlementIndexer.publicStatsSnapshot` entry point is removed; no game API route
or game frontend calls the stats builder.

The stats frontend uses its same-origin `/api/stats` by default. Its existing
`VITE_VEYDRIFT_STATS_API_URL` override must point only at the isolated stats API,
never the game API. A frontend-only stats service uses
`VEYDRIFT_STATS_UPSTREAM_URL` to proxy the isolated stats API and does not spawn a
worker or open any database.

## Metrics and timestamp semantics

- Legacy decimal numbers/strings and JSON-RPC hexadecimal timestamps and block
  numbers are normalized in TypeScript, not SQLite integer casts. Invalid, partial,
  negative, unsafe, and unrepresentable timestamps cannot win coverage/daily buckets.
- UTC is canonical for the public service: one 30-day snapshot, not per-viewer jobs.
  The offline test helper also supports a fixed UTC offset.
- Daily **Fleets launched** counts `FleetMissionLaunched` events. Daily **Battles
  resolved** counts distinct case-insensitive transaction hashes emitting
  `AttackBattleResolved`, matching the existing battle summary's semantics.
- Canonical mission/player/planet/alliance totals retain migrated entities without
  corresponding launch/join events. They are mirrored from existing state tables;
  only the private stats database performs their count/active-player queries.
- The UI shows both snapshot generation time and latest indexed event time. Polling
  every 30 seconds does not imply that another event was emitted every 30 seconds.

## Bounded work and recovery

The private stats SQLite store contains compact normalized event contributions,
transaction reference counts per aggregation scope, counters, first joins, compact
canonical entities, cursors, and the last completed JSON snapshot. It does **not**
copy raw historical event JSON. Exact transaction reference counts permit removal,
restoration and edits without double counting.

Every source read is a rowid keyset range or a last-row seek. There is no source
`COUNT`, `DISTINCT`, grouping, JSON extraction, numeric-block sort, `OFFSET`, schema
migration, new source index, or source trigger. Rowid, not block number, advances
ingestion: out-of-order old-block backfills and arbitrarily large blocks cannot
starve or skip rows. Source queries fully consume bounded `.all()` results; no
unfinished source iterator holds a WAL reader while the private projection writes.

For configured event batch size **B**, a pass reads at most:

- **3 × B event rows**: append batch, rolling historical audit, and a recent rowid
  tail of width B once caught up. Default worst-case: 15,000 event rows.
- **3 × min(B, 1000) rows from each of five canonical tables**: players, planets,
  missions, alliances and player activity. Default worst-case: 15,000 small scalar
  rows total. Counts and activity-window predicates run only on the private store.
- Constant-size source schema/reorg metadata and last-row seeks.

The local audit side is bounded independently, so a large deleted source gap cannot
cause an unbounded private reconciliation batch. `INSERT OR REPLACE` canonical
entities retain their unique identity even when their rowid moves. A pass publishes
only after all append cursors catch up; marked-reorg reconciliation also holds the
last good snapshot until the event historical audit completes. All private updates,
progress and publication commit in one `BEGIN IMMEDIATE` transaction. Overlapping
workers serialize or fail with a bounded busy timeout; they cannot double-advance a
cursor. A crashed/killed worker rolls back and retries from the committed cursor.

`reorgDetectedAt` accelerates the historical audit, but existing backend restorations
and some repairs do not update that marker. Therefore:

- Recent-row in-place mutations are rechecked on the next normal refresh.
- Older silent edits/deletions/restorations are eventually reconciled by the rolling
  audit, not claimed to be instantly observable without a backend change journal.
  At 1,154,189 densely numbered events, B=5000 and 60-second refresh, an uninterrupted
  historical sweep is about **232 minutes**, plus worker execution time. Deletion
  gaps or continued writes can lengthen it. Health reports `auditCursor` and
  `lastAuditCompletedAt`; monitor these, not just the generation timestamp.
- Canonical entity edits have the analogous bounded audit delay (1000 rows/pass per
  table by default); production-sized 10,000-player fixtures take roughly ten normal
  ticks for a silent edit to an old player. No game/backend request is added to make
  analytics immediately consistent.

Source path/device/inode changes, a regressed source high-water mark, or an
incompatible private projection version rebuild only private derived state. The
last good snapshot survives until catch-up completes. In-place source replacement
with the same identity/high-water is eventually found by audits. Do not delete or
truncate production data to repair stats.

## Parent-owned Easypanel rollout

Deploy **only the existing Easypanel-managed `veydrift/stats-api` and `veydrift/stats`
services**, as identified in the parent's production baseline. Use the existing Nixpacks stats
configuration. No game backend/frontend, indexer, contract, Docker/Swarm management,
or production DB mutation is required by this change. Keep the canonical ticket
`in-review` for review/deploy readiness; parent moves it to `testing` after rollout
and leaves it there until live UI QA passes.

API service settings:

| Setting | Default / requirement |
| --- | --- |
| `VEYDRIFT_INDEX_DB_PATH` | Existing backend SQLite directory mount, including WAL/SHM companions; app-level read-only (parent observed the existing bind itself is RW); default `/app/apps/backend/.data/contract-state.sqlite` |
| `VEYDRIFT_STATS_DB_PATH` | **New durable private writable stats volume**; recommended `/app/apps/stats/.data/stats.sqlite`; default relative `.data/stats.sqlite` |
| `VEYDRIFT_STATS_BATCH_SIZE` | `5000`, allowed integer 1–10000 |
| `VEYDRIFT_STATS_REFRESH_MS` | `60000`, integer >= 1000; delay after a completed normal pass |
| `VEYDRIFT_STATS_CATCHUP_MS` | `1000`, integer >= 250; throttled delay between bounded pending passes |
| `VEYDRIFT_STATS_WORKER_TIMEOUT_MS` | `120000`, integer >= 1000; worker is killed on timeout and last-good remains served |
| `VEYDRIFT_STATS_SEED_SNAPSHOT_PATH` | Optional first-rollout bridge: JSON captured from the **existing stats** `/api/stats`, saved on the private stats volume before deployment |
| `VEYDRIFT_STATS_UPSTREAM_URL` | **Unset on API**; preserve the stats frontend's existing isolated-stats upstream |

Keep one API replica for the expected read budget. Any overlapping rollout workers
must share the same local POSIX private volume; independent volumes would each
bootstrap from history. Do not place SQLite WAL storage on NFS. The worker rejects
using the backend DB itself as its writable stats file, including symlinks/hardlinks.
Retain the private volume across deploys/restarts. Storage grows with history to
preserve exact totals; provide free-space headroom for WAL and future events.

First deployment from the old in-memory-only service otherwise returns warming 503
until bootstrap finishes. **Before replacing it**, parent captures its current stats
JSON to the new private volume and sets the optional seed path. The new API then
serves that explicitly old snapshot (with its original timestamps) while bootstrapping.
After the first successful result, SQLite persistence takes precedence over the seed
on every restart. New chart fields safely render zero for an old seed; deploy API
first and the stats frontend only after fresh fields are verified.

Required parent verification:

1. Record backend request p50/p95/p99, wallet mission-route p95, indexer event p95,
   writer readiness/backlog/RPC subscription state, disk/WAL size before deployment.
2. Confirm stats API managed source/build SHA, private mount ownership/writability,
   unchanged backend mount and application-level read-only access, single replica and preserved contract labels.
3. Watch `/health` cursor progress and errors through bootstrap. Confirm `/api/stats`
   remains responsive with last-good JSON during pending work and a service restart.
4. Compare latest valid indexed event timestamp/block with API coverage; inspect both
   new daily arrays against corresponding launch/battle events. Verify current hex
   timestamps no longer appear as zero. No new source scan is needed per request.
5. Deploy stats frontend; inspect 7/14/30-day fleet/battle controls, tooltip/keyboard
   interaction and narrow layouts. Capture fresh live screenshots for the ticket.
6. Repeat the same production health/latency window, including during bootstrap;
   confirm no backend/indexer regression and no duplicate stats reader. Keep `testing`
   until live UI QA passes. Rollback only affected managed stats services/configuration,
   preserving the private snapshot volume and all source data.

## Local verification

```sh
bun test apps/backend/src/stats.test.ts apps/stats/scripts/snapshot-worker.test.ts
bun test apps/stats/scripts/snapshot-worker.test.ts --rerun-each 10
bun run test:backend
bun run check:backend
bun run check:stats
bun scripts/veydrift-stats-benchmark.ts
```

The benchmark creates only synthetic temporary DBs: 1,154,189 ~850-byte events,
192,365 transactions, 10,000 players, 50,000 planets and 100,000 canonical missions.
It verifies full bootstrap counts, bounded idle work, a 100-event delta and a
persisted restart. Source query plans must use integer-primary-key seeks. SQLite
labels the `ORDER BY rowid DESC LIMIT 1` high-water plan `SCAN`, but its included
bytecode is `Last → Rowid → ResultRow → DecrJumpZero → Halt`: one row, not history.
EXPLAIN statements are explicitly finalized so benchmark instrumentation itself
cannot pin a stale WAL snapshot.

Worker tests execute real independent Bun processes, persisted SQLite and the actual
server fetch handler. Handler tests avoid the host's localhost HTTP proxy route;
upstream routing is stubbed and asserted. They are **not** browser/socket/live QA.
Local SSD synthetic performance does not replace the parent's before/after production
measurements. See [recorded benchmark evidence](stats-service-benchmark.json).

Recorded local result for the final implementation: 231 bootstrap passes / 28.73s
unthrottled; idle p50 36.44ms / p95 40.27ms (20 samples, 20,000 bounded source rows);
100-event delta 39.31ms (20,100 source rows); persisted restart 38.92ms with zero
changed events. Default hard cap is 30,000 source rows per pass. Source fixture was
1.46GB and private store 522MB; allow at least several GB of durable private capacity
plus growth/WAL headroom. Default throttling adds ~230 seconds and child startup
cost to initial bootstrap, so budget minutes, not 28 seconds, for the first rollout.
