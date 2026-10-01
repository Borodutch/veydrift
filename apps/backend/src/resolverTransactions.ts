import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Hex } from "viem";

export type ResolverTransactionRequest = {
  chainId: number;
  address: `0x${string}`;
  operationId: string;
  /** Raw bytes persisted by the owner: no other operation may replace/cancel its reservation. */
  signedEnvelope?: boolean;
  /** A10 preparation-only lifecycle, valid only with the intact shared mission journal. */
  preparation?: { store: Database; identity: string };
  getTransactionCount: (blockTag: "latest" | "pending") => Promise<number>;
  submit: (nonce: number) => Promise<Hex>;
  /** A persisted confirmation is reusable only while its receipt remains canonical. */
  isConfirmedCanonical?: (hash: Hex) => Promise<boolean>;
  /** A canonical receipt can be one bounded chunk of a larger logical operation. */
  isOperationComplete?: () => Promise<boolean>;
  shouldReplace?: (hash: Hex) => Promise<boolean>;
  replace?: (nonce: number, previousHash: Hex) => Promise<Hex>;
  cancelStale?: (nonce: number, previousHash: Hex) => Promise<Hex>;
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
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type StoredAttempt = {
  signedEnvelope?: number;
  operationId?: string;
  nonce: number;
  status: "allocating" | "ambiguous" | "submitted" | "confirmed" | "reverted" | "rejected" | "cancelled";
  transactionHash: Hex | null;
  updatedAt: string;
};

const defaultLeaseDurationMs = 90_000;
const defaultLeaseRenewIntervalMs = 15_000;
const defaultLeaseWaitMs = 60_000;
const defaultReplacementWaitMs = 15_000;
const defaultReplacementPollMs = 250;
const defaultStaleTransactionMs = 5 * 60_000;

/**
 * Serializes every transaction signed by one resolver EOA, including across rolling backend
 * processes. These tables store coordination metadata: operation labels, nonces, public hashes
 * and signed-envelope ownership. The shared database may also contain mission raw envelopes;
 * private keys and RPC credentials never enter it.
 */
export class ResolverTransactionCoordinator {
  private readonly database: Database;
  private readonly leaseDurationMs: number;
  private readonly leaseRenewIntervalMs: number;
  private readonly leaseWaitMs: number;
  private readonly replacementWaitMs: number;
  private readonly replacementPollMs: number;
  private readonly staleTransactionMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly localTails = new Map<string, Promise<void>>();

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
    this.database.transaction(() => {
      const columns = this.database.query("PRAGMA table_info(resolver_transaction_attempts)").all() as { name: string }[];
      if (!columns.some(column => column.name === "signed_envelope")) {
        this.database.exec("ALTER TABLE resolver_transaction_attempts ADD COLUMN signed_envelope INTEGER NOT NULL DEFAULT 0");
        // The pre-release guarded mission identity already proves owner-managed signed bytes.
        this.database.exec("UPDATE resolver_transaction_attempts SET signed_envelope = 1 WHERE operation_id LIKE '%:resolveFleetMission:progress:%' OR operation_id LIKE '%:completeFleetMissionReturn:progress:%'");
      }
      if (!columns.some(column => column.name === "preparation_identity")) {
        this.database.exec("ALTER TABLE resolver_transaction_attempts ADD COLUMN preparation_identity TEXT");
      }
    }).immediate();
  }

  /** Guarded mission recovery and new allocation share exactly the same account lease as every
   * randomness/moon writer. Callers must assert after awaits, before durable ack or dispatch. */
  withAccountLease<T>(chainId: number, address: Hex, operation: (lease: {
    assert: () => void;
    reconcilePreparations: (store: Database, ownerPrefix: string) => void;
    acknowledge: (operationId: string, nonce: number, hash: Hex, reverted: boolean) => void;
    submit: (request: ResolverTransactionRequest) => Promise<Hex>;
    recover: (operationId: string, nonce: number, hash: Hex, finish: () => Promise<Hex>) => Promise<Hex>;
  }) => Promise<T>): Promise<T> {
    return this.enqueueLocal(resolverKey(chainId, address), () => this.withLease(chainId, address, assertLease =>
      operation({ assert: assertLease,
        reconcilePreparations: (store, ownerPrefix) => this.reconcilePreparations(chainId, address, store, ownerPrefix, assertLease),
        acknowledge: (operationId, nonce, hash, reverted) => {
          assertLease();
          const existing = this.loadAttempt(chainId, address, operationId);
          if (!existing || existing.nonce !== nonce || existing.transactionHash !== hash) {
            throw new Error("stale coordinator acknowledgment");
          }
          this.recordAttempt(chainId, address, operationId, nonce, hash, reverted ? "reverted" : "confirmed");
        },
        submit: request => {
          if (request.chainId !== chainId || normalizeAddress(request.address) !== normalizeAddress(address)) {
            throw new Error("account lease identity mismatch");
          }
          return this.submitWithLease(request, assertLease);
        },
        recover: async (operationId, nonce, hash, finish) => {
          assertLease();
          const existing = this.loadAttempt(chainId, address, operationId);
          if (existing?.transactionHash && existing.transactionHash !== hash) throw new Error("recovery hash differs from coordinator");
          this.assertNoReservedAttempt(chainId, address, operationId, nonce);
          this.recordAttempt(chainId, address, operationId, nonce, hash, "submitted", true);
          try {
            const result = await finish();
            assertLease();
            this.recordAttempt(chainId, address, operationId, nonce, hash, "confirmed");
            return result;
          } catch (error) {
            assertLease();
            if (isRevertedTransactionError(error)) this.recordAttempt(chainId, address, operationId, nonce, hash, "reverted");
            throw error;
          }
        }
      })
    ));
  }

  submit(request: ResolverTransactionRequest): Promise<Hex> {
    const key = resolverKey(request.chainId, request.address);
    return this.enqueueLocal(key, () => this.withLease(request.chainId, request.address, (assertLease) =>
      this.submitWithLease(request, assertLease)
    ));
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
      const record = (...args: Parameters<ResolverTransactionCoordinator["recordAttempt"]>) => {
        assertLease(); this.recordAttempt(...args);
      };
      const plannedNonces = range(request.fromNonce, request.throughNonce);
      const submitted: Array<{ nonce: number; hash: Hex }> = [];
      let latest = await request.getTransactionCount("latest");
      assertLease();
      let pending = await request.getTransactionCount("pending");
      assertLease();
      if (latest !== request.fromNonce || pending !== request.fromNonce) {
        throw new Error(
          `resolver nonce recovery expected latest/pending ${request.fromNonce}, got ${latest}/${pending}`
        );
      }
      this.assertNoReservedAttempt(request.chainId, request.address, "", request.fromNonce);
      if (!request.broadcast) return { plannedNonces, submitted };

      for (const nonce of plannedNonces) {
        latest = await request.getTransactionCount("latest");
        assertLease();
        pending = await request.getTransactionCount("pending");
        assertLease();
        if (latest !== nonce || pending !== nonce) {
          throw new Error(
            `resolver nonce recovery stopped before ${nonce}: latest/pending is ${latest}/${pending}`
          );
        }
        this.assertNoReservedAttempt(request.chainId, request.address, "", nonce);
        const operationId = `nonce-gap-cancel:${nonce}`;
        record(request.chainId, request.address, operationId, nonce, null, "allocating");
        assertLease();
        let hash: Hex;
        try {
          hash = await request.submitCancellation(nonce);
          assertLease();
        } catch (error) {
          assertLease();
          record(request.chainId, request.address, operationId, nonce, null, "rejected");
          throw error;
        }
        record(request.chainId, request.address, operationId, nonce, hash, "submitted");
        try {
          await request.confirm(hash);
          assertLease();
        } catch (error) {
          assertLease();
          if (isRevertedTransactionError(error)) {
            record(request.chainId, request.address, operationId, nonce, hash, "reverted");
          }
          throw error;
        }
        record(request.chainId, request.address, operationId, nonce, hash, "confirmed");
        submitted.push({ nonce, hash });
      }
      assertLease();
      return { plannedNonces, submitted };
    }));
  }

  private async submitWithLease(
    request: ResolverTransactionRequest,
    assertLease: () => void
  ): Promise<Hex> {
    const record = (...args: Parameters<ResolverTransactionCoordinator["recordAttempt"]>) => {
      assertLease(); this.recordAttempt(...args);
    };
    this.assertNoReservedAttempt(request.chainId, request.address, request.operationId, Number.MAX_SAFE_INTEGER);
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
      record(
        request.chainId,
        request.address,
        request.operationId,
        previous.nonce,
        previous.transactionHash,
        "rejected"
      );
    }
    if (previous?.status === "allocating" || previous?.status === "ambiguous") {
      // Only reconcilePreparations may release a proven A10 pre-dispatch allocation. A generic
      // or migrated unknown send is never cleared by nonce counts, time, or another retry.
      throw new ResolverSubmissionAmbiguousError(request.chainId, request.address, previous.nonce,
        "unknown allocation retained; explicit owner reconciliation required before any retry");
    }
    if (previous?.status === "submitted" && previous.transactionHash) {
      const replaceImmediately = this.isStale(previous)
        || (await request.shouldReplace?.(previous.transactionHash) ?? false);
      let confirmationError: unknown;
      if (!replaceImmediately) {
        try {
          await request.confirm(previous.transactionHash);
          record(
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
            record(
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
        replacementHash = await request.replace(previous.nonce, previous.transactionHash);
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
      record(
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
          record(
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
      record(
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
          && !stale.signedEnvelope
          && stale.transactionHash
          && request.shouldReplace
          && request.cancelStale
          && (this.isStale(stale) || await request.shouldReplace(stale.transactionHash))
        ) {
          assertLease();
          const cancellationHash = await request.cancelStale(latest, stale.transactionHash);
          record(
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
              record(
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
          record(
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
      // A persisted hash (or a crash during allocation) owns this nonce even when no RPC
      // accepted it: latest==pending is NOT evidence that locally signed bytes do not exist.
      this.assertNoReservedAttempt(request.chainId, request.address, request.operationId, nonce);
      record(request.chainId, request.address, request.operationId, nonce, null, "allocating", request.signedEnvelope,
        request.preparation && this.sharesStore(request.preparation.store) ? request.preparation.identity : null);
      assertLease();
      let hash: Hex;
      try {
        hash = await request.submit(nonce);
      } catch (error) {
        if (!isReplacementUnderpricedError(error)) {
          record(request.chainId, request.address, request.operationId, nonce, null, "rejected");
          throw error;
        }
        const advanced = await this.waitForNonceAdvance(request.getTransactionCount, nonce);
        if (advanced) continue;
        record(request.chainId, request.address, request.operationId, nonce, null, "rejected");
        throw new ResolverNonceStalledError(request.chainId, request.address, nonce);
      }

      record(request.chainId, request.address, request.operationId, nonce, hash, "submitted");
      try {
        await request.confirm(hash);
      } catch (error) {
        if (isRevertedTransactionError(error)) {
          record(request.chainId, request.address, request.operationId, nonce, hash, "reverted");
        }
        throw error;
      }
      record(request.chainId, request.address, request.operationId, nonce, hash, "confirmed");
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
      assertLease();
      return result;
    } catch (error) {
      assertLease();
      throw error;
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

  private sharesStore(store: Database): boolean {
    const file = (db: Database) => (db.query("PRAGMA database_list").all() as { name: string; file: string }[])
      .find(row => row.name === "main")?.file;
    const mine = file(this.database);
    return store === this.database || (!!mine && mine === file(store));
  }

  private reconcilePreparations(chainId: number, address: Hex, store: Database, ownerPrefix: string,
    assertLease: () => void): void {
    assertLease();
    if (!this.sharesStore(store)) return; // Never infer absence across separate/lost journals.
    this.database.transaction(() => {
      assertLease();
      const rows = this.database.query(
        "SELECT operation_id AS operationId, nonce, preparation_identity AS identity FROM resolver_transaction_attempts WHERE chain_id = ? AND resolver_address = ? AND status = 'allocating' AND transaction_hash IS NULL AND signed_envelope = 1 AND preparation_identity IS NOT NULL"
      ).all(chainId, normalizeAddress(address)) as { operationId: string; nonce: number; identity: string }[];
      for (const row of rows) {
        if (!row.identity.startsWith(ownerPrefix) || row.operationId.indexOf(row.identity + ":progress:") !== 0) continue;
        if (this.database.query("SELECT 1 FROM mission_signed_attempts WHERE identity = ?").get(row.identity)) continue;
        // A10-only marker proves callback has no dispatch before durable raw persistence. No
        // RPC nonce comparison, timeout, migrated/generic allocation or unknown send is cleared.
        const now = new Date(this.now()).toISOString();
        this.database.query("UPDATE resolver_transaction_attempts SET status = 'rejected', updated_at = ?, preparation_identity = NULL WHERE chain_id = ? AND resolver_address = ? AND operation_id = ?")
          .run(now, chainId, normalizeAddress(address), row.operationId);
        this.database.query("INSERT INTO resolver_transaction_audit (chain_id,resolver_address,operation_id,nonce,transaction_hash,status,created_at) VALUES (?,?,?,?,NULL,'rejected',?)")
          .run(chainId, normalizeAddress(address), row.operationId, row.nonce, now);
      }
    }).immediate();
  }

  private assertNoReservedAttempt(chainId: number, address: Hex, operationId: string, nonce: number): void {
    const owner = this.database.query(
      "SELECT operation_id FROM resolver_transaction_attempts WHERE chain_id = ? AND resolver_address = ? AND operation_id != ? AND (nonce >= ? OR signed_envelope = 1) AND status IN ('allocating','ambiguous','submitted') LIMIT 1"
    ).get(chainId, normalizeAddress(address), operationId, nonce);
    if (owner) throw new Error("durable resolver nonce reservation requires owner recovery before other writes");
  }

  private loadSubmittedAttemptAtNonce(
    chainId: number,
    address: `0x${string}`,
    nonce: number
  ): StoredAttempt | null {
    return this.database.query(`
      SELECT operation_id AS operationId, signed_envelope AS signedEnvelope, nonce, transaction_hash AS transactionHash, status,
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
    status: StoredAttempt["status"],
    signedEnvelope = false,
    preparationIdentity: string | null = null
  ): void {
    const normalizedAddress = normalizeAddress(address);
    const now = new Date(this.now()).toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.query(`
        INSERT INTO resolver_transaction_attempts (
          chain_id, resolver_address, operation_id, nonce, transaction_hash, status, updated_at, signed_envelope, preparation_identity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chain_id, resolver_address, operation_id) DO UPDATE SET
          nonce = excluded.nonce,
          transaction_hash = excluded.transaction_hash,
          status = excluded.status,
          updated_at = excluded.updated_at,
          signed_envelope = MAX(resolver_transaction_attempts.signed_envelope, excluded.signed_envelope),
          preparation_identity = excluded.preparation_identity
      `).run(chainId, normalizedAddress, operationId, nonce, transactionHash, status, now, signedEnvelope ? 1 : 0, preparationIdentity);
      this.database.query(`
        INSERT INTO resolver_transaction_audit (
          chain_id, resolver_address, operation_id, nonce, transaction_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chainId, normalizedAddress, operationId, nonce, transactionHash, status, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
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
