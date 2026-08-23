import { describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { GameStateReadScheduler, GameStateStore } from "./gameStateStore";
import { backendDataProjection } from "./useBackendDataSnapshot";

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
  test("keeps the newest generation when responses resolve out of order", async () => {
    const store = new GameStateStore();
    const older = deferred<{ revision: number }>();
    const newer = deferred<{ revision: number }>();

    const olderRead = store.read("overview:wallet:1", () => older.promise, {
      dedupe: false,
    });
    const newerRead = store.read("overview:wallet:1", () => newer.promise, {
      dedupe: false,
    });
    newer.resolve({ revision: 2 });
    await expect(newerRead).resolves.toEqual({ revision: 2 });
    older.resolve({ revision: 1 });
    await expect(olderRead).resolves.toEqual({ revision: 1 });

    expect(store.snapshot<{ revision: number }>("overview:wallet:1")).toMatchObject({
      data: { revision: 2 },
      freshness: "fresh",
      indexRevision: "2",
    });
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

  test("removes a cancelled navigation read before it consumes a queue slot", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    let navigationLoads = 0;
    const active = store.read("active", () => blocker.promise, {
      scope: "stable",
      deadlineMs: 100,
    });
    const navigation = store.read(
      "galaxy:old",
      async () => {
        navigationLoads += 1;
        return "stale";
      },
      { scope: "navigation:old", deadlineMs: 100 },
    );

    store.cancelScope("navigation:old");
    await expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    expect(navigationLoads).toBe(0);
    blocker.resolve("ready");
    await expect(active).resolves.toBe("ready");
  });

  test("route cleanup cancels queued reads but retains started shared transport", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    const active = store.read("active", () => blocker.promise);
    const activeResult = active.then(
      () => undefined,
      (error) => error,
    );
    let queuedStarted = false;
    const queued = store.read("queued", async () => {
      queuedStarted = true;
      return "queued";
    });

    await Promise.resolve();
    expect(store.cancelQueuedRead("active")).toBe(false);
    expect(store.cancelQueuedRead("queued")).toBe(true);
    blocker.resolve("active");

    await expect(activeResult).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();
    expect(queuedStarted).toBe(false);
  });

  test("terminal disposal cancels queued reads before they begin transport", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    const active = store.read("active", () => blocker.promise);
    let queuedStarted = false;
    const queued = store.read("queued", async () => {
      queuedStarted = true;
      return "queued";
    });
    const activeResult = active.then(
      () => undefined,
      (error) => error,
    );
    const queuedResult = queued.then(
      () => undefined,
      (error) => error,
    );

    await Promise.resolve();
    store.dispose();
    blocker.resolve("active");

    await expect(activeResult).resolves.toMatchObject({ name: "AbortError" });
    await expect(queuedResult).resolves.toMatchObject({ name: "AbortError" });
    expect(queuedStarted).toBe(false);
  });

  test("enforces an end-to-end deadline while a read is queued", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    let queuedLoads = 0;
    const active = store.read("active", () => blocker.promise, {
      deadlineMs: 100,
    });
    const queued = store.read(
      "queued",
      async () => {
        queuedLoads += 1;
        return "late";
      },
      { deadlineMs: 5 },
    );

    await expect(queued).rejects.toThrow("including queue time");
    expect(queuedLoads).toBe(0);
    expect(store.snapshot("queued")?.freshness).toBe("failed");
    blocker.resolve("ready");
    await active;
  });

  test("does not start a replacement before a timed-out transport settles", async () => {
    const scheduler = new GameStateReadScheduler(1);
    const slowTransport = deferred<string>();
    let replacementStarted = false;
    const timedOut = scheduler.schedule("slow", () => slowTransport.promise, { deadlineMs: 5 }).promise;
    const replacement = scheduler.schedule(
      "replacement",
      async () => {
        replacementStarted = true;
        return "replacement";
      },
      { deadlineMs: 100 },
    ).promise;

    await expect(timedOut).rejects.toThrow("including queue time");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(replacementStarted).toBe(false);

    slowTransport.resolve("finished after abort");
    await expect(replacement).resolves.toBe("replacement");
    expect(replacementStarted).toBe(true);
  });

  test("keeps dedupe ownership until a deadline-aborted transport actually settles", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const slowTransport = deferred<string>();
    let duplicateLoads = 0;
    const first = store.read("slow", () => slowTransport.promise, { deadlineMs: 5 });

    await expect(first).rejects.toThrow("including queue time");
    expect(store.hasInFlight("slow")).toBe(true);
    const duplicate = store.read("slow", async () => {
      duplicateLoads += 1;
      return "duplicate";
    });
    await expect(duplicate).rejects.toThrow("including queue time");
    expect(duplicateLoads).toBe(0);

    slowTransport.resolve("settled after timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(store.hasInFlight("slow")).toBe(false);
    await expect(store.read("slow", async () => "fresh", { deadlineMs: 100 })).resolves.toBe("fresh");
  });

  test("runs transaction convergence before selected and background refreshes", async () => {
    const scheduler = new GameStateReadScheduler(1);
    const blocker = deferred<string>();
    const order: string[] = [];
    const active = scheduler.schedule("active", () => blocker.promise, {
      deadlineMs: 100,
    }).promise;
    const background = scheduler.schedule(
      "background",
      async () => {
        order.push("background");
        return "background";
      },
      { priority: "background", deadlineMs: 100 },
    ).promise;
    const selected = scheduler.schedule(
      "selected",
      async () => {
        order.push("selected");
        return "selected";
      },
      { priority: "selected-planet", deadlineMs: 100 },
    ).promise;
    const transaction = scheduler.schedule(
      "transaction",
      async () => {
        order.push("transaction");
        return "transaction";
      },
      { priority: "transaction", deadlineMs: 100 },
    ).promise;

    blocker.resolve("ready");
    await Promise.all([active, background, selected, transaction]);
    expect(order).toEqual(["transaction", "selected", "background"]);
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
