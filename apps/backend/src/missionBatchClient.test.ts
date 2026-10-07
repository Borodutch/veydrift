import { expect, test } from "bun:test";
import { encodeFunctionResult, keccak256, parseTransaction, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

// Synthetic fixture-only key, never loaded from runtime configuration.
const account = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`);
const game = "0x2222222222222222222222222222222222222222" as const;
const blockHash = "0x" + "aa".repeat(32);
const chain = { id: 8453, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://invalid.test"] } } };
function fixture(options: { ambiguous?: boolean; stale?: boolean; revert?: boolean; reorg?: boolean; proofWait?: boolean } = {}) {
  let nonce = 4, broadcasts = 0, reads = 0, mined = false;
  const now = Math.floor(Date.now() / 1000);
  const receipt = () => ({ status: options.revert ? "reverted" : "success", blockNumber: 1n, blockHash,
    gasUsed: 100_000n, effectiveGasPrice: 100n, l1Fee: 200n, operatorFee: 0n });
  const publicClient = {
    getStorageAt: async () => "0x00",
    getTransactionCount: async () => nonce,
    getBlock: async () => ({ number: 1n, hash: options.reorg ? "0xdead" : blockHash, timestamp: BigInt(now), baseFeePerGas: 100n, gasLimit: 30_000_000n }),
    estimateGas: async () => 100_000n,
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async ({ functionName }: { functionName: string }) => functionName === "decimals" ? 8
      : functionName === "latestRoundData" ? [1n, 3000_00000000n, BigInt(now), BigInt(now), 1n] : functionName === "fleetMissionEligibility" ? [false, 9n, true] : 100n,
    call: async () => ({ data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", result: [[0], 100_000n] }) }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => {
      broadcasts++;
      expect(parseTransaction(serializedTransaction).nonce).toBe(4);
      // Cheap fees: full-cap headroom, never below the measured minimum.
      expect(parseTransaction(serializedTransaction).gas).toBe(16_777_216n);
      if (options.ambiguous) throw new Error("connection lost after send");
      mined = true; nonce++;
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async () => receipt(),
    getTransactionReceipt: async () => { if (!mined) throw new Error("receipt unknown"); return receipt(); }
  };
  const coordinator = new ResolverTransactionCoordinator(":memory:");
  const client = new ViemMissionResolutionChainClient({
    listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    isFleetChronologyOrderingReady: async () => true,
    isOrdinaryMissionResolutionAvailable: async () => !options.proofWait,
    getCanonicalFleetMission: async () => {
      reads++;
      return { status: options.stale && reads > 1 ? "Returned" : "Outbound", arrivalAt: String(now - 5), returnAt: String(now + 5) } as never;
    }
  }, game, account, publicClient as unknown as PublicClient, undefined, chain, undefined, coordinator, undefined, undefined,
  { ...defaultMissionBatchPolicy, enabled: true });
  const items = [{ missionId: "1", leg: "arrival" as const, dueAt: now - 5 }];
  return { client, coordinator, items, broadcasts: () => broadcasts, mine: () => { mined = true; nonce++; } };
}
test("production client sends exact locally signed batch then reconciles canonical receipt", async () => {
  const f = fixture();
  const result = await f.client.resolveMissionBatch(f.items);
  expect(result.items).toEqual(f.items);
  expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  expect(f.broadcasts()).toBe(1);
});
test("stale canonical membership under nonce lease aborts before broadcast", async () => {
  const f = fixture({ stale: true });
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("membership changed");
  expect(f.broadcasts()).toBe(0);
});
test("ambiguous batch and missing receipt block retries; empty queue can recover exact hash", async () => {
  const f = fixture({ ambiguous: true });
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("connection lost");
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("receipt unknown");
  expect(f.broadcasts()).toBe(1);
  f.mine();
  expect(await f.client.resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
  expect(f.broadcasts()).toBe(1);
});
test("reverted receipt consumes nonce without inventing per-leg success; noncanonical receipt stays blocked", async () => {
  const reverted = fixture({ revert: true });
  await reverted.client.resolveMissionBatch(reverted.items);
  expect(await reverted.client.isMissionLegComplete("1", "arrival")).toBe(false);
  const reorg = fixture({ reorg: true });
  await expect(reorg.client.resolveMissionBatch(reorg.items)).rejects.toThrow("not canonical");
  await expect(reorg.client.resolveMissionBatch([])).rejects.toThrow("not canonical");
  expect(reorg.broadcasts()).toBe(1);
});

test("proof wait is excluded before nonce, quote or broadcast even if batch simulation would succeed", async () => {
  const f = fixture({ proofWait: true });
  const result = await f.client.resolveMissionBatch(f.items);
  expect(result.hash).toBeNull();
  expect(result.items).toEqual([]);
  expect(result.exclusions[0]?.reason).toBe("proof-wait");
  expect(f.broadcasts()).toBe(0);
});
