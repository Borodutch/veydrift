import { describe, expect, test } from "bun:test";
import { formatUnits } from "viem";

import { executeCcaBidSequence, readCcaAuctionBoundary } from "./ccaBidFlow";
import { ccaLiveBidCountLabel } from "./ccaBidCount";
import {
  ccaBidPriceError,
  fdvToPriceQ96,
  isBidPriceAboveClearingPrice,
  minimumFdvWeiAboveClearingPriceQ96,
} from "./ccaBidPrice";
import type { Eip1193Provider } from "./walletFlow";

const clearingPriceQ96 = 8_556_641_551_540_548_460_102n;

describe("CCA bid price validation", () => {
  test("rejects equality through the production FDV-to-Q96 conversion", () => {
    const firstAcceptedFdvWei = minimumFdvWeiAboveClearingPriceQ96(clearingPriceQ96);
    const equalFdv = formatUnits(firstAcceptedFdvWei - 1n, 18);
    const equalPriceQ96 = fdvToPriceQ96(equalFdv);

    expect(equalPriceQ96).toBe(clearingPriceQ96);
    expect(isBidPriceAboveClearingPrice(equalPriceQ96, clearingPriceQ96)).toBe(false);
    expect(ccaBidPriceError(equalPriceQ96, clearingPriceQ96)).toContain(
      `Smallest accepted max FDV: ${formatUnits(firstAcceptedFdvWei, 18)} WETH.`,
    );
  });

  test("accepts the minimally representable FDV above clearing", () => {
    const firstAcceptedFdv = formatUnits(minimumFdvWeiAboveClearingPriceQ96(clearingPriceQ96), 18);
    const convertedPriceQ96 = fdvToPriceQ96(firstAcceptedFdv);

    expect(convertedPriceQ96).toBeGreaterThan(clearingPriceQ96);
    expect(isBidPriceAboveClearingPrice(convertedPriceQ96, clearingPriceQ96)).toBe(true);
  });
});

describe("CCA confirmed bid count", () => {
  test("shows both the visible recent count and the complete confirmed total", () => {
    expect(ccaLiveBidCountLabel(12, 27)).toBe("12 recent · 27 total confirmed");
    expect(ccaLiveBidCountLabel(0, 0)).toBe("0 recent · 0 total confirmed");
  });
});

describe("CCA bid transaction ordering", () => {
  test("reads the official clearing price, end block, and latest block from the connected provider", async () => {
    const auction = "0x7Ce8e4cC7563a9711A3D52d48439F6dfA4C1B67F" as const;
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    let auctionRead = 0;
    const provider: Eip1193Provider = {
      request: async <T>(args: { method: string; params?: unknown[] }) => {
        requests.push(args);
        if (args.method === "eth_blockNumber") return "0x64" as T;
        if (args.method === "eth_call") {
          const value = auctionRead === 0 ? clearingPriceQ96 : 101n;
          auctionRead += 1;
          return `0x${value.toString(16)}` as T;
        }
        throw new Error(`Unexpected provider request: ${args.method}`);
      },
    };

    await expect(readCcaAuctionBoundary(provider, auction)).resolves.toEqual({
      clearingPriceQ96,
      currentBlock: 100n,
      endBlock: 101n,
    });
    expect(requests.map(({ method }) => method)).toEqual([
      "eth_call",
      "eth_call",
      "eth_blockNumber",
    ]);
    expect(requests.slice(0, 2).every(({ params }) =>
      (params?.[0] as { to?: string } | undefined)?.to === auction
    )).toBe(true);
  });

  test("revalidates after ETH wrap and approvals, immediately before submit", async () => {
    const calls: string[] = [];

    await executeCcaBidSequence({
      fundingCurrency: "eth",
      wrapEth: async () => { calls.push("wrap"); },
      approveWeth: async () => { calls.push("weth approval"); },
      approvePermit2: async () => { calls.push("permit2 approval"); },
      revalidateAuction: async () => { calls.push("final revalidation"); },
      submitBid: async () => {
        calls.push("submit bid");
        return "0xbid";
      },
    });

    expect(calls).toEqual([
      "wrap",
      "weth approval",
      "permit2 approval",
      "final revalidation",
      "submit bid",
    ]);
  });

  test("does not submit when the final revalidation rejects stale equality", async () => {
    const calls: string[] = [];

    await expect(executeCcaBidSequence({
      fundingCurrency: "weth",
      wrapEth: async () => { calls.push("wrap"); },
      approveWeth: async () => { calls.push("weth approval"); },
      approvePermit2: async () => { calls.push("permit2 approval"); },
      revalidateAuction: async () => {
        calls.push("final revalidation");
        throw new Error(ccaBidPriceError(clearingPriceQ96, clearingPriceQ96) ?? "unexpected");
      },
      submitBid: async () => {
        calls.push("submit bid");
        return "0xbid";
      },
    })).rejects.toThrow("strictly above the live clearing price");

    expect(calls).toEqual([
      "weth approval",
      "permit2 approval",
      "final revalidation",
    ]);
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
    expect(source).toContain("ccaLiveBidCountLabel(auction.recentBids.length, auction.confirmedBidCount)");
    expect(source).toContain("Reverted wallet transactions are never shown here.");
  });

  test("requests and refreshes the connected wallet's complete confirmed bid list", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("fetchAuctionState(activeAccount)");
    expect(source).toContain("?owner=${encodeURIComponent(owner)}");
    expect(source).toContain("YOUR CONFIRMED BIDS");
    expect(source).toContain("Updates automatically");
    expect(source).toContain("auction.walletBids.map");
  });

  test("explains budget, FDV, partial fills, and the official CCA AI reference", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("Your budget is the most WETH this order can use.");
    expect(source).toContain("partial fill");
    expect(source).toContain("that order slice does not execute");
    expect(source).toContain('href="https://cca.uniswap.org/"');
    expect(source).toContain("cannot predict the final clearing price");
  });
});
