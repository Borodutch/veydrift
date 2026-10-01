import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeFunctionResult, keccak256, parseTransaction, stringToHex, toHex, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { progressAbi } from "../../battle-keeper/src/progress";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { ViemRandomnessCommitmentChainClient } from "./randomnessCommitter";
const account = privateKeyToAccount(("0x" + "1".repeat(64)) as Hex);
const game = "0x3333333333333333333333333333333333333333";
const blockHash = toHex(123n, { size: 32 });
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mission-coordination-"));
  const coordination = join(dir, "coordinator.sqlite"), journal = coordination; // Production shares this file.
  let nonce = 7, work = 1n, rejected = true, namespaceActive = true;
  let missionTypeId = 3, status = "Outbound", scanWork = 0n, scanOnReceipt = false;
  let receiptGate: ReturnType<typeof deferred> | undefined, receiptStarted = deferred();
  let preparationGate: ReturnType<typeof deferred> | undefined, preparationStarted = deferred();
  const receipts = new Map<Hex, unknown>(), raws: Hex[] = [], writes: number[] = [];
  const arrivalSlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"bytes32"}], [2n,keccak256(stringToHex("veydrift.storage.arrival-progress.v1"))]));
  const reader = { async isFleetChronologyOrderingReady() { return true; }, async listResolvableFleetMissions() { return []; }, async listReturnableFleetMissions() { return []; },
    async getCanonicalFleetMission() { return { status, missionTypeId, targetPlanetId: "2" }; } };
  const publicClient = {
    async call() { return { data: "0x" }; },
    async getStorageAt() { return toHex(0n, { size: 32 }); },
    async getTransactionCount() { return nonce; },
    async waitForTransactionReceipt() { return { status: "success" }; },
    async prepareTransactionRequest(input: object) {
      preparationStarted.release(); if (preparationGate) { const gate = preparationGate; preparationGate = undefined; await gate.promise; }
      return { gas: 21_000n, ...input, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, type: "eip1559" };
    },
    async request({method, params}: {method: string; params: unknown[]}) {
      if (method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash };
      if (method === "eth_getCode") return "0x6000";
      if (method === "eth_getStorageAt") return toHex(params[1] === arrivalSlot && namespaceActive ? 1n
        : params[1] === toHex(BigInt(arrivalSlot) + 1n, {size:32}) ? scanWork : 0n, { size: 32 });
      if (method === "eth_call") return encodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", result: [1,0,work] });
      if (method === "eth_sendRawTransaction") {
        const raw = params[0] as Hex; raws.push(raw);
        if (rejected) throw new Error("insufficient funds at raw broadcast");
        mine(raw); if (scanOnReceipt) scanWork += 12n; return keccak256(raw);
      }
      if (method === "eth_getTransactionReceipt") {
        const receipt = receipts.get(params[0] as Hex) ?? null;
        if (receipt && receiptGate) { const gate = receiptGate; receiptGate = undefined; receiptStarted.release(); await gate.promise; }
        return receipt;
      }
      throw new Error(method);
    }
  } as unknown as PublicClient;
  const wallet = { async writeContract(input: {nonce: number}) { writes.push(input.nonce); nonce = input.nonce + 1; return toHex(BigInt(nonce), {size:32}); } } as unknown as WalletClient;
  const coordinator = () => new ResolverTransactionCoordinator(coordination, { replacementPollMs: 1 });
  const client = (versions = [`${game}:${keccak256("0x6000")}`]) => new ViemMissionResolutionChainClient(reader as never, game, account, publicClient, wallet,
    {id:8453} as never, "https://example.invalid", coordinator(), game, undefined, journal, versions);
  const randomness = () => new ViemRandomnessCommitmentChainClient(publicClient, wallet, game, account, {id:8453} as never, coordinator());
  const mine = (raw: Hex) => {
    const hash = keccak256(raw); nonce = parseTransaction(raw).nonce! + 1;
    receipts.set(hash, { status: "0x1", transactionHash: hash, blockNumber: "0x64", blockHash });
  };
  const db = () => new Database(journal);
  const envelope = () => { const d = db(); try { return d.query("SELECT value FROM mission_signed_attempts").get() as {value:string} | null; } finally { d.close(); } };
  return { client, randomness, coordinator, raws, writes, db, envelope, coordination,
    terminal() { status = "Resolved"; }, type(id: number) { missionTypeId = id; }, scans(enabled = true) { scanOnReceipt = enabled; },
    legacy() { namespaceActive = false; }, nonHostile() { missionTypeId = 0; }, returning() { status = "Returning"; },
    mine() { mine(raws[0]!); }, advance() { work++; }, fund() { rejected = false; },
    delayReceipt() { receiptGate = deferred(); receiptStarted = deferred(); return { gate: receiptGate, started: receiptStarted.promise }; },
    delayPreparation() { preparationGate = deferred(); preparationStarted = deferred(); return { gate: preparationGate, started: preparationStarted.promise }; },
    close() { rmSync(dir, {recursive:true,force:true}); } };
}
const settle = (promise: Promise<string>) => promise.catch(error => String(error));
const moon = (client: ViemMissionResolutionChainClient) => (client as unknown as {write(name:string,id:string):Promise<string>}).write("finalizeMoonChance", "1");

test("two clients shared SQLite serialize deferred recovery ack before another allocation", async () => {
  const f = fixture();
  try {
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    f.mine(); const wait = f.delayReceipt();
    const a = settle(f.client().resolveFleetMission("1")); await wait.started;
    let secondFinished = false;
    const b = settle(f.client().resolveFleetMission("1")).then(value => { secondFinished = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(secondFinished).toBe(false); expect(f.envelope()).not.toBeNull();
    wait.gate.release(); await Promise.all([a,b]);
    expect(f.envelope()).toBeNull(); expect(f.raws).toHaveLength(1);
    f.advance(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    const next = JSON.parse(f.envelope()!.value);
    expect(next.nonce).toBe("8"); expect(next.raw).not.toBe(f.raws[0]);
  } finally { f.close(); }
});

test("stale exact-envelope ack cannot delete a replaced identity or change its guard", async () => {
  const f = fixture();
  try {
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    const original = JSON.parse(f.envelope()!.value);
    f.mine(); const wait = f.delayReceipt(); const pending = settle(f.client().resolveFleetMission("1")); await wait.started;
    const tx = parseTransaction(original.raw);
    const raw = await account.signTransaction({ to: game, data: tx.data!, nonce: 8, chainId: 8453,
      gas: 15_000_000n, type: "eip1559", maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    const replacement = JSON.stringify({...original, raw, hash: keccak256(raw), nonce:"8"});
    const d = f.db(); d.query("UPDATE mission_signed_attempts SET value = ?").run(replacement);
    wait.gate.release(); expect(await pending).toContain("stale signed mission acknowledgment");
    expect(f.envelope()!.value).toBe(replacement);
    expect(d.query("SELECT 1 FROM mission_progress_intents").get()).toBeNull(); d.close();
  } finally { f.close(); }
});

test("mission rejection/restart reserves nonce against real randomness and queued moon writers", async () => {
  const f = fixture();
  try {
    const paused = f.delayPreparation();
    const mission = settle(f.client().resolveFleetMission("1")); await paused.started;
    // Moon passed its pre-lease local-envelope check before the mission persists anything.
    const queuedMoon = settle(moon(f.client()));
    await new Promise(resolve => setTimeout(resolve, 10)); paused.gate.release();
    expect(await mission).toContain("insufficient funds");
    expect(await queuedMoon).toContain("reservation");
    const original = f.envelope()!.value;
    await expect(f.randomness().commitRandomnessBatch([toHex(1n,{size:32})])).rejects.toThrow("reservation");
    await expect(moon(f.client())).rejects.toThrow("durable signed mission");
    expect(f.writes).toEqual([]); expect(f.envelope()!.value).toBe(original);
    // Owner recovery after funding uses exactly the reserved bytes, then releases account.
    f.fund(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    expect(f.raws[0]).toBe(f.raws[1]);
    await f.randomness().commitRandomnessBatch([toHex(1n,{size:32})]);
    expect(f.writes).toEqual([8]);
  } finally { f.close(); }
});


test("lost-lease delayed old recovery cannot acknowledge the next chunk", async () => {
  const f = fixture();
  try {
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    f.mine(); const wait = f.delayReceipt(); const old = settle(f.client().resolveFleetMission("1")); await wait.started;
    const coordinatorDb = new Database(f.coordination);
    coordinatorDb.query("UPDATE resolver_transaction_leases SET expires_at_ms = 0").run();
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    f.advance(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    const next = f.envelope()!.value;
    wait.gate.release(); expect(await old).toContain("lease was lost");
    expect(f.envelope()!.value).toBe(next);
    const d = f.db(); const guard = d.query("SELECT value FROM mission_progress_intents").get() as {value:string};
    expect(JSON.parse(guard.value).before.workDone).toBe("1");
    d.close(); coordinatorDb.close();
  } finally { f.close(); }
});

test("crash after signed persistence before central hash update retains account-wide allocating reservation", async () => {
  const f = fixture();
  try {
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    const d = new Database(f.coordination);
    d.query("UPDATE resolver_transaction_attempts SET status = 'allocating', transaction_hash = NULL").run(); d.close();
    await expect(f.randomness().commitRandomnessBatch([toHex(2n,{size:32})])).rejects.toThrow("reservation");
    expect(f.writes).toEqual([]);
    f.fund(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    expect(f.raws[0]).toBe(f.raws[1]);
    await f.randomness().commitRandomnessBatch([toHex(2n,{size:32})]); expect(f.writes).toEqual([8]);
  } finally { f.close(); }
});


test("failure after central paid ack keeps local envelope for receipt-only restart recovery", async () => {
  const f = fixture();
  try {
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
    f.mine(); const d = f.db();
    d.exec("CREATE TRIGGER fail_ack BEFORE DELETE ON mission_signed_attempts BEGIN SELECT RAISE(ABORT, 'crash before local ack'); END");
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("crash before local ack");
    expect(f.envelope()).not.toBeNull();
    expect((d.query("SELECT status FROM resolver_transaction_attempts").get() as {status:string}).status).toBe("confirmed");
    d.exec("DROP TRIGGER fail_ack"); d.close();
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    expect(f.envelope()).toBeNull(); expect(f.raws).toHaveLength(1);
  } finally { f.close(); }
});


test("legacy hostile arrivals are explicitly gated without gating non-hostile or return legs", async () => {
  for (const leg of ["non-hostile", "return"]) {
    const f = fixture();
    try {
      f.legacy(); await expect(f.client([]).resolveFleetMission("1")).rejects.toThrow("runtime unverified");
      expect(f.raws).toHaveLength(0);
      if (leg === "return") {
        f.returning(); await expect(f.client().completeFleetMissionReturn("1")).rejects.toThrow("insufficient funds");
      } else {
        f.nonHostile(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
      }
      expect(f.raws).toHaveLength(1);
    } finally { f.close(); }
  }
});


for (const endState of ["advanced", "terminal"]) test("crash DURING preparation reconciles only proven no-raw lifecycle: " + endState, async () => {
  const f = fixture();
  try {
    const wait = f.delayPreparation(); const old = settle(f.client().resolveFleetMission("1")); await wait.started;
    const d = f.db();
    const row = d.query("SELECT status, transaction_hash AS hash, preparation_identity AS owner FROM resolver_transaction_attempts").get() as {status:string;hash:string|null;owner:string};
    expect(row.status).toBe("allocating"); expect(row.hash).toBeNull(); expect(row.owner).toContain(":resolveFleetMission");
    expect(f.envelope()).toBeNull();
    d.exec("UPDATE resolver_transaction_leases SET expires_at_ms = 0");
    if (endState === "advanced") {
      f.advance(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("insufficient funds");
      expect(f.raws).toHaveLength(1); expect(parseTransaction(f.raws[0]!).nonce).toBe(7);
    } else {
      f.terminal(); expect(await f.client().recoverPendingMissions()).toEqual([]);
      expect(await f.client().resolveFleetMission("1")).toBe("canonical:arrival-complete");
      await f.randomness().commitRandomnessBatch([toHex(3n,{size:32})]); expect(f.writes).toEqual([7]);
    }
    wait.gate.release(); expect(await old).toContain("lease was lost");
    if (endState === "advanced") {
      f.fund(); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
      expect(f.raws[0]).toBe(f.raws[1]);
      await f.randomness().commitRandomnessBatch([toHex(4n,{size:32})]); expect(f.writes).toEqual([8]);
    } else expect(f.raws).toHaveLength(0);
    d.close();
  } finally { f.close(); }
});

for (const type of [0,1,4]) test("verified zero-backlog bootstrap and paid ordering-only chunks for mission type " + type, async () => {
  const f = fixture();
  try {
    f.type(type); f.legacy(); f.fund(); f.scans();
    // Own staged getter remains work1/round0; only target scan-work advances on each receipt.
    for (let chunk = 0; chunk < 3; chunk++) {
      await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
      expect(f.raws).toHaveLength(chunk + 1);
    }
    expect(f.raws.map(raw => parseTransaction(raw).nonce)).toEqual([7,8,9]);
    f.scans(false); await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    await expect(f.client().resolveFleetMission("1")).rejects.toThrow("mission remains pending");
    expect(f.raws).toHaveLength(4); // status1 no-op suppresses further payment, even across new clients
  } finally { f.close(); }
}, 15_000);
