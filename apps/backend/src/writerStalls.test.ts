import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BattleReportStore } from "./battleReferee";
import { EventLoopLagMonitor } from "./eventLoopLag";
import { SqliteRandomnessCommitmentStore, type RandomnessCommitmentRecord, type RandomnessPendingReveal } from "./randomness";
import { withoutCommitSync } from "./sqliteCommitSync";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { WalCheckpointer, type WalCheckpointResult } from "./walCheckpointer";

// #74: the writer froze for seconds in WAL fsyncs and checkpoints on a contended disk.

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "veydrift-writer-stalls-"));
}

function walBytes(path: string): number {
  try { return statSync(path + "-wal").size; } catch { return 0; }
}

describe("withoutCommitSync", () => {
  test("restores FULL after the write, including when it throws", () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA synchronous = FULL;");
    const level = () => (database.query("PRAGMA synchronous").get() as { synchronous: number }).synchronous;
    expect(withoutCommitSync(database, level)).toBe(1);
    expect(level()).toBe(2);
    expect(() => withoutCommitSync(database, () => { throw new Error("boom"); })).toThrow("boom");
    expect(level()).toBe(2);
  });
});

describe("SqliteRandomnessCommitmentStore idle saves", () => {
  const record = (index: number, committedAtBlock: number | null = null): RandomnessCommitmentRecord => ({
    commitment: "0x" + index.toString(16).padStart(64, "0"),
    word: String(1000 + index),
    committedAtBlock,
    createdAt: `2026-10-11T00:00:0${index}.000Z`
  });
  const reveal = (requestId: string): RandomnessPendingReveal => ({
    request: { requestId, requester: "0x1111111111111111111111111111111111111111", purposeHash: "0x" + "a".repeat(64), createdAt: 1 }
  });

  test("unchanged saves write no WAL frames; changes match a full rewrite and keep the audit", async () => {
    const dir = tempDir();
    const path = join(dir, "commitments.sqlite");
    try {
      const store = new SqliteRandomnessCommitmentStore(path);
      store.save([record(1), record(2, 7)]);
      store.saveReveals([reveal("1"), reveal("2")]);
      const before = walBytes(path);
      for (let tick = 0; tick < 20; tick++) {
        store.save([record(2, 7), record(1)]);
        store.saveReveals([reveal("1"), reveal("2")]);
      }
      // No changed page means no WAL frame, so no commit-time fsync on the writer's event loop.
      expect(walBytes(path)).toBe(before);
      await store.withExclusiveLock(async () => undefined);
      expect((new Database(path, { readonly: true }).query("SELECT count(*) AS n FROM randomness_committer_lease").get() as { n: number }).n).toBe(0);

      store.save([record(2, 8), record(3)]);
      store.saveReveals([{ ...reveal("2"), record: record(2, 8) }, reveal("3")]);
      expect(store.load()).toEqual([record(2, 8), record(3)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      expect(store.loadReveals()).toEqual([{ ...reveal("2"), record: record(2, 8) }, reveal("3")]);

      const audit = new Database(path, { readonly: true });
      const actions = audit.query("SELECT action, commitment FROM randomness_commitment_audit ORDER BY sequence").all() as Array<{ action: string; commitment: string }>;
      audit.close();
      expect(actions).toEqual([
        { action: "record_added", commitment: record(1).commitment },
        { action: "record_added", commitment: record(2).commitment },
        { action: "commitment_state_changed", commitment: record(2).commitment },
        { action: "record_added", commitment: record(3).commitment },
        { action: "record_removed", commitment: record(1).commitment }
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("duplicate ids still fail the whole save like the former full rewrite", () => {
    const dir = tempDir();
    const path = join(dir, "commitments.sqlite");
    try {
      const store = new SqliteRandomnessCommitmentStore(path);
      store.save([record(1)]);
      store.saveReveals([reveal("1")]);
      expect(() => store.save([record(1), record(1)])).toThrow();
      expect(() => store.saveReveals([reveal("1"), reveal("1")])).toThrow();
      expect(store.load()).toEqual([record(1)]);
      expect(store.loadReveals()).toEqual([reveal("1")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EventLoopLagMonitor", () => {
  test("reports percentiles over a window and logs single stalls", () => {
    let now = 0;
    const lines: string[] = [];
    const monitor = new EventLoopLagMonitor({ now: () => now, log: (line) => lines.push(line), stallLogMs: 1_000 });
    for (let index = 0; index < 1_000; index++) {
      now += 100;
      monitor.record(index === 500 ? 2_500 : index % 100 === 0 ? 600 : 2);
    }
    const window = monitor.window(60 * 60 * 1_000);
    expect(window).toMatchObject({ samples: 1_000, p50Ms: 2, p99Ms: 600, maxMs: 2_500, over500Ms: 10, over1000Ms: 1 });
    expect(monitor.window(10_000).samples).toBe(101);
    expect(lines).toEqual(['writer_event_loop_stall {"lagMs":2500}']);
  });

  test("caches the hour snapshot that the public /health returns", () => {
    let now = 0;
    const monitor = new EventLoopLagMonitor({ now: () => now, log: () => undefined });
    monitor.record(5);
    expect(monitor.snapshot().lastHour.samples).toBe(1);
    now = 9_000;
    monitor.record(5);
    expect(monitor.snapshot().lastHour.samples).toBe(1);
    now = 10_000;
    expect(monitor.snapshot().lastHour.samples).toBe(2);
  });
});

type FakeWorker = {
  messages: unknown[];
  terminated: boolean;
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  emit(result: WalCheckpointResult): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    messages: [],
    terminated: false,
    postMessage(message) { worker.messages.push(message); },
    terminate() { worker.terminated = true; },
    onmessage: null,
    onerror: null,
    emit(result) { worker.onmessage?.({ data: result } as MessageEvent); }
  };
  return worker;
}

describe("WalCheckpointer", () => {
  test("disables writer autocheckpoint only after a worker pass and restores it when stale", () => {
    let now = 0;
    const pages: number[] = [];
    const warnings: string[] = [];
    const worker = fakeWorker();
    const checkpointer = new WalCheckpointer({
      databasePath: "/data/index.sqlite",
      setAutoCheckpoint: (value) => pages.push(value),
      staleAfterMs: 30_000,
      now: () => now,
      createWorker: () => worker,
      logger: { warn: (message: string) => warnings.push(message) }
    });
    try {
      expect(worker.messages).toEqual([{ databasePath: "/data/index.sqlite", intervalMs: 1_000 }]);
      expect(pages).toEqual([]);
      worker.emit({ ok: false, error: "unable to open", durationMs: 1 });
      expect(pages).toEqual([]);
      worker.emit({ ok: true, busy: 0, log: 10, checkpointed: 10, durationMs: 3 });
      expect(pages).toEqual([0]);
      expect(checkpointer.snapshot()).toMatchObject({ mode: "worker", passes: 1, failures: 1, lastLogPages: 10 });

      now = 31_000;
      (checkpointer as unknown as { checkStale(): void }).checkStale();
      expect(pages).toEqual([0, 1000]);
      expect(checkpointer.snapshot().mode).toBe("main-thread-fallback");
      expect(warnings.some((warning) => warning.includes("stale"))).toBe(true);

      worker.emit({ ok: true, busy: 0, log: 0, checkpointed: 0, durationMs: 1 });
      expect(pages).toEqual([0, 1000, 0]);
    } finally {
      checkpointer.stop();
    }
    expect(pages.at(-1)).toBe(1000);
    expect(worker.terminated).toBe(true);
  });

  test("a real worker thread backfills the WAL so the writer's next commit restarts and trims it", async () => {
    const dir = tempDir();
    const path = join(dir, "index.sqlite");
    const writer = new Database(path, { create: true });
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 1000; PRAGMA journal_size_limit = 0; CREATE TABLE t (v BLOB);");
    const pages: number[] = [];
    const checkpointer = new WalCheckpointer({
      databasePath: path,
      setAutoCheckpoint: (value) => {
        pages.push(value);
        writer.exec(`PRAGMA wal_autocheckpoint = ${value};`);
      },
      intervalMs: 50
    });
    try {
      const deadline = Date.now() + 10_000;
      while (checkpointer.snapshot().passes === 0 && Date.now() < deadline) await Bun.sleep(20);
      expect(pages).toEqual([0]);
      const insert = writer.query("INSERT INTO t VALUES (randomblob(4000))");
      writer.transaction(() => { for (let index = 0; index < 400; index++) insert.run(); })();
      // Autocheckpoint is off on the writer, so only the worker can have backfilled these frames.
      const grown = walBytes(path);
      expect(grown).toBeGreaterThan(400 * 4000);
      const backfilled = () => {
        const state = checkpointer.snapshot();
        return (state.lastLogPages ?? 0) >= 400 && state.lastCheckpointedPages === state.lastLogPages;
      };
      while (!backfilled() && Date.now() < deadline) await Bun.sleep(20);
      expect(backfilled()).toBe(true);
      insert.run();
      expect(walBytes(path)).toBeLessThan(grown / 10);
      expect((writer.query("SELECT count(*) AS n FROM t").get() as { n: number }).n).toBe(401);
    } finally {
      checkpointer.stop();
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lease writes skip the commit fsync", () => {
  function recordPragmas(database: Database): string[] {
    const statements: string[] = [];
    const exec = database.exec.bind(database);
    database.exec = ((sql: string, ...rest: unknown[]) => {
      if (sql.includes("synchronous")) statements.push(sql.trim());
      return (exec as (...args: unknown[]) => unknown)(sql, ...rest);
    }) as typeof database.exec;
    return statements;
  }

  test("randomness lease acquire and release run at NORMAL and leave FULL", async () => {
    const dir = tempDir();
    try {
      const store = new SqliteRandomnessCommitmentStore(join(dir, "commitments.sqlite"));
      const database = (store as unknown as { database: Database }).database;
      const pragmas = recordPragmas(database);
      await store.withExclusiveLock(async () => undefined);
      expect(pragmas).toEqual([
        "PRAGMA synchronous = NORMAL;", "PRAGMA synchronous = FULL;",
        "PRAGMA synchronous = NORMAL;", "PRAGMA synchronous = FULL;"
      ]);
      expect((database.query("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolver lease skips the fsync, but clearing a send fence keeps FULL", async () => {
    const dir = tempDir();
    try {
      const coordinator = new ResolverTransactionCoordinator(join(dir, "transactions.sqlite"));
      const internals = coordinator as unknown as {
        database: Database;
        acquireLease(chainId: number, address: `0x${string}`, holder: string): Promise<void>;
      };
      const pragmas = recordPragmas(internals.database);
      const address = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a" as const;
      await internals.acquireLease(8453, address, "first");
      expect(pragmas).toEqual(["PRAGMA synchronous = NORMAL;", "PRAGMA synchronous = FULL;"]);

      pragmas.length = 0;
      internals.database.query("DELETE FROM resolver_transaction_leases").run();
      internals.database.query(`INSERT INTO resolver_send_fences
        (chain_id, resolver_address, token, owner_host, owner_pid, transaction_hash) VALUES (?, ?, 'token', 'other-host', 1, '0x')`)
        .run(8453, address);
      await expect(internals.acquireLease(8453, address, "second")).rejects.toThrow("resolver send still outstanding");
      expect(pragmas).toEqual([]);
      expect((internals.database.query("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("battle referee discovery skips the fsync; reports keep FULL", () => {
    const dir = tempDir();
    try {
      const store = new BattleReportStore(join(dir, "referee.sqlite"));
      const database = (store as unknown as { database: Database }).database;
      const pragmas = recordPragmas(database);
      store.saveDiscovery(42n, [9n, 7n]);
      expect(pragmas).toEqual(["PRAGMA synchronous = NORMAL;", "PRAGMA synchronous = FULL;"]);
      expect(store.cursor()).toBe(42n);
      expect(store.pending()).toEqual([7n, 9n]);

      pragmas.length = 0;
      store.saveReport(7n, `0x${"ab".repeat(32)}`, "{}");
      expect(pragmas).toEqual([]);
      expect((database.query("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
