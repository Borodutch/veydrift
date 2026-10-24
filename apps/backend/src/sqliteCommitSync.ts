import type { Database } from "bun:sqlite";

/**
 * Runs `write` on a `synchronous = FULL` WAL connection without the commit-time fsync, then
 * restores FULL. Only for rows whose loss on power failure is harmless because every holder dies
 * with the host (leases, lease renewals and releases).
 *
 * A process crash cannot lose these commits: the frames are already in the OS page cache. WAL
 * frames are append-ordered, so the next FULL commit or checkpoint syncs them before anything
 * written after them becomes durable. Each skipped fsync is a writer event-loop stall avoided:
 * on the shared production disk a single WAL fsync regularly took 0.5–1.6 s (#74).
 */
export function withoutCommitSync<T>(database: Database, write: () => T): T {
  database.exec("PRAGMA synchronous = NORMAL;");
  try {
    return write();
  } finally {
    database.exec("PRAGMA synchronous = FULL;");
  }
}

/** 0 hands checkpoints to the off-thread WalCheckpointer; 1000 restores SQLite's default (#74). */
export function setWalAutoCheckpoint(database: Database, pages: number): void {
  if (!Number.isSafeInteger(pages) || pages < 0) throw new Error("invalid wal_autocheckpoint page count");
  database.exec(`PRAGMA wal_autocheckpoint = ${pages};`);
}
