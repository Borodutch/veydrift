import { encodeFunctionData, type Address } from "viem";

import type { Eip1193Provider } from "./walletFlow";

const auctionReadAbi = [
  {
    type: "function",
    name: "clearingPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "endBlock",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export type CcaAuctionBoundary = {
  clearingPriceQ96: bigint;
  currentBlock: bigint;
  endBlock: bigint;
};

export async function readCcaAuctionBoundary(
  provider: Eip1193Provider,
  auction: Address,
): Promise<CcaAuctionBoundary> {
  const [clearingPrice, endBlock, currentBlock] = await Promise.all([
    provider.request<string>({
      method: "eth_call",
      params: [{
        to: auction,
        data: encodeFunctionData({ abi: auctionReadAbi, functionName: "clearingPrice" }),
      }, "latest"],
    }),
    provider.request<string>({
      method: "eth_call",
      params: [{
        to: auction,
        data: encodeFunctionData({ abi: auctionReadAbi, functionName: "endBlock" }),
      }, "latest"],
    }),
    provider.request<string>({ method: "eth_blockNumber" }),
  ]);

  return {
    clearingPriceQ96: BigInt(clearingPrice),
    currentBlock: BigInt(currentBlock),
    endBlock: BigInt(endBlock),
  };
}

type CcaBidSequenceOptions<Result> = {
  fundingCurrency: "eth" | "weth";
  wrapEth: () => Promise<void>;
  approveWeth: () => Promise<void>;
  approvePermit2: () => Promise<void>;
  revalidateAuction: () => Promise<void>;
  submitBid: () => Promise<Result>;
};

export async function executeCcaBidSequence<Result>({
  fundingCurrency,
  wrapEth,
  approveWeth,
  approvePermit2,
  revalidateAuction,
  submitBid,
}: CcaBidSequenceOptions<Result>) {
  if (fundingCurrency === "eth") await wrapEth();
  await approveWeth();
  await approvePermit2();

  // This check deliberately lives after every prerequisite confirmation and
  // directly before the final auction write.
  await revalidateAuction();
  return submitBid();
}
