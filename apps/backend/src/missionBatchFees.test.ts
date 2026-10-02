import { expect, test } from "bun:test";
import { encodeFunctionResult, parseTransaction, type PublicClient } from "viem";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";
import { quoteMissionBatch, measuredBatchGas, rpcQuantity, quoteResolverGas, singleResolverMaxFeeWei, ResolverFeeCapError } from "./missionBatchFees";

const now = BigInt(Math.floor(Date.now() / 1000));
const input = { items: [{ missionId: "1", leg: "arrival" as const, dueAt: Number(now - 5n) }], nonce: 99,
  account: "0x1111111111111111111111111111111111111111" as const,
  game: "0x2222222222222222222222222222222222222222" as const, chainId: 8453,
  policy: { ...defaultMissionBatchPolicy } };
const signedGas = 16_777_216n;
const minimumGas = (measuredBatchGas(100_000n, batchCalldata(input.items), 1) * 120n + 99n) / 100n;
const block = (timestamp = now, baseFeePerGas = 100n) => ({ number: 10n, hash: "0x" + "aa".repeat(32), timestamp,
  baseFeePerGas, gasLimit: 30_000_000n });
const result = (outcome: number, used = 100_000n) => ({ data: encodeFunctionResult({ abi: missionBatchAbi,
  functionName: "resolveFleetMissionBatch", result: [[outcome], used] }) });
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    getBlock: async () => block(),
    estimateGas: async () => { throw new Error("must not trust success-only estimateGas"); },
    call: async (args: Record<string, unknown>) => { calls.push(args); return result(0); },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async (args: { functionName: string; args?: unknown[] }) => {
      calls.push(args);
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
      throw new Error("unexpected RPC (including any ETH/USD dependency)");
    }, ...overrides
  };
  return { client: client as unknown as PublicClient, calls };
}
test("quotes actual nonce/calldata/gas/maxfee and Base fee oracles without any USD reads", async () => {
  const { client, calls } = fixture();
  const quote = await quoteMissionBatch(client, input);
  expect(quote.totalWei).toBe(signedGas * 210n + 2200n);
  expect(Object.isFrozen(quote)).toBe(true);
  expect(Object.isFrozen(quote.provenance)).toBe(true);
  expect(quote.provenance).toEqual({ blockNumber: 10n, blockHash: block().hash as `0x${string}`, blockTimestamp: now });
  expect(calls[0]?.data).toBe(batchCalldata(input.items));
});
test("quote snapshots ETH budget before asynchronous reads", async () => {
  const policy = { ...input.policy, maxFeeWei: 210_000_000n };
  const client = fixture({ getBlock: async () => { policy.maxFeeWei = 400_000_000_000_000n; return block(); },
    readContract: async () => 0n }).client;
  const quote = await quoteMissionBatch(client, { ...input, policy });
  expect(quote.gas).toBe(1_000_000n);
  expect(quote.totalWei).toBe(210_000_000n);
});
test("stale/missing fee block, measurement, L1/operator or fee spike fail closed", async () => {
  for (const overrides of [
    { getBlock: async () => block(now - 100n) },
    { getBlock: async () => block(now + 100n) },
    { getBlock: async () => ({ ...block(), hash: null }) },
    { call: async () => { throw new Error("measurement failed"); } },
    { readContract: async () => { throw new Error("Base fee RPC unavailable"); } },
    { readContract: async () => 200_000_000_000_000n },
    { getBlock: async () => block(now, 1_000_000_000_000n), readContract: async () => 0n }
  ]) await expect(quoteMissionBatch(fixture(overrides).client, input)).rejects.toThrow();
});
test("reference and exact-signed-gas no-progress never produce a quote", async () => {
  for (const outcome of [1, 2, 3, 4, 5, 6]) {
    await expect(quoteMissionBatch(fixture({ call: async () => result(outcome) }).client, input)).rejects.toThrow();
    let calls = 0;
    await expect(quoteMissionBatch(fixture({ call: async () => result(calls++ === 0 ? 0 : outcome) }).client, input)).rejects.toThrow();
  }
  expect((await quoteMissionBatch(fixture({ call: async () => result(7) }).client, input)).outcomes).toEqual([7]);
  let calls = 0;
  expect((await quoteMissionBatch(fixture({ call: async () => result(calls++ === 0 ? 0 : 7) }).client, input)).outcomes).toEqual([7]);
});
test("a staged battle measured near the unchanged gas cap is clamped, not excluded", async () => {
  const quote = await quoteMissionBatch(fixture({ call: async () => result(7, 15_000_000n), readContract: async () => 100n }).client, input);
  expect(quote.gas).toBe(16_777_216n);
  expect(quote.outcomes).toEqual([7]);
});
test("an unfinished battle shrinks gas to the ETH budget and stays productive", async () => {
  const policy = { ...input.policy, maxFeeWei: 100_000_000_000_000n };
  const quote = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas - gas / 10n),
    getBlock: async () => block(now, 10_000_000n), readContract: async () => 0n }).client, { ...input, policy });
  expect(quote.gas).toBeLessThan(16_777_216n);
  expect(quote.gas).toBeGreaterThan(1_000_000n);
  expect(quote.totalWei).toBeLessThanOrEqual(policy.maxFeeWei);
});
test("raw Base RPC receipt extensions normalize quantities without bigint/string concatenation", () => {
  expect(rpcQuantity("0x10")).toBe(16n);
  expect(rpcQuantity("0x00")).toBe(0n);
  expect(rpcQuantity(undefined)).toBeNull();
  expect(rpcQuantity("bad")).toBeNull();
  expect(100n + rpcQuantity("0x10")! + rpcQuantity("0x2")!).toBe(118n);
});
test("single quotes reserve L1/operator costs and cap at 0.0002 ETH independent of any USD price", async () => {
  const base = { chainId: 8453, dataBytes: 36, gas: signedGas, maxFeePerGas: 100_000_000n };
  for (const ignoredPrice of [0n, 1000n, 2500n, 5000n]) {
    let priceReads = 0;
    const client = fixture({ readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals" || functionName === "latestRoundData") { priceReads++; throw new Error("missing/stale price " + ignoredPrice); }
      return functionName === "getL1FeeUpperBound" ? 1_000_000_000n : 2_000_000_000n;
    } }).client;
    const quote = await quoteResolverGas(client, base);
    expect(quote.gas).toBe((singleResolverMaxFeeWei - 6_000_000_000n) / base.maxFeePerGas);
    expect(quote.gas * base.maxFeePerGas + 6_000_000_000n).toBeLessThanOrEqual(singleResolverMaxFeeWei);
    expect(priceReads).toBe(0);
    expect((await quoteResolverGas(client, { ...base, maxFeePerGas: 1000n })).gas).toBe(signedGas);
  }
  await expect(quoteResolverGas(fixture().client, { ...base, chainId: 31337 })).rejects.toThrow("requires Base");
  for (const timestamp of [0n, now - 100n, now + 100n])
    await expect(quoteResolverGas(fixture({ getBlock: async () => block(timestamp) }).client, base)).rejects.toThrow("expired");
  for (const expensive of ["getL1FeeUpperBound", "getOperatorFee"])
    await expect(quoteResolverGas(fixture({ readContract: async ({ functionName }: { functionName: string }) =>
      functionName === expensive ? 100_000_000_000_001n : 0n }).client, base)).rejects.toBeInstanceOf(ResolverFeeCapError);
});
test("a tight ETH budget cannot sign an unaffordable measured minimum", async () => {
  const client = fixture({ readContract: async () => 0n }).client;
  const quote = await quoteMissionBatch(client, { ...input, policy: { ...input.policy, maxFeeWei: 210n * 1_000_000n } });
  expect(quote.gas).toBeGreaterThanOrEqual(minimumGas);
  expect(quote.gas).toBeLessThan(16_777_216n);
  await expect(quoteMissionBatch(client, { ...input, policy: { ...input.policy, maxFeeWei: 100n } })).rejects.toThrow("ETH cap");
});
test("0.0004 ETH batch policy cannot exceed the 0.0002 ETH transaction ceiling", async () => {
  const quote = await quoteMissionBatch(fixture({ getBlock: async () => block(now, 50_000_000n), readContract: async () => 0n }).client, input);
  expect(quote.totalWei).toBeLessThanOrEqual(200_000_000_000_000n);
  expect(quote.gas).toBeLessThan(signedGas);
});
