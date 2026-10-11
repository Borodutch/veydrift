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

function blockedEvents(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([line]): Record<string, unknown> | null => { try { return JSON.parse(String(line)); } catch { return null; } })
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
  f.db.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,'batch:ancient',1,NULL,'confirmed','2020-01-01T00:00:00.000Z')")
    .run(chainId, resolver);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(f.coordinator.reconcilePrepared(chainId, address, async () => undefined)).rejects.toThrow("missing signed bytes");
    // Housekeeping only follows a successful pass.
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get()).toEqual({ n: 1 });
    const events = blockedEvents(warn);
    expect(events).toHaveLength(1);
    const event = events[0]!;
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

test("audit pruning keeps unfinalized, unresolved and recovery evidence and steps past it", () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") };
  const f = fixture(now), old = "2026-08-01T00:00:00.000Z", other = "0x" + "cd".repeat(20);
  const insert = f.db.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,?,?,NULL,'confirmed',?)");
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES (?,?,'batch:pending',1,?,'[]','pending')")
    .run(chainId, resolver, hash(1));
  f.db.query("INSERT INTO resolver_nonce_recovery (chain_id,resolver_address,nonce,binding,original_hash,max_fee_wei,finalized) VALUES (?,?,2,'{}',?,'1',1)")
    .run(chainId, resolver, hash(2));
  f.db.query("INSERT INTO resolver_transaction_attempts (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,updated_at) VALUES (?,?,'op:unresolved',3,NULL,'submitted',?)")
    .run(chainId, resolver, old);
  f.db.transaction(() => {
    // Retained evidence sits at the head of the table, so an oldest-row anchor would stall.
    insert.run(chainId, resolver, "batch:pending", 1, old);
    insert.run(chainId, resolver, "recovery", 2, old);
    insert.run(chainId, resolver, "op:unresolved", 3, old);
    insert.run(chainId, other, "batch:other", 1, old);
    for (let i = 0; i < 6_000; i++) insert.run(chainId, resolver, "batch:old" + i, 10 + i, old);
  })();
  const prune = () => (f.coordinator as unknown as { pruneAuditHistory(c: number, a: Hex, l: () => void): void })
    .pruneAuditHistory(chainId, address, () => {});
  const remaining = () => (f.db.query("SELECT operation_id AS id FROM resolver_transaction_audit ORDER BY sequence").all() as { id: string }[]).map((row) => row.id);
  try {
    prune();
    expect(remaining().length).toBe(4 + 1_004);
    now.value += 60_000;
    prune();
    expect(remaining()).toEqual(["batch:pending", "recovery", "op:unresolved", "batch:other"]);
    now.value += 60_000;
    prune();
    expect(remaining()).toEqual(["batch:pending", "recovery", "op:unresolved", "batch:other"]);
    // Once the pending intent finalizes, a fresh sweep (after restart) prunes its expired history.
    f.db.exec("UPDATE resolver_prepared_intents SET status='finalized'");
    const restarted = new ResolverTransactionCoordinator(f.path, { now: () => now.value, sleep: async () => {}, leaseRenewIntervalMs: 1_000_000 });
    (restarted as unknown as { pruneAuditHistory(c: number, a: Hex, l: () => void): void }).pruneAuditHistory(chainId, address, () => {});
    expect(remaining()).toEqual(["recovery", "op:unresolved", "batch:other"]);
  } finally { f.db.close(); }
});

test("a lost lease during pruning deletes nothing and keeps the sweep position", () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") };
  const f = fixture(now);
  const insert = f.db.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,?,?,NULL,'confirmed','2026-08-01T00:00:00.000Z')");
  f.db.transaction(() => { for (let i = 0; i < 10; i++) insert.run(chainId, resolver, "batch:old" + i, i); })();
  const coordinator = f.coordinator as unknown as { pruneAuditHistory(c: number, a: Hex, l: () => void): void; auditPrune: Map<string, { cursor: number }> };
  const count = () => (f.db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get() as { n: number }).n;
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    coordinator.pruneAuditHistory(chainId, address, () => { throw new Error("resolver transaction lease was lost"); });
    expect(count()).toBe(10);
    expect([...coordinator.auditPrune.values()].map((state) => state.cursor)).toEqual([0]);
    expect(warn.mock.calls.some(([line]) => String(line).includes("resolver_audit_prune_failed"))).toBe(true);
    now.value += 60_000; // the next interval retries from the same position under a valid lease
    coordinator.pruneAuditHistory(chainId, address, () => {});
    expect(count()).toBe(0);
  } finally { warn.mockRestore(); f.db.close(); }
});
