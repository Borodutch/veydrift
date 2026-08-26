import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Hex } from "viem";

export type ResolverTransactionRequest = {
  chainId: number;
  address: `0x${string}`;
  operationId: string;
  getTransactionCount: (blockTag: "latest" | "pending") => Promise<number>;
  submit: (nonce: number) => Promise<Hex>;
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
 * processes. SQLite stores coordination metadata only: operation labels, nonces, and public hashes;
 * private keys, calldata, randomness words, and RPC credentials never enter this database.
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
    const previous = this.loadAttempt(request.chainId, request.address, request.operationId);
    if (previous?.status === "confirmed" && previous.transactionHash) return previous.transactionHash;
    if (previous?.status === "allocating" || previous?.status === "ambiguous") {
      const [latest, pending] = await Promise.all([
        request.getTransactionCount("latest"),
        request.getTransactionCount("pending")
      ]);
      if (previous.status === "allocating" && (latest > previous.nonce || pending > previous.nonce)) {
        this.recordAttempt(
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
      this.recordAttempt(
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
          this.recordAttempt(
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
            this.recordAttempt(
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
      this.recordAttempt(
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
          this.recordAttempt(
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
      this.recordAttempt(
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
          const cancellationHash = await request.cancelStale(latest, stale.transactionHash);
          this.recordAttempt(
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
              this.recordAttempt(
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
          this.recordAttempt(
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
      this.recordAttempt(request.chainId, request.address, request.operationId, nonce, null, "allocating");
      assertLease();
      let hash: Hex;
      try {
        hash = await request.submit(nonce);
      } catch (error) {
        if (!isReplacementUnderpricedError(error)) {
          this.recordAttempt(request.chainId, request.address, request.operationId, nonce, null, "rejected");
          throw error;
        }
        const advanced = await this.waitForNonceAdvance(request.getTransactionCount, nonce);
        if (advanced) continue;
        this.recordAttempt(request.chainId, request.address, request.operationId, nonce, null, "rejected");
        throw new ResolverNonceStalledError(request.chainId, request.address, nonce);
      }

      this.recordAttempt(request.chainId, request.address, request.operationId, nonce, hash, "submitted");
      try {
        await request.confirm(hash);
      } catch (error) {
        if (isRevertedTransactionError(error)) {
          this.recordAttempt(request.chainId, request.address, request.operationId, nonce, hash, "reverted");
        }
        throw error;
      }
      this.recordAttempt(request.chainId, request.address, request.operationId, nonce, hash, "confirmed");
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
    this.database.exec("BEGIN IMMEDIATE;");
    try {
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
