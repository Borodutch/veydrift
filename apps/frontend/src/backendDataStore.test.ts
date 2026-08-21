import { describe, expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import type { WriteTransactionState } from "./transactionActionGate";

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

  test("does not reuse an older in-flight request for an authoritative refresh", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { revision: loads };
    };

    const [first, second] = await Promise.all([
      store.refresh("fleet-visibility:wallet", load, { dedupe: false }),
      store.refresh("fleet-visibility:wallet", load, { dedupe: false }),
    ]);

    expect(first).toEqual({ revision: 1 });
    expect(second).toEqual({ revision: 2 });
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

  test("aborts the real Galaxy transport when navigation cancels its surface scope", async () => {
    const originalFetch = globalThis.fetch;
    let transportSignal: AbortSignal | undefined;
    let markTransportStarted!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined;
      markTransportStarted();
      return new Promise<Response>((_resolve, reject) => {
        transportSignal?.addEventListener("abort", () => reject(transportSignal?.reason), { once: true });
      });
    }) as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      const request = store.system(2, 44, { requestScope: "galaxy-view-navigation" });
      await transportStarted;
      store.cancelScope("galaxy-view-navigation");

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(transportSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishes one shared write lifecycle to every subscriber", async () => {
    const store = new BackendDataStore("https://api.test");
    const phases: string[] = [];
    const unsubscribe = store.subscribe(() => {
      const phase = store.snapshot<WriteTransactionState>(store.writeTransactionKey())?.data?.phase;
      if (phase && phases.at(-1) !== phase) phases.push(phase);
    });

    try {
      await expect(store.runWriteTransaction({
        confirm: async () => ({ status: "0x1" }),
        key: "defense:start:4",
        label: "Defense production",
        send: async () => "0xabc",
        waitForIndexed: async () => ({ indexed: true }),
      })).resolves.toBe(true);
    } finally {
      unsubscribe();
    }

    expect(phases).toEqual(["pending", "confirming", "confirmed", "indexing", "success"]);
    expect(store.snapshot<WriteTransactionState>(store.writeTransactionKey("defense:start:4"))?.data)
      .toMatchObject({ key: "defense:start:4", phase: "success", stage: "applied", txHash: "0xabc" });
  });

  test("uses the same shared gate for receipt writes and non-receipt mutations", async () => {
    const store = new BackendDataStore("https://api.test");
    let release!: () => void;
    const held = store.runExclusiveTransaction("player-profile:update", "Profile update", () =>
      new Promise<void>((resolve) => { release = resolve; })
    );
    await Promise.resolve();

    let sent = false;
    await expect(store.runWriteTransaction({
      confirm: async () => ({}),
      key: "defense:start:4",
      label: "Defense production",
      send: async () => {
        sent = true;
        return "0xabc";
      },
    })).resolves.toBe(false);
    expect(sent).toBe(false);

    release();
    await held;
  });
});
