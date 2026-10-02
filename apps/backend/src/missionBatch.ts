import { encodeFunctionData, parseAbi, type Hex } from "viem";

export const missionBatchAbi = parseAbi([
  "function resolveFleetMissionBatch((uint256 missionId,uint8 leg)[] items) returns (uint8[] outcomes,uint256 executionGasUsed)"
]);
export type BatchLeg = { missionId: string; leg: "arrival" | "return"; dueAt: number; chronologyKind?: 0 | 1 | 2 };
export type BatchExclusion = { item: BatchLeg; reason: string; terminal?: boolean; unproductive?: boolean };
export type BatchLegOutcome = { item: BatchLeg; outcome: string; errorSelector: string | null; blockedDependency: string | null; complete: boolean };
export type MissionBatchPolicy = {
  enabled: boolean;
  maxItems: number;
  maxFeeWei: bigint;
};
export const resolverTransactionMaxFeeWei = 200_000_000_000_000n;
export const resolverBatchMaxFeeWei = 400_000_000_000_000n;
export const defaultMissionBatchPolicy: MissionBatchPolicy = {
  enabled: false, maxItems: 16, maxFeeWei: resolverBatchMaxFeeWei
};
export function loadMissionBatchPolicy(env: Record<string, string | undefined>, problems: Array<{ field: string; message: string }>): MissionBatchPolicy {
  const prefix = "VEYDRIFT_MISSION_BATCH_";
  const enabled = env[prefix + "ENABLED"] === "true";
  const maxItems = Number(env[prefix + "MAX_ITEMS"] ?? 16);
  const rawWei = env[prefix + "MAX_FEE_WEI"] ?? resolverBatchMaxFeeWei.toString();
  const maxFeeWei = /^[0-9]{1,18}$/.test(rawWei) ? BigInt(rawWei) : 0n;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 32) problems.push({ field: prefix + "MAX_ITEMS", message: "must be 1..32" });
  if (maxFeeWei <= 0n || maxFeeWei > resolverBatchMaxFeeWei) problems.push({ field: prefix + "MAX_FEE_WEI", message: "must be positive and at most 400000000000000 wei (0.0004 ETH)" });
  if (enabled && !env.VEYDRIFT_MISSION_RESOLVER_PRIVATE_KEY) problems.push({ field: prefix + "ENABLED", message: "requires local signer; unlocked batching unsupported" });
  return { enabled, maxItems, maxFeeWei };
}
export function batchCalldata(items: readonly BatchLeg[]): Hex {
  return encodeFunctionData({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch",
    args: [items.map((item) => ({ missionId: BigInt(item.missionId), leg: item.leg === "arrival" ? 0 : 1 }))] });
}
export function compareBatchLegs(a: BatchLeg, b: BatchLeg): number {
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  const ak = a.chronologyKind ?? (a.leg === "arrival" ? 0 : 1), bk = b.chronologyKind ?? (b.leg === "arrival" ? 0 : 1);
  if (ak !== bk) return ak - bk;
  return BigInt(a.missionId) < BigInt(b.missionId) ? -1 : BigInt(a.missionId) > BigInt(b.missionId) ? 1 : 0;
}
export class BatchCapacityError extends Error {}
export class BatchUnproductiveError extends BatchCapacityError {
  constructor(readonly rejected: BatchExclusion[]) { super(rejected.map((x) => `${x.item.missionId}:${x.reason}`).join(", ")); }
}
export type BatchQuote = {
  gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint;
  l1Fee: bigint; operatorFee: bigint; totalWei: bigint;
};
export function totalBatchExposure(input: {
  gas: bigint; blockGasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint;
  l1Fee: bigint; operatorFee: bigint; policy: MissionBatchPolicy;
}): BatchQuote {
  const { policy } = input;
  if (policy.maxFeeWei <= 0n || policy.maxFeeWei > resolverBatchMaxFeeWei) throw new Error("invalid batch ETH budget");
  if (input.gas <= 0n || input.maxFeePerGas <= 0n || input.maxPriorityFeePerGas < 0n
    || input.maxPriorityFeePerGas > input.maxFeePerGas || input.l1Fee < 0n || input.operatorFee < 0n) throw new Error("invalid batch fee estimate");
  const { gas } = input;
  if (gas > 16_777_216n || gas > input.blockGasLimit) throw new BatchCapacityError("batch gas envelope exceeded");
  // L1/operator estimates receive a separate 2x headroom; EIP-1559 uses the signed maximum,
  // NOT effective gas price. OP non-execution fees are not capped by EIP-1559 on chain.
  const l1Fee = input.l1Fee * 2n;
  const operatorFee = input.operatorFee * 2n;
  const totalWei = gas * input.maxFeePerGas + l1Fee + operatorFee;
  if (totalWei > policy.maxFeeWei || totalWei > resolverTransactionMaxFeeWei) throw new BatchCapacityError("total batch transaction network fee exceeds ETH cap");
  return { gas, maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    l1Fee, operatorFee, totalWei };
}

/** Bounded greedy chronological packing: at most 2N estimates; skip an indivisible poison,
 * never rearrange chosen legs. On-chain 905 guards keep its dependent later legs blocked. */
export async function packMissionBatch<T>(items: readonly BatchLeg[], maxItems: number,
  estimate: (items: BatchLeg[]) => Promise<T>, blocked: (item: BatchLeg, reason: string) => void
): Promise<{ items: BatchLeg[]; quote?: T; estimates: number; exclusions: BatchExclusion[] }> {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 32) throw new Error("batch maxItems must be 1..32");
  const deadline = Date.now() + 20_000;
  const selected: BatchLeg[] = [];
  const exclusions: BatchExclusion[] = [];
  // Unproductive = the exact simulation rejected the leg (chronology blocker, pending oracle):
  // unpaid and expected to clear on its own, unlike a genuine gas/fee capacity problem.
  const exclude = (item: BatchLeg, reason: string, error: unknown) => {
    const unproductive = error instanceof BatchUnproductiveError;
    exclusions.push({ item, reason, ...(unproductive ? { unproductive } : {}) });
    if (!unproductive) blocked(item, reason);
  };
  let quote: T | undefined;
  let estimates = 0;
  for (const item of [...items].sort(compareBatchLegs)) {
    if (selected.length >= maxItems || Date.now() >= deadline) break;
    if (selected.some((other) => other.missionId === item.missionId && other.leg === item.leg)) continue;
    try {
      estimates++;
      quote = await estimate([...selected, item]);
      selected.push(item);
    } catch (error) {
      // Transport/price errors fail the entire attempt, never masquerade as capacity.
      if (!(error instanceof BatchCapacityError)) throw error;
      if (selected.length) {
        try { estimates++; await estimate([item]); }
        catch (singleError) {
          if (!(singleError instanceof BatchCapacityError)) throw singleError;
          exclude(item, singleError.message, singleError);
          continue;
        }
        exclude(item, "batch-capacity-or-dependency: " + error.message, error);
      } else exclude(item, error.message, error);
    }
  }
  return { items: selected, exclusions, ...(quote === undefined ? {} : { quote }), estimates };
}
