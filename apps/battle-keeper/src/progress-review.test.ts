import { expect, test } from "bun:test";
import { encodeFunctionResult } from "viem";
import { progressAbi, progressAdvanced, readMissionProgress, type MissionProgress } from "./progress";
const p: MissionProgress = { blockNumber: "100", blockHash: "0x" + "1".repeat(64), version: "v1", phase: 15, round: 0, workDone: "10", arrivalOrderCursor: "20" };
test("mixed regression cannot lower the watermark by raising a different dimension", () => {
  expect(progressAdvanced(p, { ...p, workDone: "9", arrivalOrderCursor: "21" })).toBe(false);
  expect(progressAdvanced(p, { ...p, workDone: "11", arrivalOrderCursor: "19" })).toBe(false);
});
for (const [label, block, code] of [
  ["decimal number", {number:"100",hash:p.blockHash}, "0x6000"],
  ["noncanonical quantity", {number:"0x064",hash:p.blockHash}, "0x6000"],
  ["invalid hash", {number:"0x64",hash:"garbage"}, "0x6000"],
  ["malformed bytecode", {number:"0x64",hash:p.blockHash}, "0xzz"],
  ["odd bytecode", {number:"0x64",hash:p.blockHash}, "0x1"],
] as const) test("rejects " + label, async () => {
  await expect(readMissionProgress({ async request<T>(method: string): Promise<T> {
    if (method === "eth_getBlockByNumber") return block as T;
    if (method === "eth_getStorageAt") return ("0x" + "0".repeat(64)) as T;
    if (method === "eth_getCode") return code as T;
    return encodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", result: [15, 0, 10n] }) as T;
  } }, "0x1111111111111111111111111111111111111111", "1")).rejects.toThrow();
});
