import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseTransaction, encodeFunctionResult, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy, type BatchLeg } from "./missionBatch";

const account = privateKeyToAccount(("0x" + "03".repeat(32)) as Hex);
const game = ("0x" + "12".repeat(20)) as Hex;
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
function fixture(cap = 4096) {
  const dir = mkdtempSync(join(tmpdir(), "vey61-archive-")), path = join(dir, "journal.sqlite");
  let coordinator = new ResolverTransactionCoordinator(path, { maxRetainedConfirmedIntents: cap });
  const db = new Database(path);
  let nonce = 0, finalized = 0n, reorgFrom = Infinity, wrongNonce = false, unavailableFinality = false, disagreeFinality = false;
  let reads = 0, sends = 0, signatures = 0, missingDomain = false, orphanOldOnDomain = false;
  let receiptFault: Record<string, unknown> = {};
  let prunedBefore = 0;
  const receipts = new Map<Hex, Record<string, unknown>>();
  const dueAt = Math.floor(Date.now() / 1000) - 5;
  const mine = (txHash: Hex, n: number) => {
    sends++; nonce++;
    receipts.set(txHash, { transactionHash: txHash, from: account.address, to: game, blockNumber: BigInt(1000 + n),
      blockHash: hash(1000 + n), status: "success", logs: [], gasUsed: 1n, effectiveGasPrice: 1n, l1Fee: "0x0", operatorFee: "0x0" });
    return txHash;
  };
  const block = (n: bigint) => ({ timestamp: BigInt(dueAt + 5), baseFeePerGas: 100n, gasLimit: 30_000_000n, number: n, hash: hash(Number(n) + (Number(n) >= reorgFrom ? 100_000 : 0)) });
  const rpc = {
    getStorageAt: async () => "0x00",
    estimateMaxPriorityFeePerGas: async () => 10n,
    call: async () => ({ data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", result: [[0], 100_000n] }) }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      expect(parseTransaction(serializedTransaction).nonce).toBe(nonce);
      return mine(keccak256(serializedTransaction), nonce);
    },
    getBlock: async ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) => {
      reads++;
      if (blockTag === "finalized") {
        if (unavailableFinality) throw new Error("upstream unavailable with private provider detail");
        return { number: finalized, hash: disagreeFinality ? hash(888) : hash(Number(finalized)) };
      }
      return block(blockNumber ?? BigInt(1000 + nonce));
    },
    getTransactionCount: async ({ blockNumber }: { blockNumber?: bigint }) => {
      reads++; if (blockNumber !== undefined && Number(blockNumber) < prunedBefore) throw new Error("historical nonce state pruned");
      return wrongNonce ? 0 : blockNumber === undefined ? nonce : Number(blockNumber) - 1000 + 1;
    },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => { reads++; return { ...receipts.get(hash), ...receiptFault }; },
    readContract: async ({ functionName }: { functionName: string }) => { reads++; return functionName === "fleetMissionEligibility" ? [false, 0n, true] : 100n; }
  } as unknown as PublicClient;
  const attach = () => new ViemMissionResolutionChainClient({
    listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    isFleetChronologyOrderingReady: async () => true,
    getCanonicalFleetMission: async (id) => { reads++; if (missingDomain) return null as never; if (orphanOldOnDomain) reorgFrom = 1000; return { status: Number(id) <= nonce ? "Returned" : "Returning", returnAt: String(dueAt), arrivalAt: String(dueAt - 5) } as never; }
  }, game, { address: account.address, signTransaction: async (tx: Parameters<typeof account.signTransaction>[0]) => {
    signatures++; return account.signTransaction(tx);
  } } as never, rpc, undefined, { id: 8453 } as never, undefined, coordinator, undefined, undefined,
  { ...defaultMissionBatchPolicy, enabled: true, maxItems: 1 });
  let client = attach();
  const submit = async () => {
    const n = nonce, items: BatchLeg[] = [{ missionId: String(n + 1), leg: "return", dueAt: 1 }];
    return coordinator.submit({ chainId: 8453, address: account.address, operationId: "batch:" + n,
      getTransactionCount: async () => nonce, submit: async () => { throw new Error("legacy submit forbidden"); }, confirm: async () => {},
      prepare: async (_nonce, signing) => {
        const membership = JSON.stringify(items);
        const raw = await signing.sign(membership, async () => {
          signatures++;
          return account.signTransaction({ chainId: 8453, nonce: n, to: game, data: batchCalldata(items), value: 0n,
            gas: 200_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, type: "eip1559" });
        });
        const txHash = keccak256(raw);
        return { hash: txHash, membership, serializedTransaction: raw, broadcast: async () => {
          return mine(txHash, n);
        } };
      }
    });
  };
  return { submit, resolveNext: () => client.resolveMissionBatch([{ missionId: String(nonce + 1), leg: "return", dueAt }]), db, path, get coordinator() { return coordinator; }, get client() { return client; },
    restart: () => { coordinator = new ResolverTransactionCoordinator(path, { maxRetainedConfirmedIntents: cap }); client = attach(); },
    reconcile: () => coordinator.reconcilePrepared(8453, account.address, undefined),
    reorg: (from: number) => { reorgFrom = from; }, badNonce: () => { wrongNonce = true; },
    finality: (n: bigint) => { finalized = n; }, finalityUnavailable: () => { unavailableFinality = true; },
    finalityDisagreement: () => { disagreeFinality = true; },
    pruneBefore: (n: number) => { prunedBefore = n; },
    corruptReceipt: (fault: Record<string, unknown>) => { receiptFault = fault; },
    missingDomain: () => { missingDomain = true; }, reorgDuringHydration: () => { orphanOldOnDomain = true; },
    counters: () => ({ reads, sends, signatures }), resetReads: () => { reads = 0; },
    close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("48 real signed coordinator admissions continue with frozen finality, bounded pages and durable restart", async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 48; n++) {
      f.resetReads(); await f.submit();
      expect(f.counters().reads).toBeLessThanOrEqual(82); // two bounded coordinator passes, not O(history)
      if (n === 31) f.restart();
    }
    expect(f.counters().sends).toBe(48); expect(f.counters().signatures).toBe(48);
    expect(f.client.admissionSnapshot()).toMatchObject({ active: 0, retainedConfirmed: 48, blockedReason: null });
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE serialized_transaction IS NOT NULL").get()).toEqual({ n: 48 });
    f.pruneBefore(1040); // old retained rows need headers, not indefinitely retained historical nonce state
    f.resetReads(); await f.reconcile(); expect(f.counters().reads).toBeLessThanOrEqual(32);
    const cursor = f.db.query("SELECT cursor_nonce FROM resolver_archive_progress").get();
    f.restart(); await f.reconcile();
    expect(f.db.query("SELECT cursor_nonce FROM resolver_archive_progress").get()).not.toEqual(cursor);
    // Reorg starts much earlier than the archival page; frontier MUST detect it immediately.
    f.reorg(1002); f.resetReads();
    await expect(f.submit()).rejects.toThrow("not canonical");
    expect(f.counters().reads).toBe(1); expect(f.counters().signatures).toBe(48);
    expect(f.client.admissionSnapshot()?.blockedReason).toBe("canonical-reconciliation-required");
  } finally { f.close(); }
});

test("consumed nonce contradiction fails closed despite unchanged containing hash", async () => {
  const f = fixture();
  try {
    await f.submit(); f.restart(); f.badNonce();
    await expect(f.submit()).rejects.toThrow("nonce not consumed");
    expect(f.counters().signatures).toBe(1);
  } finally { f.close(); }
});

test("missing finality retains evidence but does not stop ordinary admission; disagreement does", async () => {
  const f = fixture();
  try {
    await f.submit(); f.finalityUnavailable();
    await f.submit(); await f.submit();
    expect(f.client.admissionSnapshot()).toMatchObject({ active: 0, retainedConfirmed: 3 });
    expect(JSON.stringify(f.client.admissionSnapshot())).not.toContain("private provider");
  } finally { f.close(); }
  const bad = fixture();
  try {
    await bad.submit(); bad.finalityDisagreement();
    await expect(bad.submit()).rejects.toThrow("finalized identity contradiction");
    expect(bad.counters().signatures).toBe(1);
  } finally { bad.close(); }
});

test("confirmed retention cap stops before signing, retains all bytes, and finality drains bounded pages", async () => {
  const f = fixture(36);
  try {
    for (let n = 0; n < 36; n++) await f.submit();
    await expect(f.submit()).rejects.toThrow("confirmed-retention-full");
    expect(f.counters().signatures).toBe(36);
    expect(f.client.admissionSnapshot()?.blockedReason).toBe("confirmed-retention-full");
    f.finality(2000n);
    for (let n = 0; n < 7; n++) await f.reconcile();
    expect(f.client.admissionSnapshot()).toMatchObject({ retainedConfirmed: 0, blockedReason: null });
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE serialized_transaction IS NOT NULL").get()).toEqual({ n: 0 });
    expect(f.db.query("SELECT count(*) AS n FROM resolver_signing_results WHERE serialized_transaction IS NOT NULL").get()).toEqual({ n: 0 });
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE outcomes IS NOT NULL").get()).toEqual({ n: 36 });
    await f.submit(); expect(f.counters().signatures).toBe(37);
  } finally { f.close(); }
});


test("full production batch selection, fee readiness, signing and sending continue past 32 while finality freezes", async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 40; n++) {
      f.resetReads();
      const result = await f.resolveNext();
      expect(result.items).toHaveLength(1);
      expect(result.outcomes?.[0]?.complete).toBe(true);
      expect(f.counters().reads).toBeLessThanOrEqual(150);
      if (n === 31) f.restart();
    }
    expect(f.counters().sends).toBe(40); expect(f.counters().signatures).toBe(40);
    expect(f.client.admissionSnapshot()).toMatchObject({ active: 0, retainedConfirmed: 40, blockedReason: null });
  } finally { f.close(); }
});


for (const [name, fault] of [["hash", { transactionHash: hash(999) }], ["sender", { from: game }], ["target", { to: account.address }]] as const) {
  test("contradictory receipt " + name + " never qualifies for confirmed admission", async () => {
    const f = fixture();
    try {
      f.corruptReceipt(fault);
      await expect(f.submit()).rejects.toThrow("receipt identity mismatch");
      expect(f.db.query("SELECT status,admission_proven,outcomes FROM resolver_prepared_intents").get()).toEqual({ status: "pending", admission_proven: 0, outcomes: null });
      f.restart(); await expect(f.submit()).rejects.toThrow("receipt identity mismatch");
      expect(f.counters().signatures).toBe(1);
    } finally { f.close(); }
  });
}

test("missing domain evidence or a hydration reorg cannot advance the durable checkpoint", async () => {
  for (const kind of ["domain", "reorg"]) {
    const f = fixture();
    try {
      await f.submit();
      if (kind === "domain") f.missingDomain(); else f.reorgDuringHydration();
      await expect(f.submit()).rejects.toThrow(kind === "domain" ? "canonical state unavailable" : "not canonical");
      expect(f.db.query("SELECT max(nonce) AS n FROM resolver_prepared_intents WHERE admission_proven=1").get()).toEqual({ n: 0 });
      f.restart(); await expect(f.submit()).rejects.toThrow();
      expect(f.counters().signatures).toBe(2);
      expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE serialized_transaction IS NOT NULL").get()).toEqual({ n: 2 });
    } finally { f.close(); }
  }
});

test("storage backpressure blocks before lease writes and leaves evidence intact", async () => {
  const f = fixture();
  try {
    await f.submit();
    const before = f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get();
    // Fault-inject the measured disk budget, not a 240 MiB allocation in CI.
    (f.coordinator as unknown as { journalBytes(): number }).journalBytes = () => 240 * 1024 * 1024;
    await expect(f.submit()).rejects.toThrow("journal-storage-full");
    expect(f.counters().signatures).toBe(1);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get()).toEqual(before);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_leases").get()).toEqual({ n: 0 });
    expect(f.client.admissionSnapshot()?.blockedReason).toBe("journal-storage-full");
  } finally { f.close(); }
});
