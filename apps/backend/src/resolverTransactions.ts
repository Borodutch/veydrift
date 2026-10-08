import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";
import { emitObservabilityEvent } from "./observability";

export type PreparedReceipt = { finalized: boolean; blockNumber: string; blockHash: Hex; outcomes: string };

export type PreparedReconciliationPass = {
  /** Every asynchronous read must pass here; late completions cannot resume hydration. */
  read: <T>(operation: () => Promise<T>) => Promise<T>;
  assertActive: () => void;
  finalizedHead?: Promise<bigint>;
};
type PreparedReconciler = (hash: Hex, membership: string, stored: PreparedReceipt | undefined,
  pass: PreparedReconciliationPass) => Promise<PreparedReceipt | void>;

export type PreparedReplay = {
  /** Only explicit not-found returns null; transport errors throw. */
  getTransaction: (hash: Hex) => Promise<{ hash: Hex; blockHash: Hex | null } | null>;
  validate: (raw: Hex, operationId: string, membership: string, originalMaxFeeWei: string | null, pass: PreparedReconciliationPass) => Promise<() => void>;
  broadcast: (raw: Hex) => Promise<Hex>;
};
type ReplayIntent = { operationId: string; nonce: number; hash: Hex; membership: string;
  raw: Hex | null; attempts: number; nextRetry: number; replayState: string; status: string; originalMaxFeeWei: string | null };

export type ResolverTransactionRequest = {
  chainId: number;
  address: `0x${string}`;
  operationId: string;
  getTransactionCount: (blockTag: "latest" | "pending") => Promise<number>;
  submit: (nonce: number, assertLease: () => void) => Promise<Hex>;
  /** Batch-only: locally sign without broadcasting; persist exact envelope and intent before send. */
  prepare?: (nonce: number, signing: {
    /** Reserve identity under the lease, fence actual signer invocation, privately retain its result. */
    sign: (membership: string, signer: () => Promise<Hex>) => Promise<Hex>;
  }) => Promise<{ hash: Hex; membership: string;
    serializedTransaction?: Hex;
    replayMaxFeeWei?: string;
    /** Read-only preflight after persistence; failure proves broadcast was never invoked. */
    validateBeforeBroadcast?: () => Promise<void>;
    /** Synchronous final guard, run after the last await and lease check. */
    assertBeforeBroadcast?: () => void;
    broadcast: () => Promise<Hex> }>;
  /** Reconcile any durable prepared intent under the shared signer lease, including other operations. */
  reconcilePrepared?: PreparedReconciler;
  /** A persisted confirmation is reusable only while its receipt remains canonical. */
  isConfirmedCanonical?: (hash: Hex) => Promise<boolean>;
  /** A canonical receipt can be one bounded chunk of a larger logical operation. */
  isOperationComplete?: () => Promise<boolean>;
  shouldReplace?: (hash: Hex) => Promise<boolean>;
  replace?: (nonce: number, previousHash: Hex, assertLease: () => void) => Promise<Hex>;
  cancelStale?: (nonce: number, previousHash: Hex, assertLease: () => void) => Promise<Hex>;
  confirm: (hash: Hex) => Promise<void>;
};

export type ResolverNonceGapRecoveryRequest = Omit<
  ResolverTransactionRequest,
  "operationId" | "submit"
> & {
  fromNonce: number;
  throughNonce: number;
  broadcast: boolean;
  submitCancellation: (nonce: number) => Promise<Hex>;
};

export type ResolverNonceGapRecoveryResult = {
  plannedNonces: number[];
  submitted: Array<{ nonce: number; hash: Hex }>;
};

export type ResolverTransactionCoordinatorOptions = {
  leaseDurationMs?: number;
  leaseRenewIntervalMs?: number;
  leaseWaitMs?: number;
  replacementWaitMs?: number;
  replacementPollMs?: number;
  staleTransactionMs?: number;
  maxUnfinalizedIntents?: number;
  reconciliationTimeoutMs?: number;
  reconciliationReadLimit?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type StoredAttempt = {
  operationId?: string;
  nonce: number;
  status: "allocating" | "ambiguous" | "submitted" | "confirmed" | "reverted" | "rejected" | "cancelled" | "prevented";
  transactionHash: Hex | null;
  updatedAt: string;
};

const defaultLeaseDurationMs = 90_000;
const defaultLeaseRenewIntervalMs = 15_000;
const defaultLeaseWaitMs = 60_000;
const defaultReplacementWaitMs = 15_000;
const defaultReplacementPollMs = 250;
const defaultStaleTransactionMs = 5 * 60_000;
// 32 retained receipts => 33 reads on a warm pass; cold hydration is separately bounded.
const defaultMaxUnfinalizedIntents = 32;
const defaultReconciliationTimeoutMs = 5_000;
const defaultReconciliationReadLimit = 128;

/**
 * Serializes every transaction signed by one resolver EOA, including across rolling backend
 * processes. SQLite retains signed mission envelopes in its private (0600) journal for exact replay.
 * These bytes are broadcast-capable: never log/export them. Private keys and RPC credentials
 * never enter this database; randomness writers do not use this prepared mission path.
 */
export class ResolverTransactionCoordinator {
  private readonly database: Database;
  private readonly leaseDurationMs: number;
  private readonly leaseRenewIntervalMs: number;
  private readonly leaseWaitMs: number;
  private readonly replacementWaitMs: number;
  private readonly replacementPollMs: number;
  private readonly staleTransactionMs: number;
  private readonly maxUnfinalizedIntents: number;
  private readonly reconciliationTimeoutMs: number;
  private readonly reconciliationReadLimit: number;
  // A transport may not support abort. Never stack abandoned reads on the same signer.
  private readonly unfinishedReconciliations = new Map<string, Set<Promise<unknown>>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly localTails = new Map<string, Promise<void>>();
  private readonly preparedReplayers = new Map<string, PreparedReplay>();
  private readonly preparedReconcilers = new Map<string, NonNullable<ResolverTransactionRequest["reconcilePrepared"]>>();

  constructor(
    private readonly databasePath: string,
    options: ResolverTransactionCoordinatorOptions = {}
  ) {
    this.leaseDurationMs = options.leaseDurationMs ?? defaultLeaseDurationMs;
    this.leaseRenewIntervalMs = options.leaseRenewIntervalMs ?? defaultLeaseRenewIntervalMs;
    this.leaseWaitMs = options.leaseWaitMs ?? defaultLeaseWaitMs;
    this.replacementWaitMs = options.replacementWaitMs ?? defaultReplacementWaitMs;
    this.replacementPollMs = options.replacementPollMs ?? defaultReplacementPollMs;
    this.staleTransactionMs = options.staleTransactionMs ?? defaultStaleTransactionMs;
    this.maxUnfinalizedIntents = options.maxUnfinalizedIntents ?? defaultMaxUnfinalizedIntents;
    this.reconciliationTimeoutMs = options.reconciliationTimeoutMs ?? defaultReconciliationTimeoutMs;
    this.reconciliationReadLimit = options.reconciliationReadLimit ?? defaultReconciliationReadLimit;
    for (const value of [this.maxUnfinalizedIntents, this.reconciliationTimeoutMs, this.reconciliationReadLimit]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid resolver reconciliation bounds");
    }
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    }
    this.database = new Database(databasePath, { create: true });
    if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = FULL;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS resolver_signing_reservations (
        id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, resolver_address TEXT NOT NULL,
        operation_id TEXT NOT NULL, nonce INTEGER NOT NULL, membership TEXT NOT NULL,
        transferred INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS resolver_signing_untransferred
        ON resolver_signing_reservations(chain_id, resolver_address) WHERE transferred = 0;
      -- Append-only signing evidence, not ownership/admission state. A late signer result
      -- may only INSERT against its unique reservation; it cannot update a successor.
      CREATE TABLE IF NOT EXISTS resolver_signing_results (
        reservation_id TEXT PRIMARY KEY, transaction_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resolver_prepared_intents (
        chain_id INTEGER NOT NULL, resolver_address TEXT NOT NULL, operation_id TEXT NOT NULL,
        nonce INTEGER NOT NULL, transaction_hash TEXT NOT NULL, membership TEXT NOT NULL,
        status TEXT NOT NULL, PRIMARY KEY (chain_id, resolver_address)
      );
      CREATE TABLE IF NOT EXISTS resolver_transaction_leases (
        chain_id INTEGER NOT NULL,
        resolver_address TEXT NOT NULL,
        holder TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        PRIMARY KEY (chain_id, resolver_address)
      );
      CREATE TABLE IF NOT EXISTS resolver_transaction_attempts (
        chain_id INTEGER NOT NULL,
        resolver_address TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        transaction_hash TEXT,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (chain_id, resolver_address, operation_id)
      );
      CREATE TABLE IF NOT EXISTS resolver_transaction_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        resolver_address TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        transaction_hash TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    // Migrate the old single-slot intent, including reconciled but NOT finalized rows.
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const columns = this.database.query("PRAGMA table_info(resolver_prepared_intents)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "receipt_block_hash")) {
        this.database.exec(`ALTER TABLE resolver_prepared_intents RENAME TO resolver_prepared_intents_v1;
        CREATE TABLE resolver_prepared_intents (
          chain_id INTEGER NOT NULL, resolver_address TEXT NOT NULL, operation_id TEXT NOT NULL,
          nonce INTEGER NOT NULL, transaction_hash TEXT NOT NULL, membership TEXT NOT NULL,
          status TEXT NOT NULL, receipt_block_number TEXT, receipt_block_hash TEXT, outcomes TEXT,
          PRIMARY KEY (chain_id, resolver_address, transaction_hash)
        );
        INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status)
          SELECT chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,
            CASE WHEN status = 'reconciled' THEN 'confirmed' ELSE status END FROM resolver_prepared_intents_v1;
        DROP TABLE resolver_prepared_intents_v1;`);
      }
      const intentColumns = this.database.query("PRAGMA table_info(resolver_prepared_intents)").all() as Array<{ name: string }>;
      for (const [name, definition] of Object.entries({ serialized_transaction: "TEXT", replay_state: "TEXT NOT NULL DEFAULT 'legacy'",
        send_attempts: "INTEGER NOT NULL DEFAULT 0", next_retry_ms: "INTEGER NOT NULL DEFAULT 0", replay_max_fee_wei: "TEXT" })) {
        if (!intentColumns.some((column) => column.name === name)) this.database.exec(`ALTER TABLE resolver_prepared_intents ADD COLUMN ${name} ${definition}`);
      }
      const resultColumns = this.database.query("PRAGMA table_info(resolver_signing_results)").all() as Array<{ name: string }>;
      if (!resultColumns.some((column) => column.name === "serialized_transaction"))
        this.database.exec("ALTER TABLE resolver_signing_results ADD COLUMN serialized_transaction TEXT");
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS resolver_signing_binding
        ON resolver_signing_reservations(chain_id, resolver_address, nonce, operation_id);
      CREATE INDEX IF NOT EXISTS resolver_intents_unfinalized_nonce
        ON resolver_prepared_intents(chain_id, resolver_address, nonce) WHERE status != 'finalized';
      CREATE INDEX IF NOT EXISTS resolver_intents_nonce
        ON resolver_prepared_intents(chain_id, resolver_address, nonce);
    `);
  }
  /** The mission client registers the canonical batch reader for sibling randomness/moon writers.
   * A standalone writer without it fails closed while any unfinalized batch remains. */
  setPreparedReconciler(chainId: number, address: Hex, reconcile: NonNullable<ResolverTransactionRequest["reconcilePrepared"]>): void {
    this.preparedReconcilers.set(resolverKey(chainId, address), reconcile);
  }

  setPreparedReplayer(chainId: number, address: Hex, replay: PreparedReplay): void {
    this.preparedReplayers.set(resolverKey(chainId, address), replay);
  }

  submit(request: ResolverTransactionRequest): Promise<Hex> {
    const key = resolverKey(request.chainId, request.address);
    return this.enqueueLocal(key, () => this.withLease(request.chainId, request.address, (assertLease) =>
      this.submitWithLease(request, assertLease)
    ));
  }

  reconcilePrepared(chainId: number, address: Hex,
    confirm: PreparedReconciler): Promise<void> {
    return this.enqueueLocal(resolverKey(chainId, address), () => this.withLease(chainId, address,
      (assertLease) => this.reconcileIntents(chainId, address, confirm, assertLease)));
  }

  private async reconcileIntents(chainId: number, address: Hex,
    confirm: ResolverTransactionRequest["reconcilePrepared"], assertLease: () => void): Promise<void> {
    const signing = this.database.query(
      "SELECT id FROM resolver_signing_reservations WHERE chain_id = ? AND resolver_address = ? AND transferred = 0 LIMIT 1"
    ).get(chainId, normalizeAddress(address));
    if (signing) throw new Error("resolver signed preparation requires explicit fenced recovery; never re-sign or resend");
    const key = resolverKey(chainId, address);
    confirm ??= this.preparedReconcilers.get(key);
    const started = performance.now();
    let reads = 0, checked = 0, active = true;
    let budgetError: Error | undefined;
    const blocked = (reason: string) => new Error("resolver reconciliation backpressure: " + reason
      + "; no nonce allocated; check RPC/finality and retry, preserve the intent journal");
    const deadline = started + this.reconciliationTimeoutMs;
    const assertActive = () => {
      if (budgetError) throw budgetError;
      if (!active || performance.now() >= deadline) throw blocked("read deadline exceeded");
      assertLease();
    };
    // LIMIT bounds memory AND index traversal, even on a pre-upgrade oversized journal.
    const intents = this.database.query(`SELECT operation_id AS operationId, nonce, transaction_hash AS hash,
      membership, status, serialized_transaction AS raw, send_attempts AS attempts, next_retry_ms AS nextRetry, replay_state AS replayState, replay_max_fee_wei AS originalMaxFeeWei, receipt_block_number AS blockNumber, receipt_block_hash AS blockHash, outcomes
      FROM resolver_prepared_intents INDEXED BY resolver_intents_unfinalized_nonce WHERE chain_id = ? AND resolver_address = ? AND status != 'finalized'
      ORDER BY nonce LIMIT ?`).all(chainId, normalizeAddress(address), this.maxUnfinalizedIntents + 1) as Array<{
        operationId: string; nonce: number; hash: Hex; membership: string; status: string;
        raw: Hex | null; attempts: number; nextRetry: number; replayState: string; originalMaxFeeWei: string | null;
        blockNumber: string | null; blockHash: Hex | null; outcomes: string | null;
      }>;
    if (!intents.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { active = false; reject(blocked("read deadline exceeded")); }, this.reconciliationTimeoutMs);
    });
    // One underlying read at a time; a timeout releases the lease, not permission to keep
    // hydrating or write late. Retain the unresolved handle so retries cannot pile up reads.
    const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
      assertActive();
      const work = Promise.resolve().then(() => { assertActive(); return operation(); });
      const unfinished = this.unfinishedReconciliations.get(key) ?? new Set<Promise<unknown>>();
      unfinished.add(work);
      this.unfinishedReconciliations.set(key, unfinished);
      const clear = () => {
        unfinished.delete(work);
        if (!unfinished.size && this.unfinishedReconciliations.get(key) === unfinished) this.unfinishedReconciliations.delete(key);
      };
      void work.then(clear, clear);
      const result = await Promise.race([work, expired]);
      assertActive();
      return result;
    };
    const pass: PreparedReconciliationPass = { assertActive, read: async (operation) => {
      if (reads >= this.reconciliationReadLimit) {
        budgetError = blocked("read budget exhausted");
        throw budgetError;
      }
      reads++;
      return bounded(operation);
    } };
    try {
      if (this.unfinishedReconciliations.has(key)) throw blocked("previous read still unresolved");
      for (const intent of intents.slice(0, this.maxUnfinalizedIntents)) {
        if (intent.status === "prevented") throw new Error(
          "resolver batch broadcast locally prevented; retained signed intent requires explicit recovery; never resend or re-sign");
        if (!confirm) throw new ResolverSubmissionAmbiguousError(chainId, address, intent.nonce,
          "durable batch intent cannot bypass canonical receipt/finality reconciliation");
        const stored = intent.blockNumber !== null && intent.blockHash !== null && intent.outcomes !== null
          ? { finalized: false, blockNumber: intent.blockNumber, blockHash: intent.blockHash, outcomes: intent.outcomes } : undefined;
        let receipt = await bounded(() => confirm!(intent.hash, intent.membership, stored, pass));
        for (let retry = 0; !receipt && !stored && retry < 3; retry++) {
          if (!intent.raw) throw new Error("legacy durable batch intent missing signed bytes; canonical receipt unknown; preserve journal and obtain independently reviewed original-envelope recovery; never re-sign/reset");
          await bounded(() => this.replayIntent(chainId, address, intent, assertActive, pass));
          receipt = await bounded(() => confirm!(intent.hash, intent.membership, undefined, pass));
        }
        assertActive();
        if (!receipt) throw new Error("durable batch intent requires explicit canonical receipt/finality evidence");
        if (!stored || receipt.finalized || receipt.blockNumber !== stored.blockNumber || receipt.blockHash !== stored.blockHash || receipt.outcomes !== stored.outcomes) {
          this.database.query("UPDATE resolver_prepared_intents SET status = ?, receipt_block_number = ?, receipt_block_hash = ?, outcomes = ? WHERE chain_id = ? AND resolver_address = ? AND transaction_hash = ?")
            .run(receipt.finalized ? "finalized" : "confirmed", receipt.blockNumber, receipt.blockHash, receipt.outcomes,
              chainId, normalizeAddress(address), intent.hash);
          if (intent.status !== "confirmed") this.recordAttempt(chainId, address, intent.operationId, intent.nonce, intent.hash, "confirmed");
        }
        checked++;
      }
      // An oversized old journal may drain finalized rows in bounded passes, but NEVER
      // authorize a writer based on only a page of canonical evidence.
      if (intents.length > this.maxUnfinalizedIntents) throw blocked("retained window exceeded; reconciliation-only drain required");
    } catch (error) {
      emitObservabilityEvent({ kind: "resolver_reconciliation_blocked", chainId, address, checked, reads,
        retainedAtLeast: intents.length, maxRetained: this.maxUnfinalizedIntents, readLimit: this.reconciliationReadLimit,
        durationMs: Math.round(performance.now() - started), deadlineMs: this.reconciliationTimeoutMs,
        reason: error instanceof Error ? error.message : String(error),
        action: "check RPC/finality; retry bounded reconciliation; never delete intents or bypass admission" }, "warn");
      throw error;
    } finally {
      active = false;
      clearTimeout(timer);
    }
  }

  private async validateEnvelope(chainId: number, address: Hex, nonce: number, hash: Hex, raw: Hex): Promise<void> {
    try {
      const tx = parseTransaction(raw);
      if (keccak256(raw).toLowerCase() !== hash.toLowerCase() || tx.chainId !== chainId || tx.nonce !== nonce
        || (await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toLowerCase() !== normalizeAddress(address)) throw new Error();
    } catch { throw new Error("persisted signed envelope identity mismatch; preserve journal for explicit recovery"); }
  }

  private replayError(intent: ReplayIntent, reason: string): Error {
    return new Error(`resolver durable replay ${intent.hash} nonce ${intent.nonce}: ${reason}; attempts=${intent.attempts}, nextRetryMs=${intent.nextRetry}; preserve journal, no new nonce or replacement`);
  }

  private async sendPrepared(chainId: number, address: Hex, intent: ReplayIntent,
    assertLease: () => void, broadcast: () => Promise<Hex>, guard?: () => void): Promise<void> {
    this.database.transaction(() => {
      assertLease();
      guard?.();
      intent.attempts++;
      intent.nextRetry = this.now() + (intent.attempts < 3 ? 250 * 2 ** (intent.attempts - 1) : 60_000);
      const result = this.database.query("UPDATE resolver_prepared_intents SET send_attempts = ?, next_retry_ms = ?, replay_state = 'retryable' WHERE chain_id = ? AND resolver_address = ? AND transaction_hash = ? AND operation_id = ? AND membership = ? AND nonce = ? AND status = 'pending' AND serialized_transaction = ? AND send_attempts = ?")
        .run(intent.attempts, intent.nextRetry, chainId, normalizeAddress(address), intent.hash, intent.operationId,
          intent.membership, intent.nonce, intent.raw, intent.attempts - 1);
      if (result.changes !== 1) throw this.replayError(intent, "send identity changed");
    }).immediate();
    intent.replayState = "retryable";
    assertLease();
    guard?.();
    let state = "retryable";
    const key = resolverKey(chainId, address);
    // Track the underlying RPC, not just the timed-out wrapper: a late send must settle
    // before this process starts another pass, just like a late canonical read.
    const sends = this.unfinishedReconciliations.get(key) ?? new Set<Promise<unknown>>();
    let send: Promise<Hex> | undefined;
    try {
      send = broadcast();
      sends.add(send); this.unfinishedReconciliations.set(key, sends);
      const hash = await send;
      if (hash.toLowerCase() !== intent.hash.toLowerCase()) state = "invalid-response";
    } catch (error) {
      // viem send errors can contain raw signed bytes. Retain only a fixed category.
      const reason = errorText(error).toLowerCase();
      if (/execution reverted|transaction.*reverted|invalid sender|invalid signature|intrinsic gas too low|invalid chain/.test(reason))
        state = "deterministic-rejection";
      // already-known, nonce-too-low and underpriced are not inclusion/absence evidence.
    } finally {
      if (send) sends.delete(send);
      if (!sends.size && this.unfinishedReconciliations.get(key) === sends) this.unfinishedReconciliations.delete(key);
    }
    assertLease();
    if (state !== "retryable") {
      this.database.transaction(() => {
        assertLease();
        this.database.query("UPDATE resolver_prepared_intents SET replay_state = ? WHERE chain_id = ? AND resolver_address = ? AND transaction_hash = ? AND send_attempts = ?")
          .run(state, chainId, normalizeAddress(address), intent.hash, intent.attempts);
      }).immediate();
      intent.replayState = state;
    }
  }

  private async replayIntent(chainId: number, address: Hex, intent: ReplayIntent,
    assertLease: () => void, pass: PreparedReconciliationPass): Promise<void> {
    const replay = this.preparedReplayers.get(resolverKey(chainId, address));
    if (!replay) throw this.replayError(intent, "replay client unavailable");
    if (intent.replayState !== "retryable" && intent.replayState !== "ready"
      && intent.replayState !== "deterministic-rejection" && intent.replayState !== "invalid-response")
      throw this.replayError(intent, "first-send validation not durably completed; explicit fenced recovery required; never auto-send");
    const binding = this.database.query("SELECT r.id FROM resolver_signing_reservations r JOIN resolver_signing_results s ON s.reservation_id = r.id WHERE r.chain_id = ? AND r.resolver_address = ? AND r.operation_id = ? AND r.nonce = ? AND r.membership = ? AND r.transferred = 1 AND s.transaction_hash = ? AND s.serialized_transaction = ? LIMIT 1")
      .get(chainId, normalizeAddress(address), intent.operationId, intent.nonce, intent.membership, intent.hash, intent.raw);
    if (!binding) throw new Error("persisted signed envelope identity mismatch; signing reservation binding missing");
    await this.validateEnvelope(chainId, address, intent.nonce, intent.hash, intent.raw!);
    assertLease();
    // Receipt has just been checked. Reconcile transaction inclusion before each resend.
    const transaction = await pass.read(() => replay.getTransaction(intent.hash));
    if (transaction && (transaction.hash.toLowerCase() !== intent.hash.toLowerCase() || transaction.blockHash !== null))
      throw this.replayError(intent, "transaction included or inconsistent; await canonical receipt");
    if (["deterministic-rejection", "invalid-response"].includes(intent.replayState))
      throw this.replayError(intent, "deterministic send rejection; operator review required, receipt reconciliation remains active");
    if (intent.nextRetry > this.now()) {
      if (intent.attempts >= 3) throw this.replayError(intent, "recoverable pending; bounded retry cooling down");
      await this.sleep(intent.nextRetry - this.now());
      assertLease();
    }
    let guard: () => void;
    try { guard = await pass.read(() => replay.validate(intent.raw!, intent.operationId, intent.membership, intent.originalMaxFeeWei, pass)); }
    catch { throw this.replayError(intent, "fixed-envelope fee/intent preflight blocked; retry when prerequisites recover"); }
    assertLease();
    await this.sendPrepared(chainId, address, intent, assertLease, () => replay.broadcast(intent.raw!), guard);
  }

  private assertPreparedAdmission(chainId: number, address: Hex): void {
    const rows = this.database.query("SELECT nonce FROM resolver_prepared_intents INDEXED BY resolver_intents_unfinalized_nonce WHERE chain_id = ? AND resolver_address = ? AND status != 'finalized' ORDER BY nonce LIMIT ?")
      .all(chainId, normalizeAddress(address), this.maxUnfinalizedIntents);
    if (rows.length >= this.maxUnfinalizedIntents) {
      emitObservabilityEvent({ kind: "resolver_reconciliation_blocked", chainId, address,
        retainedAtLeast: rows.length, maxRetained: this.maxUnfinalizedIntents, reason: "retained window full",
        action: "wait for explicit RPC finality; keep reconciliation running; no new batch signatures" }, "warn");
      throw new Error("resolver reconciliation backpressure: retained window full; wait for finality before preparing another batch");
    }
  }
  /**
   * Fill a precisely bounded, currently empty nonce range with zero-value self-transactions supplied
   * by the caller. The chain must be contiguous at every step; any occupied/earlier nonce aborts the
   * run rather than replacing an unknown canonical transaction.
   */
  recoverNonceGap(request: ResolverNonceGapRecoveryRequest): Promise<ResolverNonceGapRecoveryResult> {
    validateNonceRange(request.fromNonce, request.throughNonce);
    const key = resolverKey(request.chainId, request.address);
    return this.enqueueLocal(key, () => this.withLease(request.chainId, request.address, async (assertLease) => {
      await this.reconcileIntents(request.chainId, request.address, request.reconcilePrepared, assertLease);
      const retained = this.database.query("SELECT nonce FROM resolver_prepared_intents WHERE chain_id = ? AND resolver_address = ? AND nonce >= ? LIMIT 1")
        .get(request.chainId, normalizeAddress(request.address), request.fromNonce) as { nonce: number } | null;
      if (retained) throw new ResolverSubmissionAmbiguousError(request.chainId, request.address, request.fromNonce,
        "nonce-gap recovery overlaps retained batch history; explicit recovery required");
      const plannedNonces = range(request.fromNonce, request.throughNonce);
      const submitted: Array<{ nonce: number; hash: Hex }> = [];
      let latest = await request.getTransactionCount("latest");
      let pending = await request.getTransactionCount("pending");
      if (latest !== request.fromNonce || pending !== request.fromNonce) {
        throw new Error(
          `resolver nonce recovery expected latest/pending ${request.fromNonce}, got ${latest}/${pending}`
        );
      }
      if (!request.broadcast) return { plannedNonces, submitted };

      for (const nonce of plannedNonces) {
        latest = await request.getTransactionCount("latest");
        pending = await request.getTransactionCount("pending");
        if (latest !== nonce || pending !== nonce) {
          throw new Error(
            `resolver nonce recovery stopped before ${nonce}: latest/pending is ${latest}/${pending}`
          );
        }
        const operationId = `nonce-gap-cancel:${nonce}`;
        this.recordAttempt(request.chainId, request.address, operationId, nonce, null, "allocating");
        assertLease();
        let hash: Hex;
        try {
          hash = await request.submitCancellation(nonce);
        } catch (error) {
          this.recordAttempt(request.chainId, request.address, operationId, nonce, null, "rejected");
          throw error;
        }
        this.recordAttempt(request.chainId, request.address, operationId, nonce, hash, "submitted");
        try {
          await request.confirm(hash);
        } catch (error) {
          if (isRevertedTransactionError(error)) {
            this.recordAttempt(request.chainId, request.address, operationId, nonce, hash, "reverted");
          }
          throw error;
        }
        this.recordAttempt(request.chainId, request.address, operationId, nonce, hash, "confirmed");
        submitted.push({ nonce, hash });
      }
      return { plannedNonces, submitted };
    }));
  }

  private async submitWithLease(
    request: ResolverTransactionRequest,
    assertLease: () => void
  ): Promise<Hex> {
    // A late RPC/preflight completion must never mutate a successor's shared journal.
    // BEGIN IMMEDIATE fences ownership and writes atomically across coordinator processes.
    const recordOwnedAttempt = (...args: Parameters<ResolverTransactionCoordinator["recordAttempt"]>) => {
      this.database.transaction(() => { assertLease(); this.recordAttempt(...args); }).immediate();
    };
    await this.reconcileIntents(request.chainId, request.address, request.reconcilePrepared, assertLease);
    if (request.prepare) this.assertPreparedAdmission(request.chainId, request.address);
    const previous = this.loadAttempt(request.chainId, request.address, request.operationId);
    if (previous?.status === "confirmed" && previous.transactionHash) {
      const isCanonical = !request.isConfirmedCanonical
        || await request.isConfirmedCanonical(previous.transactionHash);
      if (isCanonical) {
        const isComplete = !request.isOperationComplete || await request.isOperationComplete();
        if (isComplete) return previous.transactionHash;
      }
      // Either a reorg removed the confirmation or the receipt completed only one bounded chunk.
      // Retire this attempt and allocate at the current pending nonce; never replay the old nonce.
      recordOwnedAttempt(
        request.chainId,
        request.address,
        request.operationId,
        previous.nonce,
        previous.transactionHash,
        "rejected"
      );
    }
    if (previous?.status === "allocating" || previous?.status === "ambiguous") {
      const [latest, pending] = await Promise.all([
        request.getTransactionCount("latest"),
        request.getTransactionCount("pending")
      ]);
      if (previous.status === "allocating" && (latest > previous.nonce || pending > previous.nonce)) {
        recordOwnedAttempt(
          request.chainId,
          request.address,
          request.operationId,
          previous.nonce,
          null,
          "ambiguous"
        );
        throw new ResolverSubmissionAmbiguousError(
          request.chainId,
          request.address,
          previous.nonce,
          "an unrecorded broadcast may have advanced the account; refresh canonical operation state"
        );
      }
      if (previous.status === "ambiguous" && pending > previous.nonce && latest <= previous.nonce) {
        throw new ResolverSubmissionAmbiguousError(
          request.chainId,
          request.address,
          previous.nonce,
          "the possibly accepted transaction is still pending"
        );
      }
      recordOwnedAttempt(
        request.chainId,
        request.address,
        request.operationId,
        previous.nonce,
        null,
        "rejected"
      );
      if (previous.status === "ambiguous" && latest > previous.nonce) {
        throw new ResolverSubmissionAmbiguousError(
          request.chainId,
          request.address,
          previous.nonce,
          "the nonce was mined; refresh canonical operation state before any retry"
        );
      }
    }
    if (previous?.status === "submitted" && previous.transactionHash) {
      const replaceImmediately = this.isStale(previous)
        || (await request.shouldReplace?.(previous.transactionHash) ?? false);
      let confirmationError: unknown;
      if (!replaceImmediately) {
        try {
          await request.confirm(previous.transactionHash);
          recordOwnedAttempt(
            request.chainId,
            request.address,
            request.operationId,
            previous.nonce,
            previous.transactionHash,
            "confirmed"
          );
          return previous.transactionHash;
        } catch (error) {
          if (isRevertedTransactionError(error)) {
            recordOwnedAttempt(
              request.chainId,
              request.address,
              request.operationId,
              previous.nonce,
              previous.transactionHash,
              "reverted"
            );
            throw error;
          }
          confirmationError = error;
        }
      }

      const latest = await request.getTransactionCount("latest");
      if (latest > previous.nonce) {
        throw new ResolverSubmissionAmbiguousError(
          request.chainId,
          request.address,
          previous.nonce,
          "the nonce was mined by another hash; refresh canonical operation state"
        );
      }
      if (!request.replace) {
        throw confirmationError ?? new Error("resolver transaction requires replacement but no replacement writer is configured");
      }

      assertLease();
      let replacementHash: Hex;
      try {
        replacementHash = await request.replace(previous.nonce, previous.transactionHash, assertLease);
      } catch (replacementError) {
        if (isReplacementUnderpricedError(replacementError)) {
          throw new ResolverNonceStalledError(
            request.chainId,
            request.address,
            previous.nonce
          );
        }
        throw replacementError;
      }
      recordOwnedAttempt(
        request.chainId,
        request.address,
        request.operationId,
        previous.nonce,
        replacementHash,
        "submitted"
      );
      try {
        await request.confirm(replacementHash);
      } catch (replacementError) {
        if (isRevertedTransactionError(replacementError)) {
          recordOwnedAttempt(
            request.chainId,
            request.address,
            request.operationId,
            previous.nonce,
            replacementHash,
            "reverted"
          );
        }
        throw replacementError;
      }
      recordOwnedAttempt(
        request.chainId,
        request.address,
        request.operationId,
        previous.nonce,
        replacementHash,
        "confirmed"
      );
      return replacementHash;
    }

    for (let collision = 0; collision < 2; collision += 1) {
      const [latest, pending] = await Promise.all([
        request.getTransactionCount("latest"),
        request.getTransactionCount("pending")
      ]);
      if (pending > latest) {
        // The persisted operation may already be resolved elsewhere, so clear its earliest nonce without replaying stale calldata.
        const stale = this.loadSubmittedAttemptAtNonce(request.chainId, request.address, latest);
        if (
          stale?.operationId
          && stale.transactionHash
          && request.shouldReplace
          && request.cancelStale
          && (this.isStale(stale) || await request.shouldReplace(stale.transactionHash))
        ) {
          assertLease();
          const cancellationHash = await request.cancelStale(latest, stale.transactionHash, assertLease);
          recordOwnedAttempt(
            request.chainId,
            request.address,
            stale.operationId,
            latest,
            cancellationHash,
            "submitted"
          );
          try {
            await request.confirm(cancellationHash);
          } catch (error) {
            if (isRevertedTransactionError(error)) {
              recordOwnedAttempt(
                request.chainId,
                request.address,
                stale.operationId,
                latest,
                cancellationHash,
                "reverted"
              );
            }
            throw error;
          }
          recordOwnedAttempt(
            request.chainId,
            request.address,
            stale.operationId,
            latest,
            cancellationHash,
            "cancelled"
          );
          collision -= 1;
          continue;
        }
        throw new ResolverNonceStalledError(request.chainId, request.address, latest);
      }
      const nonce = pending;
      const retained = this.database.query("SELECT nonce FROM resolver_prepared_intents WHERE chain_id = ? AND resolver_address = ? AND nonce >= ? LIMIT 1")
        .get(request.chainId, normalizeAddress(request.address), nonce) as { nonce: number } | null;
      if (retained) throw new ResolverSubmissionAmbiguousError(request.chainId, request.address, nonce,
        "nonce regression overlaps retained batch history; explicit recovery required");
      recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, null, "allocating");
      assertLease();
      let hash: Hex;
      try {
        if (request.prepare) {
          let reservationId: string | undefined;
          let prepared: Awaited<ReturnType<NonNullable<typeof request.prepare>>>;
          try { prepared = await request.prepare(nonce, { sign: async (membership, signer) => {
            if (reservationId) throw new Error("batch preparation cannot sign twice");
            const id = randomUUID();
            this.database.transaction(() => {
              assertLease();
              const attempt = this.loadAttempt(request.chainId, request.address, request.operationId);
              if (attempt?.nonce !== nonce || attempt.transactionHash !== null || attempt.status !== "allocating")
                throw new Error("batch signing allocation identity changed");
              this.database.query("INSERT INTO resolver_signing_reservations (id,chain_id,resolver_address,operation_id,nonce,membership) VALUES (?, ?, ?, ?, ?, ?)")
                .run(id, request.chainId, normalizeAddress(request.address), request.operationId, nonce, membership);
            }).immediate();
            reservationId = id;
            assertLease(); // synchronous fence after the last await, immediately before actual signer
            const signed = await signer();
            // Immutable, reservation-scoped evidence only: even a late result cannot touch
            // shared attempts/intents. The reservation already blocks all automatic writers.
            this.database.query("INSERT INTO resolver_signing_results (reservation_id,transaction_hash,serialized_transaction) VALUES (?, ?, ?)")
              .run(id, keccak256(signed), signed);
            assertLease();
            return signed;
          } }); } catch (error) {
            // Nothing signed yet (no reservation): release the nonce allocation cleanly, but only
            // while this process still owns the lease; a successor owns the state otherwise.
            if (!reservationId) {
              let owned = true;
              try { assertLease(); } catch { owned = false; }
              if (owned) recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, null, "rejected");
            }
            throw error;
          }
          if (prepared.serializedTransaction) {
            if (!reservationId) throw new Error("durable replay requires fenced signing reservation");
            await this.validateEnvelope(request.chainId, request.address, nonce, prepared.hash, prepared.serializedTransaction);
          }
          this.database.transaction(() => {
            assertLease();
            const attempt = this.loadAttempt(request.chainId, request.address, request.operationId);
            if (attempt?.nonce !== nonce || attempt.transactionHash !== null || attempt.status !== "allocating")
              throw new Error("batch preparation allocation identity changed; explicit recovery required");
            if (reservationId) {
              const reserved = this.database.query("SELECT r.id FROM resolver_signing_reservations r JOIN resolver_signing_results s ON s.reservation_id = r.id WHERE r.id = ? AND r.chain_id = ? AND r.resolver_address = ? AND r.operation_id = ? AND r.nonce = ? AND r.membership = ? AND s.transaction_hash = ? AND (s.serialized_transaction = ? OR ? IS NULL) AND r.transferred = 0")
                .get(reservationId, request.chainId, normalizeAddress(request.address), request.operationId, nonce, prepared.membership, prepared.hash, prepared.serializedTransaction ?? null, prepared.serializedTransaction ?? null);
              if (!reserved) throw new Error("signed preparation identity mismatch; explicit recovery required");
            }
            this.database.query(
              "INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status,serialized_transaction,replay_state,replay_max_fee_wei) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
            ).run(request.chainId, normalizeAddress(request.address), request.operationId, nonce, prepared.hash, prepared.membership, prepared.serializedTransaction ?? null, prepared.serializedTransaction ? "unvalidated" : "legacy", prepared.replayMaxFeeWei ?? null);
            recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, prepared.hash, "submitted");
            if (reservationId) this.database.query("UPDATE resolver_signing_reservations SET transferred = 1 WHERE id = ?").run(reservationId);
          }).immediate();
          try {
            await prepared.validateBeforeBroadcast?.();
            assertLease();
            prepared.assertBeforeBroadcast?.();
          } catch (error) {
            // Only the current owner may transition the exact original pair. BEGIN
            // IMMEDIATE makes ownership + identity checks + both writes atomic across processes.
            this.database.transaction(() => {
              assertLease();
              const attempt = this.loadAttempt(request.chainId, request.address, request.operationId);
              if (attempt?.nonce !== nonce || attempt.transactionHash !== prepared.hash || attempt.status !== "submitted")
                throw new Error("batch prevention identity changed; retained intent requires explicit recovery");
              const changed = this.database.query("UPDATE resolver_prepared_intents SET status = 'prevented' WHERE chain_id = ? AND resolver_address = ? AND operation_id = ? AND nonce = ? AND transaction_hash = ? AND membership = ? AND status = 'pending'")
                .run(request.chainId, normalizeAddress(request.address), request.operationId, nonce, prepared.hash, prepared.membership);
              if (changed.changes !== 1) throw new Error("batch prevention intent changed; explicit recovery required");
              recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, prepared.hash, "prevented");
            }).immediate();
            throw error;
          }
          if (prepared.serializedTransaction) {
            // A durable ready marker distinguishes completed first-send validation from
            // a crash while it was in flight; the latter must remain explicitly fenced.
            this.database.transaction(() => {
              assertLease(); prepared.assertBeforeBroadcast?.();
              const ready = this.database.query("UPDATE resolver_prepared_intents SET replay_state = 'ready' WHERE chain_id = ? AND resolver_address = ? AND transaction_hash = ? AND status = 'pending' AND replay_state = 'unvalidated'")
                .run(request.chainId, normalizeAddress(request.address), prepared.hash);
              if (ready.changes !== 1) throw new Error("first-send validation identity changed");
            }).immediate();
            const intent: ReplayIntent = { operationId: request.operationId, nonce, hash: prepared.hash,
              membership: prepared.membership, raw: prepared.serializedTransaction, attempts: 0, nextRetry: 0,
              replayState: "ready", status: "pending", originalMaxFeeWei: prepared.replayMaxFeeWei ?? null };
            await this.sendPrepared(request.chainId, request.address, intent, assertLease, prepared.broadcast, prepared.assertBeforeBroadcast);
            hash = prepared.hash;
            await this.reconcileIntents(request.chainId, request.address, request.reconcilePrepared, assertLease);
            // Canonical hydration already recorded inclusion/outcomes. Do not downgrade a
            // confirmed intent to submitted or enter the generic replacement/confirm path.
            return hash;
          } else {
            hash = await prepared.broadcast();
            if (hash.toLowerCase() !== prepared.hash.toLowerCase()) throw new Error("broadcast hash differs from persisted local batch hash");
          }
        } else hash = await request.submit(nonce, assertLease);
      } catch (error) {
        if (request.prepare) throw error; // never discard a possibly broadcast durable hash
        if (!isReplacementUnderpricedError(error)) {
          recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, null, "rejected");
          throw error;
        }
        const advanced = await this.waitForNonceAdvance(request.getTransactionCount, nonce);
        if (advanced) continue;
        recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, null, "rejected");
        throw new ResolverNonceStalledError(request.chainId, request.address, nonce);
      }

      recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, hash, "submitted");
      try {
        await request.confirm(hash);
      } catch (error) {
        if (isRevertedTransactionError(error)) {
          recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, hash, "reverted");
        }
        throw error;
      }
      recordOwnedAttempt(request.chainId, request.address, request.operationId, nonce, hash, "confirmed");
      if (request.prepare) await this.reconcileIntents(request.chainId, request.address, request.reconcilePrepared, assertLease);
      return hash;
    }

    const nonce = await request.getTransactionCount("pending");
    throw new ResolverNonceStalledError(request.chainId, request.address, nonce);
  }

  private async waitForNonceAdvance(
    getTransactionCount: ResolverTransactionRequest["getTransactionCount"],
    nonce: number
  ): Promise<boolean> {
    const deadline = this.now() + this.replacementWaitMs;
    while (this.now() < deadline) {
      if (await getTransactionCount("pending") > nonce) return true;
      await this.sleep(this.replacementPollMs);
    }
    return await getTransactionCount("pending") > nonce;
  }

  private async enqueueLocal<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.localTails.get(key) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => { release = resolve; });
    this.localTails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.localTails.get(key) === tail) this.localTails.delete(key);
    }
  }

  private async withLease<T>(
    chainId: number,
    address: `0x${string}`,
    operation: (assertLease: () => void) => Promise<T>
  ): Promise<T> {
    const holder = randomUUID();
    await this.acquireLease(chainId, address, holder);
    let leaseError: unknown;
    const renew = setInterval(() => {
      try {
        this.renewLease(chainId, address, holder);
      } catch (error) {
        leaseError = error;
      }
    }, this.leaseRenewIntervalMs);
    renew.unref?.();
    const assertLease = () => {
      if (leaseError) throw leaseError;
      const row = this.database.query(`
        SELECT holder, expires_at_ms AS expiresAtMs
        FROM resolver_transaction_leases
        WHERE chain_id = ? AND resolver_address = ?
      `).get(chainId, normalizeAddress(address)) as { holder: string; expiresAtMs: number } | null;
      if (!row || row.holder !== holder || row.expiresAtMs <= this.now()) {
        throw new Error("resolver transaction lease was lost before broadcast");
      }
    };
    try {
      const result = await operation(assertLease);
      if (leaseError) throw leaseError;
      return result;
    } finally {
      clearInterval(renew);
      this.database.query(`
        DELETE FROM resolver_transaction_leases
        WHERE chain_id = ? AND resolver_address = ? AND holder = ?
      `).run(chainId, normalizeAddress(address), holder);
    }
  }

  private async acquireLease(chainId: number, address: `0x${string}`, holder: string): Promise<void> {
    const deadline = this.now() + this.leaseWaitMs;
    const normalizedAddress = normalizeAddress(address);
    while (true) {
      const now = this.now();
      const result = this.database.query(`
        INSERT INTO resolver_transaction_leases (
          chain_id, resolver_address, holder, expires_at_ms
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(chain_id, resolver_address) DO UPDATE SET
          holder = excluded.holder,
          expires_at_ms = excluded.expires_at_ms
        WHERE resolver_transaction_leases.expires_at_ms <= ?
      `).run(chainId, normalizedAddress, holder, now + this.leaseDurationMs, now) as { changes: number };
      if (result.changes > 0) return;
      if (now >= deadline) {
        throw new Error(`timed out waiting for resolver transaction lease ${chainId}:${normalizedAddress}`);
      }
      await this.sleep(Math.min(50, this.replacementPollMs));
    }
  }

  private renewLease(chainId: number, address: `0x${string}`, holder: string): void {
    const result = this.database.query(`
      UPDATE resolver_transaction_leases
      SET expires_at_ms = ?
      WHERE chain_id = ? AND resolver_address = ? AND holder = ?
    `).run(
      this.now() + this.leaseDurationMs,
      chainId,
      normalizeAddress(address),
      holder
    ) as { changes: number };
    if (result.changes !== 1) {
      throw new Error("resolver transaction lease was lost before confirmation");
    }
  }

  private loadAttempt(
    chainId: number,
    address: `0x${string}`,
    operationId: string
  ): StoredAttempt | null {
    return this.database.query(`
      SELECT nonce, transaction_hash AS transactionHash, status, updated_at AS updatedAt
      FROM resolver_transaction_attempts
      WHERE chain_id = ? AND resolver_address = ? AND operation_id = ?
    `).get(chainId, normalizeAddress(address), operationId) as StoredAttempt | null;
  }

  private loadSubmittedAttemptAtNonce(
    chainId: number,
    address: `0x${string}`,
    nonce: number
  ): StoredAttempt | null {
    return this.database.query(`
      SELECT operation_id AS operationId, nonce, transaction_hash AS transactionHash, status,
        updated_at AS updatedAt
      FROM resolver_transaction_attempts
      WHERE chain_id = ? AND resolver_address = ? AND nonce = ? AND status = 'submitted'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(chainId, normalizeAddress(address), nonce) as StoredAttempt | null;
  }

  private isStale(attempt: StoredAttempt): boolean {
    const updatedAtMs = Date.parse(attempt.updatedAt);
    return Number.isFinite(updatedAtMs) && this.now() - updatedAtMs >= this.staleTransactionMs;
  }

  private recordAttempt(
    chainId: number,
    address: `0x${string}`,
    operationId: string,
    nonce: number,
    transactionHash: Hex | null,
    status: StoredAttempt["status"]
  ): void {
    const normalizedAddress = normalizeAddress(address);
    const now = new Date(this.now()).toISOString();
    // Bun uses a savepoint when nested in the lease-fenced intent transition.
    this.database.transaction(() => {
      this.database.query(`
        INSERT INTO resolver_transaction_attempts (
          chain_id, resolver_address, operation_id, nonce, transaction_hash, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chain_id, resolver_address, operation_id) DO UPDATE SET
          nonce = excluded.nonce,
          transaction_hash = excluded.transaction_hash,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(chainId, normalizedAddress, operationId, nonce, transactionHash, status, now);
      this.database.query(`
        INSERT INTO resolver_transaction_audit (
          chain_id, resolver_address, operation_id, nonce, transaction_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chainId, normalizedAddress, operationId, nonce, transactionHash, status, now);
    }).immediate();
  }
}

export class ResolverNonceStalledError extends Error {
  constructor(chainId: number, address: `0x${string}`, nonce: number) {
    super(
      `resolver nonce ${nonce} is stalled after replacement-underpriced on chain ${chainId} for ${normalizeAddress(address)}; `
      + "future nonces were not allocated"
    );
    this.name = "ResolverNonceStalledError";
  }
}

export class ResolverSubmissionAmbiguousError extends Error {
  constructor(
    chainId: number,
    address: `0x${string}`,
    nonce: number,
    detail: string
  ) {
    super(
      `resolver submission at nonce ${nonce} is ambiguous on chain ${chainId} for ${normalizeAddress(address)}: ${detail}`
    );
    this.name = "ResolverSubmissionAmbiguousError";
  }
}

function resolverKey(chainId: number, address: `0x${string}`): string {
  return `${chainId}:${normalizeAddress(address)}`;
}

function normalizeAddress(address: `0x${string}`): string {
  return address.toLowerCase();
}

function isReplacementUnderpricedError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("replacement transaction underpriced");
}

function isRevertedTransactionError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return message.includes("transaction") && message.includes("reverted");
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const shortMessage = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof shortMessage === "string") return shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function validateNonceRange(fromNonce: number, throughNonce: number): void {
  if (!Number.isSafeInteger(fromNonce) || !Number.isSafeInteger(throughNonce) || fromNonce < 0 || throughNonce < fromNonce) {
    throw new Error("nonce recovery range must be non-negative safe integers with from <= through");
  }
}

function range(from: number, through: number): number[] {
  return Array.from({ length: through - from + 1 }, (_, index) => from + index);
}
