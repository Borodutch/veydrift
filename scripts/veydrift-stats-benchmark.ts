// Run with Bun. Uses only synthetic temporary databases; never opens a production path.
import { Database } from "bun:sqlite";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeStatsStore, refreshPublicStats, statsSourceBatchSql } from "../apps/backend/src/stats";

const rows = Number(process.env.STATS_BENCH_ROWS ?? 1_154_189);
const directory = mkdtempSync(join(tmpdir(), "veydrift-stats-bench-"));
const sourcePath = join(directory, "source.sqlite");
const storePath = join(directory, "stats.sqlite");
const sourceWriter = new Database(sourcePath, { create: true, readwrite: true });
const now = Math.floor(Date.now() / 1000);
console.error(JSON.stringify({ phase: "fixture", directory, rows }));
sourceWriter.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE indexed_event_logs (event_id TEXT PRIMARY KEY, transaction_hash TEXT NOT NULL, log_index TEXT NOT NULL,
    block_number TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, event_json TEXT NOT NULL, received_at TEXT NOT NULL);
  CREATE INDEX indexed_event_logs_block_idx ON indexed_event_logs(block_number);
  CREATE INDEX indexed_event_logs_numeric_block_idx ON indexed_event_logs(removed, CAST(block_number AS INTEGER));
  CREATE INDEX indexed_event_logs_transaction_idx ON indexed_event_logs(transaction_hash);
  CREATE INDEX indexed_event_logs_transaction_state_idx ON indexed_event_logs(lower(transaction_hash), removed);
  CREATE TABLE contract_players(wallet TEXT PRIMARY KEY);
  CREATE TABLE contract_planets(planet_id TEXT PRIMARY KEY);
  CREATE TABLE contract_fleet_missions(mission_id TEXT PRIMARY KEY);
  CREATE TABLE contract_alliances(alliance_id TEXT PRIMARY KEY, active INTEGER);
  CREATE TABLE indexed_player_activity(wallet TEXT PRIMARY KEY, last_active_at TEXT, event_id TEXT);
  CREATE TABLE indexer_metadata(key TEXT PRIMARY KEY, value TEXT);
`);
const insert = sourceWriter.prepare(`WITH RECURSIVE sequence(n) AS (SELECT ? UNION ALL SELECT n+1 FROM sequence WHERE n < ?)
  INSERT INTO indexed_event_logs
  SELECT printf('event-%d', n), printf('0x%064x', n / 6), printf('0x%x', n % 6), CAST(40000000 + n / 10 AS TEXT), 0,
    json_object('address', printf('0x%040x', n % 5), 'blockNumber', printf('0x%x', 40000000+n/10),
      'blockTimestamp', CASE WHEN n % 2 = 0 THEN printf('0x%x', ? - (? - n)*4) ELSE CAST(? - (? - n)*4 AS TEXT) END,
      'topics', json_array(CASE WHEN n % 100 = 0 THEN '0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456'
        WHEN n % 301 = 0 THEN '0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b'
        ELSE '0x8f00000000000000000000000000000000000000000000000000000000000000' END,
        printf('0x%064x', n % 1000)), 'data', '0x' || printf('%0512d', 0)), '' FROM sequence`);
for (let start = 1; start <= rows; start += 10000) sourceWriter.transaction(() => insert.run(start, Math.min(rows, start + 9999), now, rows, now, rows))();
sourceWriter.exec(`
  WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 10000) INSERT INTO contract_players SELECT CAST(x AS TEXT) FROM n;
  WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 50000) INSERT INTO contract_planets SELECT CAST(x AS TEXT) FROM n;
  WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 100000) INSERT INTO contract_fleet_missions SELECT CAST(x AS TEXT) FROM n;
  INSERT INTO indexed_player_activity SELECT wallet, '${now}', 'activity' FROM contract_players;
  INSERT INTO contract_alliances SELECT wallet, 1 FROM contract_players LIMIT 1000;
  PRAGMA wal_checkpoint(TRUNCATE);
`);
const source = new Database(sourcePath, { readonly: true });
source.exec("PRAGMA query_only = ON; PRAGMA cache_size = -8192;");
let store = new Database(storePath, { create: true, readwrite: true });
initializeStatsStore(store);
// Bun's EXPLAIN statement can retain a WAL snapshot even after .all(); always finalize it.
function explain(sql: string, ...bindings: number[]) {
  const statement = source.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  try { return statement.all(...bindings); } finally { statement.finalize(); }
}
const plans = {
  delta: explain(statsSourceBatchSql, rows - 5000, rows, 5000),
  highWater: explain("SELECT rowid FROM indexed_event_logs ORDER BY rowid DESC LIMIT 1"),
  audit: explain(statsSourceBatchSql, 500000, rows, 5000),
  missions: explain("SELECT rowid AS source_rowid, mission_id AS entity_key, 1 AS value FROM contract_fleet_missions WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?", 50000, 100000, 1000),
  activity: explain("SELECT rowid AS source_rowid, wallet AS entity_key, last_active_at AS value FROM indexed_player_activity WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?", 5000, 10000, 1000)
};
const highWaterStatement = source.prepare("EXPLAIN SELECT rowid FROM indexed_event_logs ORDER BY rowid DESC LIMIT 1");
let highWaterBytecode;
try { highWaterBytecode = highWaterStatement.all(); } finally { highWaterStatement.finalize(); }
const timings: number[] = [];
let sourceRows = 0;
let maxSourceRows = 0;
const started = performance.now();
let result;
do {
  const start = performance.now();
  result = refreshPublicStats(source, store, [], { sourceId: sourcePath, nowSeconds: now });
  timings.push(performance.now() - start);
  sourceRows += result.sourceRows;
  maxSourceRows = Math.max(maxSourceRows, result.sourceRows);
  if (timings.length % 25 === 0) console.error(JSON.stringify({ phase: "bootstrap", passes: timings.length, cursor: result.cursor }));
} while (result.pending);
const bootstrapMs = performance.now() - started;
if (result.snapshot?.summary.events !== rows) throw new Error(`Lost events: ${result.snapshot?.summary.events} != ${rows}`);
function percentile(values: number[], p: number) { return [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))]; }
function summarize(values: number[]) { return { samples: values.length, p50Ms: percentile(values,.5), p95Ms: percentile(values,.95), maxMs: Math.max(...values) }; }
const idle: number[] = [];
const idleRows: number[] = [];
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  result = refreshPublicStats(source, store, [], { sourceId: sourcePath, nowSeconds: now });
  idle.push(performance.now() - start); idleRows.push(result.sourceRows);
  if (result.changedRows !== 0 || result.sourceRows > 30000) throw new Error("Idle work is not bounded/idempotent");
}
sourceWriter.transaction(() => insert.run(rows + 1, rows + 100, now, rows + 100, now, rows + 100))();
const deltaStart = performance.now();
result = refreshPublicStats(source, store, [], { sourceId: sourcePath, nowSeconds: now });
const delta = { ms: performance.now()-deltaStart, sourceRows: result.sourceRows, changedRows: result.changedRows, events: result.snapshot?.summary.events };
if (delta.events !== rows + 100 || delta.changedRows !== 100) throw new Error(`Delta count mismatch: ${JSON.stringify(delta)}`);
store.close();
store = new Database(storePath, { readwrite: true }); initializeStatsStore(store);
const restartStart = performance.now();
result = refreshPublicStats(source, store, [], { sourceId: sourcePath, nowSeconds: now });
const restart = { ms: performance.now()-restartStart, sourceRows: result.sourceRows, changedRows: result.changedRows, cursor: result.cursor };
const report = {
  runtime: Bun.version, fixture: { rows, transactions: Math.floor(rows / 6) + 1, players: 10000, planets: 50000, missions: 100000, synthetic: true },
  directory, plans, highWaterBytecode,
  bootstrap: { ms: bootstrapMs, passes: timings.length, sourceRows, maxSourceRows, ...summarize(timings) },
  idle: { ...summarize(idle), maxSourceRows: Math.max(...idleRows), changedRows: 0 }, delta, restart,
  bytes: { source: statSync(sourcePath).size, store: statSync(storePath).size },
  caveat: "Local SSD synthetic fixture, not production latency/health evidence. Source event JSON ~850 bytes; existing ledger indexes, no production data. Bootstrap timings exclude the server's 1s per-pass throttle. Parent must measure backend/indexer before/after stats-only rollout."
};
console.log(JSON.stringify(report, null, 2));
store.close(); source.close(); sourceWriter.close();
