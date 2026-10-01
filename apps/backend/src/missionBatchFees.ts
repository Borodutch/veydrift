import { decodeFunctionResult, parseAbi, serializeTransaction, type Hex, type PublicClient } from "viem";
import { BatchCapacityError, BatchUnproductiveError, missionBatchAbi, batchCalldata, totalBatchExposure, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";

const priceAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
]);
export const oracleAbi = parseAbi([
  "function getL1Fee(bytes data) view returns (uint256)",
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
  "function getOperatorFee(uint256 gasUsed) view returns (uint256)"
]);
export const gasOracle = "0x420000000000000000000000000000000000000F" as const;

/** Immutable provenance of the exact fee/simulation block and price used for USD exposure. */
export type BatchQuoteProvenance = Readonly<{
  blockNumber: bigint; blockHash: Hex; blockTimestamp: bigint;
  priceFeed: Hex; priceRoundId: bigint; priceUpdatedAt: bigint; priceMaxAgeSeconds: number;
}>;

export function assertBatchQuoteFresh(provenance: BatchQuoteProvenance, nowMs = Date.now()): void {
  if (Math.abs(nowMs / 1000 - Number(provenance.blockTimestamp)) > 30)
    throw new Error("batch quote block expired");
  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  if (provenance.priceUpdatedAt <= 0n || provenance.priceUpdatedAt > nowSeconds
    || nowSeconds - provenance.priceUpdatedAt > BigInt(provenance.priceMaxAgeSeconds))
    throw new Error("missing or stale ETH/USD price; batch blocked");
}

export async function quoteMissionBatch(client: PublicClient, input: {
  blockNumber?: bigint; items: BatchLeg[]; nonce: number; account: Hex; game: Hex; chainId: number; policy: MissionBatchPolicy;
}) {
  if (![8453, 84532].includes(input.chainId) || !input.policy.priceFeed) throw new Error("batch fee oracle requires Base and configured ETH/USD feed");
  // Snapshot policy before any await; exposure and final checks use the same feed/age/cap.
  const policy = Object.freeze({ ...input.policy });
  const data = batchCalldata(input.items);
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  if (block.number === null || !block.hash || block.baseFeePerGas === null) throw new Error("fresh EIP-1559 block unavailable");
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new Error("stale fee block");
  const blockNumber = block.number;
  const cap = block.gasLimit < 16_777_216n ? block.gasLimit : 16_777_216n;
  const [reference, tip, decimals, round] = await Promise.all([
    simulateProductiveBatch(client, { ...input, data, blockNumber, gas: cap }),
    client.estimateMaxPriorityFeePerGas(),
    client.readContract({ address: policy.priceFeed!, abi: priceAbi, functionName: "decimals", blockNumber }),
    client.readContract({ address: policy.priceFeed!, abi: priceAbi, functionName: "latestRoundData", blockNumber })
  ]);
  if (round[4] < round[0]) throw new Error("ETH/USD oracle round incomplete");
  const provenance: BatchQuoteProvenance = Object.freeze({ blockNumber, blockHash: block.hash,
    blockTimestamp: block.timestamp, priceFeed: policy.priceFeed!, priceRoundId: round[0],
    priceUpdatedAt: round[3], priceMaxAgeSeconds: policy.priceMaxAgeSeconds });
  // The returned meter starts inside the module: add intrinsic/calldata, proxy dispatch,
  // EIP-150 forwarding loss and tail/reserve before the existing 20% safety margin.
  const estimatedGas = measuredBatchGas(reference.executionGasUsed, data, input.items.length);
  const gas = (estimatedGas * 120n + 99n) / 100n;
  if (gas > cap) throw new BatchCapacityError("productive batch gas envelope exceeded");
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
  const exposure = totalBatchExposure({ estimatedGas, blockGasLimit: block.gasLimit, maxFeePerGas,
    maxPriorityFeePerGas: tip, l1Fee: l1Exact > l1Upper ? l1Exact : l1Upper, operatorFee, price: round[1], priceDecimals: decimals,
    updatedAt: round[3], nowSeconds: Math.floor(Date.now() / 1000), policy });
  const exact = await simulateProductiveBatch(client, { ...input, data, blockNumber, gas,
    maxFeePerGas, maxPriorityFeePerGas: tip });
  if (exact.outcomes.some((outcome, i) => outcome !== reference.outcomes[i]))
    throw new BatchCapacityError("exact signed gas changed productive progress; repack without raising cap");
  assertBatchQuoteFresh(provenance); // exact eth_call can outlive either freshness window
  return Object.freeze({ ...exposure, blockNumber, provenance, outcomes: exact.outcomes, executionGasUsed: exact.executionGasUsed });
}

export const batchOutcomeNames = ["Settled", "Pending", "AlreadySettled", "Invalid", "NotDue", "Failed", "GasLimited", "Progress"] as const;

export function measuredBatchGas(executionGasUsed: bigint, data: Hex, count: number): bigint {
  let intrinsic = 21_000n;
  for (let i = 2; i < data.length; i += 2) intrinsic += data.slice(i, i + 2) === "00" ? 4n : 16n;
  return intrinsic + (executionGasUsed * 64n + 62n) / 63n + 120_000n + BigInt(count) * 8_000n;
}

async function simulateProductiveBatch(client: PublicClient, input: {
  items: BatchLeg[]; account: Hex; game: Hex; data: Hex; nonce: number; gas: bigint; blockNumber: bigint;
  maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint;
}) {
  const result = await client.call({ account: input.account, to: input.game, data: input.data,
    nonce: input.nonce, value: 0n, gas: input.gas, blockNumber: input.blockNumber,
    ...(input.maxFeePerGas === undefined ? {} : { maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas }) });
  if (!result.data) throw new Error("batch productive measurement unavailable");
  const [outcomes, executionGasUsed] = decodeFunctionResult({ abi: missionBatchAbi,
    functionName: "resolveFleetMissionBatch", data: result.data });
  if (outcomes.length !== input.items.length || executionGasUsed <= 0n || executionGasUsed > input.gas)
    throw new Error("invalid batch productive measurement");
  const rejected = input.items.flatMap((item, i) => outcomes[i] === 0 || outcomes[i] === 7 ? []
    : [{ item, reason: batchOutcomeNames[outcomes[i]!] ?? "UnknownOutcome", terminal: outcomes[i] === 2 || outcomes[i] === 3 }]);
  if (rejected.length) throw new BatchUnproductiveError(rejected);
  return { outcomes, executionGasUsed };
}

/** Unknown OP receipt extensions are raw RPC hex even with a generic viem chain. */
export function rpcQuantity(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}
