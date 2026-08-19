import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadBackendConfig } from "./config";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

type RecoveryArguments = {
  fromNonce: number;
  throughNonce: number;
  broadcast: boolean;
};

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const loaded = loadBackendConfig();
  if (!loaded.config.rpcUrl) throw new Error("resolver nonce recovery requires VEYDRIFT_RPC_URL");
  const keys = [
    loaded.config.missionResolverPrivateKey,
    loaded.config.randomnessFulfillerPrivateKey
  ].filter((value): value is `0x${string}` => Boolean(value));
  if (keys.length === 0) {
    throw new Error("resolver nonce recovery requires a configured mission resolver/randomness fulfiller key");
  }
  const accounts = [...new Map(keys.map((key) => {
    const account = privateKeyToAccount(key);
    return [account.address.toLowerCase(), account] as const;
  })).values()];
  if (accounts.length !== 1) {
    throw new Error("configured resolver writers use different EOAs; recovery refuses to guess which signer owns the gap");
  }
  const account = accounts[0]!;
  const chain = defineChain({
    id: loaded.config.chainId,
    name: `veydrift-${loaded.config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [loaded.config.rpcUrl] } }
  });
  const transport = http(loaded.config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const coordinator = new ResolverTransactionCoordinator(
    loaded.config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite"
  );
  const result = await coordinator.recoverNonceGap({
    chainId: chain.id,
    address: account.address,
    fromNonce: args.fromNonce,
    throughNonce: args.throughNonce,
    broadcast: args.broadcast,
    getTransactionCount: (blockTag) => publicClient.getTransactionCount({
      address: account.address,
      blockTag
    }),
    submitCancellation: (nonce) => walletClient.sendTransaction({
      account,
      chain,
      to: account.address,
      value: 0n,
      nonce
    }),
    confirm: async (hash: Hex) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    }
  });

  console.log(JSON.stringify({
    mode: args.broadcast ? "broadcast" : "dry-run",
    chainId: chain.id,
    resolverAddress: account.address,
    plannedNonces: result.plannedNonces,
    submitted: result.submitted
  }, null, 2));
}

function parseArguments(args: string[]): RecoveryArguments {
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const fromNonce = Number(value("--from"));
  const throughNonce = Number(value("--through"));
  if (!Number.isSafeInteger(fromNonce) || !Number.isSafeInteger(throughNonce)) {
    throw new Error("usage: bun src/resolverNonceRecovery.ts --from <nonce> --through <nonce> [--broadcast]");
  }
  return { fromNonce, throughNonce, broadcast: args.includes("--broadcast") };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
