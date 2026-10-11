import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const chainId = 8453, address = ("0x" + "ab".repeat(20)) as Hex, resolver = address.toLowerCase();
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(now: { value: number }) {
  const dir = mkdtempSync(join(tmpdir(), "resolver-diagnostics-")); dirs.push(dir);
  const path = join(dir, "journal.sqlite");
  const coordinator = new ResolverTransactionCoordinator(path, { now: () => now.value, sleep: async () => {}, leaseRenewIntervalMs: 1_000_000 });
  return { coordinator, db: new Database(path), path };
}

function blockedEvents(spy: ReturnType<typeof spyOn>): Record<string, unknown>[] {
  return (spy.mock.calls as unknown[][]).map(([line]): Record<string, unknown> | null => { try { return JSON.parse(String(line)); } catch { return null; } })
    .filter((event): event is Record<string, unknown> => event?.kind === "resolver_reconciliation_blocked");
}

test("blocked event keeps the real sanitized error and stage when recovery lineage is retained", async () => {
  const f = fixture({ value: Date.now() });
  const binding = { chainId, address: resolver, nonce: 5, originalHash: hash(1), operationId: "batch:recovered", membership: "[]",
    to: resolver, data: "0x", value: "0", evidence: "{}" };
  const receipt = { finalized: true, blockNumber: "10", blockHash: hash(10), outcomes: "[]" };
  // A finalized, fully bound recovery group (the production shape) plus an unrelated failing intent.
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,receipt_block_number,receipt_block_hash,outcomes) VALUES (?,?,?,?,?,?,'finalized','10',?,'[]')")
    .run(chainId, resolver, "batch:recovered", 5, hash(1), "[]", hash(10));
  f.db.query("INSERT INTO resolver_nonce_recovery (chain_id,resolver_address,nonce,binding,original_hash,max_fee_wei,winner_hash,winner_receipt,finalized) VALUES (?,?,5,?,?,'1',?,?,1)")
    .run(chainId, resolver, JSON.stringify(binding), hash(1), hash(1), JSON.stringify(receipt));
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES (?,?,?,?,?,?,'pending')")
    .run(chainId, resolver, "batch:legacy", 6, hash(2), "[]");
  let verified = 0;
  f.coordinator.setRecoveryObserver(chainId, address, { verifyFinalized: async () => { verified++; },
    observe: async () => null, invalidate: () => {}, assertUnconsumed: async () => {} });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(f.coordinator.reconcilePrepared(chainId, address, async () => undefined)).rejects.toThrow("missing signed bytes");
    const event = blockedEvents(warn)[0]!;
    expect(verified).toBe(1);
    expect(event).toMatchObject({ stage: "active", recoveryGroups: 1, retainedAtLeast: 1 });
    expect(event.reason).toContain("legacy durable batch intent missing signed bytes");
    expect(event.reason).not.toContain("recovery reconciliation held");
    expect(typeof event.slowestReadMs).toBe("number");
    expect(f.coordinator.admissionSnapshot(chainId, address).blockedReason).toBe("canonical-reconciliation-required");
  } finally { warn.mockRestore(); f.db.close(); }
});

test("audit history beyond retention is pruned in throttled, bounded batches; recent history stays", async () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") };
  const f = fixture(now);
  const insert = f.db.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,?,?,NULL,'confirmed',?)");
  f.db.transaction(() => {
    for (let i = 0; i < 6_000; i++) insert.run(chainId, resolver, "batch:old" + i, i, "2026-08-01T00:00:00.000Z");
    for (let i = 0; i < 10; i++) insert.run(chainId, resolver, "batch:new" + i, 6_000 + i, "2026-10-10T00:00:00.000Z");
  })();
  const count = () => (f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get() as { n: number }).n;
  const checkpoint = () => f.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  checkpoint();
  const before = f.coordinator.admissionSnapshot(chainId, address).journalBytes;
  try {
    await f.coordinator.reconcilePrepared(chainId, address);
    expect(count()).toBe(1_010);
    await f.coordinator.reconcilePrepared(chainId, address); // throttled: at most one write per minute
    expect(count()).toBe(1_010);
    now.value += 60_000;
    await f.coordinator.reconcilePrepared(chainId, address);
    expect(count()).toBe(10);
    now.value += 60_000;
    await f.coordinator.reconcilePrepared(chainId, address);
    expect(f.db.query("SELECT DISTINCT substr(operation_id,1,9) AS p FROM resolver_transaction_audit").all()).toEqual([{ p: "batch:new" }]);
    // Freed pages are reusable headroom: the storage ceiling counts live pages plus WAL.
    checkpoint();
    expect(f.coordinator.admissionSnapshot(chainId, address).journalBytes).toBeLessThan(before);
  } finally { f.db.close(); }
});
