import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedResponseCache, type SharedCachedJsonResponse } from "./sharedResponseCache";

describe("SharedResponseCache", () => {
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
