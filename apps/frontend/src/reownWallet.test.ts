import { describe, expect, test } from "bun:test";
import { walletConnectEnabled } from "./reownWallet";

describe("WalletConnect connector", () => {
  test("never enables on the Farcaster Mini App surface", () => {
    expect(walletConnectEnabled(true, "project-id")).toBe(false);
  });

  test("requires an explicit Reown project ID on regular web", () => {
    expect(walletConnectEnabled(false, "")).toBe(false);
    expect(walletConnectEnabled(false, "project-id")).toBe(true);
  });
});
