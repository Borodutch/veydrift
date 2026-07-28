import { describe, expect, test } from "bun:test";

import { isBidPriceAboveClearingPrice } from "./ccaBidPrice";

describe("CCA bid price validation", () => {
  test("rejects a bid whose maximum price equals the clearing price", () => {
    expect(isBidPriceAboveClearingPrice(8_556_641_551_540_548_460_102n, 8_556_641_551_540_548_460_102n)).toBe(false);
  });

  test("accepts the smallest Q96 value above the clearing price", () => {
    expect(isBidPriceAboveClearingPrice(8_556_641_551_540_548_460_103n, 8_556_641_551_540_548_460_102n)).toBe(true);
  });

  test("uses the Farcaster Mini App wallet provider for CCA connections", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("signalFarcasterReadyOnce");
    expect(source).toContain("getAvailableWalletProviderDetails");
    expect(source).toContain("preferFarcasterProvider: true");
    expect(source).toContain("walletProvider ?? providerFromWindow()");
  });

  test("defaults the maximum FDV strictly above the live clearing price and renders confirmed bids", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain('useState("109")');
    expect(source).toContain("maxFdvIsAutomatic.current");
    expect(source).toContain("setMaxFdv(String(minimumBidFdv))");
    expect(source).toContain("CONFIRMED ON BASE");
    expect(source).toContain("Reverted wallet transactions are never shown here.");
  });
});
