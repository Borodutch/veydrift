import { describe, expect, test } from "bun:test";
import { decodeFunctionData } from "viem";
import { BatchCapacityError, batchCalldata, compareBatchLegs, defaultMissionBatchPolicy, loadMissionBatchPolicy,
  missionBatchAbi, packMissionBatch, totalBatchExposure, type BatchLeg } from "./missionBatch";

const policy = { ...defaultMissionBatchPolicy, enabled: true, maxFeeWei: 200_000_000_000_000n };
const feeInput = { gas: 120_000n, blockGasLimit: 30_000_000n, maxFeePerGas: 1_000_000n,
  maxPriorityFeePerGas: 100n, l1Fee: 20_000_000n, operatorFee: 30_000_000n,
  policy };
const item = (id: number, leg: BatchLeg["leg"] = "arrival", dueAt = id): BatchLeg => ({ missionId: String(id), leg, dueAt });

describe("mission batch fee envelope", () => {
  test("counts max EIP1559 plus reserved L1/operator fees in wei", () => {
    const quote = totalBatchExposure(feeInput);
    expect(quote.gas).toBe(120_000n);
    expect(quote.totalWei).toBe(120_100_000_000n);
    expect(() => totalBatchExposure({ ...feeInput, policy: { ...policy, maxFeeWei: quote.totalWei - 1n } })).toThrow(BatchCapacityError);
    expect(totalBatchExposure({ ...feeInput, policy: { ...policy, maxFeeWei: quote.totalWei } }).totalWei).toBe(quote.totalWei);
  });
  test("fails closed on invalid fees and ETH cap crossings including L1/operator", () => {
    for (const change of [{ maxFeePerGas: 0n }, { maxPriorityFeePerGas: -1n }, { l1Fee: -1n }, { operatorFee: -1n }])
      expect(() => totalBatchExposure({ ...feeInput, ...change })).toThrow("fee estimate");
    for (const change of [{ maxFeePerGas: 10_000_000_000n }, { l1Fee: 100_000_000_000_000n },
      { operatorFee: 100_000_000_000_000n }]) expect(() => totalBatchExposure({ ...feeInput, ...change })).toThrow(BatchCapacityError);
    expect(() => totalBatchExposure({ ...feeInput, gas: 18_000_000n })).toThrow("gas envelope");
    expect(() => totalBatchExposure({ ...feeInput, blockGasLimit: 119_999n })).toThrow("gas envelope");
  });
  test("defaults disabled, ignores retired USD inputs and rejects looser ETH configuration", () => {
    const problems: Array<{ field: string; message: string }> = [];
    expect(loadMissionBatchPolicy({}, problems)).toEqual({ enabled: false, maxItems: 16, maxFeeWei: 400_000_000_000_000n });
    expect(loadMissionBatchPolicy({ VEYDRIFT_MISSION_BATCH_MAX_USD: "0", VEYDRIFT_MISSION_BATCH_ETH_USD_FEED: "missing" }, problems))
      .toEqual(defaultMissionBatchPolicy);
    expect(problems).toEqual([]);
    loadMissionBatchPolicy({ VEYDRIFT_MISSION_BATCH_ENABLED: "true", VEYDRIFT_MISSION_BATCH_MAX_FEE_WEI: "400000000000001",
      VEYDRIFT_MISSION_BATCH_MAX_ITEMS: "33" }, problems);
    expect(problems.map((problem) => problem.field).sort()).toEqual([
      "VEYDRIFT_MISSION_BATCH_ENABLED", "VEYDRIFT_MISSION_BATCH_MAX_FEE_WEI", "VEYDRIFT_MISSION_BATCH_MAX_ITEMS"
    ]);
  });
});

describe("chronological bounded packing", () => {
  const estimate = async (items: BatchLeg[]) => {
    const gas = 60_000 + items.reduce((sum, i) => sum + (i.leg === "return" ? 40_000 : 400_000), 0);
    if (gas > 1_000_000) throw new BatchCapacityError("fee/gas");
    return gas;
  };
  test("zero and lone due mission do not wait for fill; typed exact calldata", async () => {
    expect((await packMissionBatch([], 16, estimate, () => {})).estimates).toBe(0);
    const lone = await packMissionBatch([item(1)], 16, estimate, () => {});
    expect(lone.items).toEqual([item(1)]);
    expect(decodeFunctionData({ abi: missionBatchAbi, data: batchCalldata(lone.items) }).args?.[0]).toEqual([{ missionId: 1n, leg: 0 }]);
  });
  test("905 dueAt first in both directions; arrival-first only same timestamp, numeric ID tie", () => {
    expect([item(10, "return", 2), item(8, "arrival", 2), item(2, "arrival", 2), item(1, "return", 1)]
      .sort(compareBatchLegs).map((i) => i.missionId)).toEqual(["1", "2", "8", "10"]);
  });
  test("mixed-cost realistic 100-leg backlog reduces receipts with bounded estimates", async () => {
    let backlog = Array.from({ length: 100 }, (_, i) => item(i + 1, i % 5 === 0 ? "arrival" : "return"));
    let txs = 0, largest = 0, estimates = 0;
    while (backlog.length) {
      const packed = await packMissionBatch(backlog, 16, estimate, () => {});
      expect(packed.items).toEqual([...packed.items].sort(compareBatchLegs));
      expect(packed.estimates).toBeLessThanOrEqual(backlog.length * 2);
      txs++; largest = Math.max(largest, packed.items.length); estimates += packed.estimates;
      backlog = backlog.filter((i) => !packed.items.includes(i));
    }
    expect(txs).toBeLessThan(20);
    expect(largest).toBe(14); // measured fixture result, not a universal safe count
    console.info(JSON.stringify({ fixture: "100 legs, 20 battles@400k + 80 returns@40k + 60k overhead, 1m envelope", txs, largest, estimates }));
  });
  test("oversized indivisible mission emits blocker while unrelated work proceeds; duplicate removed", async () => {
    const blocked: string[] = [];
    const result = await packMissionBatch([item(1), item(2), item(2)], 16, async (items) => {
      if (items.some((i) => i.missionId === "1")) throw new BatchCapacityError("oversized battle");
      return 10;
    }, (i) => blocked.push(i.missionId));
    expect(blocked).toEqual(["1"]);
    expect(result.items.map((i) => i.missionId)).toEqual(["2"]);
  });
  test("transport/price/estimate failures never bypass envelope or masquerade as oversize", async () => {
    await expect(packMissionBatch([item(1)], 16, async () => { throw new Error("stale price"); }, () => {})).rejects.toThrow("stale price");
  });
});
