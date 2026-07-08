import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "bun:test";

import type { ChickenBurnEvent } from "./events";
import type { MoonGrantClient } from "./grant";
import { ChickenBurnProcessor } from "./processor";
import { JsonStateStore } from "./store";

class MockGrantClient implements MoonGrantClient {
  calls = 0;
  async grantMoon(): Promise<`0x${string}`> {
    this.calls += 1;
    return "0xabc";
  }
  async chickenBurnMoonGrantCount(): Promise<number> {
    return 0;
  }
  async isBurnGranted(): Promise<boolean> {
    return false;
  }
  grantAddress(): string {
    return "0x1111111111111111111111111111111111111111";
  }
}

const event: ChickenBurnEvent = {
  burnId: `0x${"2".repeat(64)}`,
  burner: "0x2222222222222222222222222222222222222222",
  tokenId: "42",
  planetId: "7",
  sourceTxHash: `0x${"1".repeat(64)}`,
  sourceLogIndex: 0,
  sourceBlockNumber: 100n
};

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("ChickenBurnProcessor", () => {
  test("grants once and skips duplicate replay from store", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "chicken-burn-listener-"));
    const store = new JsonStateStore(join(tempDir, "state.json"));
    await store.load();
    const grants = new MockGrantClient();
    const processor = new ChickenBurnProcessor(store, grants, {
      info: () => {},
      warn: () => {},
      error: () => {}
    });

    await processor.processBurn(event);
    await processor.processBurn(event);

    expect(grants.calls).toBe(1);
    expect(processor.snapshot()).toMatchObject({
      processedCount: 1,
      duplicateCount: 1,
      grantFailureCount: 0,
      lastProcessedBurnId: event.burnId
    });

    const reloaded = new JsonStateStore(join(tempDir, "state.json"));
    await reloaded.load();
    expect(reloaded.hasProcessed(event.burnId)).toBe(true);
  });
});
