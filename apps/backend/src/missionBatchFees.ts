import { decodeFunctionResult, parseAbi, serializeTransaction, type Hex, type PublicClient } from "viem";
import { BatchUnproductiveError, missionBatchAbi, batchCalldata, totalBatchExposure, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";

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
  // Snapshot policy before any await; exposure and final checks use the same feed/age/cap.
  const priceFeed = input.policy.priceFeed ?? defaultEthUsdFeeds[input.chainId];
  if (![8453, 84532].includes(input.chainId) || !priceFeed) throw new Error("batch fee oracle requires Base and an ETH/USD feed");
  // A batch is still one transaction: enforce the stricter $0.50 transaction ceiling
  // as well as the configured (at most $1) aggregate batch policy.
  const policy = Object.freeze({ ...input.policy, priceFeed,
    maxFeeUsdMicros: input.policy.maxFeeUsdMicros < singleResolverMaxUsdMicros
      ? input.policy.maxFeeUsdMicros : singleResolverMaxUsdMicros });
  const data = batchCalldata(input.items);
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  if (block.number === null || !block.hash || block.baseFeePerGas === null) throw new Error("fresh EIP-1559 block unavailable");
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new Error("stale fee block");
  const blockNumber = block.number;
  const cap = block.gasLimit < 16_777_216n ? block.gasLimit : 16_777_216n;
  const [reference, tip, decimals, round] = await Promise.all([
    simulateProductiveBatch(client, { ...input, data, blockNumber, gas: cap }),
    client.estimateMaxPriorityFeePerGas(),
    client.readContract({ address: policy.priceFeed, abi: priceAbi, functionName: "decimals", blockNumber }),
    client.readContract({ address: policy.priceFeed, abi: priceAbi, functionName: "latestRoundData", blockNumber })
  ]);
  if (round[4] < round[0]) throw new Error("ETH/USD oracle round incomplete");
  const provenance: BatchQuoteProvenance = Object.freeze({ blockNumber, blockHash: block.hash,
    blockTimestamp: block.timestamp, priceFeed: policy.priceFeed!, priceRoundId: round[0],
    priceUpdatedAt: round[3], priceMaxAgeSeconds: policy.priceMaxAgeSeconds });
  // The returned meter starts inside the module: add intrinsic/calldata, proxy dispatch,
  // EIP-150 forwarding loss and tail/reserve before the existing 20% safety margin.
  const estimatedGas = measuredBatchGas(reference.executionGasUsed, data, input.items.length);
  const minimumGas = (estimatedGas * 120n + 99n) / 100n;
  const maxFeePerGas = block.baseFeePerGas * 2n + tip;
  // L1 data and operator fees are quoted at the cap: an upper bound for any smaller signed gas.
  const transaction = { type: "eip1559" as const, chainId: input.chainId, to: input.game, data,
    value: 0n, nonce: input.nonce, gas: cap, maxFeePerGas, maxPriorityFeePerGas: tip };
  // GasPriceOracle getL1Fee expects the unsigned serialized tx and adds signature overhead.
  // Do NOT use viem estimateOperatorFee: it catches RPC errors and silently returns zero.
  const serialized = serializeTransaction(transaction);
  const [l1Exact, l1Upper, operatorFee] = await Promise.all([
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1Fee", args: [serialized], blockNumber }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [BigInt((serialized.length - 2) / 2)], blockNumber }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getOperatorFee", args: [cap], blockNumber })
  ]);
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new Error("fee quote expired during estimation");
  const l1Fee = l1Exact > l1Upper ? l1Exact : l1Upper;
  // Staged battles use whatever gas they get and only start another stage with headroom left, so
  // sign as much as the USD cap affords (unused gas is not charged), up to the cap, never below
  // the measured estimate + 20%. A battle that cannot finish even at the cap (Progress) may
  // shrink below that estimate and simply commits fewer stages.
  const budgetWei = round[1] > 0n
    ? policy.maxFeeUsdMicros * 10n ** BigInt(18 + decimals) / (round[1] * 1_000_000n) : 0n;
  const reserved = l1Fee * 2n + operatorFee * 2n;
  const affordable = budgetWei > reserved && maxFeePerGas > 0n ? (budgetWei - reserved) / maxFeePerGas : 0n;
  let gas = affordable < cap ? affordable : cap;
  if (gas < minimumGas && !(reference.outcomes.includes(7) && gas > 0n)) gas = minimumGas < cap ? minimumGas : cap;
  const exposure = totalBatchExposure({ gas, blockGasLimit: block.gasLimit, maxFeePerGas,
    maxPriorityFeePerGas: tip, l1Fee, operatorFee, price: round[1], priceDecimals: decimals,
    updatedAt: round[3], nowSeconds: Math.floor(Date.now() / 1000), policy });
  // Throws unless every leg is still Settled or Progress at the exact signed gas. Settled turning
  // into Progress is fine: the battle commits fewer stages and continues next tick.
  const exact = await simulateProductiveBatch(client, { ...input, data, blockNumber, gas,
    maxFeePerGas, maxPriorityFeePerGas: tip });
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

/** Chainlink ETH/USD on Base, used when no feed is configured (verified on-chain "ETH / USD"). */
export const defaultEthUsdFeeds: Record<number, Hex> = {
  8453: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  84532: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"
};
/** Hard per-transaction ceiling for single-call resolver writes. */
export const singleResolverMaxUsdMicros = 500_000n;
/** Base's ETH/USD feed heartbeat is 20 minutes; a cost ceiling tolerates an hour-old price. */
export const resolverPriceMaxAgeSeconds = 3_600;
export class ResolverFeeCapError extends Error {}

export async function initialResolverFees(client: PublicClient): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const [block, tip] = await Promise.all([client.getBlock({ blockTag: "latest" }), client.estimateMaxPriorityFeePerGas()]);
  if (block.baseFeePerGas === null) throw new Error("EIP-1559 base fee unavailable");
  return { maxFeePerGas: block.baseFeePerGas * 2n + tip, maxPriorityFeePerGas: tip };
}

/** Largest gas (at most `gas`) whose worst case — gas*maxFee plus 2x L1 data and operator fee —
 * stays within `maxUsdMicros` at the quoted price. Unsupported chains fail closed.
 * OP L1/operator charges and USD prices cannot be capped by an EIP-1559 envelope at inclusion. */
type ResolverGasBudget = {
  chainId: number; dataBytes: number; gas: bigint; maxFeePerGas: bigint; priceFeed?: Hex | undefined; maxUsdMicros: bigint;
};
export async function usdCappedGas(client: PublicClient, input: ResolverGasBudget): Promise<bigint> {
  return (await quoteResolverGas(client, input)).gas;
}

export async function quoteResolverGas(client: PublicClient, input: ResolverGasBudget) {
  const startedAt = Date.now();
  const feed = input.priceFeed ?? defaultEthUsdFeeds[input.chainId];
  if (![8453, 84532].includes(input.chainId) || !feed) throw new Error("resolver fee cap requires Base and an ETH/USD feed");
  const [decimals, round, l1Upper, operatorFee] = await Promise.all([
    client.readContract({ address: feed, abi: priceAbi, functionName: "decimals" }),
    client.readContract({ address: feed, abi: priceAbi, functionName: "latestRoundData" }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [BigInt(input.dataBytes + 200)] }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getOperatorFee", args: [input.gas] })
  ]);
  const age = Math.floor(Date.now() / 1000) - Number(round[3]);
  if (round[1] <= 0n || round[3] <= 0n || round[4] < round[0] || age < 0 || age > resolverPriceMaxAgeSeconds
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("missing or stale ETH/USD price; resolver fee cap cannot be enforced");
  if (l1Upper < 0n || operatorFee < 0n || input.gas <= 0n || input.maxUsdMicros <= 0n || input.maxUsdMicros > singleResolverMaxUsdMicros)
    throw new ResolverFeeCapError("invalid resolver fee budget");
  const budgetWei = input.maxUsdMicros * 10n ** BigInt(18 + decimals) / (round[1] * 1_000_000n);
  const reserved = l1Upper * 2n + operatorFee * 2n;
  if (budgetWei <= reserved || input.maxFeePerGas <= 0n) throw new ResolverFeeCapError("network fees exceed the resolver USD cap");
  const affordable = (budgetWei - reserved) / input.maxFeePerGas;
  const assertFresh = () => {
    const now = Date.now();
    const priceAge = Math.floor(now / 1000) - Number(round[3]);
    if (now < startedAt || now - startedAt > 30_000 || priceAge < 0 || priceAge > resolverPriceMaxAgeSeconds)
      throw new ResolverFeeCapError("resolver fee quote expired before signing");
  };
  assertFresh();
  return Object.freeze({ gas: affordable < input.gas ? affordable : input.gas, assertFresh });
}
