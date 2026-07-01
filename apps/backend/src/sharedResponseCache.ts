import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SharedCachedJsonResponse = {
  body: ArrayBuffer;
  expiresAt: number;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
};

type CacheRow = {
  body: Uint8Array;
  expires_at: number;
  headers_json: string;
  status: number;
  status_text: string;
};

export class SharedResponseCache {
  private readonly db: Database;
  private readonly maxRows = 4_096;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 25;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache (
        cache_key TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        status_text TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        body BLOB NOT NULL,
        expires_at INTEGER NOT NULL,
        stale_expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache_locks (
        cache_key TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS response_cache_stale_expires_at_idx ON response_cache (stale_expires_at);");
  }

  get(cacheKey: string, now = Date.now(), includeStale = false): SharedCachedJsonResponse | null {
    const row = this.runCacheOperation(() => this.db.query(`
        SELECT status, status_text, headers_json, body, expires_at
        FROM response_cache
        WHERE cache_key = ?
          AND ${includeStale ? "stale_expires_at" : "expires_at"} > ?
        LIMIT 1
      `).get(cacheKey, now) as CacheRow | null, null);
    if (!row) return null;

    return {
      body: arrayBufferFromBytes(row.body),
      expiresAt: row.expires_at,
      headers: JSON.parse(row.headers_json) as Array<[string, string]>,
      status: row.status,
      statusText: row.status_text
    };
  }

  set(cacheKey: string, cached: SharedCachedJsonResponse, staleExpiresAt: number, now = Date.now()): void {
    this.runCacheOperation(() => {
      this.db.query(`
        INSERT INTO response_cache (cache_key, status, status_text, headers_json, body, expires_at, stale_expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          status = excluded.status,
          status_text = excluded.status_text,
          headers_json = excluded.headers_json,
          body = excluded.body,
          expires_at = excluded.expires_at,
          stale_expires_at = excluded.stale_expires_at,
          created_at = excluded.created_at
      `).run(
        cacheKey,
        cached.status,
        cached.statusText,
        JSON.stringify(cached.headers),
        new Uint8Array(cached.body),
        cached.expiresAt,
        staleExpiresAt,
        now
      );
    });
    this.prune(now);
  }

  tryAcquireRefresh(cacheKey: string, ttlMs = 15_000, now = Date.now()): boolean {
    const result = this.runCacheOperation(() => {
      this.db.query("DELETE FROM response_cache_locks WHERE expires_at <= ?").run(now);
      return this.db.query(`
        INSERT OR IGNORE INTO response_cache_locks (cache_key, expires_at)
        VALUES (?, ?)
      `).run(cacheKey, now + ttlMs) as { changes?: number };
    }, null);
    if (!result) return false;
    return (result.changes ?? 0) > 0;
  }

  releaseRefresh(cacheKey: string): void {
    this.runCacheOperation(() => {
      this.db.query("DELETE FROM response_cache_locks WHERE cache_key = ?").run(cacheKey);
    });
  }

  async waitForFresh(cacheKey: string, deadlineMs = 8_000): Promise<SharedCachedJsonResponse | null> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      await delay(25);
      const cached = this.get(cacheKey);
      if (cached) return cached;
    }
    return null;
  }

  private prune(now = Date.now()): void {
    this.runCacheOperation(() => {
      this.db.query("DELETE FROM response_cache WHERE stale_expires_at <= ?").run(now);
      this.db.query(`
        DELETE FROM response_cache
        WHERE cache_key IN (
          SELECT cache_key
          FROM response_cache
          ORDER BY created_at DESC
          LIMIT -1 OFFSET ?
        )
      `).run(this.maxRows);
    });
  }

  private runCacheOperation<T>(operation: () => T, fallback: T): T;
  private runCacheOperation(operation: () => void): void;
  private runCacheOperation<T>(operation: () => T, fallback?: T): T | void {
    try {
      return operation();
    } catch (error) {
      if (isSqliteBusyError(error)) return fallback;
      throw error;
    }
  }
}

export function responseCachePath(indexDbPath: string): string | null {
  if (indexDbPath === ":memory:") return null;
  return `${dirname(indexDbPath)}/response-cache.sqlite`;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SQLITE_BUSY") || message.includes("database is locked");
}
