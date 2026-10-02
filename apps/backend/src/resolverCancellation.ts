import type { Account, Chain, Hex, PublicClient, WalletClient } from "viem";
import { quoteResolverGas, singleResolverMaxUsdMicros } from "./missionBatchFees";
import { resolverReplacementFees } from "./resolverReplacementFees";

/** All shared-signer callers use the same paid-cancellation boundary. */
export async function cancelResolverTransaction(input: {
  client: PublicClient; wallet: WalletClient; account: Account; chain: Chain;
  nonce: number; previousHash: Hex; assertLease: () => void; priceFeed?: Hex | undefined;
}): Promise<Hex> {
  const { client, wallet, account, chain, nonce, previousHash, assertLease } = input;
  const fees = await resolverReplacementFees(client, previousHash);
  const quote = await quoteResolverGas(client, { chainId: chain.id, dataBytes: 0, gas: 21_000n,
    maxFeePerGas: fees.maxFeePerGas, priceFeed: input.priceFeed, maxUsdMicros: singleResolverMaxUsdMicros });
  if (quote.gas < 21_000n) throw new Error("stale nonce cancellation exceeds resolver USD cap");
  const envelope = { account, to: account.address, data: "0x" as Hex, value: 0n, nonce, gas: quote.gas, ...fees };
  await client.call({ ...envelope, blockTag: "latest" });
  quote.assertFresh();
  assertLease();
  // Quote/preflight failure preserves the previous submitted attempt and its nonce.
  return wallet.sendTransaction({ ...envelope, chain });
}
