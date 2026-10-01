import { expect, test } from "bun:test";
import { keccak256, parseTransaction, type Hex } from "viem";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { BattleKeeper } from "./keeper";
import { assertSignedTarget, signedAttempt } from "./transaction";
import { KeeperJournal } from "./journal";
import { ViemMissionResolver, settlementGasLimit } from "./resolver";
import type { JsonRpcTransport } from "./transport";
import { consumeProgress, guardAllows, type MissionProgress } from "./progress";
const progress: MissionProgress = { blockNumber: "100", blockHash: "0x" + "1".repeat(64), version: "v1", phase: 15, round: 0, workDone: "10" };
const blockHash = "0x" + "2".repeat(64);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "keeper-signed-"));
  const path = join(dir, "journal.sqlite");
  let journal = new KeeperJournal(path, "8453:game");
  let mined: Hex | undefined, reject = false, loseReceipt = false, reverted = false;
  const raws: Hex[] = [];
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_call") return ((params[0] as {data:string}).data.startsWith("0xce02abe2") ? ("0x" + [1n,0n,1n].map(n=>n.toString(16).padStart(64,"0")).join("")) : "0x") as T;
    if (method === "eth_getTransactionCount") return (mined ? "0x1" : "0x0") as T;
    if (method === "eth_estimateGas") return "0x5208" as T;
    if (method === "eth_getBlockByNumber") return { number: "0x65", hash: blockHash, baseFeePerGas: "0x1" } as T;
    if (method === "eth_maxPriorityFeePerGas") return "0x1" as T;
    if (method === "eth_sendRawTransaction") {
      const raw = params[0] as Hex; raws.push(raw);
      if (reject) throw new Error("insufficient funds for gas * price + value");
      mined = keccak256(raw); return mined as T;
    }
    if (method === "eth_getTransactionReceipt") {
      if (loseReceipt) throw new Error("receipt transport unavailable");
      return (mined === params[0] ? { status: reverted ? "0x0" : "0x1", transactionHash: mined, blockNumber: "0x65", blockHash } : null) as T;
    }
    throw new Error(method);
  } };
  const resolver = () => {
    const r = new ViemMissionResolver(transport, ("0x" + "1".repeat(64)) as Hex,
      "0x1111111111111111111111111111111111111111", 8453, { receiptMaxPolls: 2, receiptPollIntervalMs: 0 });
    r.bindAttemptStore(journal); return r;
  };
  return { get journal() { return journal; }, raws, resolver,
    revert() { reverted = true; }, reject(value: boolean) { reject = value; }, loseReceipt(value: boolean) { loseReceipt = value; },
    reopen() { journal.close(); journal = new KeeperJournal(path, "8453:game"); },
    close() { journal.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

test("crash before signing leaves no consumed checkpoint and retries without external progress", async () => {
  const f = fixture();
  try {
    await expect(f.resolver().resolveMission("1", "arrival", async () => { throw new Error("crash before sign"); })).rejects.toThrow("crash");
    expect(f.journal.attemptKeys()).toHaveLength(0); expect(f.journal.guards()).toHaveLength(0);
    f.reopen();
    await f.resolver().resolveMission("1", "arrival", async () => progress);
    expect(f.raws).toHaveLength(1);
    expect(parseTransaction(f.raws[0]!).gas).toBe(settlementGasLimit);
  } finally { f.close(); }
});

test("crash after signed persistence resumes identical bytes; successful no-op consumes only on receipt", async () => {
  const f = fixture();
  try {
    const r = f.resolver();
    r.bindAttemptStore({ attemptKeys: () => f.journal.attemptKeys(), getAttempt: key => f.journal.getAttempt(key),
      removeAttempt: key => f.journal.removeAttempt(key), putAttempt: (key, attempt) => {
        f.journal.putAttempt(key, attempt); throw new Error("crash after persist before broadcast");
      } });
    await expect(r.resolveMission("1", "arrival", async () => progress)).rejects.toThrow("crash");
    const raw = f.journal.getAttempt("1:arrival")!.raw;
    expect(f.raws).toHaveLength(0); expect(f.journal.guards()).toHaveLength(0);
    f.reopen();
    const recovered = f.resolver();
    await recovered.resolveMission("1", "arrival", async () => { throw new Error("must not sign twice"); });
    expect(f.raws).toEqual([raw]);
    const guard = consumeProgress(undefined, recovered.pendingProgress("1", "arrival")!, "1", "arrival");
    f.journal.putGuard(guard); recovered.acknowledgeReceipt("1", "arrival");
    f.reopen(); expect(guardAllows(f.journal.guards()[0], progress)).toBe(false);
  } finally { f.close(); }
});

test("definite RPC rejection recovers after funding by resending same signed nonce, never a fresh checkpoint", async () => {
  const f = fixture();
  try {
    f.reject(true);
    await expect(f.resolver().resolveMission("1", "arrival", async () => progress)).rejects.toThrow("insufficient funds");
    expect(f.journal.guards()).toHaveLength(0);
    const raw = f.raws[0]!;
    f.reopen(); f.reject(false);
    await f.resolver().resolveMission("1", "arrival", async () => { throw new Error("must resume"); });
    expect(f.raws).toEqual([raw, raw]);
  } finally { f.close(); }
});

test("unknown receipt never allocates a fresh nonce and restart finds canonical receipt without rebroadcast", async () => {
  const f = fixture();
  try {
    await f.resolver().resolveMission("1", "arrival", async () => progress);
    f.loseReceipt(true);
    await expect(f.resolver().resolveMission("1", "arrival")).rejects.toThrow("receipt transport");
    await expect(f.resolver().resolveMission("2", "arrival")).rejects.toThrow("owns the keeper nonce");
    f.reopen(); f.loseReceipt(false);
    await f.resolver().resolveMission("1", "arrival");
    expect(f.raws).toHaveLength(1);
  } finally { f.close(); }
});

test("version oscillation never reopens a previously paid checkpoint", () => {
  let guard = consumeProgress(undefined, progress, "1", "arrival");
  const v2 = { ...progress, version: "v2", workDone: "0", blockNumber: "101" };
  expect(guardAllows(guard, v2)).toBe(true);
  guard = consumeProgress(guard, v2, "1", "arrival");
  expect(guardAllows(guard, { ...progress, blockNumber: "102" })).toBe(false);
  expect(guardAllows(guard, { ...v2, blockNumber: "103" })).toBe(false);
  expect(guardAllows(guard, { ...progress, workDone: "11", blockNumber: "104" })).toBe(true);
});


test("paid reverted receipt consumes checkpoint across restart; genuine progress unlocks", async () => {
  const f = fixture(); let work = progress;
  const keeper = () => {
    const r = f.resolver();
    r.missionStatus = async missionId => ({ missionId, status: 1, missionType: 3, arrivalAt: 1, returnAt: 2, randomnessRequestId: "1" });
    r.missionProgress = async () => work;
    return new BattleKeeper(r, { journal: f.journal, now: () => 1000, logger: { info() {}, warn() {}, error() {} } });
  };
  try {
    f.revert(); let k = keeper();
    k.recordLaunched({ missionId: "1", missionType: 3, arrivalAt: 1, returnAt: 2 });
    await k.tick(); expect(f.raws).toHaveLength(1);
    expect(f.journal.attemptKeys()).toHaveLength(0);
    expect(f.journal.guards()).toHaveLength(1);
    f.reopen(); k = keeper(); await k.tick(); await k.tick();
    expect(f.raws).toHaveLength(1);
    work = { ...progress, workDone: "11" }; await k.tick();
    expect(f.raws).toHaveLength(2);
  } finally { f.close(); }
});

test("signed target rejects nonzero value and over-ceiling gas before dispatch", async () => {
  const account = privateKeyToAccount(("0x" + "1".repeat(64)) as Hex);
  const to = "0x1111111111111111111111111111111111111111", data = "0x1234";
  for (const [value, gas] of [[1n, settlementGasLimit], [0n, 16_777_216n]]) {
    const raw = await account.signTransaction({ to, data, value, gas, chainId: 8453, nonce: 0,
      type: "eip1559", maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    await expect(assertSignedTarget(signedAttempt(raw, 0), { from: account.address, to, data,
      chainId: 8453, maxGas: settlementGasLimit })).rejects.toThrow("authorized mission envelope");
  }
});
