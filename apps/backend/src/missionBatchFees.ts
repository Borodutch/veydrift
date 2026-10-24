import { decodeFunctionResult, parseAbi, parseTransaction, serializeTransaction, type Hex, type PublicClient } from "viem";
import { BatchUnproductiveError, resolverTransactionMaxFeeWei, missionBatchAbi, batchCalldata, totalBatchExposure, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";

import type { PreparedReconciliationPass } from "./resolverTransactions";
import { resolverReplacementFees } from "./resolverReplacementFees";

export const oracleAbi = parseAbi([
  "function getL1Fee(bytes data) view returns (uint256)",
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
  "function getOperatorFee(uint256 gasUsed) view returns (uint256)"
]);
export const gasOracle = "0x420000000000000000000000000000000000000F" as const;

/** Immutable provenance of the exact fee/simulation block used for ETH exposure. */
export type BatchQuoteProvenance = Readonly<{
  blockNumber: bigint; blockHash: Hex; blockTimestamp: bigint;
}>;

export class BatchQuoteExpiredError extends Error { constructor() { super("batch quote block expired"); } }

export function assertBatchQuoteFresh(provenance: BatchQuoteProvenance, nowMs = Date.now()): void {
  if (typeof provenance.blockTimestamp !== "bigint" || provenance.blockTimestamp <= 0n
    || Math.abs(nowMs / 1000 - Number(provenance.blockTimestamp)) > 30)
    throw new BatchQuoteExpiredError();

}

export async function quoteMissionBatch(client: PublicClient, input: {
  blockNumber?: bigint; items: BatchLeg[]; nonce: number; account: Hex; game: Hex; chainId: number; policy: MissionBatchPolicy;
}) {
  if (![8453, 84532].includes(input.chainId)) throw new Error("batch fee oracle requires Base");
  // The batch API emits exactly one envelope, bounded by both the configured batch
  // aggregate and the stricter immutable per-transaction ETH ceiling.
  const policy = Object.freeze({ ...input.policy });
  const data = batchCalldata(input.items);
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  if (typeof block.number !== "bigint" || !block.hash || block.baseFeePerGas === null) throw new Error("fresh EIP-1559 block unavailable");
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new BatchQuoteExpiredError();
  const blockNumber = block.number;
  const cap = block.gasLimit < 16_777_216n ? block.gasLimit : 16_777_216n;
  const [reference, tip] = await Promise.all([
    simulateProductiveBatch(client, { ...input, data, blockNumber, gas: cap }),
    client.estimateMaxPriorityFeePerGas()
  ]);
  const provenance: BatchQuoteProvenance = Object.freeze({ blockNumber, blockHash: block.hash,
    blockTimestamp: block.timestamp });
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
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 30) throw new BatchQuoteExpiredError();
  const l1Fee = l1Exact > l1Upper ? l1Exact : l1Upper;
  // Staged battles use whatever gas they get and only start another stage with headroom left, so
  // sign as much as the ETH cap affords (unused gas is not charged), up to the cap, never below
  // the measured estimate + 20%. A battle that cannot finish even at the cap (Progress) may
  // shrink below that estimate and simply commits fewer stages.
  const budgetWei = policy.maxFeeWei < resolverTransactionMaxFeeWei ? policy.maxFeeWei : resolverTransactionMaxFeeWei;
  const reserved = l1Fee * 2n + operatorFee * 2n;
  const affordable = budgetWei > reserved && maxFeePerGas > 0n ? (budgetWei - reserved) / maxFeePerGas : 0n;
  let gas = affordable < cap ? affordable : cap;
  if (gas < minimumGas && !(reference.outcomes.includes(7) && gas > 0n)) gas = minimumGas < cap ? minimumGas : cap;
  const exposure = totalBatchExposure({ gas, blockGasLimit: block.gasLimit, maxFeePerGas,
    maxPriorityFeePerGas: tip, l1Fee, operatorFee, policy });
  // Throws unless every leg is still Settled or Progress at the exact signed gas. Settled turning
  // into Progress is fine: the battle commits fewer stages and continues next tick.
  const exact = await simulateProductiveBatch(client, { ...input, data, blockNumber, gas,
    maxFeePerGas, maxPriorityFeePerGas: tip });
  assertBatchQuoteFresh(provenance); // exact eth_call can outlive the freshness window
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
}, allowAlreadySettled = false) {
  const result = await client.call({ account: input.account, to: input.game, data: input.data,
    nonce: input.nonce, value: 0n, gas: input.gas, blockNumber: input.blockNumber,
    ...(input.maxFeePerGas === undefined ? {} : { maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas }) });
  if (!result.data) throw new Error("batch productive measurement unavailable");
  const [outcomes, executionGasUsed] = decodeFunctionResult({ abi: missionBatchAbi,
    functionName: "resolveFleetMissionBatch", data: result.data });
  if (outcomes.length !== input.items.length || executionGasUsed <= 0n || executionGasUsed > input.gas)
    throw new Error("invalid batch productive measurement");
  const rejected = input.items.flatMap((item, i) => outcomes[i] === 0 || outcomes[i] === 7 || (allowAlreadySettled && outcomes[i] === 2) ? []
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

/** Fixed per-transaction quote ceiling, independent of ETH/USD. */
export const singleResolverMaxFeeWei = resolverTransactionMaxFeeWei;
export class ResolverFeeCapError extends Error {}

export async function initialResolverFees(client: PublicClient) {
  const [block, tip] = await Promise.all([client.getBlock({ blockTag: "latest" }), client.estimateMaxPriorityFeePerGas()]);
  if (typeof block.number !== "bigint" || block.number < 0n || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")
    || typeof block.baseFeePerGas !== "bigint" || block.baseFeePerGas < 0n
    || typeof tip !== "bigint" || tip < 0n || block.baseFeePerGas * 2n + tip <= 0n)
    throw new Error("fresh EIP-1559 fee inputs unavailable or invalid");
  const provenance = Object.freeze({ blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp });
  const assertFresh = () => assertBatchQuoteFresh(provenance);
  assertFresh();
  return Object.freeze({ fees: Object.freeze({ maxFeePerGas: block.baseFeePerGas * 2n + tip, maxPriorityFeePerGas: tip }),
    provenance, assertFresh });
}

/** Largest gas whose execution max plus 2x Base L1/operator reserves fits 0.0002 ETH.
 * A quote-time ceiling, not a promise about variable inclusion-time Base charges. */
export async function quoteResolverGas(client: PublicClient, input: {
  chainId: number; dataBytes: number; gas: bigint; previousHash?: Hex;
}) {
  if (![8453, 84532].includes(input.chainId)) throw new Error("resolver fee cap requires Base");
  // Execution maximum and all Base reserves share this one validated fee block.
  // Never pair stale execution fees with a later fresh oracle snapshot.
  const snapshot = await initialResolverFees(client);
  const fees = input.previousHash
    ? await resolverReplacementFees(client, input.previousHash, snapshot.fees) : snapshot.fees;
  const assertFresh = snapshot.assertFresh;
  const blockNumber = snapshot.provenance.blockNumber;
  assertFresh();
  const [l1Upper, operatorFee] = await Promise.all([
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [BigInt(input.dataBytes + 200)], blockNumber }),
    client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getOperatorFee", args: [input.gas], blockNumber })
  ]);
  if (typeof l1Upper !== "bigint" || l1Upper < 0n || typeof operatorFee !== "bigint" || operatorFee < 0n
    || typeof input.gas !== "bigint" || input.gas <= 0n || fees.maxFeePerGas <= 0n)
    throw new ResolverFeeCapError("invalid resolver fee estimate");
  const reserved = l1Upper * 2n + operatorFee * 2n;
  if (singleResolverMaxFeeWei <= reserved) throw new ResolverFeeCapError("network fees exceed the resolver ETH cap");
  const affordable = (singleResolverMaxFeeWei - reserved) / fees.maxFeePerGas;
  const gas = affordable < input.gas ? affordable : input.gas;
  if (gas <= 0n) throw new ResolverFeeCapError("network fees exceed the resolver ETH cap");
  assertFresh();
  return Object.freeze({ gas, ...fees, assertFresh });
}

/** Replay never changes gas/fees/calldata. Refresh uncapped Base charges at a canonical block. */
export async function validateMissionBatchReplay(client: PublicClient, raw: Hex, input: {
  items: BatchLeg[]; account: Hex; game: Hex; chainId: number; policy: MissionBatchPolicy; blockNumber?: bigint;
}, pass: PreparedReconciliationPass, recoveryAlreadySettled = false, observe?: (evidence: string) => void): Promise<() => void> {
  const tx = parseTransaction(raw);
  if (tx.type !== "eip1559" || tx.chainId !== input.chainId || tx.to?.toLowerCase() !== input.game.toLowerCase()
    || tx.data !== batchCalldata(input.items) || (tx.value ?? 0n) !== 0n || tx.nonce === undefined
    || tx.gas === undefined || tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined
    || ![8453, 84532].includes(input.chainId)) throw new Error("replay mission envelope mismatch");
  const block = await pass.read(() => client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber }));
  if (block.number === null || !block.hash || block.baseFeePerGas === null) throw new Error("replay fee block unavailable");
  const provenance = { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp };
  assertBatchQuoteFresh(provenance);
  if (block.baseFeePerGas > tx.maxFeePerGas) throw new Error("fixed replay fee below current base fee; wait, never replace");
  // getL1Fee adds signature overhead itself; strip only signature, never change envelope fields.
  const unsigned = serializeTransaction({ type: "eip1559", chainId: tx.chainId!, to: tx.to, data: tx.data,
    value: tx.value ?? 0n, nonce: tx.nonce, gas: tx.gas, maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas, accessList: tx.accessList });
  const blockNumber = block.number, gas = tx.gas;
  const exact = await pass.read(() => client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1Fee", args: [unsigned], blockNumber }));
  const upper = await pass.read(() => client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [BigInt((unsigned.length - 2) / 2)], blockNumber }));
  const operatorFee = await pass.read(() => client.readContract({ address: gasOracle, abi: oracleAbi, functionName: "getOperatorFee", args: [gas], blockNumber }));
  const exposure = totalBatchExposure({ gas: tx.gas, blockGasLimit: block.gasLimit, maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas, l1Fee: exact > upper ? exact : upper, operatorFee, policy: input.policy });
  const simulation = { ...input, data: tx.data!, nonce: tx.nonce, gas: tx.gas,
    maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, blockNumber };
  const measured = await pass.read(() => simulateProductiveBatch(client, simulation, recoveryAlreadySettled));
  const canonical = await pass.read(() => client.getBlock({ blockNumber }));
  if (canonical.hash !== block.hash) throw new Error("replay fee block changed");
  assertBatchQuoteFresh(provenance);
  observe?.(JSON.stringify({provenance,exposure,measured,l1Exact:exact,l1Upper:upper,operatorFee},(_,value)=>typeof value === "bigint" ? value.toString() : value));
  return () => assertBatchQuoteFresh(provenance);
}
