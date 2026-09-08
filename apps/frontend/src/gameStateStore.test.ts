import { describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { GameStateStore } from "./gameStateStore";
import { backendDataProjection, isBackendDataSnapshotLoading } from "./useBackendDataSnapshot";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("GameStateStore", () => {
  test("treats an unseeded selected-resource snapshot as pending, not failed", () => {
    expect(isBackendDataSnapshotLoading(undefined, true)).toBe(true);
    expect(isBackendDataSnapshotLoading({ freshness: "refreshing", generation: 1 }, true)).toBe(true);
    expect(isBackendDataSnapshotLoading({ freshness: "delayed", generation: 1 }, true)).toBe(true);
    expect(isBackendDataSnapshotLoading({ freshness: "failed", generation: 1, error: "offline" }, true)).toBe(false);
    expect(isBackendDataSnapshotLoading(undefined, false)).toBe(false);
  });

  test("a late response cannot replace a newer published snapshot", async () => {
    const store = new GameStateStore();
    const older = deferred<{ revision: number }>();
    const olderRead = store.read("planet:1", () => older.promise);
    store.publish("planet:1", { revision: 2 });
    older.resolve({ revision: 1 });
    await olderRead;
    expect(store.value<{ revision: number }>("planet:1")).toEqual({ revision: 2 });
  });

  test("clearing an error does not invalidate an in-flight deduplicated read", async () => {
    const store = new GameStateStore();
    const response = deferred<{ level: number }>();
    const firstRead = store.read("infrastructure:wallet:planet", () => response.promise);

    store.fail("infrastructure:wallet:planet", undefined);
    const deduplicatedRead = store.read("infrastructure:wallet:planet", () => {
      throw new Error("deduplicated refresh must not start another transport");
    });
    response.resolve({ level: 4 });

    await expect(Promise.all([firstRead, deduplicatedRead])).resolves.toEqual([{ level: 4 }, { level: 4 }]);
    expect(store.snapshot<{ level: number }>("infrastructure:wallet:planet")).toMatchObject({
      data: { level: 4 },
      freshness: "fresh",
    });
  });

  test("independent planets start together and a slow read cannot block infrastructure", async () => {
    const store = new GameStateStore();
    const blockers = Array.from({ length: 10 }, () => deferred<string>());
    const started: number[] = [];
    const reads = blockers.map((blocker, id) => store.read(`planet:${id}`, () => {
      started.push(id);
      return blocker.promise;
    }));
    await Promise.resolve();
    expect(started).toHaveLength(10);
    await expect(store.read("infrastructure", async () => "ready")).resolves.toBe("ready");
    blockers.forEach((blocker) => blocker.resolve("ready"));
    await Promise.all(reads);
  });

  test("ten consumers share one transport even when requesting fresh data", async () => {
    const store = new GameStateStore();
    const response = deferred<string>();
    let calls = 0;
    const reads = Array.from({ length: 10 }, () => store.read("planet:1", () => {
      calls += 1;
      return response.promise;
    }, { dedupe: false }));
    await Promise.resolve();
    expect(calls).toBe(1);
    response.resolve("ready");
    expect(await Promise.all(reads)).toEqual(Array(10).fill("ready"));
  });

  test("a parent read can await independent children without a scheduler deadlock", async () => {
    const store = new GameStateStore();
    await expect(store.read("parent", () => Promise.all([
      store.read("child:1", async () => 1),
      store.read("child:2", async () => 2),
    ]))).resolves.toEqual([1, 2]);
  });

  test("disposal aborts transports and prevents late publication", async () => {
    const store = new GameStateStore();
    const response = deferred<string>();
    let signal: AbortSignal | undefined;
    const read = store.read("old", (requestSignal) => {
      signal = requestSignal;
      return response.promise;
    });
    await Promise.resolve();
    store.dispose();
    expect(signal?.aborted).toBe(true);
    response.resolve("obsolete");
    await read;
    expect(store.snapshot("old")).toBeUndefined();
    store.publish("old", "late projection");
    expect(store.snapshot("old")).toBeUndefined();
    await expect(store.read("old", async () => "restarted")).rejects.toMatchObject({ name: "AbortError" });
  });

  test("a disposed wallet response cannot republish after an account switch", async () => {
    const store = new GameStateStore();
    const response = deferred<string>();
    const read = store.read("planet", () => response.promise, { wallet: "0xabc" });
    store.clearWallet("0xabc");
    response.resolve("old wallet");
    await read;
    expect(store.snapshot("planet")).toBeUndefined();
  });

  test("notifies a keyed subscriber only when its canonical entry changes", () => {
    const store = new GameStateStore();
    let systemUpdates = 0;
    const unsubscribe = store.subscribeKey("system:1:2", () => {
      systemUpdates += 1;
    });

    store.publish("attack-protection:0xabc:9:false", { allowed: true });
    expect(systemUpdates).toBe(0);

    store.publish("system:1:2", { planets: [] });
    expect(systemUpdates).toBe(1);

    unsubscribe();
  });

  test("propagates shared refreshing, fresh, delayed, and failed entries through runtime surface consumers", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("overview", "0xabc", "planet-7");
    const topBar = backendDataProjection<{ revision: number }>(store, key);
    const overview = backendDataProjection<{ revision: number }>(store, key);
    const topBarObserved: string[] = [];
    const overviewObserved: string[] = [];
    const observe = (target: string[]) => (snapshot: ReturnType<typeof topBar.getSnapshot>) => {
      target.push(`${snapshot?.freshness ?? "missing"}:${snapshot?.data?.revision ?? "none"}:${snapshot?.error ?? "none"}`);
    };
    const unsubscribeTopBar = topBar.subscribe(observe(topBarObserved));
    const unsubscribeOverview = overview.subscribe(observe(overviewObserved));

    const response = deferred<{ revision: number }>();
    const refresh = store.refresh(key, () => response.promise);
    response.resolve({ revision: 9 });
    await refresh;
    await expect(
      store.refresh(key, async () => {
        throw new Error("Indexer is unavailable.");
      }),
    ).rejects.toThrow("Indexer is unavailable.");

    unsubscribeOverview();
    unsubscribeTopBar();
    expect(topBarObserved).toEqual(overviewObserved);
    expect(topBarObserved).toContain("refreshing:none:none");
    expect(topBarObserved).toContain("fresh:9:none");
    expect(topBarObserved).toContain("delayed:9:Indexer is unavailable.");
  });

  test("exposes nested backend index revisions with the canonical snapshot", async () => {
    const store = new GameStateStore();
    await store.read("overview", async () => ({
      fleetVisibility: { indexedRevision: "block:991:4" },
      settlement: { planet: null },
    }));
    expect(store.snapshot("overview")?.indexRevision).toBe("block:991:4");
  });
});
