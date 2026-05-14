import { beforeEach, describe, expect, test } from "bun:test";
import {
  resetFarcasterReadyForTests,
  scheduleFarcasterReady,
  signalFarcasterReadyOnce,
  type FarcasterReadyClient,
} from "../src/farcasterReady";

function readyClient(ready: () => Promise<void> | void): FarcasterReadyClient {
  return {
    actions: {
      ready,
    },
  };
}

describe("Farcaster Mini App ready lifecycle", () => {
  beforeEach(() => {
    resetFarcasterReadyForTests();
  });

  test("signals ready exactly once", async () => {
    let calls = 0;
    const client = readyClient(() => {
      calls += 1;
    });

    await Promise.all([
      signalFarcasterReadyOnce(client),
      signalFarcasterReadyOnce(client),
    ]);

    expect(calls).toBe(1);
  });

  test("does not reject app startup when ready fails", async () => {
    const client = readyClient(() => {
      throw new Error("host unavailable");
    });

    await expect(signalFarcasterReadyOnce(client)).resolves.toBeUndefined();
  });

  test("waits for the scheduled app shell frame before signaling ready", async () => {
    let calls = 0;
    let scheduled: (() => void) | undefined;
    const client = readyClient(() => {
      calls += 1;
    });

    scheduleFarcasterReady(client, (callback) => {
      scheduled = callback;
    });

    expect(calls).toBe(0);
    scheduled?.();
    await Promise.resolve();

    expect(calls).toBe(1);
  });
});
