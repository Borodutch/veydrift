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

    const [first, second] = await Promise.all([store.refresh("infrastructure:9", load), store.refresh("infrastructure:10", load)]);

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

    const [first, second] = await Promise.all([store.refresh("fleet-visibility:wallet", load, { dedupe: false }), store.refresh("fleet-visibility:wallet", load, { dedupe: false })]);

    expect(first).toEqual({ revision: 1 });
    expect(second).toEqual({ revision: 2 });
    expect(loads).toBe(2);
  });

  test("releases a failed request so a later refresh can retry", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;

    await expect(
      store.refresh("infrastructure:7", async () => {
        loads += 1;
        throw new Error("backend restarting");
      }),
    ).rejects.toThrow("backend restarting");

    await expect(
      store.refresh("infrastructure:7", async () => {
        loads += 1;
        return { level: 5 };
      }),
    ).resolves.toEqual({ level: 5 });
    expect(loads).toBe(2);
  });

  test("keeps one registered resource owner for cache reuse and tag invalidation", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("infrastructure", "0xabc", "planet-7");
    let loads = 0;
    const load = async () => ({ revision: ++loads });
    const unsubscribe = store.subscribeKey(key, () => {});

    try {
      await store.ensure(key, load, {
        wallet: "0xabc",
        planetId: "planet-7",
        maxAgeMs: 60_000,
      });
      await store.ensure(key, load, {
        wallet: "0xabc",
        planetId: "planet-7",
        maxAgeMs: 60_000,
      });
      expect(loads).toBe(1);

      await store.invalidate(["planet:planet-7"], { priority: "transaction" });
      expect(loads).toBe(2);
      expect(store.snapshot<{ revision: number }>(key)?.data).toEqual({
        revision: 2,
      });
    } finally {
      unsubscribe();
    }
  });

  test("runs one trailing read when indexed invalidation lands during an in-flight request", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("infrastructure", "0xabc", "planet-7");
    let resolveFirst!: (value: { revision: number }) => void;
    let loads = 0;
    const load = () => {
      loads += 1;
      if (loads === 1) {
        return new Promise<{ revision: number }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ revision: loads });
    };
    const unsubscribe = store.subscribeKey(key, () => {});

    try {
      const initial = store.refresh(key, load, {
        planetId: "planet-7",
        wallet: "0xabc",
      });
      await Promise.resolve();
      await store.invalidate(["planet:planet-7"], { priority: "transaction" });
      resolveFirst({ revision: 1 });
      await initial;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));

      expect(loads).toBe(2);
      expect(store.snapshot<{ revision: number }>(key)?.data).toEqual({
        revision: 2,
      });
    } finally {
      unsubscribe();
    }
  });

  test("updates a canonical resource descriptor when an equivalent surface provides newer inputs", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("system", 1, 2);
    const unsubscribe = store.subscribeKey(key, () => {});
    let firstLoads = 0;
    let secondLoads = 0;

    try {
      await store.refresh(key, async () => ({ source: "first", revision: ++firstLoads }), { scope: "first-surface" });
      await store.refresh(key, async () => ({ source: "second", revision: ++secondLoads }), { scope: "second-surface" });
      await store.invalidate(["kind:system"]);

      expect(firstLoads).toBe(1);
      expect(secondLoads).toBe(2);
      expect(store.snapshot<{ source: string; revision: number }>(key)?.data).toEqual({ source: "second", revision: 2 });
    } finally {
      unsubscribe();
    }
  });

  test("keeps global polling alive when the selected planet context changes", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("global-active-missions");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});
    const stopPolling = store.startPolling("mission-control", ["kind:global-active-missions"], 5, "mission-control");

    try {
      await store.refresh(key, async () => ({ revision: ++loads }));
      store.setContext("0xabc", "planet-7");
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(loads).toBeGreaterThan(1);
    } finally {
      stopPolling();
      unsubscribe();
    }
  });

  test("reference-counts equivalent named pollers", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("global-active-missions");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});
    const releaseFirst = store.startPolling("mission-control", ["kind:global-active-missions"], 5, "mission-control");
    const releaseSecond = store.startPolling("mission-control", ["kind:global-active-missions"], 5, "mission-control");

    try {
      await store.refresh(key, async () => ({ revision: ++loads }));
      releaseFirst();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(loads).toBeGreaterThan(1);
    } finally {
      releaseSecond();
      unsubscribe();
    }
  });

  test("keeps a canonical Galaxy transport independent of route-local cancellation", async () => {
    const originalFetch = globalThis.fetch;
    let transportSignal: AbortSignal | undefined;
    let markTransportStarted!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined;
      markTransportStarted();
      return Promise.resolve(
        new Response(JSON.stringify({ planets: [] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      const request = store.system(2, 44);
      await transportStarted;
      await expect(request).resolves.toEqual({ planets: [] });
      expect(transportSignal?.aborted).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not fan an older overview response into newer canonical snapshots", async () => {
    const originalFetch = globalThis.fetch;
    let resolveOlder!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    let requests = 0;
    const overview = (revision: number) => ({
      fleetVisibility: { revision },
      planetsResponse: { planets: [], revision },
      queues: { revision },
      settlement: { homePlanetId: null, planet: null, revision },
    });
    globalThis.fetch = (() => {
      requests += 1;
      return requests === 1 ? olderResponse : Promise.resolve(Response.json(overview(2)));
    }) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      const older = store.overview("0xabc", "planet-7");
      await Promise.resolve();
      const newer = store.overview("0xabc", "planet-7", { fresh: true });
      await expect(newer).resolves.toMatchObject({
        planetsResponse: { revision: 2 },
      });
      resolveOlder(Response.json(overview(1)));
      await expect(older).resolves.toMatchObject({
        planetsResponse: { revision: 1 },
      });

      expect(store.snapshot<{ planets: unknown[]; revision: number }>(store.key("planets", "0xabc"))?.data).toEqual({ planets: [], revision: 2 });
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
      await expect(
        store.runWriteTransaction({
          confirm: async () => ({ status: "0x1" }),
          key: "defense:start:4",
          label: "Defense production",
          send: async () => "0xabc",
          indexing: store.indexing.refresh([]),
        }),
      ).resolves.toBe(true);
    } finally {
      unsubscribe();
    }

    expect(phases).toEqual(["pending", "confirming", "confirmed", "indexing", "success"]);
    expect(store.snapshot<WriteTransactionState>(store.writeTransactionKey("defense:start:4"))?.data).toMatchObject({
      key: "defense:start:4",
      phase: "success",
      stage: "applied",
      txHash: "0xabc",
    });
  });

  test("waits only for a backend-published resource revision after a confirmed write", async () => {
    const store = new BackendDataStore("https://api.test");
    let reads = 0;

    await expect(
      store.waitForIndexedResource(
        async () => ({
          resourceSnapshot: reads++ === 0 ? { blockNumber: "10", transactionHash: "0xolder" } : { blockNumber: "11", transactionHash: "0xconfirmed" },
        }),
        { receiptBlockNumber: "11", transactionHash: "0xconfirmed" },
        { attempts: 2, intervalMs: 0 },
      ),
    ).resolves.toMatchObject({
      resourceSnapshot: { transactionHash: "0xconfirmed" },
    });
    expect(reads).toBe(2);
  });

  test("invalidates subscribed canonical resources after indexed write convergence", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("infrastructure", "0xabc", "planet-7");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});

    try {
      await store.refresh(key, async () => ({ revision: ++loads }), {
        planetId: "planet-7",
        wallet: "0xabc",
      });
      await expect(
        store.runWriteTransaction({
          confirm: async () => ({ status: "0x1" }),
          invalidateTags: ["wallet:0xabc", "planet:planet-7"],
          key: "building:start:planet-7",
          label: "Building upgrade",
          send: async () => "0xabc",
          indexing: store.indexing.refresh([]),
        }),
      ).resolves.toBe(true);
      expect(loads).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  test("forces affected resources stale and refreshes them when confirmed indexing times out", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("shipyard", "0xabc", "planet-7");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});

    try {
      await store.refresh(key, async () => ({ revision: ++loads }), {
        planetId: "planet-7",
        wallet: "0xabc",
      });
      const timeoutPlan = (store as any).createIndexingPlan(async () => {
        throw new Error("The confirmed resource change is still syncing with the game API.");
      });

      await expect(
        store.runWriteTransaction({
          confirm: async () => ({ status: "0x1" }),
          invalidateTags: ["wallet:0xabc", "planet:planet-7"],
          indexing: timeoutPlan,
          key: "ship:start:planet-7",
          label: "Ship production",
          send: async () => "0xconfirmed",
        }),
      ).resolves.toBe(false);

      expect(loads).toBe(2);
      expect(store.snapshot<{ revision: number }>(key)?.data).toEqual({ revision: 2 });
    } finally {
      unsubscribe();
    }
  });

  test("runs independent indexing plans concurrently", async () => {
    const store = new BackendDataStore("https://api.test");
    let starts = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createPlan = (store as any).createIndexingPlan.bind(store) as (runner: () => Promise<void>) => unknown;
    const first = createPlan(async () => {
      starts += 1;
      await barrier;
    });
    const second = createPlan(async () => {
      starts += 1;
      await barrier;
    });
    const parallel = store.indexing.all([first as any, second as any]);

    const pending = store.runWriteTransaction({
      confirm: async () => ({ status: "0x1" }),
      indexing: parallel,
      key: "supply:batch",
      label: "Supply 2 transports",
      send: async () => "0xconfirmed",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(starts).toBe(2);

    release();
    await expect(pending).resolves.toBe(true);
  });

  test("marks inactive batch-mutation resources stale without pretending they refreshed", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("shipyard", "0xabc", "planet-origin");
    let loads = 0;

    await store.refresh(key, async () => ({ revision: ++loads }), {
      planetId: "planet-origin",
      wallet: "0xabc",
    });
    await store.invalidate(["planet:planet-origin"], {
      priority: "transaction",
    });

    expect(loads).toBe(1);
    expect(store.snapshot<{ revision: number }>(key)).toMatchObject({
      data: { revision: 1 },
      freshness: "delayed",
    });
  });

  test("uses the same shared gate for receipt writes and non-receipt mutations", async () => {
    const store = new BackendDataStore("https://api.test");
    let release!: () => void;
    const held = store.runExclusiveTransaction(
      "player-profile:update",
      "Profile update",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();

    let sent = false;
    await expect(
      store.runWriteTransaction({
        confirm: async () => ({}),
        key: "defense:start:4",
        label: "Defense production",
        send: async () => {
          sent = true;
          return "0xabc";
        },
      }),
    ).resolves.toBe(false);
    expect(sent).toBe(false);

    release();
    await held;
  });
});
