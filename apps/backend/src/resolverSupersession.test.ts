import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ResolverTransactionCoordinator, type PreparedReplay, type ResolverTransactionRequest } from "./resolverTransactions";
import { SupersessionUnavailableError } from "./resolverReplacementFees";

// #397: an accepted batch that Base holds ("already known") but never includes.
const account = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex); // fixture only
const chainId = 8453, nonce = 7, membership = '[{"missionId":"109746","leg":"arrival"}]';
const to = "0x2222222222222222222222222222222222222222" as const, data: Hex = "0x12345678";
const originalTx = { type: "eip1559" as const, chainId, nonce, to, data, value: 0n, gas: 16_777_216n, maxFeePerGas: 11_051_270n, maxPriorityFeePerGas: 1_000_000n };
const original = await account.signTransaction(originalTx);
const originalHash = keccak256(original);
const lighter = { ...originalTx, gas: 2_500_000n, maxFeePerGas: 13_814_088n, maxPriorityFeePerGas: 1_250_000n };
const alternative = await account.signTransaction(lighter);
const alternativeHash = keccak256(alternative);

function make(path: string, options: { plan?: typeof lighter; latest?: () => number; coordinator?: Partial<ConstructorParameters<typeof ResolverTransactionCoordinator>[1]> } = {}) {
  let now = 1_000_000, signs = 0, plans = 0;
  const mined = new Set<Hex>(), sent: Hex[] = [];
  const db = () => new Database(path);
  const query = (sql: string) => { const d = db(); try { return d.query(sql).all() as any[]; } finally { d.close(); } };
  const intents = () => query("SELECT transaction_hash AS hash, status, send_attempts AS attempts, replay_state AS state, supersedes, serialized_transaction IS NOT NULL AS hasRaw FROM resolver_prepared_intents ORDER BY rowid");
  const reconcile: NonNullable<ResolverTransactionRequest["reconcilePrepared"]> = async (hash) =>
    mined.has(hash) ? { finalized: true, blockNumber: "10", blockHash: hash, outcomes: "[]" } : undefined;
  const plan = options.plan ?? lighter;
  const replay: PreparedReplay = {
    getTransaction: async () => null,
    getTransactionCount: async () => (options.latest ?? (() => nonce))(),
    validate: async () => () => {},
    broadcast: async (raw) => { sent.push(raw); return keccak256(raw); }, // accepted, never included
    supersede: async (raw) => {
      plans++;
      expect(raw).toBe(original);
      return { unsigned: serializeTransaction(plan), guard: () => {}, sign: async () => { signs++; return account.signTransaction(plan); } };
    }
  };
  const restart = () => { const c = new ResolverTransactionCoordinator(path, { now: () => now, sleep: async (ms) => { now += ms; }, leaseRenewIntervalMs: 1_000_000, ...options.coordinator });
    c.setPreparedReplayer(chainId, account.address, replay); return c; };
  let coordinator = restart();
  const request: ResolverTransactionRequest = { chainId, address: account.address, operationId: "mission-batch:fixture",
    getTransactionCount: async () => nonce, submit: async () => { throw new Error("blind signing forbidden"); },
    prepare: async (_nonce, signing) => {
      const raw = await signing.sign(membership, async () => original);
      return { hash: originalHash, membership, serializedTransaction: raw, replayMaxFeeWei: "200000000000000", broadcast: () => replay.broadcast(raw) };
    }, reconcilePrepared: reconcile, confirm: async () => {}, isOperationComplete: async () => true };
  const pass = () => coordinator.reconcilePrepared(chainId, account.address, reconcile);
  return { request, intents, query, sent, mined, pass, replay, counts: () => ({ signs, plans }),
    get coordinator() { return coordinator; }, restart: () => { coordinator = restart(); return coordinator; },
    advance: (ms: number) => { now += ms; } };
}

async function withJournal(run: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "resolver-supersession-"));
  try { await run(join(dir, "journal.sqlite")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Submit, then let identical-byte replay run until the original has `attempts` sends. */
async function stuck(f: ReturnType<typeof make>, attempts = 6) {
  await expect(f.coordinator.submit(f.request)).rejects.toThrow("recoverable pending");
  while (f.intents()[0].attempts < attempts) { f.advance(60_000); await expect(f.pass()).rejects.toThrow(); }
}

test("an accepted but never-included batch gets one lighter, fee-bumped same-nonce alternative; the winner retires the original", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    expect(f.counts()).toEqual({ signs: 0, plans: 0 });
    expect(new Set(f.sent)).toEqual(new Set([original]));
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    expect(f.counts()).toEqual({ signs: 1, plans: 1 });
    expect(f.sent.at(-1)).toBe(alternative);
    expect(f.intents()).toMatchObject([{ hash: originalHash, status: "pending", attempts: 6, supersedes: null },
      { hash: alternativeHash, status: "pending", attempts: 1, state: "retryable", supersedes: originalHash }]);
    expect(f.coordinator.admissionSnapshot(chainId, account.address).blockedReason).toBe("canonical-reconciliation-required");
    // Neither is mined: only the alternative is resent, never the original, and never re-signed.
    const before = f.sent.length;
    for (let i = 0; i < 4; i++) { f.advance(60_000); await expect(f.restart() && f.pass()).rejects.toThrow(); }
    expect(f.sent.slice(before).every((raw) => raw === alternative)).toBe(true);
    expect(f.sent.length).toBeGreaterThan(before);
    expect(f.counts()).toEqual({ signs: 1, plans: 1 });
    f.mined.add(alternativeHash);
    await f.pass();
    expect(f.intents()).toMatchObject([{ hash: originalHash, status: "superseded", hasRaw: 1 }, { hash: alternativeHash, status: "finalized" }]);
    expect(f.coordinator.admissionSnapshot(chainId, account.address)).toMatchObject({ active: 0, blockedReason: null });
    const audit = f.query("SELECT status, transaction_hash AS hash FROM resolver_transaction_audit WHERE status LIKE 'supersed%' ORDER BY sequence");
    expect(audit).toEqual([{ status: "superseding", hash: originalHash }, { status: "superseding-candidate", hash: alternativeHash },
      { status: "superseded", hash: originalHash }]);
  });
});

test("the original mined after the alternative was signed wins; the alternative is retired", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    f.mined.add(originalHash);
    await f.pass();
    expect(f.intents()).toMatchObject([{ hash: originalHash, status: "finalized" }, { hash: alternativeHash, status: "superseded", hasRaw: 1 }]);
    expect(f.coordinator.admissionSnapshot(chainId, account.address).blockedReason).toBeNull();
  });
});

test("two canonical candidates at one nonce fail closed and keep both envelopes", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    f.mined.add(originalHash); f.mined.add(alternativeHash);
    await expect(f.pass()).rejects.toThrow("conflicting canonical same-nonce candidates");
    expect(f.intents()).toMatchObject([{ status: "pending", hasRaw: 1 }, { status: "pending", hasRaw: 1 }]);
  });
});

test("no alternative before the bounded deadline; an unavailable or out-of-bounds plan keeps resending the original, never reserving or signing", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f, 5);
    expect(f.counts().plans).toBe(0);
  });
  await withJournal(async (path) => {
    let latest = nonce;
    const f = make(path, { latest: () => latest });
    await stuck(f);
    latest = nonce + 1;
    const sends = f.sent.length;
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("cooling down");
    expect(f.counts()).toEqual({ signs: 0, plans: 0 });
    expect(f.sent.slice(sends)).toEqual([original]);
  });
  for (const plan of [{ ...lighter, maxPriorityFeePerGas: 1_050_000n }, { ...lighter, maxFeePerGas: 11_051_271n },
    { ...lighter, gas: 16_777_216n }, { ...lighter, data: "0x12345679" as Hex }, { ...lighter, nonce: nonce + 1 }, "unavailable" as const,
    "planner-error" as const, "stale-at-reservation" as const, "final-check" as const]) {
    await withJournal(async (path) => {
      const f = make(path, typeof plan === "string" ? {} : { plan });
      const supersede = f.replay.supersede!;
      // Before any reservation every planning failure (stale quote, fee cap, transport) is only
      // "unavailable": the original keeps its identical-byte resend (#397 review).
      if (plan === "unavailable") f.replay.supersede = async () => { throw new SupersessionUnavailableError("supersession cannot reduce work"); };
      if (plan === "planner-error") f.replay.supersede = async () => { throw new Error("network fees exceed the resolver ETH cap"); };
      if (plan === "stale-at-reservation") f.replay.supersede = async (...args) => ({ ...(await supersede(...args)), guard: () => { throw new Error("batch quote block expired"); } });
      if (plan === "final-check") f.replay.supersede = async (...args) => {
        const planned = await supersede(...args);
        return { ...planned, guard: Object.assign(() => {}, { finalCheck: async () => { throw new Error("replay fee block changed"); } }) };
      };
      await stuck(f);
      for (let round = 1; round <= 2; round++) {
        const sends = f.sent.length;
        f.advance(60_000);
        await expect(f.pass()).rejects.toThrow("cooling down");
        expect(f.sent.slice(sends)).toEqual([original]);
      }
      expect(f.counts().signs).toBe(0);
      expect(f.query("SELECT 1 FROM resolver_signing_reservations WHERE transferred=0")).toEqual([]);
      expect(f.intents()).toHaveLength(1);
      expect(f.intents()[0].attempts).toBe(8);
    });
  }
});

test("an unavailable supersession re-plans every pass but warns once per reason, then at most hourly (#408)", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    let reason = "lighter envelope is not productive";
    f.replay.supersede = async () => { throw new SupersessionUnavailableError("supersession cannot reduce work: " + reason); };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (line: unknown) => { if (String(line).includes("resolver_same_nonce_supersession_unavailable")) warnings.push(String(line)); };
    try {
      await stuck(f);
      let plans = 0;
      const supersede = f.replay.supersede;
      f.replay.supersede = async (...args) => { plans++; return supersede(...args); };
      for (let minute = 0; minute < 10; minute++) { f.advance(60_000); await expect(f.pass()).rejects.toThrow("cooling down"); }
      expect(plans).toBe(10);
      expect(warnings).toHaveLength(1);
      // A different reason is new information: warned at once.
      reason = "lighter envelope does not do at least 10% less work";
      f.advance(60_000); await expect(f.pass()).rejects.toThrow("cooling down");
      expect(warnings).toHaveLength(2);
      expect(warnings[1]).toContain("10% less work");
      // Reasons alternating pass by pass (e.g. a slow RPC) do not re-warn every minute either.
      const reasons = ["lighter envelope is not productive", "lighter envelope does not do at least 10% less work"];
      for (let minute = 0; minute < 40; minute++) {
        reason = reasons[minute % 2]!;
        f.advance(60_000); await expect(f.pass()).rejects.toThrow("cooling down");
      }
      expect(warnings).toHaveLength(2);
      // A reason persisting: repeated once its hour has passed, not before.
      reason = reasons[0]!;
      f.advance(11 * 60_000); await expect(f.pass()).rejects.toThrow("cooling down");
      expect(warnings).toHaveLength(3);
      expect(warnings[2]).toContain("not productive");
      // The original keeps its unchanged identical-byte resend throughout.
      expect(new Set(f.sent)).toEqual(new Set([original]));
    } finally { console.warn = originalWarn; }
  });
});

test("after a superseded nonce, ordinary batches are admitted, signed at the next nonce and finalized", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    f.mined.add(alternativeHash);
    await f.pass();
    const next = await account.signTransaction({ ...originalTx, nonce: nonce + 1, gas: 2_500_000n });
    const nextHash = keccak256(next);
    f.mined.add(nextHash);
    const hash = await f.coordinator.submit({ ...f.request, operationId: "mission-batch:next", getTransactionCount: async () => nonce + 1,
      prepare: async (allocated, signing) => {
        expect(allocated).toBe(nonce + 1);
        const raw = await signing.sign(membership, async () => next);
        return { hash: nextHash, membership, serializedTransaction: raw, replayMaxFeeWei: "200000000000000", broadcast: () => f.replay.broadcast(raw) };
      } });
    expect(hash).toBe(nextHash);
    await f.pass();
    expect(f.intents()).toMatchObject([{ hash: originalHash, status: "superseded" }, { hash: alternativeHash, status: "finalized" }, { hash: nextHash, status: "finalized" }]);
    expect(f.coordinator.admissionSnapshot(chainId, account.address)).toMatchObject({ active: 0, blockedReason: null });
  });
});

test("a signed alternative interrupted before transfer resumes from its retained result; an unknown result stays fenced", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    const d = new Database(path);
    try {
      d.query("INSERT INTO resolver_signing_reservations(id,chain_id,resolver_address,operation_id,nonce,membership) VALUES('supersede:crash',?,?,?,?,?)")
        .run(chainId, account.address.toLowerCase(), "mission-batch:fixture", nonce, membership);
    } finally { d.close(); }
    await expect(f.restart() && f.pass()).rejects.toThrow("signing result unknown");
    expect(f.counts().signs).toBe(0);
    const w = new Database(path);
    try { w.query("INSERT INTO resolver_signing_results(reservation_id,transaction_hash,serialized_transaction) VALUES('supersede:crash',?,?)").run(alternativeHash, alternative); }
    finally { w.close(); }
    f.advance(60_000);
    await expect(f.restart() && f.pass()).rejects.toThrow();
    expect(f.counts()).toEqual({ signs: 0, plans: 0 });
    expect(f.intents()).toMatchObject([{ hash: originalHash, status: "pending" }, { hash: alternativeHash, supersedes: originalHash }]);
    expect(f.sent.at(-1)).toBe(alternative);
    f.mined.add(alternativeHash);
    await f.pass();
    expect(f.coordinator.admissionSnapshot(chainId, account.address).blockedReason).toBeNull();
  });
});

test("an alternative is never itself superseded", async () => {
  await withJournal(async (path) => {
    const f = make(path);
    await stuck(f);
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    for (let i = 0; i < 10; i++) { f.advance(60_000); await expect(f.pass()).rejects.toThrow(); }
    expect(f.counts()).toEqual({ signs: 1, plans: 1 });
    expect(f.intents()).toHaveLength(2);
    expect(parseTransaction(f.sent.at(-1)!).gas).toBe(2_500_000n);
  });
});

test("supersession planning has its own bounded budget: a slow planner falls back to the unchanged resend, a planner within it extends the pass (#397 review)", async () => {
  const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await withJournal(async (path) => {
    const f = make(path, { coordinator: { supersessionPlanningMs: 50 } });
    const supersede = f.replay.supersede!;
    let slow = true, lateReads = 0;
    f.replay.supersede = async (raw, operationId, membership, originalMaxFeeWei, pass) => {
      if (slow) {
        await pass.read(() => realSleep(150));
        // A late planner must not keep spending the pass: its next read fails fast.
        try { await pass.read(async () => { lateReads++; }); } catch { /* expected */ }
      }
      return supersede(raw, operationId, membership, originalMaxFeeWei, pass);
    };
    await stuck(f);
    const sends = f.sent.length;
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("cooling down");
    expect(f.sent.slice(sends)).toEqual([original]);
    expect(f.counts().signs).toBe(0);
    expect(f.query("SELECT 1 FROM resolver_signing_reservations WHERE id LIKE 'supersede:%'")).toEqual([]);
    await realSleep(200); // the abandoned planner settles; nothing it returned is ever signed
    expect(lateReads).toBe(0);
    expect(f.counts().signs).toBe(0);
    slow = false;
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    expect(f.counts().signs).toBe(1);
    expect(f.sent.at(-1)).toBe(alternative);
  });
  await withJournal(async (path) => {
    // Production shape: planning budget longer than the pass. A planner that overruns it (a hanging
    // read) still leaves a full pass budget for the unchanged resend (#397 review, f066aec).
    const f = make(path, { coordinator: { reconciliationTimeoutMs: 100, supersessionPlanningMs: 300 } });
    let release = () => {};
    const hanging = new Promise<void>((resolve) => { release = resolve; });
    f.replay.supersede = async (_raw, _operationId, _membership, _originalMaxFeeWei, pass) => {
      // Hangs until the end of the test: a pass that waited for the planner would never finish.
      await pass.read(() => hanging);
      throw new Error("planner resumed after its budget");
    };
    await stuck(f);
    const sends = f.sent.length;
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("cooling down");
    expect(f.sent.slice(sends)).toEqual([original]);
    expect(f.counts().signs).toBe(0);
    expect(f.query("SELECT 1 FROM resolver_signing_reservations WHERE id LIKE 'supersede:%'")).toEqual([]);
    release();
    await realSleep(20);
  });
  await withJournal(async (path) => {
    // The 100 ms pass deadline alone would expire mid-planning; the planning budget extends it.
    const f = make(path, { coordinator: { reconciliationTimeoutMs: 100, supersessionPlanningMs: 2_000 } });
    const supersede = f.replay.supersede!;
    f.replay.supersede = async (raw, operationId, membership, originalMaxFeeWei, pass) => {
      await pass.read(() => realSleep(250));
      return supersede(raw, operationId, membership, originalMaxFeeWei, pass);
    };
    await stuck(f);
    f.advance(60_000);
    await expect(f.pass()).rejects.toThrow("same-nonce alternative dispatched");
    expect(f.counts().signs).toBe(1);
  });
});
