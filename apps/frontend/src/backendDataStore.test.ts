import { describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";

describe("BackendDataStore", () => {
  test("reuses an in-flight refresh and stores one shared response", async () => {
    const store = new BackendDataStore("https://api.test");
    let resolveRequest!: (value: { level: number }) => void;
    let loads = 0;
    const load = () => {
      loads += 1;
      return new Promise<{ level: number }>((resolve) => {
        resolveRequest = resolve;
      });
    };

    const first = store.refresh("infrastructure:7", load);
    const second = store.refresh("infrastructure:7", load);

    expect(second).toBe(first);
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(store.entry("infrastructure:7")).toMatchObject({ status: "loading" });

    resolveRequest({ level: 3 });
    await expect(first).resolves.toEqual({ level: 3 });
    expect(store.entry("infrastructure:7")).toMatchObject({
      data: { level: 3 },
      status: "ready",
    });
  });

  test("publishes loading only after the request is available for reuse", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;
    let nested: Promise<{ level: number }> | undefined;
    const load = async () => {
      loads += 1;
      return { level: 2 };
    };

    const unsubscribe = store.subscribe(() => {
      if (store.entry("infrastructure:9").status === "loading") {
        nested = store.refresh("infrastructure:9", load);
      }
    });
    const first = store.refresh("infrastructure:9", load);

    expect(nested).toBe(first);
    await expect(first).resolves.toEqual({ level: 2 });
    expect(loads).toBe(1);
    unsubscribe();
  });

  test("keeps confirmed data visible when a later refresh fails", async () => {
    const store = new BackendDataStore("https://api.test");
    store.write("infrastructure:7", { level: 4 });

    await expect(store.refresh("infrastructure:7", async () => {
      throw new Error("backend restarting");
    })).rejects.toThrow("backend restarting");

    expect(store.entry("infrastructure:7")).toMatchObject({
      data: { level: 4 },
      error: new Error("backend restarting"),
      status: "error",
    });
  });

  test("notifies every consumer from the same write and refresh lifecycle", async () => {
    const store = new BackendDataStore("https://api.test");
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.write("queues:7", { building: null });
    await store.refresh("queues:7", async () => ({ building: { readyAt: "10" } }));
    unsubscribe();
    store.write("queues:7", { building: null });

    expect(notifications).toBe(3);
  });
});
