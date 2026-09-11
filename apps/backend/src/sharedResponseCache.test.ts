import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedResponseCache, type SharedCachedJsonResponse } from "./sharedResponseCache";

describe("SharedResponseCache", () => {
  test("upgrades an existing lock table without dropping cache data or live leases", () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-response-cache-migration-"));
    const databasePath = join(directory, "response-cache.sqlite");
    try {
      const database = new Database(databasePath);
      database.exec("CREATE TABLE response_cache_locks (cache_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
      database.query("INSERT INTO response_cache_locks VALUES (?, ?)").run("busy", 200);
      database.close();
      const first = new SharedResponseCache(databasePath);
      first.set("data", cachedResponse(), 180_000, 100);
      const second = new SharedResponseCache(databasePath);
      expect(second.get("data", 101)).toEqual(cachedResponse());
      expect(second.tryAcquireRefresh("busy", 10, 101)).toBeNull();
      expect(second.tryAcquireRefresh("busy", 10, 201)).toBeString();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("an expired owner cannot release its replacement; unrelated keys stay parallel", () => {
    const cache = new SharedResponseCache(":memory:");
    const first = cache.tryAcquireRefresh("a", 10, 100)!;
    expect(first).toBeString();
    expect(cache.tryAcquireRefresh("a", 10, 101)).toBeNull();
    expect(cache.tryAcquireRefresh("b", 10, 101)).toBeString();
    const replacement = cache.tryAcquireRefresh("a", 10, 111)!;
    expect(replacement).toBeString();
    expect(replacement).not.toBe(first);
    cache.releaseRefresh("a", first);
    expect(cache.tryAcquireRefresh("a", 10, 112)).toBeNull();
    cache.releaseRefresh("a", replacement);
    expect(cache.tryAcquireRefresh("a", 10, 112)).toBeString();
  });

  test("allows only one reader to run periodic cache maintenance", () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-response-cache-"));
    const databasePath = join(directory, "response-cache.sqlite");
    try {
      const firstReader = new SharedResponseCache(databasePath);
      const secondReader = new SharedResponseCache(databasePath);
      const cached = cachedResponse();

      firstReader.set("first", cached, 600_000, 60_000);
      secondReader.set("second", cached, 600_001, 60_001);

      const database = new Database(databasePath, { readonly: true });
      const maintenanceLocks = database.query(
        "SELECT expires_at FROM response_cache_locks WHERE cache_key = ?"
      ).all("__response_cache_maintenance__") as Array<{ expires_at: number }>;
      database.close();

      expect(maintenanceLocks).toEqual([{ expires_at: 90_000 }]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

function cachedResponse(): SharedCachedJsonResponse {
  return {
    body: new TextEncoder().encode('{"ok":true}').buffer,
    expiresAt: 120_000,
    headers: [["content-type", "application/json"]],
    status: 200,
    statusText: ""
  };
}
