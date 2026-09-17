import { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { safeDiagnosticText } from "./safeDiagnostics";

export type Address = string;

export type RandomnessRequestEvent = {
  requestId: string;
  requester: Address;
  purposeHash: string;
  createdAt: number;
  transactionHash?: string;
  /**
   * The precommit value stored on the request when it consumed the pending commitment.
   * Empty/zero in fulfill-only (precommitRequired == false) deployments. In precommit mode the
   * committer must reveal the exact word whose `randomnessCommitment(word)` equals this value.
   */
  randomnessCommitment?: string;
};

export type RandomnessRequestCandidates = {
  highestIndexedRequestId: string;
  pendingRequestIds: string[];
};

export interface RandomnessRequestCandidateSource {
  randomnessRequestCandidates(): RandomnessRequestCandidates | Promise<RandomnessRequestCandidates>;
}

export type RandomnessFulfillmentRecord = RandomnessRequestEvent & {
  fulfilledAt: string;
  randomWord: string;
  transactionHash: string;
};

export type RandomnessFailureRecord = RandomnessRequestEvent & {
  failedAt: string;
  error: string;
};

export type RandomnessOperationalStatus = {
  pending: number;
  oldestPendingAgeSeconds: number | null;
  fulfilled: number;
  failed: number;
  lastFulfilledAt: string | null;
  alerts: string[];
};

export interface RandomnessChainClient {
  listPendingRequests(): Promise<RandomnessRequestEvent[]>;
  fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string>;
}

export type RandomnessWorkerOptions = {
  maxPendingAgeSeconds?: number;
  now?: () => Date;
  randomWord?: () => bigint;
  targetCommitments?: number;
};

const uint256Bytes = 32;
const defaultMaxPendingAgeSeconds = 5 * 60;
const defaultTargetCommitments = 8;
const maximumCommitmentInventory = 16;

export class RandomnessFulfillmentWorker {
  private readonly failures: RandomnessFailureRecord[] = [];
  private readonly fulfilled: RandomnessFulfillmentRecord[] = [];

  constructor(
    private readonly chainClient: RandomnessChainClient,
    private readonly options: RandomnessWorkerOptions = {}
  ) {}

  async tick(): Promise<RandomnessOperationalStatus> {
    const pending = await this.chainClient.listPendingRequests();
    const stillPending: RandomnessRequestEvent[] = [];

    for (const request of pending) {
      try {
        const randomWord = this.randomWord();
        const txHash = await this.chainClient.fulfillRandomness(
          BigInt(request.requestId),
          randomWord
        );
        this.fulfilled.push({
          ...request,
          fulfilledAt: this.now().toISOString(),
          randomWord: randomWord.toString(),
          transactionHash: txHash
        });
      } catch (error) {
        stillPending.push(request);
        this.failures.push({
          ...request,
          failedAt: this.now().toISOString(),
          error: safeDiagnosticText(error)
        });
      }
    }

    return this.status(stillPending);
  }

  status(pendingRequests: RandomnessRequestEvent[] = []): RandomnessOperationalStatus {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const pendingAges = pendingRequests.map((request) =>
      Math.max(nowSeconds - request.createdAt, 0)
    );
    const oldestPendingAgeSeconds = pendingAges.length > 0 ? Math.max(...pendingAges) : null;
    const alerts: string[] = [];
    const maxPendingAgeSeconds = this.options.maxPendingAgeSeconds ?? defaultMaxPendingAgeSeconds;

    if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > maxPendingAgeSeconds) {
      alerts.push(
        "oldest randomness request has been pending for " + oldestPendingAgeSeconds + "s"
      );
    }
    if (this.failures.length > 0) {
      const lastFailure = this.failures[this.failures.length - 1]!;
      alerts.push(
        "last randomness fulfillment failed for request " +
          lastFailure.requestId +
          ": " +
          lastFailure.error
      );
    }

    return {
      pending: pendingRequests.length,
      oldestPendingAgeSeconds,
      fulfilled: this.fulfilled.length,
      failed: this.failures.length,
      lastFulfilledAt: this.fulfilled[this.fulfilled.length - 1]?.fulfilledAt ?? null,
      alerts
    };
  }

  fulfillmentHistory(): RandomnessFulfillmentRecord[] {
    return [...this.fulfilled];
  }

  failureHistory(): RandomnessFailureRecord[] {
    return [...this.failures];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private randomWord(): bigint {
    return this.options.randomWord?.() ?? secureRandomUint256();
  }
}

export function secureRandomUint256(): bigint {
  const bytes = randomBytes(uint256Bytes);
  let hex = bytes.toString("hex");
  if (/^0+$/.test(hex)) {
    hex = "1" + hex.slice(1);
  }
  return BigInt("0x" + hex);
}

const zeroCommitment = "0x" + "0".repeat(64);

/**
 * A committer-side secret. `word` is the uint256 the fulfiller revealed-to-be; `commitment` is the
 * on-chain `randomnessCommitment(word)`. The pair must survive restarts so a consumed commitment can
 * always be revealed (losing it permanently bricks every request that consumed it).
 */
export type RandomnessCommitmentRecord = {
  commitment: string;
  word: string;
  committedAtBlock: number | null;
  createdAt: string;
};

/** Durable retry metadata and, when known, the secret protected from legacy commitment saves. */
export type RandomnessPendingReveal = {
  request: RandomnessRequestEvent;
  record?: RandomnessCommitmentRecord;
};

/**
 * Public, non-secret health snapshot produced by the single committer. Reader processes and the
 * frontend use it to fail closed before creating a randomness-consuming attack while a commitment
 * mapping is unsafe. The reveal words never leave the transactional store.
 */
export type RandomnessReadinessSnapshot = {
  ready: boolean;
  reasons: string[];
  updatedAt: string;
};

export function randomnessReadinessPath(commitmentStorePath: string): string {
  return commitmentStorePath + ".readiness.json";
}

export function loadRandomnessReadinessSnapshot(
  commitmentStorePath: string
): RandomnessReadinessSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(randomnessReadinessPath(commitmentStorePath), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Partial<RandomnessReadinessSnapshot>;
    if (typeof value.ready !== "boolean" || typeof value.updatedAt !== "string" || !Array.isArray(value.reasons)) {
      return null;
    }
    if (!value.reasons.every((reason) => typeof reason === "string")) return null;
    return {
      ready: value.ready,
      reasons: value.reasons,
      updatedAt: value.updatedAt
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export function saveRandomnessReadinessSnapshot(
  commitmentStorePath: string,
  snapshot: RandomnessReadinessSnapshot
): void {
  const path = randomnessReadinessPath(commitmentStorePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = path + ".tmp";
  writeFileSync(tempPath, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, path);
  chmodSync(path, 0o600);
}

/** Persistence boundary for unrevealed commitment secrets. Injectable so it can be file- or db-backed. */
export interface RandomnessCommitmentStore {
  load(): RandomnessCommitmentRecord[] | Promise<RandomnessCommitmentRecord[]>;
  save(records: RandomnessCommitmentRecord[]): void | Promise<void>;
  loadReveals(): RandomnessPendingReveal[] | Promise<RandomnessPendingReveal[]>;
  saveReveals(reveals: RandomnessPendingReveal[]): void | Promise<void>;
  withExclusiveLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export class InMemoryRandomnessCommitmentStore implements RandomnessCommitmentStore {
  private records: RandomnessCommitmentRecord[];
  private reveals: RandomnessPendingReveal[] = [];

  constructor(initial: RandomnessCommitmentRecord[] = []) {
    this.records = initial.map((record) => ({ ...record }));
  }

  load(): RandomnessCommitmentRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  save(records: RandomnessCommitmentRecord[]): void {
    this.records = records.map((record) => ({ ...record }));
  }

  loadReveals(): RandomnessPendingReveal[] {
    return structuredClone(this.reveals);
  }

  saveReveals(reveals: RandomnessPendingReveal[]): void {
    this.reveals = structuredClone(reveals);
  }
}

/**
 * File-backed persistence for production. Writes atomically (temp file + rename) so a crash mid-write
 * cannot corrupt the secret store, and tolerates a missing file on first run. A filesystem lock
 * serializes the full read/chain-write/save cycle across start-first rolling replicas.
 */
export class FileRandomnessCommitmentStore implements RandomnessCommitmentStore {
  private readonly lockPath: string;

  constructor(private readonly filePath: string) {
    this.lockPath = filePath + ".lock";
  }

  load(): RandomnessCommitmentRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const trimmed = raw.trim();
    if (trimmed === "") return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as RandomnessCommitmentRecord[]) : [];
  }

  save(records: RandomnessCommitmentRecord[]): void {
    this.writeRecords(this.filePath, records);
  }

  loadReveals(): RandomnessPendingReveal[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath + ".reveals.json", "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("randomness pending reveal journal is not an array");
    return parsed as RandomnessPendingReveal[];
  }

  saveReveals(reveals: RandomnessPendingReveal[]): void {
    // The same full-cycle lock protects both files; old replicas never write this journal.
    this.writeRecords(this.filePath + ".reveals.json", reveals);
  }

  private writeRecords(path: string, records: unknown[]): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = path + ".tmp";
    writeFileSync(tempPath, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  }

  async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireLock();
    const heartbeatPath = join(this.lockPath, "heartbeat");
    const writeHeartbeat = () => writeFileSync(heartbeatPath, Date.now().toString(), "utf8");
    writeHeartbeat();
    const heartbeat = setInterval(writeHeartbeat, 5_000);
    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
      rmSync(this.lockPath, { recursive: true, force: true });
    }
  }

  private async acquireLock(): Promise<void> {
    const startedAt = Date.now();
    const lockWaitTimeoutMs = 60_000;
    const staleLockAgeMs = 30_000;

    while (true) {
      try {
        mkdirSync(dirname(this.lockPath), { recursive: true });
        mkdirSync(this.lockPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;

        try {
          const heartbeatPath = join(this.lockPath, "heartbeat");
          const ageMs = Date.now() - statSync(heartbeatPath).mtimeMs;
          if (ageMs > staleLockAgeMs) {
            rmSync(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          const statCode = (statError as NodeJS.ErrnoException).code;
          if (statCode !== "ENOENT") throw statError;
          const ageMs = Date.now() - statSync(this.lockPath).mtimeMs;
          if (ageMs > staleLockAgeMs) {
            rmSync(this.lockPath, { recursive: true, force: true });
            continue;
          }
        }

        if (Date.now() - startedAt >= lockWaitTimeoutMs) {
          throw new Error(
            "timed out waiting for exclusive randomness commitment store lock " + this.lockPath
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
}

/**
 * Transactional production store for unrevealed words. The worker holds a renewable SQLite lease
 * for its complete read/chain-write/save cycle, so a rolling replica cannot overwrite another
 * replica's committed secrets. The audit contains commitments and state transitions only—never words.
 */
export class SqliteRandomnessCommitmentStore implements RandomnessCommitmentStore {
  private readonly database: Database;

  constructor(
    private readonly databasePath: string,
    legacyFilePath?: string
  ) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.database = new Database(databasePath);
    chmodSync(databasePath, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = FULL;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS randomness_commitments (
        commitment TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        committed_at_block INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS randomness_pending_reveals (
        request_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS randomness_committer_lease (
        lease_id INTEGER PRIMARY KEY CHECK (lease_id = 1),
        holder TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS randomness_commitment_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        commitment TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.migrateLegacyFile(legacyFilePath);
  }

  load(): RandomnessCommitmentRecord[] {
    return this.database.query(`
      SELECT commitment, word, committed_at_block AS committedAtBlock, created_at AS createdAt
      FROM randomness_commitments
      ORDER BY created_at ASC, commitment ASC
    `).all() as RandomnessCommitmentRecord[];
  }

  loadReveals(): RandomnessPendingReveal[] {
    return (this.database.query(
      "SELECT payload FROM randomness_pending_reveals ORDER BY request_id"
    ).all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as RandomnessPendingReveal);
  }

  saveReveals(reveals: RandomnessPendingReveal[]): void {
    // No foreign key/cascade into the legacy table: its old DELETE+INSERT saves cannot erase
    // either retry metadata or the retained reveal word during a start-first rolling deployment.
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.query("DELETE FROM randomness_pending_reveals").run();
      const insert = this.database.query("INSERT INTO randomness_pending_reveals (request_id, payload) VALUES (?, ?)");
      for (const reveal of reveals) insert.run(reveal.request.requestId, JSON.stringify(reveal));
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  save(records: RandomnessCommitmentRecord[]): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.database.query(`
        SELECT commitment, committed_at_block AS committedAtBlock
        FROM randomness_commitments
      `).all() as Array<Pick<RandomnessCommitmentRecord, "commitment" | "committedAtBlock">>;
      const existingByCommitment = new Map(existing.map((record) => [record.commitment, record]));
      const nextByCommitment = new Map(records.map((record) => [record.commitment, record]));
      this.database.query("DELETE FROM randomness_commitments").run();
      const insert = this.database.query(`
        INSERT INTO randomness_commitments (commitment, word, committed_at_block, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const record of records) {
        insert.run(record.commitment, record.word, record.committedAtBlock, record.createdAt);
      }
      const audit = this.database.query(`
        INSERT INTO randomness_commitment_audit (action, commitment, created_at)
        VALUES (?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const record of records) {
        const previous = existingByCommitment.get(record.commitment);
        if (!previous) {
          audit.run("record_added", record.commitment, now);
        } else if (previous.committedAtBlock !== record.committedAtBlock) {
          audit.run("commitment_state_changed", record.commitment, now);
        }
      }
      for (const record of existing) {
        if (!nextByCommitment.has(record.commitment)) {
          audit.run("record_removed", record.commitment, now);
        }
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const holder = randomUUID();
    await this.acquireLease(holder);
    const renew = setInterval(() => this.renewLease(holder), 15_000);
    try {
      return await operation();
    } finally {
      clearInterval(renew);
      this.database.query("DELETE FROM randomness_committer_lease WHERE lease_id = 1 AND holder = ?").run(holder);
    }
  }

  private migrateLegacyFile(legacyFilePath: string | undefined): void {
    const existing = this.database.query("SELECT COUNT(*) AS count FROM randomness_commitments").get() as { count: number };
    if (existing.count > 0 || !legacyFilePath || !existsSync(legacyFilePath)) return;
    const parsed = JSON.parse(readFileSync(legacyFilePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("legacy randomness commitment store is not an array");
    this.save(parsed as RandomnessCommitmentRecord[]);
    this.database.query(`
      INSERT INTO randomness_commitment_audit (action, commitment, created_at)
      VALUES (?, NULL, ?)
    `).run("legacy_json_migrated", new Date().toISOString());
  }

  private async acquireLease(holder: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (true) {
      const now = Date.now();
      const result = this.database.query(`
        INSERT INTO randomness_committer_lease (lease_id, holder, expires_at_ms)
        VALUES (1, ?, ?)
        ON CONFLICT(lease_id) DO UPDATE SET
          holder = excluded.holder,
          expires_at_ms = excluded.expires_at_ms
        WHERE randomness_committer_lease.expires_at_ms <= ?
      `).run(holder, now + 90_000, now) as { changes: number };
      if (result.changes > 0) return;
      if (now >= deadline) {
        throw new Error(`timed out waiting for transactional randomness committer lease ${this.databasePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private renewLease(holder: string): void {
    const result = this.database.query(`
      UPDATE randomness_committer_lease
      SET expires_at_ms = ?
      WHERE lease_id = 1 AND holder = ?
    `).run(Date.now() + 90_000, holder) as { changes: number };
    if (result.changes !== 1) {
      throw new Error("randomness committer lease was lost before the current cycle completed");
    }
  }
}

export type RandomnessPendingCommitment = {
  commitment: string;
  committedAtBlock: number;
};

export type RandomnessCommitmentInventory = {
  commitments: RandomnessPendingCommitment[];
  readyCommitments: number;
};

/**
 * Chain client for the full precommit lifecycle (commit -> wait a block -> consume -> reveal ->
 * recommit). Extends the read/fulfill surface of {@link RandomnessChainClient} with the commit-side
 * reads and writes a hardened deployment needs.
 */
export interface RandomnessCommitmentChainClient {
  getBlockNumber(): Promise<number>;
  getCommitmentInventory(): Promise<RandomnessCommitmentInventory>;
  computeCommitment(randomWord: bigint): Promise<string>;
  commitRandomnessBatch(commitments: string[]): Promise<string>;
  listPendingRequests(): Promise<RandomnessRequestEvent[]>;
  /** Null means unknown/unfulfilled, never proof that a missing candidate is terminal. */
  getRequestFulfillment(requestId: bigint, blockTag: "latest" | "finalized"): Promise<{
    randomnessCommitment: string;
    randomWord: string;
  } | null>;
  fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string>;
}

export type RandomnessCommitmentStatus = {
  pendingRequests: number;
  oldestPendingRequestAgeSeconds: number | null;
  fulfilled: number;
  failed: number;
  lastFulfilledAt: string | null;
  pendingCommitmentAvailable: boolean;
  pendingCommitmentAgeBlocks: number | null;
  commitmentInventory: number;
  readyCommitments: number;
  targetCommitments: number;
  trackedCommitments: number;
  readinessReasons: string[];
  alerts: string[];
};

function normalizeCommitment(commitment: string): string {
  return commitment.trim().toLowerCase();
}

function isZeroCommitment(commitment: string | undefined): boolean {
  if (!commitment) return true;
  const normalized = normalizeCommitment(commitment);
  return normalized === zeroCommitment || /^0x0*$/.test(normalized);
}

/**
 * Runs the documented Fulfiller Runbook commit side. Each tick:
 *  1. refills the bounded on-chain inventory before doing any fulfillment work;
 *  2. reveals requests that consumed tracked commitments;
 *  3. surfaces operational alerts (low inventory, stale requests, unknown on-chain
 *     commitment, commit failures).
 */
export class RandomnessCommitmentWorker {
  private readonly failures: RandomnessFailureRecord[] = [];
  private readonly fulfilled: RandomnessFulfillmentRecord[] = [];
  private lastCommitError: string | null = null;
  private missingRevealMappings: string[] = [];
  private cleanupCursor = 0;

  constructor(
    private readonly chainClient: RandomnessCommitmentChainClient,
    private readonly store: RandomnessCommitmentStore,
    private readonly options: RandomnessWorkerOptions = {}
  ) {}

  async tick(): Promise<RandomnessCommitmentStatus> {
    const run = () => this.tickWithFreshStore();
    return this.store.withExclusiveLock ? this.store.withExclusiveLock(run) : run();
  }

  private async tickWithFreshStore(): Promise<RandomnessCommitmentStatus> {
    // Never retain an in-memory snapshot across ticks. During a start-first rollout, the replica
    // holding the lock may change; each lock holder must begin from the latest durable secrets.
    const loaded = await this.store.load();
    const reveals = await this.store.loadReveals();
    // A legacy replica may have deleted/reinserted the entire commitment table after a shallow
    // receipt. The separate journal keeps both the retry identity and the original word intact.
    const records = [...new Map([
      ...loaded.map((record) => [record.commitment, { ...record }] as const),
      ...reveals.flatMap(({ record }) => record ? [[record.commitment, { ...record }] as const] : [])
    ]).values()];
    const blockNumber = await this.chainClient.getBlockNumber();

    const targetCommitments = Math.min(
      Math.max(this.options.targetCommitments ?? defaultTargetCommitments, 1),
      maximumCommitmentInventory
    );
    let inventory = await this.chainClient.getCommitmentInventory();
    this.reconcileInventoryRecords(records, inventory);
    if (inventory.commitments.length < targetCommitments) {
      await this.commitNextWords(
        records,
        blockNumber,
        targetCommitments - inventory.commitments.length
      );
      inventory = await this.chainClient.getCommitmentInventory();
      this.reconcileInventoryRecords(records, inventory);
    }

    const discovered = await this.chainClient.listPendingRequests();
    // Discovery is only a source of new candidates, never the lifecycle/retry authority.
    const pending = [...new Map([
      ...reveals.map(({ request }) => [request.requestId, request] as const),
      ...this.failures.map((request) => [request.requestId, request] as const),
      ...discovered.map((request) => [request.requestId, request] as const)
    ]).values()];
    const stillPending = await this.revealConsumedCommitments(pending, records, reveals);
    const finalized = await this.pruneFinalizedRecords(records, reveals);

    // Remove primary secrets before retiring their journal copies. A crash between saves retains
    // the journal and safely repeats reconciliation, never loses an unresolved reveal.
    await this.store.save(records);
    await this.store.saveReveals(reveals);

    const front = inventory.commitments[0];

    return this.status({
      pendingRequests: stillPending.filter((request) => !finalized.has(request.requestId)),
      pendingCommitmentAvailable: inventory.readyCommitments > 0,
      pendingCommitmentAgeBlocks: front ? Math.max(blockNumber - front.committedAtBlock, 0) : null,
      commitmentInventory: inventory.commitments.length,
      readyCommitments: inventory.readyCommitments,
      targetCommitments,
      trackedCommitments: records.length
    });
  }

  private async revealConsumedCommitments(
    pending: RandomnessRequestEvent[],
    records: RandomnessCommitmentRecord[],
    reveals: RandomnessPendingReveal[]
  ): Promise<RandomnessRequestEvent[]> {
    const stillPending: RandomnessRequestEvent[] = [];

    for (const request of pending) {
      const record = records.find((entry) => entry.commitment === normalizeCommitment(request.randomnessCommitment ?? ""));
      const reveal = { request: { ...request }, ...(record ? { record: { ...record } } : {}) };
      const index = reveals.findIndex((entry) => entry.request.requestId === request.requestId);
      if (index < 0) reveals.push(reveal);
      else reveals[index] = reveal;
    }
    // Checkpoint every observed request (including missing-word/fulfill-only cases) in one write
    // before any reveal. Failure aborts the tick without broadcasting or discarding retry state.
    await this.store.saveReveals(reveals);

    for (const request of pending) {
      try {
        if (await this.reconcileFulfilledRequest(request.requestId)) continue;
        const word = this.resolveRevealWord(request, records);
        const txHash = await this.chainClient.fulfillRandomness(BigInt(request.requestId), word);
        if (!this.fulfilled.some((entry) => entry.requestId === request.requestId)) this.fulfilled.push({
          ...request,
          fulfilledAt: this.now().toISOString(),
          randomWord: word.toString(),
          transactionHash: txHash
        });
        // A receipt (including one reused by the coordinator) is not terminal proof.
        if (!await this.reconcileFulfilledRequest(request.requestId)) {
          throw new Error("randomness fulfillment is not yet authoritative for request " + request.requestId);
        }
      } catch (error) {
        // A duplicate/retry may have won between read and write. Revert text alone is not proof;
        // failed RPC reads must preserve the failure and durable reveal secret too.
        if (await this.reconcileFulfilledRequest(request.requestId).catch(() => false)) continue;
        stillPending.push(request);
        this.upsertFailure({
          ...request,
          failedAt: this.now().toISOString(),
          error: safeDiagnosticText(error)
        });
      }
    }

    return stillPending;
  }

  private async reconcileFulfilledRequest(requestId: string): Promise<boolean> {
    if (!await this.chainClient.getRequestFulfillment(BigInt(requestId), "latest")) return false;
    this.clearFailure(requestId);
    return true;
  }

  private async pruneFinalizedRecords(
    records: RandomnessCommitmentRecord[],
    reveals: RandomnessPendingReveal[]
  ): Promise<Set<string>> {
    // Finality can lag latest by many minutes. Bound GC reads per tick; never downgrade proof.
    const finalized = new Set<string>();
    const batch = Array.from({ length: Math.min(8, reveals.length) }, (_, index) =>
      reveals[(this.cleanupCursor + index) % reveals.length]!
    );
    this.cleanupCursor = reveals.length ? (this.cleanupCursor + batch.length) % reveals.length : 0;
    for (const { request, record } of batch) {
      const fulfillment = await this.chainClient.getRequestFulfillment(
        BigInt(request.requestId), "finalized"
      ).catch(() => null);
      if (fulfillment && (!record || (
        normalizeCommitment(fulfillment.randomnessCommitment) === record.commitment
        && fulfillment.randomWord === record.word
      ))) {
        if (record) this.dropRecord(records, record.commitment);
        reveals.splice(reveals.findIndex((entry) => entry.request.requestId === request.requestId), 1);
        this.clearFailure(request.requestId);
        finalized.add(request.requestId);
      }
    }
    return finalized;
  }

  private upsertFailure(failure: RandomnessFailureRecord): void {
    const existingIndex = this.failures.findIndex((entry) => entry.requestId === failure.requestId);
    if (existingIndex >= 0) {
      this.failures[existingIndex] = failure;
    } else {
      this.failures.push(failure);
    }
  }

  private clearFailure(requestId: string): void {
    const existingIndex = this.failures.findIndex((entry) => entry.requestId === requestId);
    if (existingIndex >= 0) {
      this.failures.splice(existingIndex, 1);
    }
  }

  private resolveRevealWord(
    request: RandomnessRequestEvent,
    records: RandomnessCommitmentRecord[]
  ): bigint {
    if (isZeroCommitment(request.randomnessCommitment)) {
      // Fulfill-only deployment: no commitment was stored, so any secure word is valid.
      return this.randomWord();
    }

    const commitment = normalizeCommitment(request.randomnessCommitment!);
    const record = records.find((entry) => entry.commitment === commitment);
    if (!record) {
      throw new Error(
        "no tracked random word for commitment " + commitment + " on request " + request.requestId
      );
    }

    return BigInt(record.word);
  }

  private async commitNextWords(
    records: RandomnessCommitmentRecord[],
    blockNumber: number,
    quantity: number
  ): Promise<void> {
    try {
      const staged = records
        .filter((record) => record.committedAtBlock === null)
        .slice(0, quantity);
      while (staged.length < quantity) {
        const word = this.randomWord();
        const commitment = normalizeCommitment(await this.chainClient.computeCommitment(word));
        if (records.some((record) => record.commitment === commitment)) continue;
        const record: RandomnessCommitmentRecord = {
          commitment,
          word: word.toString(),
          committedAtBlock: null,
          createdAt: this.now().toISOString()
        };
        records.push(record);
        staged.push(record);
      }

      // Persist every reveal secret before broadcasting the batch.
      await this.store.save(records);

      await this.chainClient.commitRandomnessBatch(staged.map((record) => record.commitment));
      for (const record of staged) record.committedAtBlock = blockNumber;
      this.lastCommitError = null;
    } catch (error) {
      const message = safeDiagnosticText(error);
      this.lastCommitError = "failed to refill randomness commitment inventory: " + message;
    }
  }

  private reconcileInventoryRecords(
    records: RandomnessCommitmentRecord[],
    inventory: RandomnessCommitmentInventory
  ): void {
    const unknown: string[] = [];
    for (const onChain of inventory.commitments) {
      const normalized = normalizeCommitment(onChain.commitment);
      const record = records.find((entry) => entry.commitment === normalized);
      if (record) {
        record.committedAtBlock = onChain.committedAtBlock;
      } else {
        unknown.push(normalized);
      }
    }
    this.missingRevealMappings = unknown;
  }

  private dropRecord(records: RandomnessCommitmentRecord[], commitment: string | undefined): void {
    if (isZeroCommitment(commitment)) return;
    const normalized = normalizeCommitment(commitment!);
    const index = records.findIndex((record) => record.commitment === normalized);
    if (index >= 0) {
      records.splice(index, 1);
    }
  }

  status(input: {
    pendingRequests: RandomnessRequestEvent[];
    pendingCommitmentAvailable: boolean;
    pendingCommitmentAgeBlocks: number | null;
    commitmentInventory: number;
    readyCommitments: number;
    targetCommitments: number;
    trackedCommitments: number;
  }): RandomnessCommitmentStatus {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const pendingAges = input.pendingRequests.map((request) =>
      Math.max(nowSeconds - request.createdAt, 0)
    );
    const oldestPendingRequestAgeSeconds = pendingAges.length > 0 ? Math.max(...pendingAges) : null;
    const maxPendingAgeSeconds = this.options.maxPendingAgeSeconds ?? defaultMaxPendingAgeSeconds;
    const alerts: string[] = [];
    const readinessReasons: string[] = [];

    if (!input.pendingCommitmentAvailable) {
      alerts.push(
        "no block-activated randomness commitment available; randomness-consuming actions will revert"
      );
      readinessReasons.push(
        "Randomness commitments are activating. New attacks are temporarily paused."
      );
    }
    if (input.commitmentInventory < input.targetCommitments) {
      alerts.push(
        "randomness commitment inventory below target: " +
          input.commitmentInventory +
          "/" +
          input.targetCommitments
      );
    }
    if (
      oldestPendingRequestAgeSeconds !== null &&
      oldestPendingRequestAgeSeconds > maxPendingAgeSeconds
    ) {
      alerts.push(
        "oldest randomness request has been pending for " + oldestPendingRequestAgeSeconds + "s"
      );
    }
    if (this.lastCommitError) {
      alerts.push(this.lastCommitError);
    }
    if (this.missingRevealMappings.length > 0) {
      alerts.push(
        "on-chain randomness commitments have no tracked reveal words: " +
          this.missingRevealMappings.join(", ")
      );
      readinessReasons.push(
        "A required randomness reveal mapping is unavailable. New attacks are temporarily paused."
      );
    }
    if (this.failures.length > 0) {
      const lastFailure = this.failures[this.failures.length - 1]!;
      alerts.push(
        "last randomness fulfillment failed for request " +
          lastFailure.requestId +
          ": " +
          lastFailure.error
      );
      if (this.failures.some((failure) => failure.error.includes("no tracked random word"))) {
        readinessReasons.push(
          "A required randomness reveal mapping is unavailable. New attacks are temporarily paused."
        );
      }
      readinessReasons.push(
        "A randomness fulfillment has not been confirmed. New attacks are temporarily paused."
      );
    }

    return {
      pendingRequests: input.pendingRequests.length,
      oldestPendingRequestAgeSeconds,
      fulfilled: this.fulfilled.length,
      failed: this.failures.length,
      lastFulfilledAt: this.fulfilled[this.fulfilled.length - 1]?.fulfilledAt ?? null,
      pendingCommitmentAvailable: input.pendingCommitmentAvailable,
      pendingCommitmentAgeBlocks: input.pendingCommitmentAgeBlocks,
      commitmentInventory: input.commitmentInventory,
      readyCommitments: input.readyCommitments,
      targetCommitments: input.targetCommitments,
      trackedCommitments: input.trackedCommitments,
      readinessReasons: [...new Set(readinessReasons)],
      alerts
    };
  }

  fulfillmentHistory(): RandomnessFulfillmentRecord[] {
    return [...this.fulfilled];
  }

  failureHistory(): RandomnessFailureRecord[] {
    return [...this.failures];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private randomWord(): bigint {
    return this.options.randomWord?.() ?? secureRandomUint256();
  }
}
