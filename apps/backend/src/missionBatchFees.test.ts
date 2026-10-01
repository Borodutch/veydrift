import { expect, test } from "bun:test";
import { parseTransaction, type PublicClient } from "viem";
import { batchCalldata, defaultMissionBatchPolicy } from "./missionBatch";
import { quoteMissionBatch } from "./missionBatchFees";

const now = BigInt(Math.floor(Date.now() / 1000));
const input = { items: [{ missionId: "1", leg: "arrival" as const, dueAt: Number(now - 5n) }], nonce: 99,
  account: "0x1111111111111111111111111111111111111111" as const,
  game: "0x2222222222222222222222222222222222222222" as const, chainId: 8453,
  policy: { ...defaultMissionBatchPolicy, priceFeed: "0x3333333333333333333333333333333333333333" as const } };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    getBlock: async () => ({ number: 10n, timestamp: now, baseFeePerGas: 100n, gasLimit: 30_000_000n }),
    estimateGas: async (args: Record<string, unknown>) => { calls.push(args); return 100_000n; },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async (args: { functionName: string; args?: unknown[] }) => {
      calls.push(args);
      if (args.functionName === "decimals") return 8;
      if (args.functionName === "latestRoundData") return [5n, 3000_00000000n, now, now, 5n];
      if (args.functionName === "getL1Fee") {
        const tx = parseTransaction(args.args![0] as `0x${string}`);
        expect(tx.data).toBe(batchCalldata(input.items));
        expect(tx.nonce).toBe(99);
        expect(tx.gas).toBe(120_000n);
        expect(tx.maxFeePerGas).toBe(210n);
        return 1000n;
      }
      if (args.functionName === "getL1FeeUpperBound") return 1000n;
      if (args.functionName === "getOperatorFee") { expect(args.args).toEqual([120_000n]); return 100n; }
      throw new Error("unexpected RPC");
    }, ...overrides
  };
  return { client: client as unknown as PublicClient, calls };
}
test("quotes actual nonce/calldata/gas/maxfee and explicit Base fee oracles", async () => {
  const { client, calls } = fixture();
  const quote = await quoteMissionBatch(client, input);
  expect(quote.totalWei).toBe(25_202_200n);
  expect(calls[0]?.data).toBe(batchCalldata(input.items));
});
test("stale base block, failed estimate, operator failure, stale price and cap spike fail closed", async () => {
  for (const overrides of [
    { getBlock: async () => ({ number: 10n, timestamp: now - 100n, baseFeePerGas: 1n, gasLimit: 30_000_000n }) },
    { estimateGas: async () => { throw new Error("estimate failed"); } },
    { readContract: async () => { throw new Error("fee/price RPC unavailable"); } }
  ]) await expect(quoteMissionBatch(fixture(overrides).client, input)).rejects.toThrow();
});
