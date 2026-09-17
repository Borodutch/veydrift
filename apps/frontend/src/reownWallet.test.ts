import { describe, expect, test } from "bun:test";
import {
  connectWalletConnect,
  type ReownAppKit,
  walletConnectAppKitFeatures,
  walletConnectCustomRpcUrls,
  walletConnectEnabled,
} from "./reownWallet";
import type { Eip1193Provider } from "./walletFlow";

const walletProvider = (): Eip1193Provider => ({
  request: async <T>() => undefined as T,
});

describe("WalletConnect connector", () => {
  test("closes the wallet chooser when a locked wallet exposes its provider", async () => {
    const provider = walletProvider();
    let currentProvider: unknown;
    let notifyProviders = () => {};
    let closeCalls = 0;
    const appKit: ReownAppKit = {
      close: async () => {
        closeCalls += 1;
      },
      getWalletProvider: () => currentProvider,
      open: async () => undefined,
      subscribeProviders: (callback) => {
        notifyProviders = callback;
        return () => {};
      },
      subscribeState: () => () => {},
    };

    const connection = connectWalletConnect(async () => appKit);
    await Promise.resolve();
    currentProvider = provider;
    notifyProviders();

    await expect(connection).resolves.toEqual({ provider, source: "reown" });
    expect(closeCalls).toBe(1);
  });

  test("closes a stale chooser without reopening it when a provider already exists", async () => {
    const provider = walletProvider();
    let closeCalls = 0;
    let openCalls = 0;
    const appKit: ReownAppKit = {
      close: async () => {
        closeCalls += 1;
      },
      getWalletProvider: () => provider,
      open: async () => {
        openCalls += 1;
      },
      subscribeProviders: () => () => {},
      subscribeState: () => () => {},
    };

    await expect(connectWalletConnect(async () => appKit)).resolves.toEqual({ provider, source: "reown" });
    expect(openCalls).toBe(0);
    expect(closeCalls).toBe(1);
  });

  test("keeps a successful connection when closing an already-gone chooser rejects", async () => {
    const provider = walletProvider();
    const appKit: ReownAppKit = {
      close: async () => {
        throw new Error("already closed");
      },
      getWalletProvider: () => provider,
      open: async () => undefined,
      subscribeProviders: () => () => {},
      subscribeState: () => () => {},
    };

    await expect(connectWalletConnect(async () => appKit)).resolves.toEqual({ provider, source: "reown" });
  });

  test("leaves a cancelled chooser closed without treating it as a connection", async () => {
    let notifyState = (_state: { open: boolean }) => {};
    let closeCalls = 0;
    const appKit: ReownAppKit = {
      close: async () => {
        closeCalls += 1;
      },
      getWalletProvider: () => undefined,
      open: async () => undefined,
      subscribeProviders: () => () => {},
      subscribeState: (callback) => {
        notifyState = callback;
        return () => {};
      },
    };

    const connection = connectWalletConnect(async () => appKit);
    await Promise.resolve();
    await Promise.resolve();
    notifyState({ open: false });

    await expect(connection).resolves.toBeUndefined();
    expect(closeCalls).toBe(0);
  });

  test("does not mask a chooser-open failure", async () => {
    let closeCalls = 0;
    const appKit: ReownAppKit = {
      close: async () => {
        closeCalls += 1;
      },
      getWalletProvider: () => undefined,
      open: async () => {
        throw new Error("chooser failed");
      },
      subscribeProviders: () => () => {},
      subscribeState: () => () => {},
    };

    await expect(connectWalletConnect(async () => appKit)).rejects.toThrow("chooser failed");
    expect(closeCalls).toBe(0);
  });

  test("never enables on the Farcaster Mini App surface", () => {
    expect(walletConnectEnabled(true, "project-id")).toBe(false);
  });

  test("requires an explicit Reown project ID on regular web", () => {
    expect(walletConnectEnabled(false, "")).toBe(false);
    expect(walletConnectEnabled(false, "project-id")).toBe(true);
  });

  test("routes WalletConnect Base reads through the Veydrift API, not a public node", () => {
    expect(walletConnectCustomRpcUrls({ hostname: "veydrift.com" })).toEqual({
      "eip155:8453": [{ url: "https://api.veydrift.com/walletconnect-rpc" }]
    });
    expect(walletConnectCustomRpcUrls({ hostname: "localhost" })).toEqual({
      "eip155:8453": [{ url: "https://api-test.veydrift.com/walletconnect-rpc" }]
    });
  });

  test("uses AppKit only for external-wallet pairing", () => {
    expect(walletConnectAppKitFeatures).toEqual({
      analytics: false,
      email: false,
      emailShowWallets: false,
      onramp: false,
      socials: false,
      swaps: false,
    });
  });
});
