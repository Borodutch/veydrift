import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  decodeDebrisFieldLog,
  decodeMoonChanceReportLog,
  decodeSettledPlanetLog,
  isDebrisFieldLog,
  isMoonChanceReportLog,
  isSettledPlanetLog,
  type ChainReader,
  type DebrisFieldEvent,
  type MoonChanceReportEvent,
  type RpcLog,
  type SettledPlanetEvent
} from "./evm";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;
export type IndexedMoonChanceReportEvent = MoonChanceReportEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

export type IndexerSnapshot = {
  indexedDebrisFields: number;
  indexedEventLogs: number;
  indexedMoonChanceReports: number;
  indexedPlanets: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
  lastReconciledAt: string | null;
  lastReconciledBlock: string | null;
  lastReconciliationError: string | null;
  latestIndexedBlock: string | null;
  reconciliationInProgress: boolean;
  reorgDetectedAt: string | null;
};

export type SettlementIndexerOptions = {
  database?: Database;
  databasePath?: string;
};

type CountRow = {
  count: number;
};

type MetadataRow = {
  value: string;
};

type EventRow = {
  event_json: string;
};

export type IndexedRpcLog = RpcLog & {
  logIndex?: string;
  removed?: boolean;
};

export type ApplyLogResult = {
  applied: boolean;
  duplicate: boolean;
  ignored: boolean;
  removed: boolean;
  snapshot: IndexerSnapshot;
};

export class SettlementIndexer {
  private readonly db: Database;
  private planetRebuildPromise: Promise<IndexerSnapshot> | null = null;
  private rebuildPromise: Promise<IndexerSnapshot> | null = null;

  constructor(
    private readonly chainReader: Pick<
      ChainReader,
      "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"
    > & Pick<Partial<ChainReader>, "listCurrentPlanets">,
    private readonly fromBlock: bigint,
    options: SettlementIndexerOptions = {}
  ) {
    this.db = options.database ?? openIndexerDatabase(options.databasePath ?? ":memory:");
    this.migrate();
  }

  snapshot(): IndexerSnapshot {
    return {
      indexedDebrisFields: this.count("indexed_debris_fields"),
      indexedEventLogs: this.count("indexed_event_logs"),
      indexedMoonChanceReports: this.count("indexed_moon_chance_reports"),
      indexedPlanets: this.count("indexed_planets"),
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.metadata("lastRebuiltAt"),
      lastReconciledAt: this.metadata("lastReconciledAt"),
      lastReconciledBlock: this.metadata("lastReconciledBlock"),
      lastReconciliationError: this.metadata("lastReconciliationError"),
      latestIndexedBlock: this.metadata("latestIndexedBlock"),
      reconciliationInProgress: this.rebuildPromise !== null || this.planetRebuildPromise !== null,
      reorgDetectedAt: this.metadata("reorgDetectedAt")
    };
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    return this.rows<SettledPlanetEvent>(
      "SELECT event_json FROM indexed_planets WHERE galaxy = ? AND system = ? ORDER BY position ASC",
      galaxy,
      system
    );
  }

  debrisFieldsInSystem(galaxy: number, system: number): IndexedDebrisFieldEvent[] {
    const rows = this.db.query(`
      SELECT debris.event_json
      FROM indexed_debris_fields debris
      INNER JOIN indexed_planets planet ON planet.planet_id = debris.planet_id
      WHERE planet.galaxy = ? AND planet.system = ?
      ORDER BY planet.position ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const field = parseEvent<DebrisFieldEvent>(row.event_json);
      const planet = this.planet(field.planetId);
      if (!planet) return [];
      return [{ ...field, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  moonChanceReportsInSystem(galaxy: number, system: number): IndexedMoonChanceReportEvent[] {
    const rows = this.db.query(`
      SELECT report.event_json
      FROM indexed_moon_chance_reports report
      INNER JOIN indexed_planets planet ON planet.planet_id = report.target_planet_id
      WHERE planet.galaxy = ? AND planet.system = ?
      ORDER BY planet.position ASC, report.block_number ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const report = parseEvent<MoonChanceReportEvent>(row.event_json);
      const planet = this.planet(report.targetPlanetId);
      if (!planet) return [];
      return [{ ...report, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  settledPlanets(): SettledPlanetEvent[] {
    return this.rows<SettledPlanetEvent>("SELECT event_json FROM indexed_planets ORDER BY CAST(planet_id AS INTEGER) ASC");
  }

  settledPlanetsByOwner(): Map<string, SettledPlanetEvent[]> {
    const planetsByOwner = new Map<string, SettledPlanetEvent[]>();
    for (const planet of this.settledPlanets()) {
      const owner = planet.owner.toLowerCase();
      planetsByOwner.set(owner, [...(planetsByOwner.get(owner) ?? []), planet]);
    }
    return planetsByOwner;
  }

  planet(planetId: string): SettledPlanetEvent | null {
    const row = this.db.query("SELECT event_json FROM indexed_planets WHERE planet_id = ?").get(planetId) as EventRow | null;
    return row ? parseEvent<SettledPlanetEvent>(row.event_json) : null;
  }

  walletSettlement(wallet: `0x${string}`): { wallet: `0x${string}`; hasFirstPlanet: boolean; homePlanetId: string | null; planet: SettledPlanetEvent | null; contractKind: "game" } {
    const planets = this.rows<SettledPlanetEvent>(
      "SELECT event_json FROM indexed_planets WHERE lower(owner) = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
      wallet
    );
    const planet = planets.find((item) => item.eventName === "PlanetStarted") ?? planets[0] ?? null;

    return {
      wallet,
      hasFirstPlanet: planet !== null,
      homePlanetId: planet?.planetId ?? null,
      planet,
      contractKind: "game"
    };
  }

  applyEvent(event: SettledPlanetEvent): IndexerSnapshot {
    this.upsertPlanet(event);
    this.touch();
    return this.snapshot();
  }

  applyDebrisEvent(event: DebrisFieldEvent): IndexerSnapshot {
    this.upsertDebris(event);
    this.touch();
    return this.snapshot();
  }

  applyMoonChanceEvent(event: MoonChanceReportEvent): IndexerSnapshot {
    this.upsertMoonChanceReport(event);
    this.touch();
    return this.snapshot();
  }

  applyLog(log: IndexedRpcLog): ApplyLogResult {
    const eventId = indexedLogKey(log);
    const existing = this.db.query("SELECT event_json FROM indexed_event_logs WHERE event_id = ?").get(eventId) as EventRow | null;
    if (existing) {
      return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    this.recordLog(eventId, log);
    this.recordLatestBlock(log.blockNumber);

    if (log.removed) {
      this.db.query(`
        INSERT INTO indexer_metadata (key, value)
        VALUES ('reorgDetectedAt', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(new Date().toISOString());
      return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
    }

    if (isSettledPlanetLog(log)) {
      this.applyEvent(decodeSettledPlanetLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isDebrisFieldLog(log)) {
      this.applyDebrisEvent(decodeDebrisFieldLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonChanceReportLog(log)) {
      this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    return { applied: false, duplicate: false, ignored: true, removed: false, snapshot: this.snapshot() };
  }

  async rebuild(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }

    this.rebuildPromise = this.rebuildUncached()
      .catch((error) => {
        this.recordReconciliationError(error);
        throw error;
      })
      .finally(() => {
        this.rebuildPromise = null;
        this.planetRebuildPromise = null;
      });
    this.planetRebuildPromise = this.rebuildPromise;
    return this.rebuildPromise;
  }

  async rebuildPlanets(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    if (this.planetRebuildPromise) {
      return this.planetRebuildPromise;
    }

    this.planetRebuildPromise = this.rebuildPlanetsUncached().finally(() => {
      this.planetRebuildPromise = null;
    });
    return this.planetRebuildPromise;
  }

  private async rebuildUncached(): Promise<IndexerSnapshot> {
    const events = await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const debrisEvents = await this.chainReader.listDebrisFieldEvents(this.fromBlock, "latest");
    const moonChanceEvents = await this.chainReader.listMoonChanceReportEvents(this.fromBlock, "latest");
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM indexed_debris_fields").run();
      this.db.query("DELETE FROM indexed_moon_chance_reports").run();
      for (const event of events) {
        this.upsertPlanet(event);
      }
      for (const event of debrisEvents) {
        this.upsertDebris(event);
      }
      for (const event of moonChanceEvents) {
        this.upsertMoonChanceReport(event);
      }
      const latestBlock = latestEventBlock([...events, ...debrisEvents, ...moonChanceEvents]);
      this.touch();
      this.recordSuccessfulReconciliation(latestBlock);
    });
    rebuild();
    return this.snapshot();
  }

  private async rebuildPlanetsUncached(): Promise<IndexerSnapshot> {
    const events = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      for (const event of events) {
        this.upsertPlanet(event);
      }
      this.touch();
    });
    rebuild();
    return this.snapshot();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexer_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_planets (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        galaxy INTEGER NOT NULL,
        system INTEGER NOT NULL,
        position INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_planets_owner_idx ON indexed_planets (owner);
      CREATE INDEX IF NOT EXISTS indexed_planets_coordinates_idx ON indexed_planets (galaxy, system, position);
      CREATE TABLE IF NOT EXISTS indexed_debris_fields (
        planet_id TEXT PRIMARY KEY,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_moon_chance_reports (
        report_key TEXT PRIMARY KEY,
        target_planet_id TEXT NOT NULL,
        battle_id TEXT NOT NULL,
        outcome_id TEXT,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_moon_chance_reports_target_idx
        ON indexed_moon_chance_reports (target_planet_id);
      CREATE TABLE IF NOT EXISTS indexed_event_logs (
        event_id TEXT PRIMARY KEY,
        transaction_hash TEXT NOT NULL,
        log_index TEXT NOT NULL,
        block_number TEXT NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0,
        event_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_event_logs_block_idx
        ON indexed_event_logs (block_number);
    `);
  }

  private upsertPlanet(event: SettledPlanetEvent): void {
    this.db.query(`
      INSERT INTO indexed_planets (planet_id, owner, galaxy, system, position, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        galaxy = excluded.galaxy,
        system = excluded.system,
        position = excluded.position,
        event_json = excluded.event_json
    `).run(
      event.planetId,
      event.owner.toLowerCase(),
      event.galaxy,
      event.system,
      event.position,
      JSON.stringify(event)
    );
  }

  private upsertDebris(event: DebrisFieldEvent): void {
    if (event.resources.metal === "0" && event.resources.crystal === "0") {
      this.db.query("DELETE FROM indexed_debris_fields WHERE planet_id = ?").run(event.planetId);
      return;
    }

    this.db.query(`
      INSERT INTO indexed_debris_fields (planet_id, block_number, event_json)
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(event.planetId, event.blockNumber, JSON.stringify(event));
  }

  private upsertMoonChanceReport(event: MoonChanceReportEvent): void {
    this.db.query(`
      INSERT INTO indexed_moon_chance_reports (report_key, target_planet_id, battle_id, outcome_id, block_number, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_key) DO UPDATE SET
        target_planet_id = excluded.target_planet_id,
        battle_id = excluded.battle_id,
        outcome_id = excluded.outcome_id,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(
      moonChanceReportKey(event),
      event.targetPlanetId,
      event.battleId,
      event.outcomeId ?? null,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private touch(): void {
    this.setMetadata("lastRebuiltAt", new Date().toISOString());
  }

  private recordLog(eventId: string, log: IndexedRpcLog): void {
    this.db.query(`
      INSERT INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      log.transactionHash,
      log.logIndex ?? "0x0",
      blockNumberToDecimal(log.blockNumber),
      log.removed ? 1 : 0,
      JSON.stringify(log),
      new Date().toISOString()
    );
  }

  private recordLatestBlock(blockNumber: string): void {
    this.setMetadata("latestIndexedBlock", blockNumberToDecimal(blockNumber));
  }

  private recordSuccessfulReconciliation(latestBlock: string | null): void {
    const now = new Date().toISOString();
    this.setMetadata("lastReconciledAt", now);
    this.setMetadata("lastReconciledBlock", latestBlock ?? this.fromBlock.toString());
    this.db.query("DELETE FROM indexer_metadata WHERE key = 'lastReconciliationError'").run();
    if (latestBlock) {
      this.recordLatestBlock(latestBlock);
    }
  }

  private recordReconciliationError(error: unknown): void {
    this.setMetadata("lastReconciliationError", error instanceof Error ? error.message : String(error));
  }

  private setMetadata(key: string, value: string): void {
    this.db.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private count(table: "indexed_debris_fields" | "indexed_event_logs" | "indexed_moon_chance_reports" | "indexed_planets"): number {
    const row = this.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
    return row.count;
  }

  private metadata(key: string): string | null {
    const row = this.db.query("SELECT value FROM indexer_metadata WHERE key = ?").get(key) as MetadataRow | null;
    return row?.value ?? null;
  }

  private rows<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    return (this.db.query(sql).all(...params) as EventRow[]).map((row) => parseEvent<T>(row.event_json));
  }
}

function moonChanceReportKey(event: MoonChanceReportEvent): string {
  return event.outcomeId ? `outcome:${event.outcomeId}` : `battle:${event.battleId}:${event.targetPlanetId}`;
}

function openIndexerDatabase(databasePath: string): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  return new Database(databasePath);
}

function parseEvent<T>(value: string): T {
  return JSON.parse(value) as T;
}

function indexedLogKey(log: IndexedRpcLog): string {
  return `${log.transactionHash.toLowerCase()}:${log.logIndex ?? fallbackLogIndex(log)}`;
}

function fallbackLogIndex(log: RpcLog): string {
  return `${log.blockNumber}:${log.topics.join(",")}:${log.data}`;
}

function blockNumberToDecimal(blockNumber: string): string {
  try {
    return BigInt(blockNumber).toString();
  } catch {
    return blockNumber;
  }
}

function latestEventBlock(events: Array<{ blockNumber: string }>): string | null {
  let latest: bigint | null = null;
  for (const event of events) {
    try {
      const block = BigInt(event.blockNumber);
      latest = latest === null || block > latest ? block : latest;
    } catch {
      continue;
    }
  }

  return latest?.toString() ?? null;
}
