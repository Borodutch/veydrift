import { Database } from "bun:sqlite";
import { eventNameForTopic, fleetMissionLaunchedTopic } from "./evm";

const firstPlanetSettledTopic = "0x1f673e84fe49fdcd9930a486d10cac412437f89541987902f82b43a93d86cf1c";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";

export interface StatsContractDescriptor { address: string; label: string }
export interface PublicStatsSnapshot {
  generatedAt: string;
  utcOffsetMinutes: number;
  coverage: { fromBlock: number; throughBlock: number; fromTimestamp: number; throughTimestamp: number };
  summary: {
    players: number; newPlayers24h: number; newPlayers7d: number;
    activePlayers24h: number; activePlayers7d: number;
    planets: number; colonies: number; transactions: number; events: number;
    fleetMissions: number; battles: number; alliances: number;
  };
  daily: Array<{ date: string; transactions: number; events: number; newPlayers: number; fleetMissions: number; battles: number }>;
  contracts: Array<{ address: string; label: string; transactions: number; events: number }>;
  topEvents: Array<{ name: string; transactions: number; events: number }>;
}

/** JSON-RPC quantities and legacy decimal strings/numbers; never accept partial parses. */
export function normalizeStatsInteger(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(value))) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function normalizeStatsUtcOffsetMinutes(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value >= -840 && value <= 840 ? value : 0;
}

interface SourceRow { source_rowid: number; event_id: string; transaction_hash: string; block_number: string; removed: number; event_json: string }
interface EventRow { source_rowid: number; event_id: string; tx: string; block: number; timestamp: number; address: string; topic: string; wallet: string }
interface Counter { scope: string; events: number; transactions: number; fleet_missions: number }
interface Progress {
  version: number; sourceId: string; offset: number; cursor: number; auditCursor: number;
  reorg: string; reconciling: boolean; lastAuditCompletedAt: string | null;
  entities: Record<string, { cursor: number; auditCursor: number }>;
}
export interface StatsRefreshResult {
  snapshot: PublicStatsSnapshot | null;
  pending: boolean;
  sourceRows: number;
  changedRows: number;
  cursor: number;
  auditCursor: number;
  sourceHighWater: number;
  lastAuditCompletedAt: string | null;
}

// Neither SELECT uses JSON, numeric block casts, OFFSET, or a predicate before LIMIT.
// rowid follows insertion order even for old-block backfills, hex block numbers and huge blocks.
export const statsSourceBatchSql = `SELECT rowid AS source_rowid, event_id, transaction_hash, block_number, removed, event_json
  FROM indexed_event_logs WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`;
const localBatchSql = "SELECT * FROM stats_events WHERE source_rowid > ? AND source_rowid <= ? ORDER BY source_rowid LIMIT ?";

export function initializeStatsStore(store: Database): void {
  store.exec(`
    PRAGMA busy_timeout = 1000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS stats_state (id INTEGER PRIMARY KEY CHECK(id = 1), progress TEXT NOT NULL, snapshot TEXT);
    CREATE TABLE IF NOT EXISTS stats_events (
      source_rowid INTEGER PRIMARY KEY, event_id TEXT NOT NULL, tx TEXT NOT NULL,
      block INTEGER NOT NULL, timestamp INTEGER NOT NULL, address TEXT NOT NULL, topic TEXT NOT NULL, wallet TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stats_events_block ON stats_events(block);
    CREATE INDEX IF NOT EXISTS stats_events_timestamp ON stats_events(timestamp);
    CREATE INDEX IF NOT EXISTS stats_events_wallet_timestamp ON stats_events(wallet, timestamp);
    CREATE TABLE IF NOT EXISTS stats_transactions (
      scope TEXT NOT NULL, tx TEXT NOT NULL, refs INTEGER NOT NULL,
      PRIMARY KEY(scope, tx)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS stats_counters (
      scope TEXT PRIMARY KEY, events INTEGER NOT NULL, transactions INTEGER NOT NULL, fleet_missions INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS stats_entities (
      kind TEXT NOT NULL, source_rowid INTEGER NOT NULL, entity_key TEXT NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY(kind, source_rowid), UNIQUE(kind, entity_key)
    );
    CREATE INDEX IF NOT EXISTS stats_entities_value ON stats_entities(kind, value);
    CREATE TABLE IF NOT EXISTS stats_joins (wallet TEXT PRIMARY KEY, timestamp INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS stats_joins_timestamp ON stats_joins(timestamp);
  `);
}

export function readPersistedStatsSnapshot(store: Database): PublicStatsSnapshot | null {
  const row = store.query("SELECT snapshot FROM stats_state WHERE id = 1").all()[0] as { snapshot: string | null } | null;
  return row?.snapshot ? JSON.parse(row.snapshot) as PublicStatsSnapshot : null;
}

function value(db: Database, sql: string, ...bindings: Array<string | number>): number {
  return Number((db.query(sql).all(...bindings)[0] as { value: number } | null)?.value ?? 0);
}

function normalizeTimestamp(input: unknown): number {
  const timestamp = normalizeStatsInteger(input);
  // Keep date arithmetic representable, including the maximum supported UTC offset.
  return timestamp <= 253402214400 ? timestamp : 0;
}

function normalizeEvent(row: SourceRow): EventRow | null {
  if (row.removed) return null;
  // A malformed JSON row must fail the batch, not silently advance past uncounted data.
  const log = JSON.parse(row.event_json) as { blockTimestamp?: unknown; address?: string; topics?: string[] };
  const topic = log.topics?.[0]?.toLowerCase() ?? "";
  const playerTopic = log.topics?.[1] ?? "";
  return {
    source_rowid: row.source_rowid, event_id: row.event_id, tx: row.transaction_hash.toLowerCase(),
    block: normalizeStatsInteger(row.block_number), timestamp: normalizeTimestamp(log.blockTimestamp),
    address: log.address?.toLowerCase() ?? "", topic,
    wallet: topic === firstPlanetSettledTopic && /^0x[0-9a-f]{64}$/i.test(playerTopic) ? `0x${playerTopic.slice(-40).toLowerCase()}` : ""
  };
}

function day(timestamp: number, offset: number): string {
  return new Date((timestamp + offset * 60) * 1000).toISOString().slice(0, 10);
}

function applyContribution(store: Database, row: EventRow, sign: 1 | -1, offset: number): void {
  const scopes = ["all", `contract:${row.address}`, `topic:${row.topic}`];
  if (row.timestamp) scopes.push(`day:${day(row.timestamp, offset)}`);
  if (row.topic === attackBattleResolvedTopic) {
    scopes.push("battles");
    if (row.timestamp) scopes.push(`battles:${day(row.timestamp, offset)}`);
  }
  for (const scope of scopes) {
    const refs = value(store, "SELECT refs AS value FROM stats_transactions WHERE scope = ? AND tx = ?", scope, row.tx);
    const transactionDelta = sign === 1 ? (refs === 0 ? 1 : 0) : (refs === 1 ? -1 : 0);
    if (refs + sign === 0) store.query("DELETE FROM stats_transactions WHERE scope = ? AND tx = ?").run(scope, row.tx);
    else store.query(`INSERT INTO stats_transactions VALUES (?, ?, ?)
      ON CONFLICT(scope, tx) DO UPDATE SET refs = excluded.refs`).run(scope, row.tx, refs + sign);
    store.query(`INSERT INTO stats_counters VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET events = events + excluded.events,
        transactions = transactions + excluded.transactions, fleet_missions = fleet_missions + excluded.fleet_missions`
    ).run(scope, sign, transactionDelta, row.topic === fleetMissionLaunchedTopic ? sign : 0);
  }
}

function replaceEvent(store: Database, previous: EventRow | null, next: EventRow | null, offset: number): boolean {
  if (JSON.stringify(previous) === JSON.stringify(next)) return false;
  if (previous) {
    applyContribution(store, previous, -1, offset);
    store.query("DELETE FROM stats_events WHERE source_rowid = ?").run(previous.source_rowid);
  }
  if (next) {
    store.query("INSERT INTO stats_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      next.source_rowid, next.event_id, next.tx, next.block, next.timestamp, next.address, next.topic, next.wallet
    );
    applyContribution(store, next, 1, offset);
  }
  for (const wallet of new Set([previous?.wallet, next?.wallet])) {
    if (!wallet) continue;
    const first = value(store, "SELECT timestamp AS value FROM stats_events WHERE wallet = ? AND timestamp > 0 ORDER BY timestamp LIMIT 1", wallet);
    if (first) store.query(`INSERT INTO stats_joins VALUES (?, ?) ON CONFLICT(wallet) DO UPDATE SET timestamp = excluded.timestamp`).run(wallet, first);
    else store.query("DELETE FROM stats_joins WHERE wallet = ?").run(wallet);
  }
  return true;
}

function snapshotFromStore(store: Database, descriptors: readonly StatsContractDescriptor[], now: number, offset: number): PublicStatsSnapshot {
  const counter = (scope: string): Counter => (store.query("SELECT * FROM stats_counters WHERE scope = ?").all(scope)[0] as Counter | null)
    ?? { scope, events: 0, transactions: 0, fleet_missions: 0 };
  const all = counter("all");
  const players = value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'players'");
  const planets = value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'planets'");
  const labels = new Map(descriptors.map(({ address, label }) => [address.toLowerCase(), label]));
  const rank = (prefix: string) => (store.query("SELECT * FROM stats_counters WHERE scope >= ? AND scope < ? AND events > 0 ORDER BY transactions DESC, events DESC, scope").all(prefix, `${prefix}\uffff`) as Counter[]);
  const today = Math.floor((now + offset * 60) / 86400);
  return {
    generatedAt: new Date(now * 1000).toISOString(), utcOffsetMinutes: offset,
    coverage: {
      fromBlock: value(store, "SELECT block AS value FROM stats_events WHERE block > 0 ORDER BY block LIMIT 1"),
      throughBlock: value(store, "SELECT block AS value FROM stats_events ORDER BY block DESC LIMIT 1"),
      fromTimestamp: value(store, "SELECT timestamp AS value FROM stats_events WHERE timestamp > 0 ORDER BY timestamp LIMIT 1"),
      throughTimestamp: value(store, "SELECT timestamp AS value FROM stats_events ORDER BY timestamp DESC LIMIT 1")
    },
    summary: {
      players, planets, colonies: Math.max(0, planets - players), transactions: all.transactions, events: all.events,
      newPlayers24h: value(store, "SELECT COUNT(*) AS value FROM stats_joins WHERE timestamp >= ?", now - 86400),
      newPlayers7d: value(store, "SELECT COUNT(*) AS value FROM stats_joins WHERE timestamp >= ?", now - 7 * 86400),
      activePlayers24h: value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'activity' AND value >= ?", now - 86400),
      activePlayers7d: value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'activity' AND value >= ?", now - 7 * 86400),
      // Preserve canonical state totals (including migrated missions without a launch event).
      fleetMissions: value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'missions'"),
      battles: counter("battles").transactions,
      alliances: value(store, "SELECT COUNT(*) AS value FROM stats_entities WHERE kind = 'alliances' AND value = 1")
    },
    daily: Array.from({ length: 30 }, (_, index) => {
      const start = (today - 29 + index) * 86400 - offset * 60;
      const date = day(start, offset);
      const activity = counter(`day:${date}`);
      return { date, transactions: activity.transactions, events: activity.events, fleetMissions: activity.fleet_missions,
        battles: counter(`battles:${date}`).transactions,
        newPlayers: value(store, "SELECT COUNT(*) AS value FROM stats_joins WHERE timestamp >= ? AND timestamp < ?", start, start + 86400) };
    }),
    contracts: rank("contract:").map((row) => ({ address: row.scope.slice(9), label: labels.get(row.scope.slice(9)) ?? "Historical contract", transactions: row.transactions, events: row.events })),
    topEvents: rank("topic:").slice(0, 12).map((row) => ({ name: eventNameForTopic(row.scope.slice(6)) ?? "Unknown event", transactions: row.transactions, events: row.events }))
  };
}

interface EntityRow { source_rowid: number; entity_key: string; value: number | string }
// Fixed identifiers only, never configuration/user-provided SQL. These tables have rowid in the
// existing backend schema. Preserve migrated canonical entities, not just event-derived totals.
const canonicalStatsTables = [
  ["players", "contract_players", "wallet", "1"],
  ["planets", "contract_planets", "planet_id", "1"],
  ["missions", "contract_fleet_missions", "mission_id", "1"],
  ["alliances", "contract_alliances", "alliance_id", "active"],
  ["activity", "indexed_player_activity", "wallet", "last_active_at"]
] as const;

function syncCanonicalStats(source: Database, store: Database, progress: Progress, batchSize: number): { sourceRows: number; pending: boolean } {
  let sourceRows = 0;
  let pending = false;
  for (const [kind, table, key, column] of canonicalStatsTables) {
    const highWater = value(source, `SELECT rowid AS value FROM ${table} ORDER BY rowid DESC LIMIT 1`);
    let position = progress.entities[kind];
    if (!position || position.cursor > highWater) {
      store.query("DELETE FROM stats_entities WHERE kind = ?").run(kind);
      position = { cursor: 0, auditCursor: 0 };
      progress.entities[kind] = position;
    }
    const sourceSql = `SELECT rowid AS source_rowid, ${key} AS entity_key, ${column} AS value FROM ${table}
      WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`;
    const syncRange = (start: number, through: number): number => {
      const remote = source.query(sourceSql).all(start, through, batchSize) as EntityRow[];
      const local = store.query(`SELECT source_rowid, entity_key, value FROM stats_entities
        WHERE kind = ? AND source_rowid > ? AND source_rowid <= ? ORDER BY source_rowid LIMIT ?`).all(kind, start, through, batchSize) as EntityRow[];
      sourceRows += remote.length;
      const end = Math.min(remote.length === batchSize ? remote.at(-1)!.source_rowid : through,
        local.length === batchSize ? local.at(-1)!.source_rowid : through);
      const remoteById = new Map(remote.filter((row) => row.source_rowid <= end).map((row) => [row.source_rowid, row]));
      const localById = new Map(local.filter((row) => row.source_rowid <= end).map((row) => [row.source_rowid, row]));
      for (const id of new Set([...remoteById.keys(), ...localById.keys()])) {
        const row = remoteById.get(id);
        const old = localById.get(id);
        const normalized = row ? normalizeStatsInteger(row.value) : 0;
        if (row && old?.entity_key === row.entity_key && old.value === normalized) continue;
        store.query("DELETE FROM stats_entities WHERE kind = ? AND source_rowid = ?").run(kind, id);
        if (row) store.query(`INSERT INTO stats_entities VALUES (?, ?, ?, ?)
          ON CONFLICT(kind, entity_key) DO UPDATE SET source_rowid = excluded.source_rowid, value = excluded.value`)
          .run(kind, id, row.entity_key, normalized);
      }
      return end;
    };
    position.cursor = syncRange(position.cursor, highWater);
    position.auditCursor = syncRange(position.auditCursor, position.cursor);
    if (position.auditCursor >= position.cursor) position.auditCursor = 0;
    if (position.cursor >= highWater) syncRange(Math.max(0, highWater - batchSize), highWater);
    else pending = true;
  }
  return { sourceRows, pending };
}

/** One bounded pass. Only this stats-owned DB is writable. No backend schema/trigger changes. */
export function refreshPublicStats(
  source: Database, store: Database, descriptors: readonly StatsContractDescriptor[],
  options: { sourceId: string; batchSize?: number; nowSeconds?: number; utcOffsetMinutes?: number }
): StatsRefreshResult {
  const batchSize = options.batchSize ?? 5000;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw new Error("Stats batch size must be 1–10000");
  const offset = normalizeStatsUtcOffsetMinutes(options.utcOffsetMinutes);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Serializes overlapping worker processes; cursor, contributions and published snapshot commit together.
  return store.transaction(() => {
    const state = store.query("SELECT progress FROM stats_state WHERE id = 1").all()[0] as { progress: string } | null;
    let progress = state ? JSON.parse(state.progress) as Progress : null;
    const highWater = value(source, "SELECT rowid AS value FROM indexed_event_logs ORDER BY rowid DESC LIMIT 1");
    const hasMetadata = source.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexer_metadata'").all()[0];
    const reorg = hasMetadata ? ((source.query("SELECT value FROM indexer_metadata WHERE key = 'reorgDetectedAt'").all()[0] as { value: string } | null)?.value ?? "") : "";
    if (!progress || progress.version !== 2 || progress.sourceId !== options.sourceId || progress.offset !== offset || highWater < progress.cursor) {
      // Source replacement/truncation rebuilds private derived state, never the production ledger.
      // Keep the previous good snapshot until this bounded bootstrap catches up.
      store.exec("DELETE FROM stats_events; DELETE FROM stats_transactions; DELETE FROM stats_counters; DELETE FROM stats_joins; DELETE FROM stats_entities;");
      progress = { version: 2, sourceId: options.sourceId, offset, cursor: 0, auditCursor: 0, reorg, reconciling: false, lastAuditCompletedAt: null, entities: {} };
    }
    if (progress.reorg !== reorg) {
      progress.reorg = reorg;
      progress.auditCursor = 0;
      progress.reconciling = true;
    }
    const canonical = syncCanonicalStats(source, store, progress, Math.min(batchSize, 1000));
    // Fully consume every source statement, including scalar/metadata reads. Bun .get()/early-exit
    // iterators can pin a WAL read snapshot across calls and hide another connection's commits.
    const incoming = source.query(statsSourceBatchSql).all(progress.cursor, highWater, batchSize) as SourceRow[];
    let sourceRows = incoming.length + canonical.sourceRows;
    let changedRows = 0;
    for (const row of incoming) {
      const previous = store.query("SELECT * FROM stats_events WHERE source_rowid = ?").all(row.source_rowid)[0] as EventRow | null;
      if (replaceEvent(store, previous ?? null, normalizeEvent(row), offset)) changedRows++;
    }
    progress.cursor = incoming.length === batchSize ? incoming.at(-1)!.source_rowid : highWater;

    // Bounded rolling audit detects old removals, restorations, edits, and deleted rows without a
    // source change journal. Reorg markers accelerate a full audit and freeze snapshot publication.
    const auditLimit = progress.cursor;
    const remote = source.query(statsSourceBatchSql).all(progress.auditCursor, auditLimit, batchSize) as SourceRow[];
    const local = store.query(localBatchSql).all(progress.auditCursor, auditLimit, batchSize) as EventRow[];
    sourceRows += remote.length;
    const end = Math.min(
      remote.length === batchSize ? remote.at(-1)!.source_rowid : auditLimit,
      local.length === batchSize ? local.at(-1)!.source_rowid : auditLimit
    );
    const remoteById = new Map(remote.filter((row) => row.source_rowid <= end).map((row) => [row.source_rowid, row]));
    const localById = new Map(local.filter((row) => row.source_rowid <= end).map((row) => [row.source_rowid, row]));
    for (const id of new Set([...remoteById.keys(), ...localById.keys()])) {
      const row = remoteById.get(id);
      if (replaceEvent(store, localById.get(id) ?? null, row ? normalizeEvent(row) : null, offset)) changedRows++;
    }
    progress.auditCursor = end;
    if (end >= auditLimit) {
      progress.auditCursor = 0;
      progress.reconciling = false;
      if (progress.cursor >= highWater) progress.lastAuditCompletedAt = new Date(now * 1000).toISOString();
    }
    // Restorations do not always advance reorgDetectedAt. Recheck the most recent rowid
    // interval on every caught-up tick as well, so current charts do not wait for the
    // historical sweep. A numeric rowid interval contains at most batchSize rows, even
    // after deletion; unlike a block interval it stays bounded during a huge block.
    if (progress.cursor >= highWater) {
      const tailStart = Math.max(0, highWater - batchSize);
      const tailSource = source.query(statsSourceBatchSql).all(tailStart, highWater, batchSize) as SourceRow[];
      const tailLocal = store.query(localBatchSql).all(tailStart, highWater, batchSize) as EventRow[];
      sourceRows += tailSource.length;
      const byId = new Map(tailSource.map((row) => [row.source_rowid, row]));
      const oldById = new Map(tailLocal.map((row) => [row.source_rowid, row]));
      for (const id of new Set([...byId.keys(), ...oldById.keys()])) {
        const row = byId.get(id);
        if (replaceEvent(store, oldById.get(id) ?? null, row ? normalizeEvent(row) : null, offset)) changedRows++;
      }
    }
    const pending = progress.cursor < highWater || progress.reconciling || canonical.pending;
    const snapshot = pending ? readPersistedStatsSnapshot(store) : snapshotFromStore(store, descriptors, now, offset);
    store.query(`INSERT INTO stats_state VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET progress = excluded.progress, snapshot = excluded.snapshot`)
      .run(JSON.stringify(progress), snapshot ? JSON.stringify(snapshot) : null);
    return { snapshot, pending, sourceRows, changedRows, cursor: progress.cursor, auditCursor: progress.auditCursor, sourceHighWater: highWater, lastAuditCompletedAt: progress.lastAuditCompletedAt ?? null };
  }).immediate();
}

/** Offline/test convenience only: production always uses one persisted bounded pass in its worker. */
export function buildPublicStatsSnapshot(source: Database, descriptors: readonly StatsContractDescriptor[], nowSeconds = Math.floor(Date.now() / 1000), utcOffsetMinutes = 0): PublicStatsSnapshot {
  const store = new Database(":memory:");
  try {
    initializeStatsStore(store);
    let result: StatsRefreshResult;
    do { result = refreshPublicStats(source, store, descriptors, { sourceId: "offline", nowSeconds, utcOffsetMinutes }); } while (result.pending);
    return result.snapshot!;
  } finally { store.close(); }
}
