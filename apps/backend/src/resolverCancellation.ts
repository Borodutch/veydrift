import type { Account, Chain, Hex, PublicClient, WalletClient } from "viem";
import { quoteResolverGas } from "./missionBatchFees";

/** All shared-signer callers use the same paid-cancellation boundary. */
export async function cancelResolverTransaction(input: {
  client: PublicClient; wallet: WalletClient; account: Account; chain: Chain;
  nonce: number; previousHash: Hex; assertLease: () => void;
}): Promise<Hex> {
  const { client, wallet, account, chain, nonce, previousHash, assertLease } = input;
  const quote = await quoteResolverGas(client, { chainId: chain.id, dataBytes: 0, gas: 21_000n,
    previousHash });
  if (quote.gas < 21_000n) throw new Error("stale nonce cancellation exceeds resolver ETH cap");
  const envelope = { account, to: account.address, data: "0x" as Hex, value: 0n, nonce, gas: quote.gas,
    maxFeePerGas: quote.maxFeePerGas, maxPriorityFeePerGas: quote.maxPriorityFeePerGas };
  await client.call({ ...envelope, blockTag: "latest" });
  quote.assertFresh();
  assertLease();
  // Quote/preflight failure preserves the previous submitted attempt and its nonce.
  return wallet.sendTransaction({ ...envelope, chain });
}
