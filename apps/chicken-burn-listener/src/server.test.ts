import { describe, expect, test } from "bun:test";

import type { ChickenBurnProcessor } from "./processor";
import { createHandler } from "./server";
import type { ChickenBurnSource } from "./source";
import type { JsonStateStore } from "./store";

describe("createHandler", () => {
  test("serves listener health snapshots", async () => {
    const handler = createHandler(
      {
        snapshot: () => ({
          connected: true,
          eventsReceived: 3,
          lastBackfillAt: "2026-06-24T21:00:00.000Z",
          lastConnectedAt: "2026-06-24T20:59:00.000Z",
          lastError: null,
          lastEventAt: "2026-06-24T21:01:00.000Z",
          reconnectAttempts: 0
        })
      } as unknown as ChickenBurnSource,
      {
        snapshot: () => ({
          duplicateCount: 1,
          grantFailureCount: 0,
          lastError: null,
          lastGrantTxHash: "0xabc",
          lastProcessedBurnId: `0x${"1".repeat(64)}`,
          processedCount: 2
        })
      } as unknown as ChickenBurnProcessor,
      {
        snapshot: () => ({
          lastScannedBlock: "123",
          processedBurnIds: [`0x${"1".repeat(64)}`]
        })
      } as unknown as JsonStateStore,
      Date.now() - 5_000
    );

    const response = handler(new Request("http://listener.test/health"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(5);
    expect(body.source).toMatchObject({ connected: true, eventsReceived: 3 });
    expect(body.processor).toMatchObject({ processedCount: 2, duplicateCount: 1 });
    expect(body.state).toMatchObject({ lastScannedBlock: "123" });
  });

  test("returns not found for unknown paths", () => {
    const handler = createHandler(
      { snapshot: () => ({}) } as unknown as ChickenBurnSource,
      { snapshot: () => ({}) } as unknown as ChickenBurnProcessor,
      { snapshot: () => ({}) } as unknown as JsonStateStore,
      Date.now()
    );

    const response = handler(new Request("http://listener.test/unknown"));
    expect(response.status).toBe(404);
  });
});
