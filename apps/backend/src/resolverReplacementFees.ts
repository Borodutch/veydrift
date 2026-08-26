import type { Hex, PublicClient } from "viem";

export type ResolverReplacementFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

const replacementNumerator = 125n;
const replacementDenominator = 100n;

export async function resolverTransactionNeedsReplacement(
  publicClient: PublicClient,
  transactionHash: Hex
): Promise<boolean> {
  const [transaction, pendingBlock] = await Promise.all([
    publicClient.getTransaction({ hash: transactionHash }),
    publicClient.getBlock({ blockTag: "pending" })
  ]);
  const transactionFeeCap = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n;
  const pendingBaseFee = pendingBlock.baseFeePerGas ?? 0n;
  return transactionFeeCap < pendingBaseFee;
}

/**
 * Build an EIP-1559 replacement that clears both the node's replacement threshold and the current
 * Base fee. The previous transaction remains the same durable resolver operation and nonce; only
 * its fees change.
 */
export async function resolverReplacementFees(
  publicClient: PublicClient,
  transactionHash: Hex
): Promise<ResolverReplacementFees> {
  const [previous, current] = await Promise.all([
    publicClient.getTransaction({ hash: transactionHash }),
    publicClient.estimateFeesPerGas()
  ]);
  const previousMaxFee = previous.maxFeePerGas ?? previous.gasPrice ?? 0n;
  const previousPriorityFee = previous.maxPriorityFeePerGas ?? previous.gasPrice ?? 0n;
  const currentMaxFee = current.maxFeePerGas ?? current.gasPrice ?? 0n;
  const currentPriorityFee = current.maxPriorityFeePerGas ?? 0n;
  const maxPriorityFeePerGas = maxBigInt(
    bumpReplacementFee(previousPriorityFee),
    currentPriorityFee
  );
  const maxFeePerGas = maxBigInt(
    bumpReplacementFee(previousMaxFee),
    currentMaxFee,
    maxPriorityFeePerGas
  );
  return { maxFeePerGas, maxPriorityFeePerGas };
}

function bumpReplacementFee(value: bigint): bigint {
  if (value === 0n) return 0n;
  return (value * replacementNumerator + replacementDenominator - 1n) / replacementDenominator;
}

function maxBigInt(...values: bigint[]): bigint {
  return values.reduce((maximum, value) => value > maximum ? value : maximum, 0n);
}
