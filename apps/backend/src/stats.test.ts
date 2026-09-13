import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { buildPublicStatsSnapshot, normalizeStatsUtcOffsetMinutes, normalizeStatsInteger, initializeStatsStore, refreshPublicStats, readPersistedStatsSnapshot } from "./stats";

const firstPlanetSettledTopic = "0x1f673e84fe49fdcd9930a486d10cac412437f89541987902f82b43a93d86cf1c";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";

function eventJson(address: string, timestamp: number | string, topic: string, player?: string): string {
  const topics = [topic];
  if (player) topics.push(`0x${"0".repeat(24)}${player.slice(2).toLowerCase()}`);
  return JSON.stringify({
    address,
    blockNumber: "100",
    blockTimestamp: String(timestamp),
    topics
  });
}

function createStatsDatabase(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE indexed_event_logs (
      event_id TEXT PRIMARY KEY,
      transaction_hash TEXT NOT NULL,
      log_index TEXT NOT NULL,
      block_number TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,
      event_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE TABLE contract_players (wallet TEXT PRIMARY KEY);
    CREATE TABLE contract_planets (planet_id TEXT PRIMARY KEY);
    CREATE TABLE contract_fleet_missions (mission_id TEXT PRIMARY KEY);
    CREATE TABLE contract_alliances (alliance_id TEXT PRIMARY KEY, active INTEGER NOT NULL);
    CREATE TABLE indexed_player_activity (
      wallet TEXT PRIMARY KEY,
      last_active_at TEXT NOT NULL,
      event_id TEXT NOT NULL
    );
  `);
  return db;
}

describe("public stats snapshot", () => {
  test("aggregates canonical state, unique transactions, contracts, events, and player joins", () => {
    const db = createStatsDatabase();
    const now = Date.UTC(2026, 6, 28, 12) / 1_000;
    const game = "0x1111111111111111111111111111111111111111";
    const player = "0x2222222222222222222222222222222222222222";
    const insert = db.query(`
      INSERT INTO indexed_event_logs
        (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `);
    insert.run("a", "0xaaa", "0", "100", eventJson(game, now - 100, firstPlanetSettledTopic, player), "");
    insert.run("b", "0xbbb", "0", "101", eventJson(game, now - 50, attackBattleResolvedTopic), "");
    insert.run("c", "0xbbb", "1", "101", eventJson(game, now - 50, attackBattleResolvedTopic), "");
    db.exec(`
      INSERT INTO contract_players VALUES ('${player}');
      INSERT INTO contract_planets VALUES ('1');
      INSERT INTO contract_planets VALUES ('2');
      INSERT INTO contract_fleet_missions VALUES ('7');
      INSERT INTO contract_alliances VALUES ('9', 1);
      INSERT INTO indexed_player_activity VALUES ('${player}', '${now - 10}', 'c');
    `);

    const stats = buildPublicStatsSnapshot(db, [{ address: game, label: "Game" }], now);

    expect(stats.summary).toMatchObject({
      players: 1,
      newPlayers24h: 1,
      newPlayers7d: 1,
      activePlayers24h: 1,
      activePlayers7d: 1,
      planets: 2,
      colonies: 1,
      transactions: 2,
      events: 3,
      fleetMissions: 1,
      battles: 1,
      alliances: 1
    });
    expect(stats.contracts[0]).toMatchObject({ label: "Game", transactions: 2, events: 3 });
    expect(stats.daily.at(-1)).toMatchObject({ transactions: 2, events: 3, newPlayers: 1 });
    expect(stats.coverage).toMatchObject({ fromBlock: 100, throughBlock: 101 });
  });

  test("uses the browser UTC offset for local-midnight daily buckets", () => {
    const db = createStatsDatabase();
    const now = Date.UTC(2026, 6, 29, 1, 21) / 1_000;
    const game = "0x1111111111111111111111111111111111111111";
    const player = "0x2222222222222222222222222222222222222222";
    const insert = db.query(`
      INSERT INTO indexed_event_logs
        (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `);
    insert.run(
      "previous-local-day",
      "0xaaa",
      "0",
      "100",
      eventJson(game, Date.UTC(2026, 6, 28, 6, 59) / 1_000, attackBattleResolvedTopic),
      ""
    );
    insert.run(
      "local-day-before-utc-midnight",
      "0xbbb",
      "0",
      "101",
      eventJson(game, Date.UTC(2026, 6, 28, 7, 1) / 1_000, attackBattleResolvedTopic),
      ""
    );
    insert.run(
      "local-day-after-utc-midnight",
      "0xccc",
      "0",
      "102",
      eventJson(game, Date.UTC(2026, 6, 29, 0, 30) / 1_000, firstPlanetSettledTopic, player),
      ""
    );

    const localStats = buildPublicStatsSnapshot(db, [{ address: game, label: "Game" }], now, -420);
    expect(localStats.utcOffsetMinutes).toBe(-420);
    expect(localStats.daily).toHaveLength(30);
    expect(localStats.daily.at(-1)).toMatchObject({
      date: "2026-07-28",
      transactions: 2,
      events: 2,
      newPlayers: 1
    });
    expect(localStats.daily.at(-2)).toMatchObject({
      date: "2026-07-27",
      transactions: 1,
      events: 1,
      newPlayers: 0
    });

    const utcStats = buildPublicStatsSnapshot(db, [{ address: game, label: "Game" }], now, 0);
    expect(utcStats.daily.at(-1)).toMatchObject({
      date: "2026-07-29",
      transactions: 1,
      events: 1,
      newPlayers: 1
    });
  });

  test("rejects invalid UTC offsets", () => {
    expect(normalizeStatsUtcOffsetMinutes(-420)).toBe(-420);
    expect(normalizeStatsUtcOffsetMinutes(840)).toBe(840);
    expect(normalizeStatsUtcOffsetMinutes(841)).toBe(0);
    expect(normalizeStatsUtcOffsetMinutes(1.5)).toBe(0);
  });
});


const missionTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const game = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const now = Date.UTC(2026, 8, 13, 3) / 1000;
function append(db: Database, id: string, timestamp: number | string = now, topic = missionTopic, tx = id, block = "100") {
  db.query("INSERT INTO indexed_event_logs VALUES (?, ?, '0x1', ?, 0, ?, '')").run(id, tx, block, eventJson(game, timestamp, topic, wallet));
}
function projection() {
  const source = createStatsDatabase();
  const store = new Database(":memory:");
  initializeStatsStore(store);
  const tick = (batchSize = 2) => refreshPublicStats(source, store, [], { sourceId: "test", batchSize, nowSeconds: now });
  return { source, store, tick };
}

describe("incremental stats", () => {
  test("normalizes decimal numbers/strings and JSON-RPC quantities without partial casts", () => {
    for (const input of [now, String(now), `0x${now.toString(16)}`, `0X${now.toString(16).toUpperCase()}`]) expect(normalizeStatsInteger(input)).toBe(now);
    for (const input of [null, undefined, "", "123junk", "0x", "-1", -1, 1.2, "1e9", "Infinity", "9007199254740993"]) expect(normalizeStatsInteger(input)).toBe(0);
  });

  test("fresh coverage and daily fleet/battle buckets include mixed encodings, not removed rows", () => {
    const { source, store, tick } = projection();
    append(source, "old", now - 86400, firstPlanetSettledTopic);
    append(source, "launch", `0x${now.toString(16)}`, missionTopic, "0xABC", "0xa9");
    append(source, "battle-1", String(now), attackBattleResolvedTopic, "0xBEE", "0xa9");
    append(source, "battle-2", `0x${now.toString(16)}`, attackBattleResolvedTopic, "0xbee", "169");
    append(source, "removed", now + 100000, missionTopic, "removed", "999");
    source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE event_id = 'removed'");
    let result;
    do { result = tick(); } while (result.pending);
    expect(result.snapshot?.coverage).toEqual({ fromBlock: 100, throughBlock: 169, fromTimestamp: now - 86400, throughTimestamp: now });
    expect(result.snapshot?.daily.at(-1)).toMatchObject({ events: 3, transactions: 2, fleetMissions: 1, battles: 1 });
    expect(result.snapshot?.daily.at(-2)).toMatchObject({ newPlayers: 1 });
    expect(result.snapshot?.summary).toMatchObject({ events: 4, transactions: 3, battles: 1 });
    expect(tick().changedRows).toBe(0);
    source.close(); store.close();
  });

  test("never skips same-block batches, removed prefixes, late old blocks or repeated selectors", () => {
    const { source, store, tick } = projection();
    for (let i = 0; i < 25; i++) append(source, `e${i}`, now, missionTopic, `tx${Math.floor(i / 3)}`, i % 2 ? "0x9d" : "157");
    source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE rowid <= 9");
    let result;
    let ticks = 0;
    do { result = tick(3); expect(result.sourceRows).toBeLessThanOrEqual(9); ticks++; } while (result.pending);
    expect(ticks).toBe(9);
    expect(result.snapshot?.summary).toMatchObject({ events: 16, transactions: 6 });
    append(source, "backfill", now - 10 * 86400, missionTopic, "newtx", "1");
    expect(tick(3).snapshot?.coverage.fromBlock).toBe(1);
    for (let i = 0; i < 12; i++) {
      result = tick(3);
      expect(result.changedRows).toBe(0);
      expect(result.snapshot?.summary.events).toBe(17);
    }
    source.close(); store.close();
  });

  test("rolling bounded audit repairs old removals, restores, edits and physical deletions", () => {
    const { source, store, tick } = projection();
    for (let i = 0; i < 12; i++) append(source, `e${i}`, now, missionTopic, "shared");
    while (tick().pending) { /* bounded bootstrap */ }
    source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE event_id = 'e0'; DELETE FROM indexed_event_logs WHERE event_id = 'e2'");
    source.query("UPDATE indexed_event_logs SET event_json = ? WHERE event_id = 'e1'").run(eventJson(game, `0x${(now - 86400).toString(16)}`, attackBattleResolvedTopic));
    let result = tick();
    for (let i = 0; i < 12; i++) { result = tick(); expect(result.sourceRows).toBeLessThanOrEqual(6); }
    expect(result.snapshot?.summary).toMatchObject({ events: 10, transactions: 1, battles: 1 });
    expect(result.snapshot?.daily.at(-2)).toMatchObject({ battles: 1, fleetMissions: 0 });
    source.exec("UPDATE indexed_event_logs SET removed = 0 WHERE event_id = 'e0'");
    for (let i = 0; i < 12; i++) result = tick();
    expect(result.snapshot?.summary.events).toBe(11);
    source.close(); store.close();
  });

  test("last-good snapshot remains unchanged during backlog and marked reorg reconciliation", () => {
    const { source, store, tick } = projection();
    source.exec("CREATE TABLE indexer_metadata (key TEXT PRIMARY KEY, value TEXT)");
    for (let i = 0; i < 6; i++) append(source, `e${i}`);
    while (tick().pending) { /* bootstrap */ }
    const good = readPersistedStatsSnapshot(store);
    for (let i = 6; i < 12; i++) append(source, `e${i}`);
    expect(tick()).toMatchObject({ pending: true, snapshot: good });
    while (tick().pending) { /* catch up */ }
    const beforeReorg = readPersistedStatsSnapshot(store);
    source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE event_id = 'e0'; INSERT INTO indexer_metadata VALUES ('reorgDetectedAt', 'new')");
    expect(tick()).toMatchObject({ pending: true, snapshot: beforeReorg });
    let result;
    do { result = tick(); } while (result.pending);
    expect(result.snapshot?.summary.events).toBe(11);
    source.close(); store.close();
  });

  test("first join moves correctly after removal and invalid timestamps cannot win coverage", () => {
    const { source, store, tick } = projection();
    append(source, "first", now - 86400, firstPlanetSettledTopic);
    append(source, "second", `0x${now.toString(16)}`, firstPlanetSettledTopic);
    append(source, "invalid", "123junk", firstPlanetSettledTopic);
    while (tick().pending) { /* bootstrap */ }
    source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE event_id = 'first'");
    tick(); tick();
    const result = tick();
    expect(result.snapshot?.coverage.fromTimestamp).toBe(now);
    expect(result.snapshot?.daily.at(-1)?.newPlayers).toBe(1);
    expect(result.snapshot?.daily.at(-2)?.newPlayers).toBe(0);
    source.close(); store.close();
  });

  test("a failed batch rolls back cursor, contributions and publication, then retries cleanly", () => {
    const { source, store, tick } = projection();
    append(source, "good"); tick();
    const before = readPersistedStatsSnapshot(store);
    append(source, "next"); append(source, "bad");
    source.exec("UPDATE indexed_event_logs SET event_json = 'not json' WHERE event_id = 'bad'");
    expect(() => tick()).toThrow();
    expect(readPersistedStatsSnapshot(store)).toEqual(before);
    source.query("UPDATE indexed_event_logs SET event_json = ? WHERE event_id = 'bad'").run(eventJson(game, now, missionTopic));
    expect(tick().snapshot?.summary.events).toBe(3);
    source.close(); store.close();
  });

  test("source replacement preserves old snapshot until private rebuild catches up", () => {
    const { source, store, tick } = projection();
    for (let i = 0; i < 5; i++) append(source, `old${i}`);
    while (tick().pending) { /* bootstrap */ }
    const before = readPersistedStatsSnapshot(store);
    source.exec("DELETE FROM indexed_event_logs");
    for (let i = 0; i < 3; i++) append(source, `new${i}`);
    const options = { sourceId: "replacement", batchSize: 2, nowSeconds: now };
    expect(refreshPublicStats(source, store, [], options)).toMatchObject({ pending: true, snapshot: before });
    expect(refreshPublicStats(source, store, [], options).snapshot?.summary.events).toBe(3);
    source.close(); store.close();
  });
});


test("recent restorations without a reorg marker repair on the next bounded tick", () => {
  const { source, store, tick } = projection();
  for (let i = 0; i < 20; i++) append(source, `e${i}`);
  while (tick().pending) { /* bootstrap */ }
  source.exec("UPDATE indexed_event_logs SET removed = 1 WHERE event_id = 'e19'");
  expect(tick().snapshot?.summary.events).toBe(19);
  source.exec("UPDATE indexed_event_logs SET removed = 0 WHERE event_id = 'e19'");
  expect(tick().snapshot?.summary.events).toBe(20);
  source.close(); store.close();
});

test("canonical state uses bounded persisted batches and preserves migrated totals across replacements", () => {
  const { source, store, tick } = projection();
  for (let i = 0; i < 11; i++) {
    source.query("INSERT INTO contract_players VALUES (?)").run(`p${i}`);
    source.query("INSERT INTO contract_planets VALUES (?)").run(`planet${i}`);
    source.query("INSERT INTO contract_fleet_missions VALUES (?)").run(`m${i}`);
    source.query("INSERT INTO contract_alliances VALUES (?, 1)").run(`a${i}`);
    source.query("INSERT INTO indexed_player_activity VALUES (?, ?, '')").run(`p${i}`, String(now - 20 * 86400));
  }
  let result;
  do {
    result = tick(2);
    expect(result.sourceRows).toBeLessThanOrEqual(3 * 2 * 6);
  } while (result.pending);
  expect(result.snapshot?.summary).toMatchObject({ players: 11, planets: 11, fleetMissions: 11, alliances: 11, activePlayers24h: 0 });
  source.exec("INSERT OR REPLACE INTO contract_fleet_missions VALUES ('m0'); DELETE FROM contract_planets WHERE planet_id = 'planet2'; UPDATE contract_alliances SET active = 0 WHERE alliance_id = 'a0'");
  source.query("UPDATE indexed_player_activity SET last_active_at = ? WHERE wallet = 'p0'").run(`0x${now.toString(16)}`);
  for (let i = 0; i < 12; i++) result = tick(2);
  expect(result.snapshot?.summary).toMatchObject({ players: 11, planets: 10, fleetMissions: 11, alliances: 10, activePlayers24h: 1 });
  source.close(); store.close();
});
