import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ResolverTransactionCoordinator, type ResolverTransactionRequest, type PreparedReplay } from "./resolverTransactions";

const account = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex); // fixture only
const chainId = 8453, nonce = 7, membership = '[{"missionId":"99306","leg":"return"}]';
const signed = await account.signTransaction({ type: "eip1559", chainId, nonce, to: account.address,
  data: "0x12345678", value: 0n, gas: 100000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 1n });
const hash = keccak256(signed);
const receipt = { finalized: true, blockNumber: "10", blockHash: hash, outcomes: "[]" };
async function fixture(run: (f: ReturnType<typeof make>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "resolver-replay-"));
  try { await run(make(join(dir, "journal.sqlite"))); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function make(path: string) {
  let now = 1000, sends = 0, signs = 0, mined = false, included = false;
  const order: string[] = [], bytes: Hex[] = [];
  let onSend: () => Promise<void> = async () => { throw new Error("transport rejected " + signed); };
  const db = () => new Database(path);
  const rows = () => { const d = db(); try { return d.query("SELECT serialized_transaction AS raw, transaction_hash AS hash, nonce, send_attempts AS attempts, next_retry_ms AS nextRetry, replay_state AS state, status FROM resolver_prepared_intents").get() as any; } finally { d.close(); } };
  const mutate = (sql: string) => { const d = db(); try { d.exec(sql); } finally { d.close(); } };
  const broadcast = async (raw: Hex) => {
    sends++; bytes.push(raw); order.push("send");
    expect(raw).toBe(signed);
    expect(rows().raw).toBe(signed); expect(rows().hash).toBe(hash); expect(rows().nonce).toBe(nonce);
    expect(rows().attempts).toBeGreaterThanOrEqual(sends);
    await onSend(); return hash;
  };
  const reconcile: NonNullable<ResolverTransactionRequest["reconcilePrepared"]> = async () => { order.push("receipt"); return mined ? receipt : undefined; };
  const replay: PreparedReplay = {
    getTransaction: async () => { order.push("transaction"); return included ? { hash, blockHash: hash } : null; },
    validate: async () => { order.push("validate"); return () => {}; }, broadcast
  };
  const restart = () => { const c = new ResolverTransactionCoordinator(path, { now: () => now,
    sleep: async (ms) => { now += ms; }, leaseRenewIntervalMs: 1000000 });
    c.setPreparedReplayer(chainId, account.address, replay); return c; };
  const coordinator = restart();
  const request: ResolverTransactionRequest = { chainId, address: account.address, operationId: "batch:fixture",
    getTransactionCount: async () => nonce, submit: async () => { throw new Error("blind signing forbidden"); },
    prepare: async (_nonce, signing) => {
      const raw = await signing.sign(membership, async () => { signs++; return signed; });
      return { hash, membership, serializedTransaction: raw, broadcast: () => broadcast(raw) };
    }, reconcilePrepared: reconcile, confirm: async () => {}, isOperationComplete: async () => true };
  return { path, rows, mutate, restart, coordinator, request, reconcile, replay, bytes, order,
    counts: () => ({ sends, signs }), advance: (ms: number) => { now += ms; },
    mine: () => { mined = true; }, include: () => { included = true; },
    send: (fn: () => Promise<void>) => { onSend = fn; } };
}

test.each([1, 2, 3])("accepted response lost / transport rejection succeeds on attempt %i", async (attempt) => {
  await fixture(async (f) => {
    f.send(async () => { if (f.counts().sends === attempt) { f.mine(); if (attempt === 1) throw new Error("accepted response lost " + signed); return; } throw new Error("connection refused " + signed); });
    expect(await f.coordinator.submit(f.request)).toBe(hash);
    expect(f.counts()).toEqual({ signs: 1, sends: attempt });
    expect(new Set(f.bytes).size).toBe(1);
    for (const [i, step] of f.order.entries()) if (step === "send" && i > 0) {
      expect(f.order.slice(0, i)).toContain("receipt"); expect(f.order.slice(0, i)).toContain("transaction");
    }
  });
});

test("exhaustion persists actionable cooldown; restart retries same bytes once per minute, never new nonce", async () => {
  await fixture(async (f) => {
    const error = await f.coordinator.submit(f.request).catch((e) => e);
    expect(error.message).toContain("recoverable pending"); expect(error.message).not.toContain(signed);
    expect(f.rows().attempts).toBe(3);
    const restarted = f.restart();
    await expect(restarted.submit(f.request)).rejects.toThrow("cooling down");
    expect(f.counts()).toEqual({ signs: 1, sends: 3 });
    f.advance(60000); await expect(restarted.submit(f.request)).rejects.toThrow("cooling down");
    expect(f.counts()).toEqual({ signs: 1, sends: 4 });
    f.advance(60000); f.send(async () => { f.mine(); });
    expect(await f.restart().submit(f.request)).toBe(hash);
    expect(f.counts()).toEqual({ signs: 1, sends: 5 });
  });
});

test("already-known reconciles delayed canonical receipt without interpreting error as success", async () => {
  await fixture(async (f) => {
    f.send(async () => { f.include(); throw new Error("already known " + signed); });
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("await canonical receipt");
    expect(f.rows().status).toBe("pending"); expect(f.counts().sends).toBe(1);
    f.mine(); expect(await f.restart().submit(f.request)).toBe(hash);
    expect(f.counts().sends).toBe(1);
  });
});

test("deterministic rejection is not retried, but later receipt still reconciles", async () => {
  await fixture(async (f) => {
    f.send(async () => { throw new Error("execution reverted " + signed); });
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("deterministic send rejection");
    f.advance(60000); await expect(f.restart().submit(f.request)).rejects.toThrow("operator review");
    expect(f.counts().sends).toBe(1); f.mine();
    expect(await f.restart().submit(f.request)).toBe(hash);
  });
});

test("concurrent coordinator processes share retry schedule and one signer lease", async () => {
  await fixture(async (f) => {
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("cooling down");
    f.advance(60000);
    const settled = await Promise.allSettled([f.restart().submit(f.request), f.restart().submit(f.request)]);
    expect(settled.every((x) => x.status === "rejected")).toBe(true);
    expect(f.counts()).toEqual({ signs: 1, sends: 4 });
  });
});

test.each(["reservation", "signed-result", "intent", "send-intent", "send-response"])("restart at %s boundary retains identity and fences unsafe sends", async (boundary) => {
  await fixture(async (f) => {
    const request = { ...f.request };
    if (boundary === "reservation" || boundary === "signed-result") request.prepare = async (_n, signing) => {
      await signing.sign(membership, async () => { if (boundary === "reservation") throw new Error("crash"); return signed; });
      throw new Error("crash");
    };
    if (boundary === "intent") request.prepare = async (n, signing) => ({ ...await f.request.prepare!(n, signing),
      validateBeforeBroadcast: async () => { f.mutate("UPDATE resolver_transaction_leases SET expires_at_ms = 0"); throw new Error("crash"); } });
    if (boundary === "send-intent" || boundary === "send-response") f.send(async () => {
      if (boundary === "send-response") f.mine();
      f.mutate("UPDATE resolver_transaction_leases SET expires_at_ms = 0"); throw new Error("crash");
    });
    await expect(f.coordinator.submit(request)).rejects.toThrow();
    const restart = f.restart();
    if (boundary === "reservation" || boundary === "signed-result") {
      await expect(restart.submit(f.request)).rejects.toThrow("explicit fenced recovery");
      const d = new Database(f.path); const result = d.query("SELECT serialized_transaction AS raw FROM resolver_signing_results").get() as any;
      expect(result?.raw ?? null).toBe(boundary === "signed-result" ? signed : null); d.close();
      expect(f.counts().sends).toBe(0);
    } else if (boundary === "intent") {
      await expect(restart.submit(f.request)).rejects.toThrow("first-send validation"); expect(f.counts().sends).toBe(0);
    } else {
      f.send(async () => { f.mine(); });
      expect(await restart.submit(f.request)).toBe(hash);
      expect(f.counts().signs).toBe(1); expect(f.counts().sends).toBe(boundary === "send-response" ? 1 : 2);
    }
  });
});

test("legacy missing bytes is actionable and never re-signed or reset", async () => {
  await fixture(async (f) => {
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("cooling down");
    f.mutate("UPDATE resolver_prepared_intents SET serialized_transaction = NULL, replay_state = 'legacy'");
    await expect(f.restart().submit(f.request)).rejects.toThrow("legacy durable batch intent missing signed bytes");
    expect(f.rows().status).toBe("pending"); expect(f.counts()).toEqual({ signs: 1, sends: 3 });
    f.mine(); expect(await f.restart().submit(f.request)).toBe(hash);
  });
});

test.each(["operation_id = 'wrong'", "membership = '[]'", "nonce = 8", "transaction_hash = '0x1234'", "resolver_address = '0x1111111111111111111111111111111111111111'", "chain_id = 84532"])("tampered envelope binding fails closed: %s", async (change) => {
  await fixture(async (f) => {
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("cooling down");
    f.mutate("UPDATE resolver_prepared_intents SET " + change); f.advance(60000);
    const chain = change.startsWith("chain") ? 84532 : chainId;
    const address = change.startsWith("resolver") ? "0x1111111111111111111111111111111111111111" : account.address;
    const c = f.restart(); c.setPreparedReplayer(chain, address, f.replay);
    await expect(c.reconcilePrepared(chain, address, f.reconcile)).rejects.toThrow("identity mismatch");
    expect(f.counts().sends).toBe(3);
  });
});

test("read transport error cannot masquerade as transaction absence or trigger a resend", async () => {
  await fixture(async (f) => {
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("cooling down"); f.advance(60000);
    f.replay.getTransaction = async () => { throw new Error("lookup failed"); };
    await expect(f.restart().submit(f.request)).rejects.toThrow("lookup failed"); expect(f.counts().sends).toBe(3);
  });
});

test("bounded replay timeout retains outstanding RPC and late completion cannot mutate journal", async () => {
  await fixture(async (f) => {
    await expect(f.coordinator.submit(f.request)).rejects.toThrow("cooling down"); f.advance(60000);
    let release!: () => void;
    f.send(() => new Promise<void>((resolve) => { release = resolve; }));
    const c = new ResolverTransactionCoordinator(f.path, { reconciliationTimeoutMs: 20, now: () => 100000,
      leaseRenewIntervalMs: 1000000 });
    c.setPreparedReplayer(chainId, account.address, f.replay);
    await expect(c.reconcilePrepared(chainId, account.address, f.reconcile)).rejects.toThrow("deadline");
    expect(f.counts().sends).toBe(4); const saved = JSON.stringify(f.rows());
    await expect(c.reconcilePrepared(chainId, account.address, f.reconcile)).rejects.toThrow("send still outstanding");
    release(); await new Promise((r) => setTimeout(r, 2));
    expect(JSON.stringify(f.rows())).toBe(saved);
  });
});

test("old hash-only schema migrates without fabricating raw bytes or clearing intent", async () => {
  await fixture(async (f) => {
    // Use a separate old-schema database to exercise the actual constructor migration.
    const path = f.path + ".legacy";
    const d = new Database(path);
    d.exec("CREATE TABLE resolver_prepared_intents (chain_id INTEGER, resolver_address TEXT, operation_id TEXT, nonce INTEGER, transaction_hash TEXT, membership TEXT, status TEXT, PRIMARY KEY(chain_id,resolver_address))");
    d.query("INSERT INTO resolver_prepared_intents VALUES (?, ?, ?, ?, ?, ?, 'pending')")
      .run(chainId, account.address.toLowerCase(), "batch:legacy", nonce, hash, membership); d.close();
    const c = new ResolverTransactionCoordinator(path);
    c.setPreparedReplayer(chainId, account.address, f.replay);
    await expect(c.reconcilePrepared(chainId, account.address, f.reconcile)).rejects.toThrow("legacy durable batch intent missing signed bytes");
    const migrated = new Database(path);
    expect(migrated.query("SELECT transaction_hash AS hash, serialized_transaction AS raw, status, replay_state AS state FROM resolver_prepared_intents").get())
      .toEqual({ hash, raw: null, status: "pending", state: "legacy" }); migrated.close();
    expect(f.counts().sends).toBe(0);
  });
});

test.each(["ready", "attempt-recorded"])("restart after %s but before RPC replays without signing", async (boundary) => {
  await fixture(async (f) => {
    let guards = 0;
    const request = { ...f.request, prepare: async (n: number, signing: Parameters<NonNullable<ResolverTransactionRequest["prepare"]>>[1]) => ({
      ...await f.request.prepare!(n, signing), assertBeforeBroadcast: () => {
        guards++;
        // validation, ready marker, attempt transaction, final synchronous send guard
        if (guards === (boundary === "ready" ? 3 : 4)) throw new Error("process stopped at send boundary");
      }
    }) };
    await expect(f.coordinator.submit(request)).rejects.toThrow("process stopped");
    expect(f.counts().sends).toBe(0);
    expect(f.rows().attempts).toBe(boundary === "ready" ? 0 : 1);
    f.send(async () => { f.mine(); });
    expect(await f.restart().submit(f.request)).toBe(hash);
    expect(f.counts()).toEqual({ signs: 1, sends: 1 });
  });
});
