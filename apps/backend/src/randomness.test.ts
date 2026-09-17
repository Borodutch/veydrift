import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileRandomnessCommitmentStore,
  InMemoryRandomnessCommitmentStore,
  loadRandomnessReadinessSnapshot,
  randomnessReadinessPath,
  saveRandomnessReadinessSnapshot,
  SqliteRandomnessCommitmentStore,
  RandomnessCommitmentWorker,
  RandomnessFulfillmentWorker,
  secureRandomUint256,
  type RandomnessChainClient,
  type RandomnessCommitmentChainClient,
  type RandomnessCommitmentInventory,
  type RandomnessRequestEvent
} from "./randomness";

const request: RandomnessRequestEvent = {
  requestId: "42",
  requester: "0x1111111111111111111111111111111111111111",
  purposeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  createdAt: 1000
};

describe("Randomness fulfillment worker", () => {
  test("fulfills pending requests with secure uint256 words", async () => {
    const fulfilled: Array<{ requestId: bigint; randomWord: bigint }> = [];
    const client: RandomnessChainClient = {
      async listPendingRequests() {
        return [request];
      },
      async fulfillRandomness(requestId, randomWord) {
        fulfilled.push({ requestId, randomWord });
        return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      }
    };
    const worker = new RandomnessFulfillmentWorker(client, {
      now: () => new Date(1_060_000),
      randomWord: () => 777n
    });

    const status = await worker.tick();

    expect(fulfilled).toEqual([{ requestId: 42n, randomWord: 777n }]);
    expect(status.pending).toBe(0);
    expect(status.fulfilled).toBe(1);
    expect(status.failed).toBe(0);
    expect(status.alerts).toEqual([]);
    expect(worker.fulfillmentHistory()[0]?.randomWord).toBe("777");
  });

  test("records failures and pending-age alerts without inventing fallback randomness", async () => {
    const client: RandomnessChainClient = {
      async listPendingRequests() {
        return [request];
      },
      async fulfillRandomness() {
        throw new Error("oracle wallet has no gas");
      }
    };
    const worker = new RandomnessFulfillmentWorker(client, {
      maxPendingAgeSeconds: 30,
      now: () => new Date(1_060_000),
      randomWord: () => 888n
    });

    const status = await worker.tick();

    expect(status.fulfilled).toBe(0);
    expect(status.failed).toBe(1);
    expect(status.pending).toBe(1);
    expect(status.oldestPendingAgeSeconds).toBe(60);
    expect(status.alerts).toEqual([
      "oldest randomness request has been pending for 60s",
      "last randomness fulfillment failed for request 42: oracle wallet has no gas"
    ]);
  });

  test("secureRandomUint256 returns a non-zero uint256", () => {
    const word = secureRandomUint256();
    expect(word).toBeGreaterThan(0n);
    expect(word).toBeLessThan(1n << 256n);
  });
});

describe("Randomness readiness snapshot", () => {
  test("writes a non-secret fail-closed readiness snapshot with owner-only permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-randomness-readiness-"));
    const storePath = join(dir, "commitments.sqlite");
    try {
      saveRandomnessReadinessSnapshot(storePath, {
        ready: false,
        reasons: ["A required randomness reveal mapping is unavailable. New attacks are temporarily paused."],
        updatedAt: "2026-07-29T16:00:00.000Z"
      });
      expect(loadRandomnessReadinessSnapshot(storePath)).toEqual({
        ready: false,
        reasons: ["A required randomness reveal mapping is unavailable. New attacks are temporarily paused."],
        updatedAt: "2026-07-29T16:00:00.000Z"
      });
      expect(statSync(randomnessReadinessPath(storePath)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const zeroCommitment = "0x" + "0".repeat(64);

/** Deterministic, reversible stand-in for `randomnessCommitment(word)` so tests can assert mapping. */
function fakeCommitment(word: bigint): string {
  return "0x" + word.toString(16).padStart(64, "0");
}

/**
 * Minimal in-memory model of RandomnessEngine's FIFO inventory, one-block activation delay, and
 * reveal-must-match-commitment behavior.
 */
class FakeRandomnessEngine implements RandomnessCommitmentChainClient {
  block = 1;
  inventory: RandomnessCommitmentInventory["commitments"] = [];
  failCommit = false;
  staleFulfillmentReads = false;
  finalized = true;
  fulfillmentReadError = false;
  fulfillError: string | null = null;
  fulfillCalls = 0;
  commits: string[] = [];
  private readonly requests = new Map<
    string,
    {
      commitment: string;
      createdAt: number;
      fulfilled: boolean;
      revealedWord?: bigint;
    }
  >();

  async getBlockNumber(): Promise<number> {
    return this.block;
  }

  get pendingCommitment(): string {
    return this.inventory[0]?.commitment ?? zeroCommitment;
  }

  set pendingCommitment(commitment: string) {
    if (commitment === zeroCommitment) this.inventory = [];
    else this.inventory = [{ commitment, committedAtBlock: this.pendingCommitmentBlock }];
  }

  get pendingCommitmentBlock(): number {
    return this.inventory[0]?.committedAtBlock ?? 0;
  }

  set pendingCommitmentBlock(committedAtBlock: number) {
    if (this.inventory[0]) this.inventory[0].committedAtBlock = committedAtBlock;
  }

  async getCommitmentInventory(): Promise<RandomnessCommitmentInventory> {
    return {
      commitments: this.inventory.map((entry) => ({ ...entry })),
      readyCommitments: this.inventory.filter((entry) => this.block > entry.committedAtBlock).length
    };
  }

  async computeCommitment(randomWord: bigint): Promise<string> {
    return fakeCommitment(randomWord);
  }

  async commitRandomnessBatch(commitments: string[]): Promise<string> {
    if (this.failCommit) {
      throw new Error("oracle wallet has no gas");
    }
    this.inventory.push(
      ...commitments.map((commitment) => ({
        commitment,
        committedAtBlock: this.block
      }))
    );
    this.commits.push(...commitments);
    return "0xcommit";
  }

  async listPendingRequests(): Promise<RandomnessRequestEvent[]> {
    return [...this.requests.entries()]
      .filter(([, request]) => !request.fulfilled)
      .map(([requestId, request]) => ({
        requestId,
        requester: "0x1111111111111111111111111111111111111111",
        purposeHash: "0xaaaa",
        createdAt: request.createdAt,
        randomnessCommitment: request.commitment
      }));
  }

  async getRequestFulfillment(requestId: bigint, blockTag: "latest" | "finalized") {
    if (this.fulfillmentReadError) throw new Error("request RPC unavailable");
    if (this.staleFulfillmentReads || (blockTag === "finalized" && !this.finalized)) return null;
    const request = this.requests.get(requestId.toString());
    return request?.fulfilled && request.revealedWord
      ? { randomnessCommitment: request.commitment, randomWord: request.revealedWord.toString() }
      : null;
  }

  async fulfillRandomness(requestId: bigint, randomWord: bigint): Promise<string> {
    this.fulfillCalls += 1;
    if (this.fulfillError) throw new Error(this.fulfillError);
    const request = this.requests.get(requestId.toString());
    if (!request) throw new Error("UnknownRequest");
    if (request.fulfilled) throw new Error("AlreadyFulfilled");
    if (
      request.commitment !== zeroCommitment &&
      fakeCommitment(randomWord) !== request.commitment
    ) {
      throw new Error("RandomnessCommitmentMismatch");
    }
    request.fulfilled = true;
    request.revealedWord = randomWord;
    return "0xreveal";
  }

  /** Simulate a game module consuming the pending commitment (the on-chain requestRandomness path). */
  consume(requestId: string, createdAt: number): void {
    if (this.pendingCommitment === zeroCommitment) {
      throw new Error("NoRandomnessCommitment");
    }
    if (this.block <= this.pendingCommitmentBlock) {
      throw new Error("RandomnessCommitmentNotActive");
    }
    const consumed = this.inventory.shift()!;
    this.requests.set(requestId, {
      commitment: consumed.commitment,
      createdAt,
      fulfilled: false
    });
  }

  requestFulfilledWith(requestId: string): bigint | undefined {
    return this.requests.get(requestId)?.revealedWord;
  }
}

describe("Randomness commitment worker", () => {
  const now = () => new Date(1_060_000);

  test("commits, waits a block, reveals the committed word, then recommits", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    const words = [100n, 200n];
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => words.shift() ?? 0n,
      targetCommitments: 1
    });

    // Block 1: nothing pending -> commit the first word.
    engine.block = 1;
    let status = await worker.tick();
    expect(engine.pendingCommitment).toBe(fakeCommitment(100n));
    expect(status.pendingCommitmentAvailable).toBe(false);
    expect(status.pendingCommitmentAgeBlocks).toBe(0);
    expect(status.readinessReasons).toEqual([
      "Randomness commitments are activating. New attacks are temporarily paused."
    ]);
    expect(store.load()).toHaveLength(1);

    // Same-block consumption is rejected on-chain; only after a block can a request consume it.
    engine.block = 2;
    engine.consume("42", 1_000);

    // Block 2: reveal request 42 with the exact committed word, then commit the next word.
    status = await worker.tick();
    expect(engine.requestFulfilledWith("42")).toBe(100n);
    expect(worker.fulfillmentHistory().map((entry) => entry.randomWord)).toEqual(["100"]);
    expect(engine.pendingCommitment).toBe(fakeCommitment(200n));
    expect(status.pendingCommitmentAvailable).toBe(false);
    expect(status.fulfilled).toBe(1);
    expect(store.load()).toHaveLength(1);
    expect(store.load()[0]?.word).toBe("200");
    expect(status.readinessReasons).toEqual([
      "Randomness commitments are activating. New attacks are temporarily paused."
    ]);
  });

  test("does not post a second commitment while one is still pending", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 321n,
      targetCommitments: 1
    });

    engine.block = 1;
    await worker.tick();
    engine.block = 3;
    const status = await worker.tick();

    expect(engine.commits).toEqual([fakeCommitment(321n)]);
    expect(status.pendingCommitmentAgeBlocks).toBe(2);
    expect(store.load()).toHaveLength(1);
    expect(status.alerts).toEqual([]);
  });

  test("recovers the committed word from the store after a restart", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();

    engine.block = 1;
    const before = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 500n,
      targetCommitments: 1
    });
    await before.tick();

    engine.block = 2;
    engine.consume("7", 1_000);

    // Fresh worker instance (process restart) shares only the persisted store, not in-memory state.
    const after = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 600n,
      targetCommitments: 1
    });
    const status = await after.tick();

    expect(engine.requestFulfilledWith("7")).toBe(500n);
    expect(after.fulfillmentHistory()[0]?.randomWord).toBe("500");
    expect(engine.pendingCommitment).toBe(fakeCommitment(600n));
    expect(status.readinessReasons).toEqual([
      "Randomness commitments are activating. New attacks are temporarily paused."
    ]);
  });

  test("reloads durable secrets on every tick instead of overwriting a newer replica", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 500n,
      targetCommitments: 1
    });

    engine.block = 1;
    await worker.tick();

    const replicaRecord = {
      commitment: fakeCommitment(700n),
      word: "700",
      committedAtBlock: 2,
      createdAt: now().toISOString()
    };
    store.save([...store.load(), replicaRecord]);

    engine.block = 3;
    await worker.tick();

    expect(store.load().map((record) => record.commitment)).toContain(replicaRecord.commitment);
  });

  test("alerts when no commitment can be posted", async () => {
    const engine = new FakeRandomnessEngine();
    engine.failCommit = true;
    const store = new InMemoryRandomnessCommitmentStore();
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 1n,
      targetCommitments: 1
    });

    engine.block = 1;
    const status = await worker.tick();

    expect(status.pendingCommitmentAvailable).toBe(false);
    expect(status.pendingCommitmentAgeBlocks).toBeNull();
    expect(status.alerts).toContain(
      "no block-activated randomness commitment available; randomness-consuming actions will revert"
    );
    expect(
      status.alerts.some((alert) =>
        alert.includes("failed to refill randomness commitment inventory")
      )
    ).toBe(true);
  });

  test("flags a consumed request whose reveal word was lost", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 900n,
      targetCommitments: 1
    });

    // A request that consumed a commitment this worker never tracked (e.g. word permanently lost).
    engine.block = 5;
    engine.pendingCommitment = fakeCommitment(111n);
    engine.pendingCommitmentBlock = 4;
    engine.consume("99", 1_000);

    const status = await worker.tick();

    expect(engine.requestFulfilledWith("99")).toBeUndefined();
    expect(status.failed).toBe(1);
    expect(status.alerts.some((alert) => alert.includes("no tracked random word"))).toBe(true);

    const repeated = await worker.tick();
    expect(repeated.failed).toBe(1);
    expect(worker.failureHistory()).toHaveLength(1);
  });

  test("clears the receipt -> stale pending -> missing-word failure after authoritative fulfillment", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    let word = 100n;
    const worker = new RandomnessCommitmentWorker(engine, store, { now, randomWord: () => word++, targetCommitments: 1 });
    await worker.tick();
    engine.block++;
    engine.consume("42", 1_000);
    const stalePending = await engine.listPendingRequests();
    engine.listPendingRequests = async () => stalePending;
    engine.staleFulfillmentReads = true;
    await worker.tick(); // successful receipt, but neither latest nor finalized proves completion
    expect(engine.requestFulfilledWith("42")).toBe(100n);
    expect(store.loadReveals().find((entry) => entry.record?.word === "100")?.request.requestId).toBe("42");

    // Model pre-journal production deletion; the repaired worker retains a second durable copy.
    store.save(store.load().filter((record) => record.word !== "100"));
    store.saveReveals([]);
    engine.block++;
    let status = await worker.tick();
    expect(status.failed).toBe(1);
    expect(status.readinessReasons.length).toBeGreaterThan(0);
    expect(worker.failureHistory()[0]?.error).toContain("no tracked random word");
    expect(engine.fulfillCalls).toBe(1);

    // Discovery stops mentioning the ID, so failures must be reconciled independently.
    engine.listPendingRequests = async () => [];
    engine.staleFulfillmentReads = false;
    status = await worker.tick();
    expect(status.failed).toBe(0);
    expect(status.pendingRequests).toBe(0);
    expect(status.readinessReasons).toEqual([]);
    expect(worker.failureHistory()).toEqual([]);
    expect(engine.fulfillCalls).toBe(1);
    expect((await worker.tick()).failed).toBe(0);
  });

  for (const kind of ["file", "sqlite"] as const) {
    test(`retains receipt-only secrets across ${kind} restart and prunes only matching finalized state`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "vey-terminal-restart-"));
      const path = join(dir, kind === "sqlite" ? "commitments.sqlite" : "commitments.json");
      const openStore = () => kind === "sqlite"
        ? new SqliteRandomnessCommitmentStore(path)
        : new FileRandomnessCommitmentStore(path);
      try {
        const engine = new FakeRandomnessEngine();
        engine.finalized = false;
        let word = 100n;
        const options = { now, randomWord: () => word++, targetCommitments: 1 };
        const before = new RandomnessCommitmentWorker(engine, openStore(), options);
        await before.tick();
        engine.block++;
        engine.consume("42", 1_000);
        const fulfill = engine.fulfillRandomness.bind(engine);
        engine.fulfillRandomness = async (id, value) => {
          expect(openStore().loadReveals().find((entry) => entry.record?.word === "100")?.request.requestId).toBe("42");
          return fulfill(id, value);
        };
        await before.tick();
        expect(openStore().loadReveals().find((entry) => entry.record?.word === "100")?.request.requestId).toBe("42");

        const after = new RandomnessCommitmentWorker(engine, openStore(), options);
        engine.block++;
        await after.tick(); // no pending candidates, cleanup must use durable requestId
        expect(openStore().load().some((record) => record.word === "100")).toBe(true);
        engine.fulfillmentReadError = true;
        await after.tick(); // unavailable finalized RPC must not delete or require a new reveal
        expect(openStore().load().some((record) => record.word === "100")).toBe(true);
        engine.fulfillmentReadError = false;
        engine.finalized = true;
        const status = await after.tick();
        expect(openStore().load().some((record) => record.word === "100")).toBe(false);
        expect(status.failed).toBe(0);
        expect(status.readinessReasons).toEqual([]);
        expect(engine.fulfillCalls).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  for (const kind of ["file", "sqlite"] as const) {
    test(`keeps cached receipts unhealthy and retryable without discovery across ${kind} restart`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "vey-unproven-receipt-"));
      const path = join(dir, kind === "sqlite" ? "commitments.sqlite" : "commitments.json");
      const openStore = () => kind === "sqlite"
        ? new SqliteRandomnessCommitmentStore(path)
        : new FileRandomnessCommitmentStore(path);
      try {
        const engine = new FakeRandomnessEngine();
        let word = 100n;
        const options = { now, randomWord: () => word++, targetCommitments: 2 };
        const before = new RandomnessCommitmentWorker(engine, openStore(), options);
        await before.tick();
        engine.block++;
        engine.consume("42", 1_000);
        const actuallyFulfill = engine.fulfillRandomness.bind(engine);
        const attempts: Array<{ id: bigint; word: bigint }> = [];
        engine.fulfillRandomness = async (id, value) => {
          attempts.push({ id, word: value });
          return "0xcached-success-receipt";
        };
        const first = await before.tick();
        expect(first.pendingRequests).toBe(1);
        expect(first.failed).toBe(1);
        expect(first.readinessReasons).toContain("A randomness fulfillment has not been confirmed. New attacks are temporarily paused.");
        engine.listPendingRequests = async () => [];
        const second = await before.tick();
        expect(second.pendingRequests).toBe(1);
        expect(second.failed).toBe(1);
        expect(second.readinessReasons.length).toBeGreaterThan(0);
        const after = new RandomnessCommitmentWorker(engine, openStore(), options);
        const restarted = await after.tick();
        expect(restarted.pendingRequests).toBe(1);
        expect(restarted.failed).toBe(1);
        expect(restarted.readinessReasons.length).toBeGreaterThan(0);
        expect(attempts).toEqual(Array.from({ length: 3 }, () => ({ id: 42n, word: 100n })));
        expect(openStore().load().some((record) => record.word === "100")).toBe(true);
        await actuallyFulfill(42n, 100n);
        const resolved = await after.tick();
        expect(resolved.pendingRequests).toBe(0);
        expect(resolved.failed).toBe(0);
        expect(resolved.readinessReasons).toEqual([]);
        expect(attempts).toHaveLength(3);
        expect(openStore().load().some((record) => record.word === "100")).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  for (const kind of ["file", "sqlite"] as const) {
    test(`legacy ${kind} saves cannot erase journaled retries or words during overlapping owners`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "vey-legacy-overlap-"));
      const path = join(dir, kind === "sqlite" ? "commitments.sqlite" : "commitments.json");
      // Start with the exact old four-column schema; old writers never know about the new journal.
      const legacyDb = kind === "sqlite" ? new Database(path) : undefined;
      legacyDb?.exec(`CREATE TABLE randomness_commitments (
        commitment TEXT PRIMARY KEY, word TEXT NOT NULL, committed_at_block INTEGER, created_at TEXT NOT NULL
      )`);
      const openStore = () => kind === "sqlite"
        ? new SqliteRandomnessCommitmentStore(path)
        : new FileRandomnessCommitmentStore(path);
      const legacyOwner = openStore(); // lock/lease protocol is unchanged from 57d35fa6
      const legacySave = (dropWord = false) => {
        // Reproduce 57d35fa6 load + whole-table replacement, including receipt-based deletion.
        const rows = legacyDb
          ? legacyDb.query(`SELECT commitment, word, committed_at_block AS committedAtBlock,
              created_at AS createdAt FROM randomness_commitments`).all() as ReturnType<InMemoryRandomnessCommitmentStore["load"]>
          : new FileRandomnessCommitmentStore(path).load();
        const records = dropWord ? rows.filter((record) => record.word !== "100") : rows;
        if (legacyDb) {
          legacyDb.exec("BEGIN IMMEDIATE;");
          try {
            legacyDb.query("DELETE FROM randomness_commitments").run();
            const insert = legacyDb.query(`INSERT INTO randomness_commitments
              (commitment, word, committed_at_block, created_at) VALUES (?, ?, ?, ?)`);
            for (const record of records) insert.run(record.commitment, record.word, record.committedAtBlock, record.createdAt);
            legacyDb.exec("COMMIT;");
          } catch (error) {
            legacyDb.exec("ROLLBACK;");
            throw error;
          }
        } else {
          new FileRandomnessCommitmentStore(path).save(records); // exact original primary-file save
        }
      };
      try {
        const engine = new FakeRandomnessEngine();
        let word = 100n;
        const options = { now, randomWord: () => word++, targetCommitments: 2 };
        const before = new RandomnessCommitmentWorker(engine, openStore(), options);
        await before.tick();
        engine.block++;
        engine.consume("42", 1_000);
        const attempts: bigint[] = [];
        engine.fulfillRandomness = async (_id, value) => { attempts.push(value); return "0xcached-receipt"; };
        expect((await before.tick()).failed).toBe(1);
        const journal = openStore().loadReveals();
        expect(journal[0]?.record?.word).toBe("100");
        await legacyOwner.withExclusiveLock(async () => legacySave());
        expect(openStore().loadReveals()).toEqual(journal);
        if (kind === "file") expect(statSync(path + ".reveals.json").mode & 0o777).toBe(0o600);

        let entered!: () => void;
        let release!: () => void;
        const oldEntered = new Promise<void>((resolve) => { entered = resolve; });
        const oldGate = new Promise<void>((resolve) => { release = resolve; });
        const oldWrite = legacyOwner.withExclusiveLock(async () => {
          entered();
          await oldGate;
          legacySave(true); // old receipt cleanup deletes the secret from its primary store
          expect(openStore().load().some((record) => record.word === "100")).toBe(false);
          expect(openStore().loadReveals()).toEqual(journal);
        });
        await oldEntered;
        engine.listPendingRequests = async () => [];
        const after = new RandomnessCommitmentWorker(engine, openStore(), options);
        const newTick = after.tick(); // must wait for the old owner, then recover from journal
        await Promise.resolve();
        expect(attempts).toEqual([100n]);
        release();
        const [, status] = await Promise.all([oldWrite, newTick]);
        expect(status.pendingRequests).toBe(1);
        expect(status.failed).toBe(1);
        expect(status.readinessReasons.length).toBeGreaterThan(0);
        expect(attempts).toEqual([100n, 100n]);
        expect(openStore().loadReveals()).toEqual(journal);
        expect(openStore().load().some((record) => record.word === "100")).toBe(true);
      } finally {
        legacyDb?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test("missing-word failures survive restart and discovery loss without inventing a reveal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-missing-word-restart-"));
    const path = join(dir, "commitments.sqlite");
    try {
      const engine = new FakeRandomnessEngine();
      engine.block = 5;
      engine.pendingCommitment = fakeCommitment(100n);
      engine.pendingCommitmentBlock = 1;
      engine.consume("42", 1_000);
      let word = 900n;
      const options = { now, randomWord: () => word++, targetCommitments: 2 };
      const before = new RandomnessCommitmentWorker(engine, new SqliteRandomnessCommitmentStore(path), options);
      expect((await before.tick()).failed).toBe(1);
      engine.block++;
      engine.listPendingRequests = async () => [];
      const after = new RandomnessCommitmentWorker(engine, new SqliteRandomnessCommitmentStore(path), options);
      const status = await after.tick();
      expect(status.pendingRequests).toBe(1);
      expect(status.failed).toBe(1);
      expect(status.readinessReasons.length).toBeGreaterThan(0);
      expect(after.failureHistory()[0]?.error).toContain("no tracked random word");
      expect(engine.fulfillCalls).toBe(0);
      await engine.fulfillRandomness(42n, 100n);
      expect((await after.tick()).failed).toBe(0);
      expect(new SqliteRandomnessCommitmentStore(path).loadReveals()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("retries genuine failures, never clears on candidate absence or failed proof reads", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    let word = 100n;
    const worker = new RandomnessCommitmentWorker(engine, store, { now, randomWord: () => word++, targetCommitments: 1 });
    await worker.tick();
    engine.block++;
    engine.consume("42", 1_000);
    engine.fulfillError = "oracle wallet has no gas";
    expect((await worker.tick()).failed).toBe(1);
    engine.block++;
    engine.listPendingRequests = async () => [];
    let status = await worker.tick();
    expect(status.failed).toBe(1);
    expect(status.pendingRequests).toBe(1);
    expect(status.readinessReasons.length).toBeGreaterThan(0);
    expect(engine.fulfillCalls).toBe(2);
    engine.fulfillmentReadError = true;
    expect((await worker.tick()).failed).toBe(1);
    expect(store.load().some((record) => record.word === "100")).toBe(true);
    expect(engine.fulfillCalls).toBe(2);
    engine.fulfillmentReadError = false;
    engine.fulfillError = null;
    status = await worker.tick();
    expect(engine.requestFulfilledWith("42")).toBe(100n);
    expect(status.failed).toBe(0);
    expect(status.readinessReasons).toEqual([]);
  });

  test("clears only proven terminal failures while a sibling missing-word request stays unhealthy", async () => {
    const engine = new FakeRandomnessEngine();
    engine.block = 5;
    engine.inventory = [
      { commitment: fakeCommitment(100n), committedAtBlock: 1 },
      { commitment: fakeCommitment(200n), committedAtBlock: 1 }
    ];
    engine.consume("42", 1_000);
    engine.consume("43", 1_000);
    const worker = new RandomnessCommitmentWorker(engine, new InMemoryRandomnessCommitmentStore(), {
      now, randomWord: () => 900n, targetCommitments: 1
    });
    expect((await worker.tick()).failed).toBe(2);
    await engine.fulfillRandomness(42n, 100n);
    engine.block++;
    engine.listPendingRequests = async () => [];
    const status = await worker.tick();
    expect(status.failed).toBe(1);
    expect(status.pendingRequests).toBe(1);
    expect(status.readinessReasons.length).toBeGreaterThan(0);
    expect(worker.failureHistory().map((failure) => failure.requestId)).toEqual(["43"]);
    expect(engine.requestFulfilledWith("43")).toBeUndefined();
  });

  test("a restarted worker reconstructs genuine failure and can retry its durable word", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-failure-restart-"));
    const path = join(dir, "commitments.sqlite");
    try {
      const engine = new FakeRandomnessEngine();
      let word = 100n;
      const options = { now, randomWord: () => word++, targetCommitments: 1 };
      const before = new RandomnessCommitmentWorker(engine, new SqliteRandomnessCommitmentStore(path), options);
      await before.tick();
      engine.block++;
      engine.consume("42", 1_000);
      engine.fulfillError = "oracle wallet has no gas";
      expect((await before.tick()).failed).toBe(1);
      engine.block++;
      const after = new RandomnessCommitmentWorker(engine, new SqliteRandomnessCommitmentStore(path), options);
      expect((await after.tick()).failed).toBe(1);
      expect(after.failureHistory()[0]?.error).toBe("oracle wallet has no gas");
      expect(new SqliteRandomnessCommitmentStore(path).load().some((record) => record.word === "100")).toBe(true);
      engine.fulfillError = null;
      const status = await after.tick();
      expect(status.failed).toBe(0);
      expect(status.readinessReasons).toEqual([]);
      expect(engine.requestFulfilledWith("42")).toBe(100n);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("treats an AlreadyFulfilled race as success only with authoritative proof", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    let word = 100n;
    const worker = new RandomnessCommitmentWorker(engine, store, { now, randomWord: () => word++, targetCommitments: 1 });
    await worker.tick();
    engine.block++;
    engine.consume("42", 1_000);
    const fulfill = engine.fulfillRandomness.bind(engine);
    engine.fulfillRandomness = async (id, value) => {
      await fulfill(id, value);
      throw new Error("AlreadyFulfilled");
    };
    expect((await worker.tick()).failed).toBe(0);
    expect(store.load().some((record) => record.word === "100")).toBe(false);
    expect(engine.fulfillCalls).toBe(1);
  });

  test("retains secrets and failure for unproven AlreadyFulfilled and deduplicates receipt retries", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    let word = 100n;
    const worker = new RandomnessCommitmentWorker(engine, store, { now, randomWord: () => word++, targetCommitments: 1 });
    await worker.tick();
    engine.block++;
    engine.consume("42", 1_000);
    engine.fulfillError = "AlreadyFulfilled";
    expect((await worker.tick()).failed).toBe(1);
    expect(store.load().some((record) => record.word === "100")).toBe(true);
    engine.fulfillRandomness = async () => "0xcached-receipt";
    expect((await worker.tick()).failed).toBe(1);
    expect((await worker.tick()).failed).toBe(1);
    expect(worker.fulfillmentHistory()).toHaveLength(1);
    expect(store.load().some((record) => record.word === "100")).toBe(true);
  });

  test("does not prune mismatched finalized proofs and does not starve later cleanup candidates", async () => {
    const engine = new FakeRandomnessEngine();
    const initial = Array.from({ length: 10 }, (_, index) => ({
      commitment: fakeCommitment(BigInt(index + 100)), word: String(index + 100),
      committedAtBlock: 1, createdAt: now().toISOString()
    }));
    const store = new InMemoryRandomnessCommitmentStore(initial);
    store.saveReveals(initial.map((record, index) => ({
      request: { ...request, requestId: String(index + 1), randomnessCommitment: record.commitment }, record
    })));
    const reads: bigint[] = [];
    engine.getRequestFulfillment = async (id, blockTag) => {
      if (blockTag === "finalized") reads.push(id);
      if (id === 10n) return { randomnessCommitment: fakeCommitment(109n), randomWord: "109" };
      // Matching ID alone is insufficient: wrong word and/or commitment must not delete secrets.
      return { randomnessCommitment: fakeCommitment(100n), randomWord: "999" };
    };
    const worker = new RandomnessCommitmentWorker(engine, store, { now, randomWord: () => 900n, targetCommitments: 1 });
    await worker.tick();
    expect(reads).toHaveLength(8);
    expect(store.loadReveals()).toHaveLength(10);
    await worker.tick();
    expect(reads).toHaveLength(16);
    expect(store.loadReveals()).toHaveLength(9);
    expect(store.loadReveals().some((entry) => entry.request.requestId === "10")).toBe(false);
  });

  test("adds an independent reveal journal without changing the legacy four-column SQLite table", () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-terminal-migration-"));
    const path = join(dir, "commitments.sqlite");
    try {
      const db = new Database(path);
      db.exec(`CREATE TABLE randomness_commitments (
        commitment TEXT PRIMARY KEY, word TEXT NOT NULL, committed_at_block INTEGER, created_at TEXT NOT NULL
      )`);
      db.query("INSERT INTO randomness_commitments VALUES (?, ?, ?, ?)").run(fakeCommitment(100n), "100", 1, now().toISOString());
      db.close();
      const store = new SqliteRandomnessCommitmentStore(path);
      const records = store.load();
      expect(records).toEqual([{ commitment: fakeCommitment(100n), word: "100", committedAtBlock: 1, createdAt: now().toISOString() }]);
      const reveals = [{ request: { ...request, randomnessCommitment: records[0]!.commitment }, record: records[0]! }];
      store.saveReveals(reveals);
      expect(new SqliteRandomnessCommitmentStore(path).load()).toEqual(records);
      expect(new SqliteRandomnessCommitmentStore(path).loadReveals()).toEqual(reveals);
      const legacy = new Database(path);
      expect((legacy.query("PRAGMA table_info(randomness_commitments)").all() as Array<{ name: string }>).map((column) => column.name))
        .toEqual(["commitment", "word", "committed_at_block", "created_at"]);
      legacy.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("survives a real process restart via the file-backed store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-randomness-"));
    const filePath = join(dir, "nested", "commitments.json");
    try {
      const engine = new FakeRandomnessEngine();

      engine.block = 1;
      const before = new RandomnessCommitmentWorker(
        engine,
        new FileRandomnessCommitmentStore(filePath),
        {
          now,
          randomWord: () => 4242n,
          targetCommitments: 1
        }
      );
      await before.tick();

      engine.block = 2;
      engine.consume("8", 1_000);

      // New store instance reads the on-disk secret the previous worker wrote.
      const after = new RandomnessCommitmentWorker(
        engine,
        new FileRandomnessCommitmentStore(filePath),
        {
          now,
          randomWord: () => 9999n,
          targetCommitments: 1
        }
      );
      const status = await after.tick();

      expect(engine.requestFulfilledWith("8")).toBe(4242n);
      expect(status.readinessReasons).toEqual([
        "Randomness commitments are activating. New attacks are temporarily paused."
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serializes overlapping file-store owners during a rolling deployment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-randomness-lock-"));
    const filePath = join(dir, "commitments.json");
    const firstStore = new FileRandomnessCommitmentStore(filePath);
    const secondStore = new FileRandomnessCommitmentStore(filePath);
    const order: string[] = [];
    let releaseFirst = () => {};
    let firstEntered = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });

    try {
      const first = firstStore.withExclusiveLock(async () => {
        order.push("first-start");
        firstEntered();
        await firstGate;
        order.push("first-end");
      });
      await entered;

      const second = secondStore.withExclusiveLock(async () => {
        order.push("second");
      });
      await Promise.resolve();
      expect(order).toEqual(["first-start"]);

      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(["first-start", "first-end", "second"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("migrates legacy secrets into a 0600 transactional store and serializes rolling owners", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vey-randomness-sqlite-"));
    const legacyPath = join(dir, "legacy.json");
    const databasePath = join(dir, "commitments.sqlite");
    const legacy = [{
      commitment: fakeCommitment(4242n),
      word: "4242",
      committedAtBlock: 7,
      createdAt: "2026-07-29T00:00:00.000Z"
    }];
    writeFileSync(legacyPath, JSON.stringify(legacy), "utf8");
    const firstStore = new SqliteRandomnessCommitmentStore(databasePath, legacyPath);
    const secondStore = new SqliteRandomnessCommitmentStore(databasePath, legacyPath);
    const order: string[] = [];
    let releaseFirst = () => {};
    let firstEntered = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });

    try {
      expect(firstStore.load()).toEqual(legacy);
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);

      const first = firstStore.withExclusiveLock(async () => {
        order.push("first-start");
        firstEntered();
        await firstGate;
        order.push("first-end");
      });
      await entered;
      const second = secondStore.withExclusiveLock(async () => { order.push("second"); });
      await Promise.resolve();
      expect(order).toEqual(["first-start"]);
      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(["first-start", "first-end", "second"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reveals a fresh word for fulfill-only (no-commitment) requests", async () => {
    const engine = new FakeRandomnessEngine();
    const store = new InMemoryRandomnessCommitmentStore();
    const worker = new RandomnessCommitmentWorker(engine, store, {
      now,
      randomWord: () => 7n,
      targetCommitments: 1
    });

    engine.block = 1;
    // Pre-commit disabled on-chain: request carries the zero commitment.
    engine["requests"].set("3", {
      commitment: zeroCommitment,
      createdAt: 1_000,
      fulfilled: false
    });

    const status = await worker.tick();

    expect(engine.requestFulfilledWith("3")).toBe(7n);
    expect(status.fulfilled).toBe(1);
  });
});
