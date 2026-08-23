import { describe, expect, test } from "bun:test";
import { BackendDataStore, backendDataStoreFor, disposeBackendDataStoresExcept, retainBackendDataStore } from "./backendDataStore";
import type { WriteTransactionState } from "./transactionActionGate";

describe("BackendDataStore", () => {
  test("disposes an unused shared API-base store after its last owner releases it", async () => {
    const apiBaseUrl = "https://leased-store.test";
    disposeBackendDataStoresExcept([]);
    const first = backendDataStoreFor(apiBaseUrl);
    const release = retainBackendDataStore(apiBaseUrl);

    release();
    await new Promise((resolve) => setTimeout(resolve, 1));

    const second = backendDataStoreFor(apiBaseUrl);
    expect(second).not.toBe(first);
    disposeBackendDataStoresExcept([]);
  });

  test("keeps a shared API-base store alive when strict-effect cleanup reacquires its lease", async () => {
    const apiBaseUrl = "https://strict-lease.test";
    disposeBackendDataStoresExcept([]);
    const first = backendDataStoreFor(apiBaseUrl);
    const releaseFirst = retainBackendDataStore(apiBaseUrl);

    releaseFirst();
    const releaseSecond = retainBackendDataStore(apiBaseUrl);
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect(backendDataStoreFor(apiBaseUrl)).toBe(first);
    releaseSecond();
    await new Promise((resolve) => setTimeout(resolve, 1));
    disposeBackendDataStoresExcept([]);
  });

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

  test("tears down prior-wallet cache entries without clearing public resources on account switch", async () => {
    const store = new BackendDataStore("https://api.test");
    const walletKey = store.key("planets", "0xaaa");
    const publicKey = store.key("global-active-missions");
    await store.refresh(walletKey, async () => ({ planets: [] }), { wallet: "0xaaa" });
    await store.refresh(publicKey, async () => ({ missions: [] }));

    store.setContext("0xaaa");
    store.setContext("0xbbb");

    expect(store.snapshot(walletKey)).toBeUndefined();
    expect(store.snapshot(publicKey)?.data).toEqual({ missions: [] });
    expect(store.refetch(walletKey)).toBeUndefined();
  });

  test("clears account-owned snapshots published outside a registered resource on wallet switch", () => {
    const store = new BackendDataStore("https://api.test");
    const release = store.connectChainEvents("0xaaa");
    const healthKey = store.key("chain-sync-health", "0xaaa");

    store.setContext("0xaaa");
    expect(store.snapshot(healthKey)).toBeDefined();
    store.setContext("0xbbb");
    expect(store.snapshot(healthKey)).toBeUndefined();
    release();
  });

  test("clears wallet-scoped write status on account switch", async () => {
    const store = new BackendDataStore("https://api.test");
    store.setContext("0xaaa");

    await store.runExclusiveTransaction("profile:0xaaa", "Save profile", async () => ({ ok: true }), "0xaaa");
    expect(store.snapshot<WriteTransactionState>(store.writeTransactionKey("profile:0xaaa", "0xaaa"))?.data?.phase).toBe("success");

    store.setContext("0xbbb");
    expect(store.snapshot(store.writeTransactionKey("profile:0xaaa", "0xaaa"))).toBeUndefined();
    expect(store.snapshot(store.writeTransactionKey(undefined, "0xaaa"))).toBeUndefined();
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

  test("updates a shared poller's refresh policy when a later owner needs a different cadence", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("global-active-missions");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});
    const releaseSlow = store.startPolling("mission-control", ["kind:global-active-missions"], 60_000, "background");
    const releaseFast = store.startPolling("mission-control", ["kind:global-active-missions"], 5, "mission-control");

    try {
      await store.refresh(key, async () => ({ revision: ++loads }));
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(loads).toBeGreaterThan(1);
    } finally {
      releaseSlow();
      releaseFast();
      unsubscribe();
    }
  });

  test("restores the remaining owner's polling policy when a faster lease releases", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("global-active-missions");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});
    const releaseSlow = store.startPolling("mission-control", ["kind:global-active-missions"], 60_000, "background");
    const releaseFast = store.startPolling("mission-control", ["kind:global-active-missions"], 5, "mission-control");

    try {
      await store.refresh(key, async () => ({ revision: ++loads }));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(loads).toBeGreaterThan(1);
      releaseFast();
      const afterFastLease = loads;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(loads).toBe(afterFastLease);
    } finally {
      releaseSlow();
      unsubscribe();
    }
  });

  test("deduplicates settlement invite reservation inside the store-owned write preparation boundary", async () => {
    const originalFetch = globalThis.fetch;
    let redemptions = 0;
    globalThis.fetch = (async () => {
      redemptions += 1;
      return Response.json({ allianceId: "1", invitee: "0xabc" });
    }) as unknown as typeof fetch;
    const store = new BackendDataStore("https://api.test");

    try {
      const [first, second] = await Promise.all([
        store.prepareSettlementRedemptions("0xabc", { paidAllianceInviteSecret: "secret" }),
        store.prepareSettlementRedemptions("0xAbC", { paidAllianceInviteSecret: "secret" }),
      ]);
      expect(first).toEqual(second);
      expect(redemptions).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("coalesces hidden scheduled refreshes into one foreground catch-up", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    let visibilityListener: (() => void) | undefined;
    const document = {
      visibilityState: "hidden" as "hidden" | "visible",
      addEventListener: (name: string, listener: () => void) => {
        if (name === "visibilitychange") visibilityListener = listener;
      },
      removeEventListener() {},
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    const store = new BackendDataStore("https://api.test");
    const key = store.key("global-active-missions");
    let loads = 0;
    const unsubscribe = store.subscribeKey(key, () => {});

    try {
      await store.refresh(key, async () => ({ revision: ++loads }));
      store.scheduleRefresh("hidden-refresh", ["kind:global-active-missions"], 1, "mission-control");
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      expect(loads).toBe(1);
      document.visibilityState = "visible";
      visibilityListener?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(loads).toBe(2);
    } finally {
      unsubscribe();
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("reference-counts one chain-event bridge per wallet", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const sources: Array<{ closed: boolean }> = [];
    class TestEventSource {
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        sources.push({ closed: false });
      }
      addEventListener() {}
      close() {
        sources.at(-1)!.closed = true;
      }
    }
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { EventSource: TestEventSource },
    });

    try {
      const store = new BackendDataStore("https://api.test");
      const releaseFirst = store.connectChainEvents("0xabc");
      const releaseSecond = store.connectChainEvents("0xAbC");
      expect(sources).toHaveLength(1);
      releaseFirst();
      expect(sources[0]!.closed).toBe(false);
      releaseSecond();
      expect(sources[0]!.closed).toBe(true);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
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

  test("joins an in-flight overview transport for an exact fresh read", async () => {
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
      expect(requests).toBe(1);
      resolveOlder(Response.json(overview(1)));
      await expect(older).resolves.toMatchObject({
        planetsResponse: { revision: 1 },
      });
      await expect(newer).resolves.toMatchObject({
        planetsResponse: { revision: 1 },
      });

      expect(store.snapshot<{ planets: unknown[]; revision: number }>(store.key("planets", "0xabc"))?.data).toEqual({ planets: [], revision: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("owns the wallet/planet aggregate and publishes its canonical projections", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0xabc";
    const planet = {
      planetId: "planet-7",
      galaxy: 1,
      system: 2,
      position: 3,
      isHomePlanet: true,
      queues: { building: null, defense: null, ship: null },
      resources: { metal: "1", crystal: "1", deuterium: "1" },
    };
    const overview = {
      fleetVisibility: { incoming: [], joinableAttacks: [], outgoing: [], returning: [] },
      planetsResponse: { wallet, homePlanetId: "planet-7", planets: [planet] },
      queues: { wallet, homePlanetId: "planet-7", building: null, defense: null, ship: null, research: null },
      settlement: { wallet, hasFirstPlanet: true, homePlanetId: "planet-7", planet },
    };
    globalThis.fetch = (async () => Response.json(overview)) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      await expect(store.walletPlanetSync(wallet, "planet-7")).resolves.toMatchObject({ settlement: { homePlanetId: "planet-7" } });
      expect(store.snapshot(store.queries.planets(wallet).key)?.data).toMatchObject({ homePlanetId: "planet-7" });
      expect(store.snapshot(store.queries.queues(wallet, "planet-7").key)?.data).toMatchObject({ homePlanetId: "planet-7" });
      expect(store.snapshot(store.queries.fleetVisibility(wallet).key)?.data).toMatchObject({ incoming: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps the prior canonical settlement when an aggregate overview is incomplete", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0xabc";
    const settlement = { wallet, hasFirstPlanet: true, homePlanetId: "planet-7", planet: { planetId: "planet-7" } };
    const overview = {
      fleetVisibility: { incoming: [], joinableAttacks: [], outgoing: [], returning: [] },
      planetsResponse: { wallet, homePlanetId: "planet-7", planets: [] },
      queues: { wallet, homePlanetId: "planet-7", building: null, defense: null, ship: null, research: null },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      return Response.json(path.endsWith("/settlement") ? settlement : overview);
    }) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      await store.settlement(wallet);
      await expect(store.overview(wallet, "planet-7")).resolves.toMatchObject({ planetsResponse: { homePlanetId: "planet-7" } });
      expect(store.snapshot(store.queries.settlement(wallet).key)?.data).toMatchObject({ homePlanetId: "planet-7" });
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

  test("normalizes equivalent query options into one canonical key", () => {
    const store = new BackendDataStore("https://api.test");
    expect(store.key("highscores", { page: 1, pageSize: 25, category: "total" })).toBe(
      store.key("highscores", { category: "total", pageSize: 25, page: 1 }),
    );
  });

  test("deduplicates concurrent global mission reads", async () => {
    const originalFetch = globalThis.fetch;
    let resolve!: (response: Response) => void;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return new Promise<Response>((nextResolve) => {
        resolve = nextResolve;
      });
    }) as unknown as typeof fetch;
    try {
      const store = new BackendDataStore("https://api.test");
      const first = store.globalActiveMissions();
      const second = store.globalActiveMissions();
      expect(first).toBe(second);
      await Promise.resolve();
      expect(calls).toBe(1);
      resolve(new Response(JSON.stringify({ missions: [] }), { headers: { "content-type": "application/json" } }));
      await expect(first).resolves.toEqual({ missions: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("releases inactive dynamic resources after the bounded retention window", async () => {
    const store = new BackendDataStore("https://api.test", { inactiveResourceRetentionMs: 5 });
    const key = store.key("system", 1, 2, { detail: "full" });
    const unsubscribe = store.subscribeKey(key, () => {});
    await store.refresh(key, async () => ({ planets: [] }));
    unsubscribe();
    await new Promise<void>((resolve) => setTimeout(resolve, 15));

    expect(store.snapshot(key)).toBeUndefined();
    expect(store.refetch(key)).toBeUndefined();
  });

  test("allows different wallet write scopes to progress independently", async () => {
    const store = new BackendDataStore("https://api.test");
    let releaseFirst!: () => void;
    const first = store.runExclusiveTransaction(
      "profile:0xaaa",
      "Profile update",
      () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
      "0xaaa",
    );
    await Promise.resolve();
    let secondRan = false;
    const second = store.runExclusiveTransaction(
      "profile:0xbbb",
      "Profile update",
      async () => { secondRan = true; },
      "0xbbb",
    );
    await second;
    expect(secondRan).toBe(true);
    releaseFirst();
    await first;
  });
});
