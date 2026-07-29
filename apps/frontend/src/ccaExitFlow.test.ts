import { describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Address,
  type Hex,
} from "viem";

import {
  ccaExitAuctionAbi,
  encodeCcaBidExit,
  readCcaBidExitState,
  readCcaBidExitStates,
  readCcaBidStates,
} from "./ccaExitFlow";
import type { Eip1193Provider } from "./walletFlow";

const auction = "0x7Ce8e4cC7563a9711A3D52d48439F6dfA4C1B67F" as Address;
const owner = "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee" as Address;
const maxUint64 = (1n << 64n) - 1n;

type Checkpoint = {
  clearingPrice: bigint;
  prev: bigint;
};

type MockOptions = {
  bid?: {
    exitedBlock?: bigint;
    maxPrice?: bigint;
    owner?: Address;
    startBlock?: bigint;
    tokensFilled?: bigint;
  };
  checkpoint?: Checkpoint;
  checkpoints?: Record<string, Checkpoint>;
  currentBlock?: bigint;
  endBlock?: bigint;
  exitBidSucceeds?: boolean;
  partialExitSucceeds?: boolean;
};

function encodedCheckpoint(checkpoint: Checkpoint) {
  return encodeFunctionResult({
    abi: ccaExitAuctionAbi,
    functionName: "checkpoint",
    result: {
      clearingPrice: checkpoint.clearingPrice,
      currencyRaisedAtClearingPriceQ96X7: 0n,
      cumulativeMpsPerPrice: 0n,
      cumulativeMps: 0,
      prev: checkpoint.prev,
      next: maxUint64,
    },
  });
}

function exitProvider(options: MockOptions = {}) {
  const calls: Array<{ functionName: string; args?: readonly unknown[] }> = [];
  const bid = {
    exitedBlock: 0n,
    maxPrice: 200n,
    owner,
    startBlock: 100n,
    tokensFilled: 0n,
    ...options.bid,
  };
  const currentCheckpoint = options.checkpoint ?? { clearingPrice: 150n, prev: 100n };
  const checkpoints = options.checkpoints ?? {
    "100": { clearingPrice: 100n, prev: maxUint64 },
  };
  const provider: Eip1193Provider = {
    request: async <T>({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_blockNumber") {
        return `0x${(options.currentBlock ?? 150n).toString(16)}` as T;
      }
      if (method !== "eth_call") throw new Error(`Unexpected ${method}`);
      const data = (params?.[0] as { data: Hex }).data;
      const decoded = decodeFunctionData({ abi: ccaExitAuctionAbi, data });
      calls.push({ functionName: decoded.functionName, args: decoded.args });
      if (decoded.functionName === "bids") {
        return encodeFunctionResult({
          abi: ccaExitAuctionAbi,
          functionName: "bids",
          result: {
            startBlock: bid.startBlock,
            startCumulativeMps: 0,
            exitedBlock: bid.exitedBlock,
            maxPrice: bid.maxPrice,
            owner: bid.owner,
            amountQ96: 1n << 96n,
            tokensFilled: bid.tokensFilled,
          },
        }) as T;
      }
      if (decoded.functionName === "endBlock") {
        return encodeFunctionResult({
          abi: ccaExitAuctionAbi,
          functionName: "endBlock",
          result: options.endBlock ?? 200n,
        }) as T;
      }
      if (decoded.functionName === "checkpoint") {
        return encodedCheckpoint(currentCheckpoint) as T;
      }
      if (decoded.functionName === "checkpoints") {
        const block = decoded.args[0].toString();
        const checkpoint = checkpoints[block];
        if (!checkpoint) throw new Error(`Missing checkpoint ${block}`);
        return encodeFunctionResult({
          abi: ccaExitAuctionAbi,
          functionName: "checkpoints",
          result: {
            clearingPrice: checkpoint.clearingPrice,
            currencyRaisedAtClearingPriceQ96X7: 0n,
            cumulativeMpsPerPrice: 0n,
            cumulativeMps: 0,
            prev: checkpoint.prev,
            next: maxUint64,
          },
        }) as T;
      }
      if (decoded.functionName === "exitBid") {
        if (options.exitBidSucceeds === false) throw new Error("CannotExitBid");
        return "0x" as T;
      }
      if (decoded.functionName === "exitPartiallyFilledBid") {
        if (options.partialExitSucceeds === false) {
          throw new Error("CannotPartiallyExitBidBeforeGraduation");
        }
        return "0x" as T;
      }
      throw new Error("Unexpected CCA function");
    },
  };
  return { calls, provider };
}

describe("CCA exit eligibility and exact checkpoint hints", () => {
  test("keeps live winning bids non-actionable", async () => {
    const { calls, provider } = exitProvider();

    await expect(readCcaBidExitState(provider, auction, owner, 7n)).resolves.toEqual({
      kind: "active-winning",
      label: "Active · winning",
    });
    expect(calls.some(({ functionName }) => functionName.startsWith("exit"))).toBe(false);
  });

  test("keeps live partially filling bids non-actionable", async () => {
    const { calls, provider } = exitProvider({
      checkpoint: { clearingPrice: 200n, prev: 100n },
    });

    await expect(readCcaBidExitState(provider, auction, owner, 7n)).resolves.toEqual({
      kind: "active-partial",
      label: "Active · partially filling",
    });
    expect(calls.some(({ functionName }) => functionName.startsWith("exit"))).toBe(false);
  });

  test("reuses one checkpoint context while reading multiple wallet bids", async () => {
    const { calls, provider } = exitProvider();

    await expect(readCcaBidExitStates(provider, auction, owner, [7n, 8n])).resolves.toEqual([
      { kind: "active-winning", label: "Active · winning" },
      { kind: "active-winning", label: "Active · winning" },
    ]);
    expect(calls.filter(({ functionName }) => functionName === "checkpoint")).toHaveLength(1);
    expect(calls.filter(({ functionName }) => functionName === "endBlock")).toHaveLength(1);
    expect(calls.filter(({ functionName }) => functionName === "bids")).toHaveLength(2);
  });

  test("returns exit eligibility and settlement state from the same bid read", async () => {
    const { calls, provider } = exitProvider({
      bid: { exitedBlock: 144n, tokensFilled: 42n },
    });

    await expect(readCcaBidStates(provider, auction, owner, [7n])).resolves.toEqual([{
      exitState: {
        kind: "exited",
        label: "Exited · refund processed",
      },
      settlement: {
        exited: true,
        tokensFilled: 42n,
      },
    }]);
    expect(calls.filter(({ functionName }) => functionName === "bids")).toHaveLength(1);
  });

  test("uses exitPartiallyFilledBid with the last fully-filled and first outbid checkpoints", async () => {
    const { calls, provider } = exitProvider({
      checkpoint: { clearingPrice: 250n, prev: 120n },
      checkpoints: {
        "120": { clearingPrice: 200n, prev: 110n },
        "110": { clearingPrice: 150n, prev: 100n },
      },
    });

    const state = await readCcaBidExitState(provider, auction, owner, 7n);
    expect(state).toEqual({
      action: {
        method: "exitPartiallyFilledBid",
        args: [7n, 110n, 150n],
      },
      kind: "eligible",
      label: "Outbid · exit/refund available",
    });
    expect(calls.at(-1)).toEqual({
      functionName: "exitPartiallyFilledBid",
      args: [7n, 110n, 150n],
    });
    expect(encodeCcaBidExit(state.action!)).toBe(
      "0x36dec5f20000000000000000000000000000000000000000000000000000000000000007000000000000000000000000000000000000000000000000000000000000006e0000000000000000000000000000000000000000000000000000000000000096",
    );
  });

  test("does not expose an outbid exit when the exact call preflight reverts", async () => {
    const { provider } = exitProvider({
      checkpoint: { clearingPrice: 250n, prev: 110n },
      checkpoints: {
        "110": { clearingPrice: 150n, prev: 100n },
      },
      partialExitSucceeds: false,
    });

    await expect(readCcaBidExitState(provider, auction, owner, 7n)).resolves.toEqual({
      kind: "outbid-waiting",
      label: "Outbid · refund unlocks at graduation or auction end",
    });
  });

  test("uses exitBid after auction end when its exact preflight succeeds", async () => {
    const { provider } = exitProvider({
      checkpoint: { clearingPrice: 150n, prev: 140n },
      currentBlock: 210n,
      endBlock: 200n,
    });

    const state = await readCcaBidExitState(provider, auction, owner, 9n);
    expect(state.action).toEqual({ method: "exitBid", args: [9n] });
    expect(encodeCcaBidExit(state.action!)).toBe(
      "0x8e4deb170000000000000000000000000000000000000000000000000000000000000009",
    );
  });

  test("uses zero outbid hint for an at-clearing partial fill after auction end", async () => {
    const { provider } = exitProvider({
      checkpoint: { clearingPrice: 200n, prev: 180n },
      checkpoints: {
        "180": { clearingPrice: 150n, prev: 100n },
      },
      currentBlock: 210n,
      endBlock: 200n,
      exitBidSucceeds: false,
    });

    await expect(readCcaBidExitState(provider, auction, owner, 9n)).resolves.toEqual({
      action: {
        method: "exitPartiallyFilledBid",
        args: [9n, 180n, 0n],
      },
      kind: "eligible",
      label: "Auction ended · exit/refund available",
    });
  });

  test("marks already exited bids without presenting another transaction", async () => {
    const { calls, provider } = exitProvider({ bid: { exitedBlock: 144n } });

    await expect(readCcaBidExitState(provider, auction, owner, 7n)).resolves.toEqual({
      kind: "exited",
      label: "Exited · refund processed",
    });
    expect(calls.some(({ functionName }) => functionName.startsWith("exit"))).toBe(false);
  });
});
