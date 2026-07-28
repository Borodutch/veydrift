import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";

import type { Eip1193Provider } from "./walletFlow";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_CHECKPOINT_WALK = 512;

export const ccaExitAuctionAbi = [
  {
    type: "function",
    name: "bids",
    stateMutability: "view",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "startBlock", type: "uint64" },
        { name: "startCumulativeMps", type: "uint24" },
        { name: "exitedBlock", type: "uint64" },
        { name: "maxPrice", type: "uint256" },
        { name: "owner", type: "address" },
        { name: "amountQ96", type: "uint256" },
        { name: "tokensFilled", type: "uint256" },
      ],
    }],
  },
  {
    type: "function",
    name: "checkpoint",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "clearingPrice", type: "uint256" },
        { name: "currencyRaisedAtClearingPriceQ96X7", type: "uint256" },
        { name: "cumulativeMpsPerPrice", type: "uint256" },
        { name: "cumulativeMps", type: "uint24" },
        { name: "prev", type: "uint64" },
        { name: "next", type: "uint64" },
      ],
    }],
  },
  {
    type: "function",
    name: "checkpoints",
    stateMutability: "view",
    inputs: [{ name: "blockNumber", type: "uint64" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "clearingPrice", type: "uint256" },
        { name: "currencyRaisedAtClearingPriceQ96X7", type: "uint256" },
        { name: "cumulativeMpsPerPrice", type: "uint256" },
        { name: "cumulativeMps", type: "uint24" },
        { name: "prev", type: "uint64" },
        { name: "next", type: "uint64" },
      ],
    }],
  },
  {
    type: "function",
    name: "endBlock",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "exitBid",
    stateMutability: "nonpayable",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "exitPartiallyFilledBid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bidId", type: "uint256" },
      { name: "lastFullyFilledCheckpointBlock", type: "uint64" },
      { name: "outbidBlock", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

export type CcaSubmittedBid = {
  amountWei: string;
  bidId: string;
  blockNumber: string;
  maxPriceQ96: string;
  owner: string;
  transactionHash: string;
};

type CcaBid = {
  exitedBlock: bigint;
  maxPrice: bigint;
  owner: Address;
  startBlock: bigint;
  tokensFilled: bigint;
};

type CcaCheckpoint = {
  clearingPrice: bigint;
  prev: bigint;
};

type CcaExitContext = {
  checkpoint: CcaCheckpoint;
  checkpointBlock: bigint;
  currentBlock: bigint;
  endBlock: bigint;
};

export type CcaBidExitAction =
  | { method: "exitBid"; args: readonly [bigint] }
  | {
    method: "exitPartiallyFilledBid";
    args: readonly [bigint, bigint, bigint];
  };

export type CcaBidExitState = {
  action?: CcaBidExitAction;
  kind:
    | "active-partial"
    | "active-winning"
    | "eligible"
    | "exited"
    | "outbid-waiting"
    | "unavailable";
  label: string;
};

export type CcaBidSettlement = {
  exited: boolean;
  tokensFilled: bigint;
};

export type CcaBidState = {
  exitState: CcaBidExitState;
  settlement: CcaBidSettlement | null;
};

async function call(
  provider: Eip1193Provider,
  auction: Address,
  data: Hex,
  from?: Address,
) {
  return provider.request<Hex>({
    method: "eth_call",
    params: [{
      ...(from ? { from } : {}),
      to: auction,
      data,
    }, "latest"],
  });
}

async function readBid(
  provider: Eip1193Provider,
  auction: Address,
  bidId: bigint,
): Promise<CcaBid> {
  const result = decodeFunctionResult({
    abi: ccaExitAuctionAbi,
    functionName: "bids",
    data: await call(provider, auction, encodeFunctionData({
      abi: ccaExitAuctionAbi,
      functionName: "bids",
      args: [bidId],
    })),
  });
  return {
    exitedBlock: result.exitedBlock,
    maxPrice: result.maxPrice,
    owner: result.owner,
    startBlock: result.startBlock,
    tokensFilled: result.tokensFilled,
  };
}

async function readEndBlock(
  provider: Eip1193Provider,
  auction: Address,
) {
  return decodeFunctionResult({
    abi: ccaExitAuctionAbi,
    functionName: "endBlock",
    data: await call(provider, auction, encodeFunctionData({
      abi: ccaExitAuctionAbi,
      functionName: "endBlock",
    })),
  });
}

async function simulateCheckpoint(
  provider: Eip1193Provider,
  auction: Address,
  from: Address,
): Promise<CcaCheckpoint> {
  const result = decodeFunctionResult({
    abi: ccaExitAuctionAbi,
    functionName: "checkpoint",
    data: await call(provider, auction, encodeFunctionData({
      abi: ccaExitAuctionAbi,
      functionName: "checkpoint",
    }), from),
  });
  return {
    clearingPrice: result.clearingPrice,
    prev: result.prev,
  };
}

async function readCheckpoint(
  provider: Eip1193Provider,
  auction: Address,
  blockNumber: bigint,
): Promise<CcaCheckpoint> {
  const result = decodeFunctionResult({
    abi: ccaExitAuctionAbi,
    functionName: "checkpoints",
    data: await call(provider, auction, encodeFunctionData({
      abi: ccaExitAuctionAbi,
      functionName: "checkpoints",
      args: [blockNumber],
    })),
  });
  return {
    clearingPrice: result.clearingPrice,
    prev: result.prev,
  };
}

async function preflightAction(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  action: CcaBidExitAction,
) {
  await call(provider, auction, encodeFunctionData({
    abi: ccaExitAuctionAbi,
    functionName: action.method,
    args: action.args,
  } as Parameters<typeof encodeFunctionData>[0]), account);
}

async function partialExitAction(
  provider: Eip1193Provider,
  auction: Address,
  bidId: bigint,
  bid: CcaBid,
  checkpointBlock: bigint,
  checkpoint: CcaCheckpoint,
  atClearingAfterEnd: boolean,
): Promise<CcaBidExitAction> {
  let cursorBlock = checkpointBlock;
  let cursor = checkpoint;
  let walked = 0;

  if (!atClearingAfterEnd) {
    while (
      cursor.prev !== MAX_UINT64
      && cursor.prev >= bid.startBlock
      && walked < MAX_CHECKPOINT_WALK
    ) {
      const previous = await readCheckpoint(provider, auction, cursor.prev);
      if (previous.clearingPrice <= bid.maxPrice) break;
      cursorBlock = cursor.prev;
      cursor = previous;
      walked += 1;
    }
  }
  const outbidBlock = atClearingAfterEnd ? 0n : cursorBlock;

  while (cursor.clearingPrice >= bid.maxPrice && walked < MAX_CHECKPOINT_WALK) {
    if (cursor.prev === MAX_UINT64 || cursor.prev < bid.startBlock) {
      throw new Error("CCA checkpoint history does not contain a valid fully-filled hint.");
    }
    cursorBlock = cursor.prev;
    cursor = await readCheckpoint(provider, auction, cursorBlock);
    walked += 1;
  }
  if (walked >= MAX_CHECKPOINT_WALK || cursorBlock < bid.startBlock) {
    throw new Error("CCA checkpoint hint walk exceeded its safe bound.");
  }

  return {
    method: "exitPartiallyFilledBid",
    args: [bidId, cursorBlock, outbidBlock],
  };
}

export async function readCcaBidState(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  bidId: bigint,
): Promise<CcaBidState> {
  const [context, bid] = await Promise.all([
    readCcaExitContext(provider, auction, account),
    readBid(provider, auction, bidId),
  ]);
  return {
    exitState: await resolveCcaBidExitState(
      provider,
      auction,
      account,
      bidId,
      bid,
      context,
    ),
    settlement: {
      exited: bid.exitedBlock !== 0n,
      tokensFilled: bid.tokensFilled,
    },
  };
}

export async function readCcaBidExitState(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  bidId: bigint,
): Promise<CcaBidExitState> {
  return (await readCcaBidState(provider, auction, account, bidId)).exitState;
}

async function readCcaExitContext(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
): Promise<CcaExitContext> {
  const [endBlock, currentBlockHex] = await Promise.all([
    readEndBlock(provider, auction),
    provider.request<Hex>({ method: "eth_blockNumber" }),
  ]);
  const currentBlock = BigInt(currentBlockHex);
  return {
    checkpoint: await simulateCheckpoint(provider, auction, account),
    checkpointBlock: currentBlock >= endBlock ? endBlock : currentBlock,
    currentBlock,
    endBlock,
  };
}

async function resolveCcaBidExitState(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  bidId: bigint,
  bid: CcaBid,
  context: CcaExitContext,
): Promise<CcaBidExitState> {
  if (bid.owner.toLowerCase() !== account.toLowerCase()) {
    return { kind: "unavailable", label: "Owner mismatch · action unavailable" };
  }
  if (bid.exitedBlock !== 0n) {
    return { kind: "exited", label: "Exited · refund processed" };
  }

  const { checkpoint, checkpointBlock, currentBlock, endBlock } = context;
  const ended = currentBlock >= endBlock;

  if (ended) {
    const exitBidAction = {
      method: "exitBid",
      args: [bidId],
    } as const;
    try {
      await preflightAction(provider, auction, account, exitBidAction);
      return {
        action: exitBidAction,
        kind: "eligible",
        label: "Auction ended · exit/refund available",
      };
    } catch {
      if (checkpoint.clearingPrice < bid.maxPrice) {
        return { kind: "unavailable", label: "Ended · final refund state is syncing" };
      }
    }

    try {
      const partialAction = await partialExitAction(
        provider,
        auction,
        bidId,
        bid,
        checkpointBlock,
        checkpoint,
        checkpoint.clearingPrice === bid.maxPrice,
      );
      await preflightAction(provider, auction, account, partialAction);
      return {
        action: partialAction,
        kind: "eligible",
        label: "Auction ended · exit/refund available",
      };
    } catch {
      return { kind: "unavailable", label: "Ended · final refund state is syncing" };
    }
  }

  if (checkpoint.clearingPrice < bid.maxPrice) {
    return { kind: "active-winning", label: "Active · winning" };
  }
  if (checkpoint.clearingPrice === bid.maxPrice) {
    return { kind: "active-partial", label: "Active · partially filling" };
  }

  try {
    const partialAction = await partialExitAction(
      provider,
      auction,
      bidId,
      bid,
      checkpointBlock,
      checkpoint,
      false,
    );
    await preflightAction(provider, auction, account, partialAction);
    return {
      action: partialAction,
      kind: "eligible",
      label: "Outbid · exit/refund available",
    };
  } catch {
    return {
      kind: "outbid-waiting",
      label: "Outbid · refund unlocks at graduation or auction end",
    };
  }
}

export async function readCcaBidStates(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  bidIds: readonly bigint[],
): Promise<CcaBidState[]> {
  if (bidIds.length === 0) return [];
  const context = await readCcaExitContext(provider, auction, account);
  const states: CcaBidState[] = [];
  // Wallet RPC providers commonly enforce small per-second limits. Reuse the
  // auction checkpoint context and keep per-bid storage reads ordered.
  for (const bidId of bidIds) {
    try {
      const bid = await readBid(provider, auction, bidId);
      states.push({
        exitState: await resolveCcaBidExitState(
          provider,
          auction,
          account,
          bidId,
          bid,
          context,
        ),
        settlement: {
          exited: bid.exitedBlock !== 0n,
          tokensFilled: bid.tokensFilled,
        },
      });
    } catch {
      states.push({
        exitState: {
          kind: "unavailable",
          label: "Eligibility check unavailable · retrying",
        },
        settlement: null,
      });
    }
  }
  return states;
}

export async function readCcaBidExitStates(
  provider: Eip1193Provider,
  auction: Address,
  account: Address,
  bidIds: readonly bigint[],
): Promise<CcaBidExitState[]> {
  return (await readCcaBidStates(
    provider,
    auction,
    account,
    bidIds,
  )).map(({ exitState }) => exitState);
}

export function encodeCcaBidExit(action: CcaBidExitAction): Hex {
  return encodeFunctionData({
    abi: ccaExitAuctionAbi,
    functionName: action.method,
    args: action.args,
  } as Parameters<typeof encodeFunctionData>[0]);
}
