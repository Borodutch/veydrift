import { expect, test } from "bun:test";
import { encodeFunctionResult, parseTransaction, type PublicClient } from "viem";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";
import { quoteMissionBatch, measuredBatchGas, rpcQuantity, usdCappedGas, singleResolverMaxUsdMicros, ResolverFeeCapError } from "./missionBatchFees";

const now = BigInt(Math.floor(Date.now() / 1000));
const input = { items: [{ missionId: "1", leg: "arrival" as const, dueAt: Number(now - 5n) }], nonce: 99,
  account: "0x1111111111111111111111111111111111111111" as const,
  game: "0x2222222222222222222222222222222222222222" as const, chainId: 8453,
  policy: { ...defaultMissionBatchPolicy, priceFeed: "0x3333333333333333333333333333333333333333" as const } };
const signedGas = (measuredBatchGas(100_000n, batchCalldata(input.items), 1) * 120n + 99n) / 100n;
const result = (outcome: number, used = 100_000n) => ({ data: encodeFunctionResult({ abi: missionBatchAbi,
  functionName: "resolveFleetMissionBatch", result: [[outcome], used] }) });
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: now, baseFeePerGas: 100n, gasLimit: 30_000_000n }),
    estimateGas: async () => { throw new Error("must not trust success-only estimateGas"); },
    call: async (args: Record<string, unknown>) => { calls.push(args); return result(0); },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async (args: { functionName: string; args?: unknown[] }) => {
      calls.push(args);
      if (args.functionName === "decimals") return 8;
      if (args.functionName === "latestRoundData") return [5n, 3000_00000000n, now, now, 5n];
      if (args.functionName === "getL1Fee") {
        const tx = parseTransaction(args.args![0] as `0x${string}`);
        expect(tx.data).toBe(batchCalldata(input.items));
        expect(tx.nonce).toBe(99);
        expect(tx.gas).toBe(signedGas);
        expect(tx.maxFeePerGas).toBe(210n);
        return 1000n;
      }
      if (args.functionName === "getL1FeeUpperBound") return 1000n;
      if (args.functionName === "getOperatorFee") { expect(args.args).toEqual([signedGas]); return 100n; }
      throw new Error("unexpected RPC");
    }, ...overrides
  };
  return { client: client as unknown as PublicClient, calls };
}
test("quotes actual nonce/calldata/gas/maxfee and explicit Base fee oracles", async () => {
  const { client, calls } = fixture();
  const quote = await quoteMissionBatch(client, input);
  expect(quote.totalWei).toBe(signedGas * 210n + 2200n);
  expect(calls[0]?.data).toBe(batchCalldata(input.items));
});
test("stale base block, failed estimate, operator failure, stale price and cap spike fail closed", async () => {
  for (const overrides of [
    { getBlock: async () => ({ number: 10n, timestamp: now - 100n, baseFeePerGas: 1n, gasLimit: 30_000_000n }) },
    { call: async () => { throw new Error("measurement failed"); } },
    { readContract: async () => { throw new Error("fee/price RPC unavailable"); } }
  ]) await expect(quoteMissionBatch(fixture(overrides).client, input)).rejects.toThrow();
});

test("reference no-progress and exact-signed-gas no-progress never produce a quote", async () => {
  for (const outcome of [1, 2, 3, 4, 5, 6]) {
    await expect(quoteMissionBatch(fixture({ call: async () => result(outcome) }).client, input)).rejects.toThrow();
    await expect(quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(gas === 16_777_216n ? 0 : outcome) }).client, input)).rejects.toThrow();
  }
  const progress = await quoteMissionBatch(fixture({ call: async () => result(7) }).client, input);
  expect(progress.outcomes).toEqual([7]); // genuine partial work is not settlement
  // Fewer committed stages at the exact signed gas is still productive: it continues next tick.
  const fewerStages = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(gas === 16_777_216n ? 0 : 7) }).client, input);
  expect(fewerStages.outcomes).toEqual([7]);
});

test("a staged battle measured near the cap is clamped, not excluded", async () => {
  const used = 15_000_000n;
  const quote = await quoteMissionBatch(fixture({ call: async () => result(7, used),
    readContract: async (args: { functionName: string }) => args.functionName === "decimals" ? 8
      : args.functionName === "latestRoundData" ? [5n, 3000_00000000n, now, now, 5n] : 100n }).client, input);
  expect(quote.gas).toBe(16_777_216n);
  expect(quote.outcomes).toEqual([7]);
});

test("an unfinished battle shrinks its gas to the USD cap instead of being excluded", async () => {
  const policy = { ...input.policy, maxFeeUsdMicros: 100_000n }; // $0.10
  // A staged battle uses (almost) all gas it is given and still reports Progress.
  const quote = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas - gas / 10n),
    getBlock: async () => ({ number: 10n, timestamp: now, baseFeePerGas: 10_000_000n, gasLimit: 30_000_000n }),
    readContract: async (args: { functionName: string }) => args.functionName === "decimals" ? 8
      : args.functionName === "latestRoundData" ? [5n, 3000_00000000n, now, now, 5n] : 0n }).client, { ...input, policy });
  expect(quote.gas).toBeLessThan(16_777_216n);
  expect(quote.gas).toBeGreaterThan(1_000_000n);
  expect(quote.usdMicros).toBeLessThanOrEqual(100_000n);
});
test("raw Base RPC receipt extensions normalize quantities without bigint/string concatenation", () => {
  expect(rpcQuantity("0x10")).toBe(16n);
  expect(rpcQuantity("0x00")).toBe(0n);
  expect(rpcQuantity(undefined)).toBeNull();
  expect(rpcQuantity("bad")).toBeNull();
  expect(100n + rpcQuantity("0x10")! + rpcQuantity("0x2")!).toBe(118n);
});

test("single-call resolver gas shrinks so the worst-case fee never exceeds $0.50", async () => {
  const feeds = (updatedAt: bigint, l1 = 1_000_000_000n) => ({ readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "decimals" ? 8 : functionName === "latestRoundData" ? [5n, 3000_00000000n, updatedAt, updatedAt, 5n]
      : functionName === "getL1FeeUpperBound" ? l1 : 0n }) as unknown as PublicClient;
  const input = { chainId: 8453, dataBytes: 36, gas: 16_777_216n, maxUsdMicros: singleResolverMaxUsdMicros };
  // 0.1 gwei max fee: 16.7M gas would cost ~$5; the cap leaves ~1.66M gas.
  const maxFeePerGas = 100_000_000n;
  const gas = await usdCappedGas(feeds(now), { ...input, maxFeePerGas });
  expect(gas).toBeLessThan(16_777_216n);
  const worstWei = gas * maxFeePerGas + 2n * 1_000_000_000n;
  expect(worstWei * 3000n * 1_000_000n / 10n ** 18n).toBeLessThanOrEqual(500_000n);
  // Cheap fees leave the full envelope; stale price and unaffordable L1 fail closed.
  expect(await usdCappedGas(feeds(now), { ...input, maxFeePerGas: 1_000n })).toBe(16_777_216n);
  await expect(usdCappedGas(feeds(now - 7_200n), { ...input, maxFeePerGas })).rejects.toThrow("stale");
  await expect(usdCappedGas(feeds(now, 10n ** 15n), { ...input, maxFeePerGas })).rejects.toBeInstanceOf(ResolverFeeCapError);
  // Local chains have no Base fee oracle: not capped.
  expect(await usdCappedGas(feeds(now), { ...input, chainId: 31337, maxFeePerGas })).toBe(16_777_216n);
});
