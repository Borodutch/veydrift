import { beforeEach, describe, expect, test } from "bun:test";
import {
  detectFarcasterMiniApp,
  farcasterMiniAppWalletSupport,
  farcasterMiniAppPlatformType,
  FARCASTER_BASE_SEPOLIA_CHAIN,
  FARCASTER_WALLET_CAPABILITY,
  hasMiniAppUrlHint,
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

  test("accepts Farcaster hosts that advertise the wallet provider and Base Sepolia", async () => {
    await expect(farcasterMiniAppWalletSupport({
      actions: {
        ready: () => undefined,
      },
      getCapabilities: async () => [FARCASTER_WALLET_CAPABILITY, "actions.ready"],
      getChains: async () => [FARCASTER_BASE_SEPOLIA_CHAIN, "eip155:8453"],
    })).resolves.toEqual({
      status: "supported",
      capabilities: [FARCASTER_WALLET_CAPABILITY, "actions.ready"],
      chains: [FARCASTER_BASE_SEPOLIA_CHAIN, "eip155:8453"],
    });
  });

  test("reports missing Farcaster wallet capability before account requests", async () => {
    await expect(farcasterMiniAppWalletSupport({
      actions: {
        ready: () => undefined,
      },
      getCapabilities: async () => ["actions.ready"],
      getChains: async () => [FARCASTER_BASE_SEPOLIA_CHAIN],
    })).resolves.toMatchObject({
      status: "unsupported",
      code: "FARCASTER_WALLET_CAPABILITY_MISSING",
      capabilities: ["actions.ready"],
      chains: [],
    });
  });

  test("reports missing Farcaster Base Sepolia support before network switching", async () => {
    await expect(farcasterMiniAppWalletSupport({
      actions: {
        ready: () => undefined,
      },
      getCapabilities: async () => [FARCASTER_WALLET_CAPABILITY],
      getChains: async () => ["eip155:8453"],
    })).resolves.toMatchObject({
      status: "unsupported",
      code: "FARCASTER_BASE_SEPOLIA_UNSUPPORTED",
      capabilities: [FARCASTER_WALLET_CAPABILITY],
      chains: ["eip155:8453"],
    });
  });

  test("keeps wallet capability and chain read failures as diagnostics", async () => {
    await expect(farcasterMiniAppWalletSupport({
      actions: {
        ready: () => undefined,
      },
      getCapabilities: async () => {
        throw new Error("method unavailable");
      },
      getChains: async () => [FARCASTER_BASE_SEPOLIA_CHAIN],
    })).resolves.toMatchObject({
      status: "unknown",
      code: "FARCASTER_CAPABILITIES_UNAVAILABLE",
      capabilities: [],
      chains: [FARCASTER_BASE_SEPOLIA_CHAIN],
    });

    await expect(farcasterMiniAppWalletSupport({
      actions: {
        ready: () => undefined,
      },
      getCapabilities: async () => [FARCASTER_WALLET_CAPABILITY],
    })).resolves.toMatchObject({
      status: "unknown",
      code: "FARCASTER_CHAINS_UNAVAILABLE",
      capabilities: [FARCASTER_WALLET_CAPABILITY],
      chains: [],
    });
  });
});
