import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PendingMission } from "./keeper";

/** Single-service durable discovery and pending jobs; chain state remains authoritative. */
export class KeeperJournal {
  private readonly db: Database;
  private failure: unknown;

  constructor(path: string, identity: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (
        missionId TEXT PRIMARY KEY, missionType INTEGER NOT NULL, leg TEXT NOT NULL,
        dueAt INTEGER NOT NULL, returnAt INTEGER NOT NULL);`);
    const stored = this.db.query<{ value: string }, []>("SELECT value FROM metadata WHERE key = 'identity'").get();
    if (stored && stored.value !== identity) {
      this.db.close();
      throw new Error("keeper journal belongs to a different chain/game");
    }
    this.db.query("INSERT OR IGNORE INTO metadata VALUES ('identity', ?)").run(identity);
  }

  assertHealthy(): void {
    if (this.failure) throw new Error("keeper journal unavailable; signing disabled", { cause: this.failure });
  }

  private write(action: () => void): void {
    this.assertHealthy();
    try { action(); } catch (error) { this.failure = error; throw error; }
  }

  load(): PendingMission[] {
    this.assertHealthy();
    return this.db.query<PendingMission, []>("SELECT * FROM pending").all();
  }

  put(mission: PendingMission): void {
    this.write(() => this.db.query("INSERT OR REPLACE INTO pending VALUES (?, ?, ?, ?, ?)").run(
      mission.missionId, mission.missionType, mission.leg, mission.dueAt, mission.returnAt
    ));
  }

  remove(missionId: string): void {
    this.write(() => this.db.query("DELETE FROM pending WHERE missionId = ?").run(missionId));
  }

  nextBlock(): bigint | undefined {
    this.assertHealthy();
    const row = this.db.query<{ value: string }, []>("SELECT value FROM metadata WHERE key = 'nextBlock'").get();
    return row ? BigInt(row.value) : undefined;
  }

  /** Cursor and all synchronous keeper mutations commit together, or neither commits. */
  commitBatch(nextBlock: bigint, apply: () => void): void {
    this.write(() => this.db.transaction(() => {
      apply();
      this.db.query("INSERT OR REPLACE INTO metadata VALUES ('nextBlock', ?)").run(nextBlock.toString());
    }).immediate());
  }

  close(): void { this.db.close(); }
}
