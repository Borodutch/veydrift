// Worker thread that checkpoints the writer's SQLite WALs on its own connections (#74). Checkpoint
// copies and fsyncs run here, so a slow disk stalls this thread instead of the writer's event loop.
import { Database } from "bun:sqlite";

import type { WalCheckpointDatabase, WalCheckpointRequest, WalCheckpointResult } from "./walCheckpointer";

declare const self: Worker;

const databases = new Map<string, Database>();
const timers: Array<ReturnType<typeof setInterval>> = [];

function pass({ databasePath }: WalCheckpointDatabase): WalCheckpointResult {
  const startedAt = performance.now();
  try {
    let database = databases.get(databasePath);
    if (!database) {
      database = new Database(databasePath, { readwrite: true, create: false });
      databases.set(databasePath, database);
    }
    // PASSIVE only: it never takes the write lock or waits in a busy handler. RESTART/TRUNCATE
    // hold the write lock through their copy and fsync, which would park the writer's next commit
    // in its busy handler on the main thread. Once a pass backfills everything, the writer's next
    // commit restarts the WAL and its journal_size_limit trims the file.
    const [result] = database.query("PRAGMA wal_checkpoint(PASSIVE)").all() as Array<{ busy: number; log: number; checkpointed: number }>;
    return {
      databasePath,
      ok: true,
      busy: result?.busy ?? 0,
      log: result?.log ?? 0,
      checkpointed: result?.checkpointed ?? 0,
      durationMs: performance.now() - startedAt
    };
  } catch (error) {
    // A failed open is retried on the next pass rather than kept as a broken handle.
    try { databases.get(databasePath)?.close(); } catch {}
    databases.delete(databasePath);
    return { databasePath, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: performance.now() - startedAt };
  }
}

function stop(): void {
  for (const timer of timers.splice(0)) clearInterval(timer);
  for (const database of databases.values()) {
    try { database.close(); } catch {}
  }
  databases.clear();
}

self.onmessage = (event: MessageEvent<WalCheckpointRequest | { stop: true }>) => {
  stop();
  if ("stop" in event.data) return;
  for (const database of event.data.databases) {
    const run = () => self.postMessage(pass(database));
    run();
    timers.push(setInterval(run, database.intervalMs));
  }
};
