import { keccak256, parseTransaction, recoverTransactionAddress, type TransactionSerialized, type Hex } from "viem";
import type { MissionProgress } from "./progress";
import type { JsonRpcTransport } from "./transport";

export type SignedAttempt = {
  raw: Hex; hash: Hex; nonce: string; progress?: MissionProgress;
};
export type AttemptStore = {
  attemptKeys(): string[];
  getAttempt(key: string): SignedAttempt | undefined;
  putAttempt(key: string, attempt: SignedAttempt): void;
  removeAttempt(key: string): void;
};

export function signedAttempt(raw: Hex, nonce: number, progress?: MissionProgress): SignedAttempt {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(raw)) throw new Error("invalid signed transaction");
  return { raw, hash: keccak256(raw), nonce: String(nonce), ...(progress ? { progress } : {}) };
}

export async function assertSignedTarget(attempt: SignedAttempt, expected: {
  from: Hex; to: Hex; data: Hex; chainId: number; maxGas: bigint;
}): Promise<void> {
  const tx = parseTransaction(attempt.raw);
  if (tx.to?.toLowerCase() !== expected.to.toLowerCase() || tx.data !== expected.data
    || tx.chainId !== expected.chainId || String(tx.nonce) !== attempt.nonce
    || (tx.value ?? 0n) !== 0n || tx.gas === undefined || tx.gas > expected.maxGas
    || (await recoverTransactionAddress({ serializedTransaction: attempt.raw as TransactionSerialized })).toLowerCase() !== expected.from.toLowerCase()) {
    throw new Error("persisted signed transaction does not match authorized mission envelope");
  }
}

/** Never allocate a second nonce to recover an unknown send. A signed payload is persisted before
 * RPC dispatch and can be safely rebroadcast byte-for-byte across crashes or explicit rejection. */
export async function resumeSignedAttempt(
  transport: JsonRpcTransport, attempt: SignedAttempt,
  options: { polls?: number; intervalMs?: number } = {}
): Promise<Hex> {
  if (keccak256(attempt.raw) !== attempt.hash) throw new Error("signed transaction journal hash mismatch");
  let sendError: unknown;
  for (let poll = 0; poll < (options.polls ?? 40); poll++) {
    const receipt = await transport.request<{ status?: string; transactionHash?: string; blockHash?: string; blockNumber?: string } | null>(
      "eth_getTransactionReceipt", [attempt.hash]);
    if (receipt) {
      if (receipt.transactionHash !== attempt.hash || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash ?? "")
        || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(receipt.blockNumber ?? "")) throw new Error("invalid transaction receipt");
      const block = await transport.request<{ hash?: string } | null>("eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (block?.hash !== receipt.blockHash) throw new Error("receipt is not canonical; retaining signed transaction");
      if (receipt.status === "0x1") return attempt.hash;
      if (receipt.status === "0x0") throw new MinedRevertError(attempt.hash);
      throw new Error("invalid receipt status");
    }
    if (poll === 0) {
      try {
        const hash = await transport.request<Hex>("eth_sendRawTransaction", [attempt.raw]);
        if (hash !== attempt.hash) throw new Error("RPC returned a different transaction hash");
      } catch (error) {
        sendError = error;
        if (error instanceof Error && /insufficient funds|underpriced|fee cap|nonce too low/i.test(error.message)) throw error;
      }
      // Rejections are not progress and do not burn a checkpoint. Retain the identical signed
      // transaction even for insufficient funds: funding can recover without any nonce guess.
    }
    if (poll + 1 < (options.polls ?? 40)) await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 1500));
  }
  throw sendError ?? new Error("signed transaction receipt pending; identical transaction retained");
}

export class MinedRevertError extends Error {
  constructor(readonly hash: Hex) { super("transaction " + hash + " reverted"); }
}
