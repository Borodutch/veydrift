import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { ResolverTransactionCoordinator, type ResolverTransactionCoordinatorOptions } from "./resolverTransactions";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { defaultMissionBatchPolicy } from "./missionBatch";

const account = privateKeyToAccount("0x" + "01".repeat(32) as `0x${string}`);
const address = account.address;
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
const membership = JSON.stringify(Array.from({ length: 32 }, (_, n) => ({ missionId: String(n + 1), leg: "return", dueAt: 1 })));

function fixture(options: ResolverTransactionCoordinatorOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vey918-bounds-"));
  const path = join(dir, "resolver.sqlite");
  const coordinator = new ResolverTransactionCoordinator(path, options);
  const db = new Database(path);
  let finalized = 0n, orphan = -1, sends = 0;
  const counts = { block: 0, finality: 0, receipt: 0, member: 0, fee: 0, eligibility: 0 };
  let delay: (() => Promise<void>) | undefined;
  let memberDelay: (() => Promise<void>) | undefined;
  const rpc = {
    getStorageAt: async () => "0x0",
    getBlock: async (args: { blockTag?: string; blockNumber?: bigint }) => {
      if (args.blockTag === "finalized") {
        counts.finality++;
        await delay?.();
        return { number: finalized, hash: hash(Number(finalized)) };
      }
      if (args.blockTag === "latest") return { number: 1000n, hash: hash(1000) };
      counts.block++;
      return { number: args.blockNumber!, hash: hash(Number(args.blockNumber) + (Number(args.blockNumber) === orphan ? 10000 : 0)) };
    },
    getTransactionReceipt: async ({ hash: transactionHash }: { hash: string }) => {
      counts.receipt++;
      const block = BigInt(transactionHash);
      return { blockNumber: block, blockHash: hash(Number(block)), status: "success", logs: [],
        gasUsed: 10n, effectiveGasPrice: 2n, l1Fee: "0x1" };
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "getOperatorFee") { counts.fee++; return 2n; }
      counts.eligibility++;
      return [false, 9n, true];
    }
  } as unknown as PublicClient;
  const attach = (c: ResolverTransactionCoordinator) => new ViemMissionResolutionChainClient({
    listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    getCanonicalFleetMission: async () => { counts.member++; await memberDelay?.(); return { status: "Returning" } as never; }
  }, address, account, rpc, undefined, { id: 8453 } as never, undefined, c, undefined, undefined,
  { ...defaultMissionBatchPolicy, enabled: true });
  const client = attach(coordinator);
  const seed = (count: number, hydrated = true) => {
    const insert = db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,receipt_block_number,receipt_block_hash,outcomes) VALUES (8453,?,?,?,?,?,?,?,?,?)");
    for (let n = 1; n <= count; n++) insert.run(address.toLowerCase(), "batch:" + n, n, hash(n), membership,
      hydrated ? "confirmed" : "pending", hydrated ? String(n) : null, hydrated ? hash(n) : null, hydrated ? "[]" : null);
  };
  const request = (operationId = "randomness") => ({ chainId: 8453, address, operationId,
    getTransactionCount: async () => 1001, submit: async () => { sends++; return hash(1001); }, confirm: async () => {} });
  const reset = () => { for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0; };
  return { coordinator, db, client, path, attach, seed, request, counts, reset,
    finalize: (n: bigint) => { finalized = n; }, orphan: (n: number) => { orphan = n; }, sends: () => sends,
    delay: (fn?: () => Promise<void>) => { delay = fn; }, memberDelay: (fn?: () => Promise<void>) => { memberDelay = fn; },
    close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test("32 stalled-finality receipts cost 33 reads per pass after restart; admission blocks only new batches", async () => {
  const f = fixture();
  try {
    f.seed(32);
    const restarted = new ResolverTransactionCoordinator(f.path);
    f.attach(restarted);
    await restarted.submit(f.request());
    expect(f.counts).toEqual({ block: 32, finality: 1, receipt: 0, member: 0, fee: 0, eligibility: 0 });
    expect(f.sends()).toBe(1);
    let prepared = 0;
    f.reset();
    await expect(restarted.submit({ ...f.request("batch:new"), prepare: async () => {
      prepared++; return { hash: hash(1001), membership, broadcast: async () => hash(1001) };
    } })).rejects.toThrow("retained window full");
    expect(prepared).toBe(0);
    expect(f.counts.block).toBe(32);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit WHERE operation_id = 'batch:new'").get()).toEqual({ n: 0 });
    // Even an empty indexed queue renews canonical evidence; no historical leg/fee work.
    f.reset();
    await expect(f.client.resolveMissionBatch([])).resolves.toEqual({ hash: null, items: [], exclusions: [] });
    expect(f.counts.block).toBe(32);
    expect(f.counts.finality).toBe(1);
    f.orphan(32);
    await expect(restarted.submit(f.request("moon"))).rejects.toThrow("not canonical");
    expect(f.sends()).toBe(1);
    f.orphan(-1); f.finalize(32n); f.reset();
    await restarted.submit(f.request("moon"));
    expect(f.counts.block).toBe(32);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE status='finalized'").get()).toEqual({ n: 32 });
    f.reset(); await restarted.submit(f.request("next"));
    expect(f.counts.finality).toBe(0);
    await expect(restarted.submit({ ...f.request("regression"), getTransactionCount: async () => 1 })).rejects.toThrow("nonce regression");
    const plan = f.db.query("EXPLAIN QUERY PLAN SELECT nonce FROM resolver_prepared_intents INDEXED BY resolver_intents_unfinalized_nonce WHERE chain_id=8453 AND resolver_address=? AND status != 'finalized' ORDER BY nonce LIMIT 33").all(address.toLowerCase());
    expect(JSON.stringify(plan)).toContain("resolver_intents_unfinalized_nonce");
  } finally { f.close(); }
});

test("the 32nd batch is admitted, hydrated once, and the 33rd cannot sign while finality stalls", async () => {
  const f = fixture();
  try {
    f.seed(31);
    let prepared = 0, broadcast = 0;
    const batch = (id: string) => ({ ...f.request(id), prepare: async () => {
      prepared++;
      return { hash: hash(1001), membership, broadcast: async () => { broadcast++; return hash(1001); } };
    } });
    await f.coordinator.submit(batch("new-batch"));
    // Pre-allocation warm pass: 32 units. Post-confirmation: 31 warm + 68 cold = 99.
    expect(Object.values(f.counts).reduce((a, b) => a + b, 0)).toBe(131);
    expect(f.counts.receipt).toBe(1); expect(f.counts.member).toBe(32);
    expect(f.counts.eligibility).toBe(32); expect(f.counts.fee).toBe(1);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents").get()).toEqual({ n: 32 });
    await expect(f.coordinator.submit(batch("over-capacity"))).rejects.toThrow("retained window full");
    expect(prepared).toBe(1); expect(broadcast).toBe(1);
  } finally { f.close(); }
});

test("oversized legacy history drains in bounded pages but never allocates past an unchecked ambiguous tail", async () => {
  const f = fixture();
  try {
    f.seed(100);
    await expect(f.coordinator.submit(f.request())).rejects.toThrow("retained window exceeded");
    expect(f.counts.block).toBe(32); expect(f.counts.finality).toBe(1);
    expect(f.sends()).toBe(0);
    f.finalize(100n); f.orphan(100);
    for (let pass = 0; pass < 3; pass++) {
      f.reset();
      await expect(f.coordinator.submit(f.request())).rejects.toThrow("retained window exceeded");
      expect(f.counts.block).toBe(32); expect(f.counts.finality).toBe(1);
      expect(f.sends()).toBe(0);
    }
    await expect(f.coordinator.submit(f.request())).rejects.toThrow("not canonical");
    expect(f.sends()).toBe(0);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents").get()).toEqual({ n: 100 });
    f.orphan(-1); await f.coordinator.submit(f.request()); expect(f.sends()).toBe(1);
  } finally { f.close(); }
});

test("cold 32-leg receipts obey 128-work budget; hydrated receipts and telemetry are reused on retry/restart", async () => {
  const f = fixture();
  const info = console.info; let receipts = 0;
  console.info = (line) => { if (JSON.parse(String(line)).kind === "mission_batch_receipt") receipts++; };
  try {
    f.seed(3, false);
    await expect(f.coordinator.submit(f.request())).rejects.toThrow("read budget exhausted");
    expect(Object.values(f.counts).reduce((a, b) => a + b, 0)).toBe(128);
    expect(f.sends()).toBe(0); expect(receipts).toBe(1);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE outcomes IS NOT NULL").get()).toEqual({ n: 1 });
    const restarted = new ResolverTransactionCoordinator(f.path); f.attach(restarted);
    await expect(restarted.submit(f.request())).rejects.toThrow("read budget exhausted");
    await restarted.submit(f.request()); expect(receipts).toBe(3);
    f.reset(); await restarted.submit(f.request("moon"));
    expect(f.counts).toEqual({ block: 3, finality: 1, receipt: 0, member: 0, fee: 0, eligibility: 0 });
    expect(receipts).toBe(3);
  } finally { console.info = info; f.close(); }
});

test("deadline releases lease; unresolved and late finality reads cannot pile up or write/broadcast", async () => {
  const f = fixture({ reconciliationTimeoutMs: 25 }); const pending = gate();
  try {
    f.seed(32); f.delay(() => pending.promise);
    const started = performance.now();
    await expect(f.coordinator.submit(f.request())).rejects.toThrow("deadline");
    expect(performance.now() - started).toBeLessThan(500);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_leases").get()).toEqual({ n: 0 });
    for (let n = 0; n < 5; n++) await expect(f.coordinator.submit(f.request("retry" + n))).rejects.toThrow("still unresolved");
    expect(f.counts.finality).toBe(1);
    // A separate process can acquire the released lease and fail closed on the same evidence.
    const sibling = new ResolverTransactionCoordinator(f.path, { reconciliationTimeoutMs: 25 }); f.attach(sibling);
    await expect(sibling.submit(f.request("sibling"))).rejects.toThrow("deadline");
    expect(f.counts.finality).toBe(2);
    pending.resolve(); await new Promise((r) => setTimeout(r, 5));
    expect(f.counts.block).toBe(0); expect(f.sends()).toBe(0);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get()).toEqual({ n: 0 });
    f.delay(); await sibling.submit(f.request("recovered")); expect(f.sends()).toBe(1);
  } finally { pending.resolve(); f.close(); }
});

test("late member hydration cannot emit receipt telemetry, persist outcomes or start another leg", async () => {
  const f = fixture({ reconciliationTimeoutMs: 25 }); const pending = gate();
  const info = console.info; let receipts = 0;
  console.info = (line) => { if (JSON.parse(String(line)).kind === "mission_batch_receipt") receipts++; };
  try {
    f.seed(1, false); f.memberDelay(() => pending.promise);
    await expect(f.coordinator.submit(f.request())).rejects.toThrow("deadline");
    expect(f.counts.member).toBe(1);
    pending.resolve(); await new Promise((r) => setTimeout(r, 5));
    expect(f.counts.member).toBe(1); expect(f.counts.eligibility).toBe(0);
    expect(receipts).toBe(0); expect(f.sends()).toBe(0);
    expect(f.db.query("SELECT status,outcomes FROM resolver_prepared_intents").get()).toEqual({ status: "pending", outcomes: null });
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_leases").get()).toEqual({ n: 0 });
    f.memberDelay(); await f.coordinator.submit(f.request()); expect(receipts).toBe(1);
  } finally { pending.resolve(); console.info = info; f.close(); }
});
