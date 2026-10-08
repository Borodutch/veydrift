import { createPublicClient, custom, encodeFunctionResult, TransactionNotFoundError,
  TransactionReceiptNotFoundError, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";

export const replayAccount = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex); // fixture only
const game = "0x2222222222222222222222222222222222222222" as const;
export const replayBlockHash = ("0x" + "aa".repeat(32)) as Hex;
const chain = { id: 8453, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://invalid.test"] } } };
export const replayItems = [{ missionId: "1", leg: "arrival" as const, dueAt: Math.floor(Date.now() / 1000) - 5 }];
export function replayMissionFixture(path: string, send: (raw: Hex) => Promise<Hex>, clock: { now: number },
  mined = () => false, timeout = 100) {
  // Actual viem request wrapping and sendRawTransaction, never a plain-error callback surrogate.
  const transportClient = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    if (method !== "eth_sendRawTransaction") throw new Error("unexpected fixture RPC");
    return send((params as [Hex])[0]);
  } }) });
  const client = {
    getStorageAt: async () => "0x00", getTransactionCount: async () => mined() ? 5 : 4,
    getBlock: async () => ({ number: 1n, hash: replayBlockHash, timestamp: BigInt(Math.floor(Date.now() / 1000)), baseFeePerGas: 100n, gasLimit: 30000000n }),
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async ({ functionName }: { functionName: string }) => functionName === "fleetMissionEligibility" ? [false, 9n, true] : 100n,
    call: async () => ({ data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", result: [[0], 100000n] }) }),
    sendRawTransaction: transportClient.sendRawTransaction,
    getTransaction: async () => { throw new TransactionNotFoundError({}); },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (!mined()) throw new TransactionReceiptNotFoundError({ hash });
      return { transactionHash: hash, from: replayAccount.address, to: game, status: "success", blockNumber: 1n, blockHash: replayBlockHash, logs: [], gasUsed: 100000n,
        effectiveGasPrice: 100n, l1Fee: 100n, operatorFee: 100n };
    }
  };
  const coordinator = new ResolverTransactionCoordinator(path, { now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; }, reconciliationTimeoutMs: timeout, leaseRenewIntervalMs: 1000000 });
  return new ViemMissionResolutionChainClient({ listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    isFleetChronologyOrderingReady: async () => true,
    getCanonicalFleetMission: async () => ({ status: mined() ? "Returned" : "Outbound", arrivalAt: String(replayItems[0]!.dueAt),
      returnAt: String(replayItems[0]!.dueAt + 10) }) as never
  }, game, replayAccount, client as unknown as PublicClient, undefined, chain, undefined, coordinator, undefined, undefined,
  { ...defaultMissionBatchPolicy, enabled: true });
}

// Real process crash fixture. Parent waits for the durable send boundary, then terminates us.
if (import.meta.main) {
  const path = process.argv[2]!;
  let sends = 0;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await replayMissionFixture(path, async () => {
      if (++sends === 1) throw { code: -32603, message: "transport internal error" };
      process.stdout.write("outstanding\n");
      return new Promise<Hex>(() => {});
    }, { now: 1000 }).resolveMissionBatch(replayItems);
  } catch { process.stdout.write("deadline\n"); }
  // Keep the live unresolved transport owner observable until the parent kills it.
  await new Promise(() => { void keepAlive; });
}
