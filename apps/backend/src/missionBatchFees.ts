import { parseAbi, serializeTransaction, type Hex, type PublicClient } from "viem";
import { batchCalldata, totalBatchExposure, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";

const priceAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
]);
const oracleAbi = parseAbi([
  "function getL1Fee(bytes data) view returns (uint256)",
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
  "function getOperatorFee(uint256 gasUsed) view returns (uint256)"
]);
const gasOracle = "0x420000000000000000000000000000000000000F" as const;

export async function quoteMissionBatch(client: PublicClient, input: {
  items: BatchLeg[]; nonce: number; account: Hex; game: Hex; chainId: number; policy: MissionBatchPolicy;
}) {
  if (![8453, 84532].includes(input.chainId) || !input.policy.priceFeed) throw new Error("batch fee oracle requires Base and configured ETH/USD feed");
  const data = batchCalldata(input.items);
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null || block.baseFeePerGas === null) throw new Error("fresh EIP-1559 block unavailable");
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new Error("stale fee block");
  const blockNumber = block.number;
  const [estimatedGas, tip, decimals, round] = await Promise.all([
    client.estimateGas({ account: input.account, to: input.game, data, nonce: input.nonce, blockNumber }),
    client.estimateMaxPriorityFeePerGas(),
    client.readContract({ address: input.policy.priceFeed, abi: priceAbi, functionName: "decimals", blockNumber }),
    client.readContract({ address: input.policy.priceFeed, abi: priceAbi, functionName: "latestRoundData", blockNumber })
  ]);
  if (round[4] < round[0]) throw new Error("ETH/USD oracle round incomplete");
  const gas = (estimatedGas * 120n + 99n) / 100n;
  const maxFeePerGas = block.baseFeePerGas * 2n + tip;
  const transaction = { type: "eip1559" as const, chainId: input.chainId, to: input.game, data,
    value: 0n, nonce: input.nonce, gas, maxFeePerGas, maxPriorityFeePerGas: tip };
  // GasPriceOracle getL1Fee expects the unsigned serialized tx and adds signature overhead.
  // Do NOT use viem estimateOperatorFee: it catches RPC errors and silently returns zero.
  const serialized = serializeTransaction(transaction);
  const [l1Exact, l1Upper, operatorFee] = await Promise.all([
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1Fee", args: [serialized], blockNumber }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [BigInt((serialized.length - 2) / 2)], blockNumber }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getOperatorFee", args: [gas], blockNumber })
  ]);
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new Error("fee quote expired during estimation");
  return totalBatchExposure({ estimatedGas, blockGasLimit: block.gasLimit, maxFeePerGas,
    maxPriorityFeePerGas: tip, l1Fee: l1Exact > l1Upper ? l1Exact : l1Upper, operatorFee, price: round[1], priceDecimals: decimals,
    updatedAt: round[3], nowSeconds: Math.floor(Date.now() / 1000), policy: input.policy });
}
