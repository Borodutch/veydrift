import { describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";

describe("BackendDataStore", () => {
  test("reuses one in-flight request for the same stable key", async () => {
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

    resolveRequest({ level: 3 });
    await expect(first).resolves.toEqual({ level: 3 });
    await expect(second).resolves.toEqual({ level: 3 });
  });

  test("does not coalesce different request keys", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { level: loads };
    };

    const [first, second] = await Promise.all([
      store.refresh("infrastructure:9", load),
      store.refresh("infrastructure:10", load),
    ]);

    expect(first).toEqual({ level: 1 });
    expect(second).toEqual({ level: 2 });
    expect(loads).toBe(2);
  });

  test("releases a failed request so a later refresh can retry", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;

    await expect(store.refresh("infrastructure:7", async () => {
      loads += 1;
      throw new Error("backend restarting");
    })).rejects.toThrow("backend restarting");

    await expect(store.refresh("infrastructure:7", async () => {
      loads += 1;
      return { level: 5 };
    })).resolves.toEqual({ level: 5 });
    expect(loads).toBe(2);
  });
});
