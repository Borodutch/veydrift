import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { buildPublicStatsSnapshot, normalizeStatsUtcOffsetMinutes } from "./stats";

const firstPlanetSettledTopic = "0x1f673e84fe49fdcd9930a486d10cac412437f89541987902f82b43a93d86cf1c";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";

function eventJson(address: string, timestamp: number, topic: string, player?: string): string {
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
