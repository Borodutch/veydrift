import { expect, test } from "bun:test";
import { encodeFunctionResult } from "viem";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BattleKeeper } from "./keeper";
import { KeeperJournal } from "./journal";
import { progressAbi, progressAdvanced, readMissionProgress, type MissionProgress } from "./progress";
import type { MissionResolver } from "./resolver";
import { RpcError, type JsonRpcTransport } from "./transport";

const initial: MissionProgress = { blockNumber: "100", blockHash: ("0x" + "a".repeat(64)), version: "v1", phase: 1, round: 0, workDone: "0" };
const silent = { info() {}, warn() {}, error() {} };

test("no-progress is durable, readonly retries resume only on progress/version, terminal never pays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-no-progress-"));
  const path = join(dir, "journal.sqlite");
  let journal = new KeeperJournal(path, "8453:game");
  let sent = 0, status = 1;
  let progress = { ...initial };
  let advance = false, failRead = false;
  const resolver: MissionResolver = {
    keeperAddress: () => "0xkeeper",
    missionProgress: async () => { if (failRead) throw new Error("RPC unavailable"); return { ...progress }; },
    missionStatus: async missionId => ({ missionId, status, missionType: 3, arrivalAt: 1, returnAt: 2, randomnessRequestId: "1" }),
    resolveMission: async (_id, _leg, beforeSign) => {
      await beforeSign?.();
      sent++;
      if (advance) progress = { ...progress, workDone: String(BigInt(progress.workDone) + 1n) };
      return "0xreceipt";
    }
  };
  const reopen = () => new BattleKeeper(resolver, { journal, now: () => 1000, logger: silent });
  try {
    let keeper = reopen();
    keeper.recordLaunched({ missionId: "95855", missionType: 3, arrivalAt: 1, returnAt: 2 });
    await keeper.tick();
    expect(sent).toBe(1);
    expect(keeper.snapshot().lastError).toContain("no canonical mission progress");
    await keeper.tick(); await keeper.tick();
    expect(sent).toBe(1);
    journal.close(); journal = new KeeperJournal(path, "8453:game"); keeper = reopen();
    await keeper.tick(); expect(sent).toBe(1);
    failRead = true; await keeper.tick(); expect(sent).toBe(1); failRead = false;
    // A receipt on an old head or a regressed round/work counter cannot unlock paid retries.
    progress = { ...progress, blockNumber: "99", workDone: "10" };
    await keeper.tick(); expect(sent).toBe(1);
    progress = { ...progress, blockNumber: "101", workDone: "1" }; advance = true;
    await keeper.tick(); await keeper.tick(); expect(sent).toBe(3);
    // Do not release the high-water intent after a successful chunk: a reorg must not buy it twice.
    progress = { ...progress, workDone: "1" };
    await keeper.tick(); expect(sent).toBe(3);
    progress = { ...progress, version: "v2" }; advance = false;
    await keeper.tick(); expect(sent).toBe(4);
    journal.close(); journal = new KeeperJournal(path, "8453:game"); keeper = reopen();
    await keeper.tick(); expect(sent).toBe(4);
    status = 3; await keeper.tick(); expect(sent).toBe(4);
    expect(keeper.snapshot().pendingCount).toBe(0);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("pre-sign hook crash does not consume a checkpoint and restart retries safely", async () => {
  const journal = new KeeperJournal(":memory:", "8453:game");
  let signatures = 0;
  const resolver: MissionResolver = {
    keeperAddress: () => "0xkeeper", missionProgress: async () => initial,
    missionStatus: async missionId => ({ missionId, status: 1, missionType: 3, arrivalAt: 1, returnAt: 2, randomnessRequestId: "1" }),
    resolveMission: async (_id, _leg, beforeSign) => {
      await beforeSign?.();
      throw new Error("crash before signing");
    }
  };
  let keeper = new BattleKeeper(resolver, { journal, now: () => 1000, logger: silent });
  keeper.recordLaunched({ missionId: "1", missionType: 3, arrivalAt: 1, returnAt: 2 });
  await keeper.tick();
  expect(journal.guards()).toHaveLength(0);
  resolver.resolveMission = async (_id, _leg, beforeSign) => { await beforeSign?.(); signatures++; return "0xreceipt"; };
  keeper = new BattleKeeper(resolver, { journal, now: () => 1000, logger: silent });
  await keeper.tick();
  expect(signatures).toBe(1);
  journal.close();
});

test("phase wrap is not regression; preparation/math work and legacy rounds advance, head/phase alone do not", () => {
  expect(progressAdvanced(initial, { ...initial, phase: 14 })).toBe(false);
  expect(progressAdvanced(initial, { ...initial, blockNumber: "101" })).toBe(false);
  expect(progressAdvanced({ ...initial, phase: 15 }, { ...initial, phase: 1, workDone: "1" })).toBe(true);
  expect(progressAdvanced(initial, { ...initial, round: 1 })).toBe(true);
  expect(progressAdvanced({ ...initial, arrivalOrderCursor: "5" }, { ...initial, arrivalOrderCursor: "6" })).toBe(true);
  expect(progressAdvanced({ ...initial, arrivalOrderCursor: "5" }, { ...initial, arrivalOrderCursor: "4" })).toBe(false);
  expect(progressAdvanced({ ...initial, queueProgress: "0:10:10" }, { ...initial, queueProgress: "1:10:10" })).toBe(true);
  expect(progressAdvanced({ ...initial, queueProgress: "2:10:10" }, { ...initial, queueProgress: "1:10:10" })).toBe(false);
  const pop = (2n << 128n).toString();
  expect(progressAdvanced({ ...initial, queueProgress: pop + ":10:10" }, { ...initial, queueProgress: pop + ":10:9" })).toBe(true);
});

test("progress reader pins version and progress reads; only empty EVM revert permits legacy fallback", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  let failure: unknown;
  let calls = 0;
  const tags: unknown[] = [];
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: ("0x" + "a".repeat(64)) } as T;
    tags.push(params.at(-1));
    if (method === "eth_getStorageAt") return ("0x" + "0".repeat(64)) as T;
    if (method === "eth_getCode") return "0x6000" as T;
    if (method === "eth_call") {
      calls++;
      if (calls === 1 && failure) throw failure;
      return (calls === 1 ? encodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", result: [14, 2, 123n] })
        : encodeFunctionResult({ abi: progressAbi, functionName: "battleResolutionProgress", result: [3, 6] })) as T;
    }
    throw new Error(method);
  } };
  expect(await readMissionProgress(transport, address, "1")).toMatchObject({ phase: 14, round: 2, workDone: "123" });
  expect(tags.every(tag => JSON.stringify(tag) === JSON.stringify({ blockHash: ("0x" + "a".repeat(64)), requireCanonical: true }))).toBe(true);
  calls = 0; failure = new RpcError("execution reverted", 3, "0x");
  expect(await readMissionProgress(transport, address, "1")).toMatchObject({ round: 3, workDone: "0" });
  calls = 0; failure = new Error("timeout");
  await expect(readMissionProgress(transport, address, "1")).rejects.toThrow("timeout");
  expect(calls).toBe(1);
});
