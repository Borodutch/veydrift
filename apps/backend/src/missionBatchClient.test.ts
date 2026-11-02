import { expect, test } from "bun:test";
import { encodeFunctionResult, keccak256, parseTransaction, TransactionNotFoundError, TransactionReceiptNotFoundError, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy, defaultBatchWorkGas, defaultBatchMaxWorkGas } from "./missionBatch";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

// Synthetic fixture-only key, never loaded from runtime configuration.
const account = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`);
const game = "0x2222222222222222222222222222222222222222" as const;
const blockHash = "0x" + "aa".repeat(32);
const chain = { id: 8453, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://invalid.test"] } } };
function fixture(options: { ambiguous?: boolean; stale?: boolean; revert?: boolean; reorg?: boolean; progress?: boolean; workGas?: bigint } = {}) {
  let nonce = 4, broadcasts = 0, reads = 0, mined = false;
  const raws: `0x${string}`[] = [];
  let minedHash: `0x${string}` | undefined;
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
    call: async ({ gas }: { gas: bigint }) => ({ data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch",
      result: options.progress ? [[7], gas / 4n] : [[0], 100_000n] }) }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => {
      broadcasts++; raws.push(serializedTransaction);
      expect(parseTransaction(serializedTransaction).nonce).toBe(4);
      // Cheap fees: the per-transaction work budget (#397), never below the measured minimum.
      if (!options.progress) expect(parseTransaction(serializedTransaction).gas).toBe(defaultBatchWorkGas);
      if (options.ambiguous) throw new Error("connection lost after send");
      mined = true; nonce++;
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async () => receipt(),
    getTransaction: async () => { throw new TransactionNotFoundError({}); },
    getTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => { if (!mined || (minedHash && hash !== minedHash)) throw new TransactionReceiptNotFoundError({ hash }); return { ...receipt(), transactionHash: hash, from: account.address, to: game }; }
  };
  // Retry backoff runs on a virtual clock: no real sleeps inside the bounded reconciliation pass.
  let clock = Date.now();
  const coordinator = new ResolverTransactionCoordinator(":memory:", { now: () => clock, sleep: async (ms) => { clock += ms; } });
  const reader = {
    listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    isFleetChronologyOrderingReady: async () => true,
    getCanonicalFleetMission: async () => {
      reads++;
      return { status: options.stale && reads > 1 ? "Returned" : "Outbound", arrivalAt: String(now - 5), returnAt: String(now + 5) } as never;
    }
  };
  const withPolicy = (workGas = options.workGas ?? defaultBatchWorkGas) => new ViemMissionResolutionChainClient(reader, game, account,
    publicClient as unknown as PublicClient, undefined, chain, undefined, coordinator, undefined, undefined,
    { ...defaultMissionBatchPolicy, enabled: true, workGas, maxWorkGas: workGas > defaultBatchMaxWorkGas ? workGas : defaultBatchMaxWorkGas });
  const client = withPolicy();
  const items = [{ missionId: "1", leg: "arrival" as const, dueAt: now - 5 }];
  return { client, withPolicy, coordinator, items, raws, broadcasts: () => broadcasts, mine: (hash?: `0x${string}`) => { mined = true; minedHash = hash; nonce++; }, advance: (ms: number) => { clock += ms; } };
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
test("ambiguous batch retries three exact sends; empty queue can recover exact hash", async () => {
  const f = fixture({ ambiguous: true });
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("recoverable pending");
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("cooling down");
  expect(f.broadcasts()).toBe(3);
  f.mine();
  expect(await f.client.resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
  expect(f.broadcasts()).toBe(3);
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
test("referee-wait attacks are excluded as unpaid waits before any signing", async () => {
  const f = fixture();
  const now = Math.floor(Date.now() / 1000);
  const mission = { status: "Outbound", missionType: "Attack", arrivalAt: String(now - 5), returnAt: String(now + 5) };
  const asked: bigint[][] = [];
  Object.assign((f.client as unknown as { reader: object }).reader, {
    getCanonicalFleetMissionBatch: async (ids: readonly bigint[]) => ids.map(() => ({ mission, orderingReady: true })),
    getRefereeWaitBattles: async (ids: readonly bigint[]) => { asked.push([...ids]); return new Set(["1"]); }
  });
  const result = await f.client.resolveMissionBatch(f.items);
  expect(asked).toEqual([[1n]]);
  expect(result.hash).toBeNull();
  expect(result.exclusions).toEqual([{ item: f.items[0]!, reason: "referee-wait", unproductive: true }]);
  expect(f.broadcasts()).toBe(0);
});
test("single-call resolve refuses referee-wait battles before signing", async () => {
  const f = fixture();
  const internals = f.client as unknown as { reader: object; publicClient: object };
  Object.assign(internals.publicClient, { getBlockNumber: async () => 7n });
  Object.assign(internals.reader, { getRefereeWaitBattles: async () => new Set(["1"]) });
  await expect(f.client.resolveFleetMission("1")).rejects.toThrow("awaits the referee");
  expect(f.broadcasts()).toBe(0);
});

test("an accepted batch that is never included gets one lighter, fee-bumped same-nonce alternative from the configured key after deploy (#397)", async () => {
  // The prod original: a staged battle signed by the old code at the full cap.
  const f = fixture({ ambiguous: true, progress: true, workGas: 16_777_216n });
  await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("recoverable pending");
  for (let i = 0; i < 3; i++) { f.advance(60_000); await expect(f.client.resolveMissionBatch([])).rejects.toThrow(); }
  expect(new Set(f.raws).size).toBe(1);
  const deployed = f.withPolicy(defaultBatchWorkGas); // same journal, default work budget
  f.advance(60_000);
  await expect(deployed.resolveMissionBatch([])).rejects.toThrow("same-nonce alternative dispatched");
  const [first, alternative] = [parseTransaction(f.raws[0]!), parseTransaction(f.raws.at(-1)!)];
  expect(new Set(f.raws).size).toBe(2);
  expect(first.gas).toBe(16_777_216n);
  expect(alternative).toMatchObject({ nonce: 4, to: first.to, data: first.data, gas: defaultBatchWorkGas });
  expect(alternative.maxPriorityFeePerGas! * 100n).toBeGreaterThanOrEqual(first.maxPriorityFeePerGas! * 125n);
  expect(alternative.maxFeePerGas! * 100n).toBeGreaterThanOrEqual(first.maxFeePerGas! * 125n);
  f.mine(keccak256(f.raws.at(-1)!));
  expect(await deployed.resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
  expect(f.coordinator.admissionSnapshot(8453, account.address).blockedReason).toBeNull();
});
