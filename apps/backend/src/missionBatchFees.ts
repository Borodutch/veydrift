import { decodeFunctionResult, parseAbi, parseTransaction, serializeTransaction, type Hex, type PublicClient } from "viem";
import { BatchCapacityError, BatchUnproductiveError, BatchWorkBudgetError, BatchWorkCeilingError, batchMaxWorkGas, batchWorkGas,resolverTransactionMaxFeeWei, missionBatchAbi, batchCalldata, totalBatchExposure, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";

import type { PreparedReconciliationPass } from "./resolverTransactions";
import { emitObservabilityEvent } from "./observability";
import { resolverReplacementFees, SupersessionUnavailableError } from "./resolverReplacementFees";

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
  // the signed gas limit is what bounds the work. Unused gas is not charged.
  const budgetWei = policy.maxFeeWei < resolverTransactionMaxFeeWei ? policy.maxFeeWei : resolverTransactionMaxFeeWei;
  const reserved = l1Fee * 2n + operatorFee * 2n;
  const affordable = budgetWei > reserved && maxFeePerGas > 0n ? (budgetWei - reserved) / maxFeePerGas : 0n;
  // Base refuses a transaction whose metered execution time is too long, permanently for its hash
  // (#397). Every batch is therefore signed at the per-transaction work budget whenever that is
  // productive, whatever the reference at the cap needed (a battle Settled at the cap may only make
  // Progress at the budget: it commits fewer stages and continues next tick). Nothing is ever signed
  // above the hard work ceiling.
  const workGas = batchWorkGas(policy);
  const maxWorkGas = batchMaxWorkGas(policy);
  const limit = affordable < cap ? affordable : cap;
  const ceiling = limit < maxWorkGas ? limit : maxWorkGas;
  if (ceiling <= 0n) throw new BatchCapacityError("total batch transaction network fee exceeds ETH cap");
  let gas = ceiling < workGas ? ceiling : workGas;
  const exposureAt = (signed: bigint) => totalBatchExposure({ gas: signed, blockGasLimit: block.gasLimit, maxFeePerGas,
    maxPriorityFeePerGas: tip, l1Fee, operatorFee, policy });
  let exposure = exposureAt(gas);
  // Throws unless every leg is still Settled or Progress at the exact signed gas.
  let exact: Awaited<ReturnType<typeof simulateProductiveBatch>> | undefined;
  try {
    exact = await simulateProductiveBatch(client, { ...input, data, blockNumber, gas,
      maxFeePerGas, maxPriorityFeePerGas: tip });
  } catch (error) {
    if (!(error instanceof BatchUnproductiveError)) throw error;
    // Several legs that do not fit the budget are split by packing (each leg is retried alone).
    if (input.items.length > 1) throw minimumGas > gas ? new BatchWorkBudgetError("batch work budget exceeded: " + error.message) : error;
    // A single leg whose first combat stage (or whole non-staged settlement) does not fit escalates
    // gradually (2x, 4x, ..., and its measured need + 20%) to the smallest productive envelope, but
    // never above the hard ceiling. Unproductive at the ceiling = an indivisible blocker.
    const candidates = new Set<bigint>();
    for (let next = gas * 2n; next < ceiling; next *= 2n) candidates.add(next);
    if (minimumGas > gas && minimumGas < ceiling) candidates.add(minimumGas);
    if (ceiling > gas) candidates.add(ceiling);
    let lastError: BatchUnproductiveError = error;
    exact = undefined;
    for (const candidate of [...candidates].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
      gas = candidate;
      exposure = exposureAt(gas);
      try {
        exact = await simulateProductiveBatch(client, { ...input, data, blockNumber, gas,
          maxFeePerGas, maxPriorityFeePerGas: tip });
        break;
      } catch (escalationError) {
        if (!(escalationError instanceof BatchUnproductiveError)) throw escalationError;
        lastError = escalationError;
      }
    }
    if (exact === undefined) throw new BatchWorkCeilingError("leg not productive within the " + ceiling.toString()
      + " gas work/fee ceiling (" + lastError.message + "); never signed heavier, Base refuses heavy execution");
    emitObservabilityEvent({ kind: "mission_batch_work_budget_exceeded", missionId: input.items[0]!.missionId, leg: input.items[0]!.leg,
      workGas: workGas.toString(), maxWorkGas: maxWorkGas.toString(), signedGas: gas.toString(),
      action: "single leg needs more than the per-transaction work budget (still within the hard ceiling); watch inclusion" }, "warn");
  }
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

/** Base (reth) mempool replacement rule: both fee fields must rise by at least 10%. */
const supersessionBumpPercent = 125n;

/**
 * Plan the single same-nonce alternative for an accepted batch envelope that the sequencer holds
 * but never includes (#397). Same chain, nonce, target and calldata; signed gas lowered to the
 * per-transaction work budget, both fee fields raised at least 25% and to the current quote. Base
 * meters execution time, so the alternative must do measurably less work than the original (an
 * exact simulation at each gas, same block): otherwise SupersessionUnavailableError, and the single
 * alternative is not spent on an envelope the builder would refuse again. The returned unsigned
 * envelope already passed the exact replay preflight (fee freshness, ETH caps, productive
 * simulation). Nothing is signed here.
 */
export async function planMissionSupersession(client: PublicClient, originalRaw: Hex, input: {
  items: BatchLeg[]; account: Hex; game: Hex; chainId: number; policy: MissionBatchPolicy;
}, pass: PreparedReconciliationPass): Promise<{ unsigned: Hex; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; guard: () => void; executionGasUsed: bigint; originalExecutionGasUsed: bigint }> {
  const original = parseTransaction(originalRaw);
  if (original.type !== "eip1559" || original.chainId !== input.chainId || original.to?.toLowerCase() !== input.game.toLowerCase()
    || original.data !== batchCalldata(input.items) || (original.value ?? 0n) !== 0n || original.nonce === undefined
    || original.gas === undefined || original.maxFeePerGas === undefined || original.maxPriorityFeePerGas === undefined
    || (original.accessList?.length ?? 0) !== 0) throw new Error("supersession original envelope mismatch");
  const workGas = batchWorkGas(input.policy);
  if (original.gas <= workGas) throw new SupersessionUnavailableError("supersession cannot reduce work: original already within the work budget");
  const block = await pass.read(() => client.getBlock({ blockTag: "latest" }));
  if (block.number === null || !block.hash || block.baseFeePerGas === null) throw new Error("supersession fee block unavailable");
  assertBatchQuoteFresh({ blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp });
  const tip = await pass.read(() => client.estimateMaxPriorityFeePerGas());
  const bump = (value: bigint) => (value * supersessionBumpPercent + 99n) / 100n;
  const maxPriorityFeePerGas = [bump(original.maxPriorityFeePerGas), tip].reduce((a, b) => a > b ? a : b);
  const maxFeePerGas = [bump(original.maxFeePerGas), block.baseFeePerGas * 2n + maxPriorityFeePerGas].reduce((a, b) => a > b ? a : b);
  const gas = workGas;
  const unsigned = serializeTransaction({ type: "eip1559", chainId: input.chainId, to: original.to!, data: original.data!,
    value: 0n, nonce: original.nonce, gas, maxFeePerGas, maxPriorityFeePerGas });
  let measured: { executionGasUsed: bigint } | undefined;
  let guard: () => void;
  try {
    guard = await validateMissionBatchReplay(client, unsigned, { ...input, blockNumber: block.number }, pass, false,
      (evidence) => { measured = { executionGasUsed: BigInt(JSON.parse(evidence).measured.executionGasUsed) }; });
  } catch (error) {
    // Only a non-productive lighter envelope is "unavailable"; fees, caps and transport stay fatal.
    if (error instanceof BatchUnproductiveError) throw new SupersessionUnavailableError("supersession cannot reduce work: lighter envelope is not productive (" + error.message + ")");
    throw error;
  }
  // Same block and original gas: the work the refused envelope does. No fee fields, so a base fee
  // above the original's cap (exactly when superseding helps) cannot fail this measurement.
  const reference = await pass.read(() => simulateProductiveBatch(client, { ...input, data: original.data!, nonce: original.nonce!,
    gas: original.gas!, blockNumber: block.number! }));
  if (!measured || measured.executionGasUsed * 10n > reference.executionGasUsed * 9n)
    throw new SupersessionUnavailableError("supersession cannot reduce work: lighter envelope does not do at least 10% less work");
  return { unsigned, gas, maxFeePerGas, maxPriorityFeePerGas, guard, executionGasUsed: measured.executionGasUsed, originalExecutionGasUsed: reference.executionGasUsed };
}
