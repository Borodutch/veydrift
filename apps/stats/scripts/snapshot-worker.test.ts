import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeStatsStore, refreshPublicStats, readPersistedStatsSnapshot } from "../../backend/src/stats";

const workerPath = new URL("./snapshot-worker.mjs", import.meta.url).pathname;
const serverPath = new URL("./serve.mjs", import.meta.url).pathname;
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "stats-worker-test-"));
  const sourcePath = join(directory, "source.sqlite");
  const storePath = join(directory, "stats.sqlite");
  const source = new Database(sourcePath, { create: true, readwrite: true });
  source.exec(`
    CREATE TABLE indexed_event_logs(event_id TEXT PRIMARY KEY, transaction_hash TEXT, log_index TEXT, block_number TEXT, removed INTEGER, event_json TEXT, received_at TEXT);
    CREATE TABLE contract_players(wallet TEXT PRIMARY KEY);
    CREATE TABLE contract_planets(planet_id TEXT PRIMARY KEY);
    CREATE TABLE contract_fleet_missions(mission_id TEXT PRIMARY KEY);
    CREATE TABLE contract_alliances(alliance_id TEXT PRIMARY KEY, active INTEGER);
    CREATE TABLE indexed_player_activity(wallet TEXT PRIMARY KEY, last_active_at TEXT, event_id TEXT);
  `);
  for (let i = 1; i <= 12; i++) source.query("INSERT INTO indexed_event_logs VALUES (?, ?, '0x0', ?, 0, ?, '')").run(
    `e${i}`, `0x${i}`, `${i}`, JSON.stringify({ address: "0xabc", topics: ["0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456"], blockTimestamp: "0x6aa60f75" })
  );
  source.close();
  const env = { ...process.env, VEYDRIFT_INDEX_DB_PATH: sourcePath, VEYDRIFT_STATS_DB_PATH: storePath,
    VEYDRIFT_STATS_BATCH_SIZE: "3", VEYDRIFT_STATS_UPSTREAM_URL: "" };
  return { directory, sourcePath, storePath, env };
}
async function worker(env: Record<string, string | undefined>) {
  const process = Bun.spawn([Bun.which("bun")!, workerPath], { env, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (code !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}
// Exercise Bun's actual server fetch handler in a fresh process without routing localhost
// through host HTTP proxies. This is handler/lifecycle evidence, not browser or socket QA.
async function serverRequest(env: Record<string, string | undefined>, mockUpstream = false, waitForRefresh = false) {
  const script = `
    const calls = [];
    ${mockUpstream ? 'globalThis.fetch = async (url) => { calls.push(url); return Response.json({test:"isolated-stats"}); };' : ''}
    const { server, stopStatsServer } = await import(${JSON.stringify(serverPath)});
    try {
      ${waitForRefresh ? 'for (let i = 0; i < 100; i++) { const h = await (await server.fetch(new Request("http://localhost/health"))).json(); if (!h.refreshing) break; await Bun.sleep(20); }' : ''}
      const response = await server.fetch(new Request("http://localhost/api/stats"));
      const health = await server.fetch(new Request("http://localhost/health"));
      console.log(JSON.stringify({status:response.status, body:await response.json(), health:await health.json(), calls}));
    } finally { stopStatsServer(); }
  `;
  const process = Bun.spawn([Bun.which("bun")!, "-e", script], { env: { ...env, PORT: "0" }, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (code !== 0) throw new Error(stderr);
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

test("independent concurrent workers serialize persisted cursors and restart without recounting", async () => {
  const f = fixture();
  try {
    await worker(f.env); // create schema before exercising simultaneous writer transactions
    const results = await Promise.all([worker(f.env), worker(f.env)]);
    expect(results.map((r) => r.cursor).sort((a,b) => a-b)).toEqual([6, 9]);
    const completed = await worker(f.env);
    expect(completed).toMatchObject({ pending: false, cursor: 12 });
    expect(completed.snapshot.summary.events).toBe(12);
    const restarted = await worker(f.env);
    expect(restarted.changedRows).toBe(0);
    expect(restarted.sourceRows).toBeLessThanOrEqual(9);
    const store = new Database(f.storePath, { readonly: true });
    expect(readPersistedStatsSnapshot(store)?.summary.events).toBe(12); store.close();
    const source = new Database(f.sourcePath, { readonly: true });
    expect(source.query("SELECT COUNT(*) AS n FROM indexed_event_logs").get()).toEqual({ n: 12 });
    expect(source.query("SELECT name FROM sqlite_master WHERE name LIKE 'stats_%'").all()).toEqual([]); source.close();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
}, 15000);

test("server restart handler serves last-good stats immediately while source is missing", async () => {
  const f = fixture();
  try {
    const ready = await worker({ ...f.env, VEYDRIFT_STATS_BATCH_SIZE: "100" });
    renameSync(f.sourcePath, `${f.sourcePath}.unavailable`);
    const result = await serverRequest(f.env, false, true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(ready.snapshot);
    expect(result.health).toMatchObject({ ok: true, refreshing: false });
    expect(result.health.snapshotError).toBeString();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
}, 15000);

test("proxy handler uses only the stats upstream and does not spawn a database worker", async () => {
  const result = await serverRequest({ ...process.env, VEYDRIFT_STATS_UPSTREAM_URL: "https://stats-api.example.test",
    VEYDRIFT_INDEX_DB_PATH: "/does/not/exist", VEYDRIFT_STATS_DB_PATH: "/does/not/exist/stats.sqlite" }, true);
  expect(result.body).toEqual({ test: "isolated-stats" });
  expect(result.calls).toEqual(["https://stats-api.example.test/api/stats"]);
  expect(result.health).toMatchObject({ ok: true, upstream: "https://stats-api.example.test" });
}, 15000);

test("worker rejects persistence pointing at the source without modifying its schema", async () => {
  const f = fixture();
  try {
    await expect(worker({ ...f.env, VEYDRIFT_STATS_DB_PATH: f.sourcePath })).rejects.toThrow("must not use the backend database");
    const source = new Database(f.sourcePath, { readonly: true });
    expect(source.query("SELECT name FROM sqlite_master WHERE name LIKE 'stats_%'").all()).toEqual([]); source.close();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
}, 15000);


test("reused read-only connection sees external WAL commits and releases source read cursors", () => {
  const f = fixture();
  const writer = new Database(f.sourcePath, { readwrite: true });
  writer.exec("PRAGMA journal_mode = WAL; CREATE TABLE indexer_metadata(key TEXT PRIMARY KEY, value TEXT); INSERT INTO indexer_metadata VALUES ('reorgDetectedAt', 'initial')");
  const source = new Database(f.sourcePath, { readonly: true });
  const store = new Database(f.storePath, { create: true, readwrite: true });
  initializeStatsStore(store);
  try {
    const options = { sourceId: "wal", batchSize: 100 };
    expect(refreshPublicStats(source, store, [], options).snapshot?.summary.events).toBe(12);
    writer.exec("INSERT INTO indexed_event_logs SELECT 'external', 'external', log_index, block_number, removed, event_json, received_at FROM indexed_event_logs WHERE event_id = 'e1'");
    expect(refreshPublicStats(source, store, [], options).snapshot?.summary.events).toBe(13);
    const checkpoint = writer.query("PRAGMA wal_checkpoint(TRUNCATE)").all()[0] as { busy: number };
    expect(checkpoint.busy).toBe(0);
  } finally { source.close(); store.close(); writer.close(); rmSync(f.directory, { recursive: true, force: true }); }
});


test("first rollout can serve an explicit old-service seed while the new projection warms", async () => {
  const f = fixture();
  try {
    const seed = { generatedAt: "2026-09-01T00:00:00Z", coverage: {}, summary: { events: 42 }, daily: [] };
    const seedPath = join(f.directory, "last-good.json"); writeFileSync(seedPath, JSON.stringify(seed));
    const result = await serverRequest({ ...f.env, VEYDRIFT_STATS_SEED_SNAPSHOT_PATH: seedPath });
    expect(result.status).toBe(200); expect(result.body).toEqual(seed);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
}, 15000);


test("simultaneous first workers initialize one private WAL store without duplicate ingestion", async () => {
  const f = fixture();
  try {
    const results = await Promise.all([worker(f.env), worker(f.env)]);
    expect(results.map((r) => r.cursor).sort((a,b) => a-b)).toEqual([3, 6]);
    await worker(f.env);
    expect((await worker(f.env)).snapshot.summary.events).toBe(12);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
}, 15000);
