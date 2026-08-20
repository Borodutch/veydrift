import { describe, expect, test } from "bun:test";
import { GameStateReadScheduler, GameStateStore } from "./gameStateStore";

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

    const olderRead = store.read("overview:wallet:1", () => older.promise, { dedupe: false });
    const newerRead = store.read("overview:wallet:1", () => newer.promise, { dedupe: false });
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

  test("removes a cancelled navigation read before it consumes a queue slot", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    let navigationLoads = 0;
    const active = store.read("active", () => blocker.promise, { scope: "stable", deadlineMs: 100 });
    const navigation = store.read("galaxy:old", async () => {
      navigationLoads += 1;
      return "stale";
    }, { scope: "navigation:old", deadlineMs: 100 });

    store.cancelScope("navigation:old");
    await expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    expect(navigationLoads).toBe(0);
    blocker.resolve("ready");
    await expect(active).resolves.toBe("ready");
  });

  test("enforces an end-to-end deadline while a read is queued", async () => {
    const store = new GameStateStore(new GameStateReadScheduler(1));
    const blocker = deferred<string>();
    let queuedLoads = 0;
    const active = store.read("active", () => blocker.promise, { deadlineMs: 100 });
    const queued = store.read("queued", async () => {
      queuedLoads += 1;
      return "late";
    }, { deadlineMs: 5 });

    await expect(queued).rejects.toThrow("including queue time");
    expect(queuedLoads).toBe(0);
    expect(store.snapshot("queued")?.freshness).toBe("failed");
    blocker.resolve("ready");
    await active;
  });

  test("runs transaction convergence before selected and background refreshes", async () => {
    const scheduler = new GameStateReadScheduler(1);
    const blocker = deferred<string>();
    const order: string[] = [];
    const active = scheduler.schedule("active", () => blocker.promise, { deadlineMs: 100 }).promise;
    const background = scheduler.schedule("background", async () => {
      order.push("background");
      return "background";
    }, { priority: "background", deadlineMs: 100 }).promise;
    const selected = scheduler.schedule("selected", async () => {
      order.push("selected");
      return "selected";
    }, { priority: "selected-planet", deadlineMs: 100 }).promise;
    const transaction = scheduler.schedule("transaction", async () => {
      order.push("transaction");
      return "transaction";
    }, { priority: "transaction", deadlineMs: 100 }).promise;

    blocker.resolve("ready");
    await Promise.all([active, background, selected, transaction]);
    expect(order).toEqual(["transaction", "selected", "background"]);
  });

  test("notifies every screen projection when shared state advances", async () => {
    const store = new GameStateStore();
    const observed: number[] = [];
    const unsubscribeOverview = store.subscribe(() => {
      const revision = store.snapshot<{ revision: number }>("wallet")?.data?.revision;
      if (revision) observed.push(revision);
    });
    const unsubscribeTopBar = store.subscribe(() => {
      const revision = store.snapshot<{ revision: number }>("wallet")?.data?.revision;
      if (revision) observed.push(revision);
    });

    await store.read("wallet", async () => ({ revision: 9 }));
    unsubscribeOverview();
    unsubscribeTopBar();
    expect(observed).toEqual([9, 9]);
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
