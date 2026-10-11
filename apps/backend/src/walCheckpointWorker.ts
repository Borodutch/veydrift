// Worker thread that checkpoints the index WAL on its own connection (#74). Checkpoint copies and
// fsyncs run here, so a slow disk stalls this thread instead of the writer's event loop.
import { Database } from "bun:sqlite";

import type { WalCheckpointRequest, WalCheckpointResult } from "./walCheckpointer";

declare const self: Worker;

let database: Database | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function pass(request: WalCheckpointRequest): WalCheckpointResult {
  const startedAt = performance.now();
  try {
    database ??= new Database(request.databasePath, { readwrite: true, create: false });
    // PASSIVE only: it never takes the write lock or waits in a busy handler. RESTART/TRUNCATE
    // hold the write lock through their copy and fsync, which would park the writer's next commit
    // in its busy handler on the main thread. Once a pass backfills everything, the writer's next
    // commit restarts the WAL and its journal_size_limit trims the file.
    const [result] = database.query("PRAGMA wal_checkpoint(PASSIVE)").all() as Array<{ busy: number; log: number; checkpointed: number }>;
    return {
      ok: true,
      busy: result?.busy ?? 0,
      log: result?.log ?? 0,
      checkpointed: result?.checkpointed ?? 0,
      durationMs: performance.now() - startedAt
    };
  } catch (error) {
    // A failed open is retried on the next pass rather than kept as a broken handle.
    try { database?.close(); } catch {}
    database = null;
    return { ok: false, error: error instanceof Error ? error.message : String(error), durationMs: performance.now() - startedAt };
  }
}

self.onmessage = (event: MessageEvent<WalCheckpointRequest | { stop: true }>) => {
  if ("stop" in event.data) {
    if (timer) clearInterval(timer);
    try { database?.close(); } catch {}
    database = null;
    return;
  }
  const request = event.data;
  if (timer) clearInterval(timer);
  const run = () => self.postMessage(pass(request));
  run();
  timer = setInterval(run, request.intervalMs);
};
