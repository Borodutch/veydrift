import { describe, expect, test } from "bun:test";
import {
  walletConnectAppKitFeatures,
  walletConnectCustomRpcUrls,
  walletConnectEnabled,
} from "./reownWallet";

describe("WalletConnect connector", () => {
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
