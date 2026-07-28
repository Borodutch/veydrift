import { Database } from "bun:sqlite";
import { eventNameForTopic } from "./evm";

const firstPlanetSettledTopic = "0x1f673e84fe49fdcd9930a486d10cac412437f89541987902f82b43a93d86cf1c";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";

export interface StatsContractDescriptor {
  address: string;
  label: string;
}

export interface PublicStatsSnapshot {
  generatedAt: string;
  coverage: {
    fromBlock: number;
    throughBlock: number;
    fromTimestamp: number;
    throughTimestamp: number;
  };
  summary: {
    players: number;
    newPlayers24h: number;
    newPlayers7d: number;
    activePlayers24h: number;
    activePlayers7d: number;
    planets: number;
    colonies: number;
    transactions: number;
    events: number;
    fleetMissions: number;
    battles: number;
    alliances: number;
  };
  daily: Array<{
    date: string;
    transactions: number;
    events: number;
    newPlayers: number;
  }>;
  contracts: Array<{
    address: string;
    label: string;
    transactions: number;
    events: number;
  }>;
  topEvents: Array<{
    name: string;
    transactions: number;
    events: number;
  }>;
}

interface NumberRow {
  value: number;
}

interface CoverageRow {
  from_block: number;
  through_block: number;
  from_timestamp: number;
  through_timestamp: number;
}

interface DailyRow {
  date: string;
  transactions: number;
  events: number;
  new_players: number;
}

interface ContractRow {
  address: string;
  transactions: number;
  events: number;
}

interface EventRow {
  topic: string;
  transactions: number;
  events: number;
}

function numberValue(db: Database, sql: string, ...bindings: Array<string | number>): number {
  return Number((db.query(sql).get(...bindings) as NumberRow | null)?.value ?? 0);
}

export function buildPublicStatsSnapshot(
  db: Database,
  descriptors: readonly StatsContractDescriptor[],
  nowSeconds = Math.floor(Date.now() / 1_000)
): PublicStatsSnapshot {
  const coverage = db.query(`
    SELECT
      CAST(MIN(CAST(block_number AS INTEGER)) AS INTEGER) AS from_block,
      CAST(MAX(CAST(block_number AS INTEGER)) AS INTEGER) AS through_block,
      CAST(MIN(CAST(json_extract(event_json, '$.blockTimestamp') AS INTEGER)) AS INTEGER) AS from_timestamp,
      CAST(MAX(CAST(json_extract(event_json, '$.blockTimestamp') AS INTEGER)) AS INTEGER) AS through_timestamp
    FROM indexed_event_logs
    WHERE removed = 0
  `).get() as CoverageRow | null;

  const players = numberValue(db, "SELECT COUNT(*) AS value FROM contract_players");
  const planets = numberValue(db, "SELECT COUNT(*) AS value FROM contract_planets");
  const transactions = numberValue(
    db,
    "SELECT COUNT(DISTINCT lower(transaction_hash)) AS value FROM indexed_event_logs WHERE removed = 0"
  );
  const events = numberValue(db, "SELECT COUNT(*) AS value FROM indexed_event_logs WHERE removed = 0");
  const firstPlayerSql = `
    SELECT lower('0x' || substr(json_extract(event_json, '$.topics[1]'), 27)) AS wallet,
      MIN(CAST(json_extract(event_json, '$.blockTimestamp') AS INTEGER)) AS joined_at
    FROM indexed_event_logs
    WHERE removed = 0 AND lower(json_extract(event_json, '$.topics[0]')) = ?
    GROUP BY wallet
  `;
  const newPlayers24h = numberValue(
    db,
    `SELECT COUNT(*) AS value FROM (${firstPlayerSql}) WHERE joined_at >= ?`,
    firstPlanetSettledTopic,
    nowSeconds - 86_400
  );
  const newPlayers7d = numberValue(
    db,
    `SELECT COUNT(*) AS value FROM (${firstPlayerSql}) WHERE joined_at >= ?`,
    firstPlanetSettledTopic,
    nowSeconds - 7 * 86_400
  );

  const daily = db.query(`
    WITH RECURSIVE days(date) AS (
      SELECT date(?, 'unixepoch', '-29 days')
      UNION ALL
      SELECT date(date, '+1 day') FROM days WHERE date < date(?, 'unixepoch')
    ),
    activity AS (
      SELECT date(CAST(json_extract(event_json, '$.blockTimestamp') AS INTEGER), 'unixepoch') AS date,
        COUNT(DISTINCT lower(transaction_hash)) AS transactions,
        COUNT(*) AS events
      FROM indexed_event_logs
      WHERE removed = 0
        AND CAST(json_extract(event_json, '$.blockTimestamp') AS INTEGER) >= ? - (29 * 86400)
      GROUP BY date
    ),
    joins AS (
      SELECT date(joined_at, 'unixepoch') AS date, COUNT(*) AS new_players
      FROM (${firstPlayerSql})
      WHERE joined_at >= ? - (29 * 86400)
      GROUP BY date
    )
    SELECT days.date,
      COALESCE(activity.transactions, 0) AS transactions,
      COALESCE(activity.events, 0) AS events,
      COALESCE(joins.new_players, 0) AS new_players
    FROM days
    LEFT JOIN activity USING (date)
    LEFT JOIN joins USING (date)
    ORDER BY days.date
  `).all(nowSeconds, nowSeconds, nowSeconds, firstPlanetSettledTopic, nowSeconds) as DailyRow[];

  const descriptorLabels = new Map(
    descriptors.map(({ address, label }) => [address.toLowerCase(), label])
  );
  const contracts = (db.query(`
    SELECT lower(json_extract(event_json, '$.address')) AS address,
      COUNT(DISTINCT lower(transaction_hash)) AS transactions,
      COUNT(*) AS events
    FROM indexed_event_logs
    WHERE removed = 0
    GROUP BY address
    ORDER BY transactions DESC, events DESC
  `).all() as ContractRow[]).map((row) => ({
    address: row.address,
    label: descriptorLabels.get(row.address) ?? "Historical contract",
    transactions: Number(row.transactions),
    events: Number(row.events)
  }));

  const topEvents = (db.query(`
    SELECT lower(json_extract(event_json, '$.topics[0]')) AS topic,
      COUNT(DISTINCT lower(transaction_hash)) AS transactions,
      COUNT(*) AS events
    FROM indexed_event_logs
    WHERE removed = 0
    GROUP BY topic
    ORDER BY transactions DESC, events DESC
    LIMIT 12
  `).all() as EventRow[]).map((row) => ({
    name: eventNameForTopic(row.topic) ?? "Unknown event",
    transactions: Number(row.transactions),
    events: Number(row.events)
  }));

  return {
    generatedAt: new Date(nowSeconds * 1_000).toISOString(),
    coverage: {
      fromBlock: Number(coverage?.from_block ?? 0),
      throughBlock: Number(coverage?.through_block ?? 0),
      fromTimestamp: Number(coverage?.from_timestamp ?? 0),
      throughTimestamp: Number(coverage?.through_timestamp ?? 0)
    },
    summary: {
      players,
      newPlayers24h,
      newPlayers7d,
      activePlayers24h: numberValue(
        db,
        "SELECT COUNT(*) AS value FROM indexed_player_activity WHERE unixepoch(last_active_at) >= ?",
        nowSeconds - 86_400
      ),
      activePlayers7d: numberValue(
        db,
        "SELECT COUNT(*) AS value FROM indexed_player_activity WHERE unixepoch(last_active_at) >= ?",
        nowSeconds - 7 * 86_400
      ),
      planets,
      colonies: Math.max(0, planets - players),
      transactions,
      events,
      fleetMissions: numberValue(db, "SELECT COUNT(*) AS value FROM contract_fleet_missions"),
      battles: numberValue(
        db,
        `SELECT COUNT(DISTINCT lower(transaction_hash)) AS value
         FROM indexed_event_logs
         WHERE removed = 0 AND lower(json_extract(event_json, '$.topics[0]')) = ?`,
        attackBattleResolvedTopic
      ),
      alliances: numberValue(db, "SELECT COUNT(*) AS value FROM contract_alliances WHERE active = 1")
    },
    daily: daily.map((row) => ({
      date: row.date,
      transactions: Number(row.transactions),
      events: Number(row.events),
      newPlayers: Number(row.new_players)
    })),
    contracts,
    topEvents
  };
}
