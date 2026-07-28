import { describe, expect, test } from "bun:test";
import { formatUnits } from "viem";

import { ccaBidsForAccount, type CcaSubmittedBid } from "./CcaApp";
import { executeCcaBidSequence, readCcaAuctionBoundary } from "./ccaBidFlow";
import {
  ccaBidPriceError,
  fdvToPriceQ96,
  isBidPriceAboveClearingPrice,
  minimumFdvWeiAboveClearingPriceQ96,
} from "./ccaBidPrice";
import type { Eip1193Provider } from "./walletFlow";

const clearingPriceQ96 = 8_556_641_551_540_548_460_102n;

const submittedBid = (bidId: string, owner: string): CcaSubmittedBid => ({
  amountWei: "1000000000000000000",
  bidId,
  blockNumber: "49240000",
  maxPriceQ96: clearingPriceQ96.toString(),
  owner,
  transactionHash: `0x${bidId.padStart(64, "0")}`,
});

describe("CCA connected-wallet bids", () => {
  test("filters the complete official bid history by owner without case sensitivity", () => {
    const connected = "0xAAbbCcDDeeFF0011223344556677889900AAbbCc";
    const recentBids = [
      submittedBid("1", connected.toLowerCase()),
      submittedBid("2", "0x1111111111111111111111111111111111111111"),
      submittedBid("3", connected.toUpperCase()),
    ];

    expect(ccaBidsForAccount(recentBids, connected).map(({ bidId }) => bidId)).toEqual(["1", "3"]);
    expect(recentBids).toHaveLength(3);
  });

  test("keeps an older wallet bid visible after it leaves the recent 12-bid list", () => {
    const connected = "0xAAbbCcDDeeFF0011223344556677889900AAbbCc";
    const confirmedBids = Array.from({ length: 13 }, (_, index) =>
      submittedBid(
        String(13 - index),
        index === 12 ? connected : "0x1111111111111111111111111111111111111111",
      )
    );

    expect(ccaBidsForAccount(confirmedBids.slice(0, 12), connected)).toEqual([]);
    expect(ccaBidsForAccount(confirmedBids, connected).map(({ bidId }) => bidId)).toEqual(["1"]);
  });

  test("returns no personal bids when no wallet is connected", () => {
    expect(ccaBidsForAccount([
      submittedBid("1", "0x1111111111111111111111111111111111111111"),
    ], null)).toEqual([]);
  });
});

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
    expect(source).toContain("Reverted wallet transactions are never shown here.");
  });

  test("keeps the strict price guard out of the bidder-facing copy", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).not.toContain("Live strict minimum");
    expect(source).toContain("minimumFdvWeiAboveClearingPriceQ96");
  });

  test("refreshes connected-wallet bids on the live cadence, after confirmation, and on account changes", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("Your confirmed bids");
    expect(source).toContain("Connect a wallet to see its confirmed CCA bids.");
    expect(source).toContain('fetch(`${playableApiUrl}/cca`, {');
    expect(source).not.toContain('fetch(`${playableApiUrl}/cca?');
    expect(source).toContain("ccaBidsForAccount(auction.confirmedBids, account)");
    expect(source).toContain('window.setInterval(() => void refresh(), 12_000)');
    expect(source).toContain("await refresh(provider, account)");
    expect(source).toContain('walletProvider.on?.("accountsChanged"');
    expect(source).toContain('walletProvider.removeListener?.("accountsChanged"');
    expect(source).toContain("Sourced from confirmed");
  });

  test("explains budget, FDV, partial fills, and the official CCA AI reference", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("Your budget is the most WETH this order can use.");
    expect(source).toContain("partial fill");
    expect(source).toContain("that order slice does not execute");
    expect(source).toContain('href="https://cca.uniswap.org/"');
    expect(source).toContain("cannot predict the final clearing price");
  });

  test("shows recent and total confirmed bids from the live auction response", async () => {
    const source = await Bun.file(new URL("./CcaApp.tsx", import.meta.url)).text();

    expect(source).toContain("totalBids: typeof totalBids === \"number\" && Number.isSafeInteger(totalBids)");
    expect(source).toContain("${auction.recentBids.length} recent · ${auction.totalBids} total");
  });
});
