import { beforeEach, describe, expect, test } from "bun:test";
import {
  detectFarcasterMiniApp,
  farcasterMiniAppPlatformType,
  hasMiniAppUrlHint,
  probeFarcasterMiniAppRuntime,
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

  test("detects Mini App URL launch hints before probing the SDK", async () => {
    expect(hasMiniAppUrlHint({ pathname: "/", search: "?miniApp=true" })).toBe(true);
    expect(hasMiniAppUrlHint({ pathname: "/miniapp", search: "" })).toBe(true);
    expect(hasMiniAppUrlHint({ pathname: "/", search: "" })).toBe(false);

    await expect(detectFarcasterMiniApp({
      isInMiniApp: () => {
        throw new Error("should not probe when URL has the launch hint");
      },
      actions: {
        ready: () => undefined,
      },
    }, { pathname: "/", search: "?miniApp=true" })).resolves.toBe(true);
  });

  test("falls back to bounded SDK Mini App detection", async () => {
    await expect(detectFarcasterMiniApp({
      isInMiniApp: async () => true,
      actions: {
        ready: () => undefined,
      },
    }, { pathname: "/", search: "" })).resolves.toBe(true);

    await expect(detectFarcasterMiniApp({
      isInMiniApp: async () => {
        throw new Error("host unavailable");
      },
      actions: {
        ready: () => undefined,
      },
    }, { pathname: "/", search: "" })).resolves.toBe(false);
  });

  test("separates Mini App URL hints from actual Farcaster runtime probing", async () => {
    const client = {
      isInMiniApp: async () => false,
      actions: {
        ready: () => undefined,
      },
    };

    await expect(detectFarcasterMiniApp(client, { pathname: "/", search: "?miniApp=true" })).resolves.toBe(true);
    await expect(probeFarcasterMiniAppRuntime(client)).resolves.toBe(false);
  });

  test("reads Mini App platform type from SDK context", async () => {
    await expect(farcasterMiniAppPlatformType({
      context: Promise.resolve({
        client: {
          platformType: "web",
        },
      }),
      actions: {
        ready: () => undefined,
      },
    })).resolves.toBe("web");

    await expect(farcasterMiniAppPlatformType({
      context: Promise.resolve({ client: {} }),
      actions: {
        ready: () => undefined,
      },
    })).resolves.toBe("unknown");

    await expect(farcasterMiniAppPlatformType({
      context: Promise.reject(new Error("host unavailable")),
      actions: {
        ready: () => undefined,
      },
    })).resolves.toBe("unknown");
  });
});
