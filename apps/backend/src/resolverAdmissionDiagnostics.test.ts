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

test("the unmasked blocked reason never carries signed bytes or URL secrets", async () => {
  const f = fixture({ value: Date.now() });
  const signedBytes = "0x02f8" + "ab".repeat(120);
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,receipt_block_number,receipt_block_hash,outcomes,admission_proven) VALUES (?,?,'batch:frontier',4,?,'[]','confirmed','9',?,'[]',1)")
    .run(chainId, resolver, hash(4), hash(9));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const error = await f.coordinator.reconcilePrepared(chainId, address, async () => {
      throw new Error(`HTTP request failed. URL: https://user:hunter2@base.rpc.example/v2/abcdef0123456789 Request body: {"params":["${signedBytes}"]}`);
    }).catch((e) => e);
    const event = blockedEvents(warn)[0]!;
    expect(event).toMatchObject({ stage: "frontier" });
    for (const text of [String(event.reason), error.message]) {
      expect(text).toContain("https://base.rpc.example");
      expect(text).not.toContain(signedBytes.slice(2, 40));
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("abcdef0123456789");
    }
  } finally { warn.mockRestore(); f.db.close(); }
});

function archiveFixture(rows: number) {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") }, f = fixture(now);
  for (let n = 1; n <= rows; n++) f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,receipt_block_number,receipt_block_hash,outcomes,admission_proven) VALUES (?,?,?,?,?,'[]','confirmed',?,?,'[]',1)")
    .run(chainId, resolver, "batch:" + n, n, hash(n), String(100 + n), hash(100 + n));
  const cursor = () => (f.db.query("SELECT cursor_nonce AS c FROM resolver_archive_progress").get() as { c: number } | null)?.c ?? null;
  return { ...f, now, cursor };
}

test("a mid-page archive failure keeps the fully reconciled prefix for the next pass", async () => {
  const f = archiveFixture(12);
  const seen: number[] = [];
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    // Frontier is nonce 12; the archive page is nonces 1..8 with a look-ahead row.
    await expect(f.coordinator.reconcilePrepared(chainId, address, async (h, _m, stored) => {
      seen.push(Number(BigInt(h)));
      if (h === hash(4)) throw new Error("rpc unavailable");
      return stored;
    })).rejects.toThrow("rpc unavailable");
    expect(blockedEvents(warn)).toMatchObject([{ stage: "archive", checked: 3 }]);
    expect(f.cursor()).toBe(3);
    seen.length = 0;
    await f.coordinator.reconcilePrepared(chainId, address, async (h, _m, stored) => { seen.push(Number(BigInt(h))); return stored; });
    // Frontier, then a full page resuming at the failed row, then the final frontier check.
    expect(seen).toEqual([12, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(f.cursor()).toBe(11);
  } finally { warn.mockRestore(); f.db.close(); }
});

test("a lease lost mid-archive keeps the cursor where the successor left it", async () => {
  const f = archiveFixture(12);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(f.coordinator.reconcilePrepared(chainId, address, async (h, _m, stored) => {
      if (h === hash(4)) f.db.query("UPDATE resolver_transaction_leases SET holder='successor', expires_at_ms=?").run(f.now.value + 600_000);
      return stored;
    })).rejects.toThrow("lease");
    expect(f.cursor()).toBeNull();
    expect(f.db.query("SELECT holder FROM resolver_transaction_leases").get()).toEqual({ holder: "successor" });
  } finally { warn.mockRestore(); f.db.close(); }
});

function seedExpiredAudit(db: Database, count: number, created = "2026-08-01T00:00:00.000Z") {
  const insert = db.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,?,?,NULL,'confirmed',?)");
  db.transaction(() => { for (let i = 0; i < count; i++) insert.run(chainId, resolver, "batch:old" + i, i, created); })();
}
const auditCount = (db: Database) => (db.query("SELECT count(*) AS n FROM resolver_transaction_audit").get() as { n: number }).n;

test("a lease taken over during the reconcilePrepared prune deletes nothing; the next interval prunes", async () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") }, f = fixture(now);
  seedExpiredAudit(f.db, 10);
  const internals = f.coordinator as unknown as { pruneAuditHistory(c: number, a: Hex, l: () => void): void };
  const prune = internals.pruneAuditHistory.bind(f.coordinator);
  let takeover = true;
  // A successor process takes the signer lease between the reconciliation and the prune write.
  internals.pruneAuditHistory = (c, a, assertLease) => {
    if (takeover) f.db.query("UPDATE resolver_transaction_leases SET holder='successor', expires_at_ms=?").run(now.value + 600_000);
    prune(c, a, assertLease);
  };
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await f.coordinator.reconcilePrepared(chainId, address);
    expect(auditCount(f.db)).toBe(10);
    expect(warn.mock.calls.some(([line]) => String(line).includes("resolver_audit_prune_failed") && String(line).includes("lease"))).toBe(true);
    expect(f.db.query("SELECT holder FROM resolver_transaction_leases").get()).toEqual({ holder: "successor" }); // never released ours over theirs
    f.db.exec("DELETE FROM resolver_transaction_leases");
    takeover = false; now.value += 60_000;
    await f.coordinator.reconcilePrepared(chainId, address);
    expect(auditCount(f.db)).toBe(0);
  } finally { warn.mockRestore(); f.db.close(); }
});

test("at the storage ceiling the bounded, lease-fenced prune still runs while admission stays blocked", async () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") }, f = fixture(now);
  seedExpiredAudit(f.db, 6_000);
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES (?,?,'batch:pending',3,?,'[]','pending')")
    .run(chainId, resolver, hash(3));
  // Fault-inject the measured budget, not a 240 MiB allocation in CI.
  (f.coordinator as unknown as { journalBytes(): number }).journalBytes = () => 240 * 1024 * 1024;
  let reads = 0, leaseWrites = 0;
  const reconcile = async () => { reads++; return undefined; };
  const internals = f.coordinator as unknown as { acquireLease(...args: unknown[]): Promise<void> };
  const acquire = internals.acquireLease.bind(f.coordinator);
  internals.acquireLease = (...args) => { leaseWrites++; return acquire(...args); };
  try {
    await expect(f.coordinator.reconcilePrepared(chainId, address, reconcile)).rejects.toThrow("journal-storage-full");
    expect(auditCount(f.db)).toBe(1_001); // one 5,000-row window; evidence for nonce 3 stays
    expect(reads).toBe(0); // no reconciliation, admission or signing work at the ceiling
    expect(leaseWrites).toBe(1);
    expect(f.db.query("SELECT count(*) AS n FROM resolver_transaction_leases").get()).toEqual({ n: 0 });
    expect(f.coordinator.admissionSnapshot(chainId, address).blockedReason).toBe("journal-storage-full");
    await expect(f.coordinator.reconcilePrepared(chainId, address, reconcile)).rejects.toThrow("journal-storage-full");
    expect(leaseWrites).toBe(1); // throttled: no lease churn until the next interval
    now.value += 60_000;
    await expect(f.coordinator.reconcilePrepared(chainId, address, reconcile)).rejects.toThrow("journal-storage-full");
    expect(f.db.query("SELECT nonce FROM resolver_transaction_audit").all()).toEqual([{ nonce: 3 }]);
    expect(f.db.query("SELECT status FROM resolver_prepared_intents").all()).toEqual([{ status: "pending" }]);
  } finally { f.db.close(); }
});

test("the prune sweep revisits retained evidence daily without a restart", () => {
  const now = { value: Date.parse("2026-10-11T00:00:00.000Z") }, f = fixture(now);
  f.db.query("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES (?,?,'batch:pending',0,?,'[]','pending')")
    .run(chainId, resolver, hash(1));
  seedExpiredAudit(f.db, 5);
  const prune = () => (f.coordinator as unknown as { pruneAuditHistory(c: number, a: Hex, l: () => void): void })
    .pruneAuditHistory(chainId, address, () => {});
  try {
    prune();
    expect(f.db.query("SELECT nonce FROM resolver_transaction_audit").all()).toEqual([{ nonce: 0 }]);
    f.db.exec("UPDATE resolver_prepared_intents SET status='finalized'");
    now.value = Date.parse("2026-10-11T23:59:00.000Z");
    prune(); // same sweep: the cursor is already past the retained row
    expect(auditCount(f.db)).toBe(1);
    now.value = Date.parse("2026-10-12T00:00:00.000Z");
    prune(); // daily revisit restarts from the head
    expect(auditCount(f.db)).toBe(0);
  } finally { f.db.close(); }
});
