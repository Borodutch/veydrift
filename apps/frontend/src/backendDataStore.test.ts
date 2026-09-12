import { describe, expect, test } from "bun:test";
import { BackendDataStore, backendDataStoreFor, disposeBackendDataStoresExcept, retainBackendDataStore } from "./backendDataStore";
import type { WriteTransactionState } from "./transactionActionGate";

const appliedTransactionStatusReader = async (transactionHash: string) => ({
  events: [],
  indexedEventCount: 0,
  latestIndexedBlock: "123",
  phase: "applied" as const,
  receiptBlock: "123",
  transactionHash,
});

describe("BackendDataStore", () => {
  test("fresh origin reads wait past an older request, coalesce, and do not block other planets", async () => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    let complete!: (response: Response) => void;
    const requests: string[] = [];
    globalThis.fetch = (async input => {
      const url = String(input);
      requests.push(url);
      if (requests.length === 1) return new Promise<Response>(resolve => { complete = resolve; });
      return Response.json({ planetId: new URL(url).searchParams.get("planetId"), ships: [{ id: 0, count: 0 }] });
    }) as typeof fetch;
    try {
      const old = store.shipyard("0xabc", "7");
      await Promise.resolve();
      const fresh = Array.from({ length: 10 }, () => store.shipyard("0xabc", "7", { fresh: true }));
      expect((await store.shipyard("0xabc", "8")).planetId).toBe("8");
      expect(requests).toHaveLength(2);
      complete(Response.json({ planetId: "7", ships: [{ id: 0, count: 2 }] }));
      expect((await old).ships[0]?.count).toBe(2);
      expect((await Promise.all(fresh)).every(state => state.ships[0]?.count === 0)).toBe(true);
      expect(requests).toHaveLength(3);
      expect(store.snapshot(store.queries.shipyard("0xabc", "7").key)?.data).toMatchObject({ ships: [{ id: 0, count: 0 }] });
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });
  test("late reads cannot recreate eviction timers after disposal", async () => {
    const store = new BackendDataStore("https://api.test");
    let finish!: (value: number) => void;
    const request = store.refresh("late", () => new Promise<number>(resolve => { finish = resolve; }));
    await Promise.resolve();
    store.dispose();
    expect((store as any).evictionTimers.size).toBe(0);
    finish(1);
    await request.catch(() => {});
    await Promise.resolve();
    expect((store as any).evictionTimers.size).toBe(0);
    expect(store.snapshot("late")).toBeUndefined();
  });

  test("equivalent query defaults and canonical media IDs share one request", async () => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ entityKind: "planet", entityId: "7", media: null, version: 1 });
    }) as typeof fetch;
    try {
      const pairs = [
        [store.queries.planets("0xABc"), store.queries.planets("0xabc")],
        [store.queries.infrastructure("0xABc", "7"), store.queries.infrastructure("0xabc", "7")],
        [store.queries.raidFinderDebris(), store.queries.raidFinderDebris({ limit: 250 })],
        [store.queries.raidFinderRifters(), store.queries.raidFinderRifters({ limit: 250 })],
        [store.queries.highscores({ currentWallet: "0xABc" }), store.queries.highscores({ currentWallet: "0xabc" })],
        [store.queries.fleetArchive("0xabc"), store.queries.fleetArchive("0xabc", { page: 1, pageSize: 25 })],
        [store.queries.missileArchive("0xabc"), store.queries.missileArchive("0xabc", { page: 1, pageSize: 25 })],
        [store.queries.globalMissionArchive(), store.queries.globalMissionArchive({ page: 1, pageSize: 25, summaryOnly: false })],
        [store.queries.playerActivity("0xabc"), store.queries.playerActivity("0xabc", { page: 1, pageSize: 25, includeProjected: false })],
        [store.queries.watchedPlanets("0xabc"), store.queries.watchedPlanets("0xabc", { page: 1, pageSize: 25, timeoutMs: 1234 })],
        [store.queries.highscores(100), store.queries.highscores({ limit: 100, signal: new AbortController().signal })],
        [store.queries.entityMedia("planet", "007"), store.queries.entityMedia("planet", "7")],
      ] as const;
      for (const [first, second] of pairs) {
        expect(first.key).toBe(second.key);
        await Promise.all([first.read(), second.read()]);
      }
      expect(urls).toHaveLength(pairs.length);
      expect(store.queries.fleetArchive("0xabc", { page: 2 }).key).not.toBe(store.queries.fleetArchive("0xabc").key);
      expect(store.queries.highscores({ currentWallet: "0xabc" }).key).not.toBe(store.queries.highscores().key);
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

  test("explicit queue identity never changes when settlement loads; plans normalize the same wallet", async () => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    globalThis.fetch = (async () => Response.json({ homePlanetId: "7", hasFirstPlanet: true })) as unknown as typeof fetch;
    try {
      const before = store.queries.queues("0xABc", "7").key;
      await store.settlement("0xabc");
      expect(store.queries.queues("0xabc", "7").key).toBe(before);
      expect(store.queries.queues("0xabc", "8").key).not.toBe(before);
      expect(store.indexing.resourceChange("0xABc", "7").keys).toContain(store.queries.infrastructure("0xabc", "7").key);
      // Arbitrary codes and secrets remain case-sensitive, even if they look like addresses.
      const code = "0xABcdefabcdefabcdefabcdefabcdefabcdefabcd";
      expect(store.queries.paidAllianceInviteResolution(code).key).not.toBe(store.queries.paidAllianceInviteResolution(code.toLowerCase()).key);
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

  test.each(["inspection", "validation", "paid-invite"])("disposal aborts %s transport", async kind => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    let transportSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init?.signal ?? undefined;
      transportSignal?.addEventListener("abort", () => reject(transportSignal?.reason), { once: true });
    })) as typeof fetch;
    try {
      const query = kind === "inspection" ? store.queries.referralCodeInspection("0xabc", "code")
        : kind === "validation" ? store.queries.referralCodeValidation("code", "0xabc")
        : store.queries.paidAllianceInviteResolution("secret");
      const read = query.read().catch(error => error);
      await Promise.resolve();
      store.dispose();
      expect(transportSignal?.aborted).toBe(true);
      expect(await read).toBeInstanceOf(Error);
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

  test.each(["profile", "watch"])("%s HTTP saves release the wallet gate but keep their own lock", async kind => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    let finishSave!: (response: Response) => void;
    let started!: () => void;
    const savingStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      started();
      return new Promise<Response>(resolve => { finishSave = resolve; });
    }) as typeof fetch;
    const provider = { async request<T>() { return "0x1234" as T; } };
    const save = () => kind === "profile" ? store.savePlayerProfile(provider, "0xabc", "Player", null)
      : store.setPlanetWatched(provider, "0xabc", "7", false);
    try {
      const saving = save();
      await savingStarted;
      await expect(save()).rejects.toThrow("already in progress");
      await expect(store.runExclusiveTransaction("unrelated", "Unrelated action", async () => "sent", "0xabc")).resolves.toBe("sent");
      finishSave(Response.json(kind === "profile" ? { wallet: "0xabc", displayName: "Player", description: null } : { watched: true, planetId: "7" }));
      await saving;
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

  test.each(["wallet change", "dispose"])("metadata signature cannot start an HTTP write after %s", async change => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    store.setContext("0xabc");
    let fetches = 0;
    let finishSignature!: (signature: string) => void;
    let started!: () => void;
    const signing = new Promise<void>(resolve => { started = resolve; });
    const provider = { async request<T>() {
      started();
      return await new Promise<string>(resolve => { finishSignature = resolve; }) as T;
    } };
    globalThis.fetch = (async (_input: RequestInfo | URL) => { fetches++; return Response.json({}); }) as typeof fetch;
    try {
      const saved = store.savePlayerProfile(provider, "0xabc", "Player", null).catch(error => error);
      await signing;
      if (change === "dispose") store.dispose(); else store.setContext("0xdef");
      finishSignature("0x1234");
      expect(await saved).toBeInstanceOf(Error);
      expect(fetches).toBe(0);
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

  test("media HTTP saves do not hold the wallet gate and duplicate entity saves stay scoped", async () => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    let finishSave!: (response: Response) => void;
    let started!: () => void;
    const savingStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ version: 1 });
      started();
      return new Promise<Response>(resolve => { finishSave = resolve; });
    }) as typeof fetch;
    const provider = { async request<T>() { return "0x1234" as T; } };
    try {
      const saving = store.saveEntityMedia(provider, "0xabc", "planet", "7", "");
      await savingStarted;
      await expect(store.saveEntityMedia(provider, "0xabc", "planet", "7", "")).rejects.toThrow("already in progress");
      await expect(store.runExclusiveTransaction("unrelated", "Unrelated action", async () => "sent", "0xabc")).resolves.toBe("sent");
      finishSave(Response.json({ entityKind: "planet", entityId: "7", media: null, version: 2 }));
      await expect(saving).resolves.toMatchObject({ version: 2 });
    } finally { store.dispose(); globalThis.fetch = originalFetch; }
  });

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

  test("starts the Attack randomness safety probe outside saturated gameplay reads", async () => {
    const originalFetch = globalThis.fetch;
    const store = new BackendDataStore("https://api.test");
    const releases: Array<() => void> = [];
    const blockers = [1, 2, 3].map((id) => store.refresh(`background:${id}`, () =>
      new Promise<{ id: number }>((resolve) => {
        releases.push(() => resolve({ id }));
      })
    ));
    let readinessRequests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.test/randomness-readiness");
      readinessRequests += 1;
      return Response.json({ ready: true, reasons: [] });
    }) as unknown as typeof fetch;

    try {
      await Promise.resolve();
      await expect(store.randomnessReadiness()).resolves.toEqual({ ready: true, reasons: [] });
      expect(readinessRequests).toBe(1);
    } finally {
      for (const release of releases) release();
      await Promise.all(blockers);
      globalThis.fetch = originalFetch;
    }
  });

  test("fresh reads still share the canonical in-flight transport", async () => {
    const store = new BackendDataStore("https://api.test");
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { revision: loads };
    };

    const [first, second] = await Promise.all([store.refresh("fleet-visibility:wallet", load, { }), store.refresh("fleet-visibility:wallet", load, { })]);

    expect(first).toEqual({ revision: 1 });
    expect(second).toEqual({ revision: 1 });
    expect(loads).toBe(1);
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
      await store.refresh(key, load, {
        wallet: "0xabc",
        planetId: "planet-7",
      });
      expect(store.isFresh(key)).toBe(true);
      expect(store.snapshot<{ revision: number }>(key)?.data).toEqual({ revision: 1 });
      expect(loads).toBe(1);

      await store.invalidate(["planet:planet-7"], { });
      expect(loads).toBe(2);
      expect(store.snapshot<{ revision: number }>(key)?.data).toEqual({
        revision: 2,
      });
    } finally {
      unsubscribe();
    }
  });

  test("ten indexed invalidations during an in-flight request produce one trailing read", async () => {
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
      await Promise.all(Array.from({ length: 10 }, () => store.invalidate(["planet:planet-7"], { })));
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

  test.each([false, true])("registered refresh cleanup evicts inactive entries after a slow read (failure=%s)", async fails => {
    const store = new BackendDataStore("https://api.test", { inactiveResourceRetentionMs: 10 });
    const key = store.key("infrastructure", "0xabc", "7");
    let release!: () => void;
    let slow = false;
    try {
      await store.refresh(key, async () => {
        if (slow) {
          await new Promise<void>(resolve => { release = resolve; });
          if (fails) throw new Error("temporary backend failure");
        }
        return { level: 1 };
      }, { wallet: "0xabc", planetId: "7" });
      slow = true;
      const read = store.refetch(key)!.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(store.snapshot(key)).toBeDefined();
      release();
      await read;
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(store.snapshot(key)).toBeUndefined();
      expect(store.refetch(key)).toBeUndefined();
    } finally { release?.(); store.dispose(); }
  });

  test("scheduled referral refresh reloads only that wallet's dashboard", async () => {
    const store = new BackendDataStore("https://api.test");
    store.setContext("0xabc");
    const loads = [0, 0, 0];
    const keys = [store.queries.referralDashboard("0xabc").key, store.queries.referralDashboard("0xdef").key, store.queries.infrastructure("0xabc", "7").key];
    try {
      for (const [index, key] of keys.entries()) {
        store.subscribeKey(key, () => {});
        await store.refresh(key, async () => ({ count: ++loads[index]! }), { wallet: index === 1 ? "0xdef" : "0xabc" });
      }
      store.scheduleRefresh(keys[0]!, 0);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(loads).toEqual([2, 1, 1]);
    } finally { store.dispose(); }
  });

  test("updates a canonical resource descriptor when an equivalent surface provides newer inputs", async () => {
    const store = new BackendDataStore("https://api.test");
    const key = store.key("system", 1, 2);
    const unsubscribe = store.subscribeKey(key, () => {});
    let firstLoads = 0;
    let secondLoads = 0;

    try {
      await store.refresh(key, async () => ({ source: "first", revision: ++firstLoads }));
      await store.refresh(key, async () => ({ source: "second", revision: ++secondLoads }));
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
    const stopPolling = store.startPolling("mission-control", ["kind:global-active-missions"], 5);

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

  test("mission-scoped polling leaves active wallet projections alone", async () => {
    const store = new BackendDataStore("https://api.test");
    const wallet = "0xabc";
    const overviewKey = store.key("overview", wallet);
    const fleetKey = store.key("fleet-visibility", wallet, false);
    let overviewLoads = 0;
    let fleetLoads = 0;
    const unsubscribeOverview = store.subscribeKey(overviewKey, () => {});
    const unsubscribeFleet = store.subscribeKey(fleetKey, () => {});

    try {
      await store.refresh(overviewKey, async () => ({ revision: ++overviewLoads }), { wallet });
      await store.refresh(fleetKey, async () => ({ revision: ++fleetLoads }), { wallet });

      await store.invalidate(["kind:fleet-visibility"], { });

      expect(overviewLoads).toBe(1);
      expect(fleetLoads).toBe(2);
    } finally {
      unsubscribeOverview();
      unsubscribeFleet();
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
    const releaseFirst = store.startPolling("mission-control", ["kind:global-active-missions"], 5);
    const releaseSecond = store.startPolling("mission-control", ["kind:global-active-missions"], 5);

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
    const releaseSlow = store.startPolling("mission-control", ["kind:global-active-missions"], 60_000);
    const releaseFast = store.startPolling("mission-control", ["kind:global-active-missions"], 5);

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
    const releaseSlow = store.startPolling("mission-control", ["kind:global-active-missions"], 60_000);
    const releaseFast = store.startPolling("mission-control", ["kind:global-active-missions"], 5);

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
      store.scheduleRefresh(key, 1);
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

  test("shell and page share one gameplay sync policy and release the bridge only after both unmount", () => {
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
      const releaseFirst = store.startGameplaySync("0xabc");
      const releaseSecond = store.startGameplaySync("0xAbC");
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

      expect(store.snapshot(store.queries.planets("0xabc").key)).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("composes independent endpoint reads without an Overview fan-out", async () => {
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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      return Response.json(path.endsWith("/settlement") ? overview.settlement : path.endsWith("/planets") ? overview.planetsResponse : path.endsWith("/queues") ? overview.queues : overview.fleetVisibility);
    }) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.test");
      await Promise.all([
        store.queries.planets(wallet).read(),
        store.queries.queues(wallet, "planet-7").read(),
        store.queries.fleetVisibility(wallet).read(),
      ]);
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
    const store = new BackendDataStore("https://api.test", { transactionStatusReader: appliedTransactionStatusReader });
    const phases: string[] = [];
    const unsubscribe = store.subscribe(() => {
      const phase = store.snapshot<WriteTransactionState>(store.writeTransactionKey())?.data?.phase;
      if (phase && phases.at(-1) !== phase) phases.push(phase);
    });

    try {
      await expect(
        store.runWriteTransaction({
          key: "defense:start:4",
          label: "Defense production",
          send: async beforeSend => { beforeSend(); return "0xabc"; },
          indexing: store.indexing.production("0xabc", "planet-7", "infrastructure"),
        }),
      ).resolves.toMatchObject({ outcome: "indexed" });
    } finally {
      unsubscribe();
    }

    expect(phases).toEqual(["preparing", "pending", "confirming", "confirmed", "indexing", "applied", "success"]);
    expect(store.snapshot<WriteTransactionState>(store.writeTransactionKey("defense:start:4"))?.data).toMatchObject({
      key: "defense:start:4",
      phase: "success",
      txHash: "0xabc",
    });
  });

  test("uses backend confirmation and materialization as the write completion boundary", async () => {
    const phases = ["submitted", "confirmed", "applied"] as const;
    let reads = 0;
    const store = new BackendDataStore("https://api.test", {
      transactionPollIntervalMs: 0,
      transactionStatusReader: async (transactionHash) => ({
        events: [],
        indexedEventCount: 0,
        latestIndexedBlock: phases[reads] === "applied" ? "13" : "12",
        phase: phases[reads++] ?? "applied",
        receiptBlock: reads > 1 ? "13" : null,
        transactionHash,
      }),
    });

    await expect(store.runWriteTransaction({
      chainId: "0x2105",
      invalidateTags: ["wallet:0xabc"],
      key: "building:start:7",
      label: "Building upgrade",
      send: async () => `0x${"ab".repeat(32)}`,
    })).resolves.toMatchObject({ outcome: "indexed" });

    expect(reads).toBe(3);
    expect(store.snapshot<WriteTransactionState>(store.writeTransactionKey("building:start:7", "0xabc"))?.data).toMatchObject({
      phase: "success",
    });
  });

  test("resynchronizes on ready, ignores heartbeat revisions and scopes wallet events", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const listeners = new Map<string, (event: MessageEvent) => void>();
    class TestEventSource {
      onerror: (() => void) | null = null;
      addEventListener(name: string, listener: (event: MessageEvent) => void) { listeners.set(name, listener); }
      close() {}
    }
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { EventSource: TestEventSource },
    });

    try {
      const store = new BackendDataStore("https://api.test");
      const key = store.key("planets", "0xabc");
      let loads = 0;
      const unsubscribe = store.subscribeKey(key, () => {});
      await store.refresh(key, async () => ({ revision: ++loads }), { wallet: "0xabc" });
      const release = store.connectChainEvents("0xabc", { debounceMs: 0 });
      const syncStatus = listeners.get("sync-status")!;
      const payload = (indexedRevision: string) => ({
        data: JSON.stringify({ ready: true, connected: true, indexedRevision, subscribedToHeads: false, subscribedToLogs: false }),
      } as MessageEvent);
      syncStatus(payload("20"));
      syncStatus(payload("21"));
      for (let attempt = 0; attempt < 20 && loads < 2; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(loads).toBe(2);
      syncStatus(payload("22"));
      listeners.get("chain-event")!({ data: JSON.stringify({ wallets: ["0xother"], planetIds: ["7"] }) } as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(loads).toBe(2);
      listeners.get("chain-event")!({ data: JSON.stringify({ wallets: ["0xabc"], planetIds: ["7"] }) } as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(loads).toBe(3);
      syncStatus({ data: JSON.stringify({ ready: false, connected: true, subscribedToHeads: true, subscribedToLogs: true }) } as MessageEvent);
      expect(store.snapshot<boolean>(store.key("chain-sync-health", "0xabc"))?.data).toBe(false);
      syncStatus(payload("23"));
      syncStatus(payload("24"));
      for (let attempt = 0; attempt < 20 && loads < 4; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(loads).toBe(4);
      expect(store.snapshot<boolean>(store.key("chain-sync-health", "0xabc"))?.data).toBe(true);
      release();
      unsubscribe();
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("invalidates subscribed canonical resources after indexed write convergence", async () => {
    const store = new BackendDataStore("https://api.test", { transactionStatusReader: appliedTransactionStatusReader });
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
          invalidateTags: ["wallet:0xabc", "planet:planet-7"],
          key: "building:start:planet-7",
          label: "Building upgrade",
          send: async () => "0xabc",
          indexing: store.indexing.production("0xabc", "planet-7", "infrastructure"),
        }),
      ).resolves.toMatchObject({ outcome: "indexed" });
      expect(loads).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  test("runs independent indexing plans concurrently", async () => {
    const store = new BackendDataStore("https://api.test", { transactionStatusReader: appliedTransactionStatusReader });
    let starts = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const planetId of ["1", "2"]) {
      const key = store.queries.infrastructure("0xabc", planetId).key;
      store.subscribeKey(key, () => {});
      let initial = true;
      await store.refresh(key, async () => {
        if (initial) { initial = false; return {}; }
        starts++; await barrier; return {};
      }, { wallet: "0xabc", planetId });
    }
    const first = store.indexing.resourceChange("0xabc", "1");
    const second = store.indexing.resourceChange("0xabc", "2");
    const parallel = store.indexing.all([first, second, first]);

    const pending = store.runWriteTransaction({
      indexing: parallel,
      key: "supply:batch",
      label: "Supply 2 transports",
      send: async () => "0xconfirmed",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(starts).toBe(2);

    release();
    await expect(pending).resolves.toMatchObject({ outcome: "indexed" });
    expect(starts).toBe(2); // The repeated first plan did not cause a second refresh.
  });

  test("store freshness policy refreshes active timed data and production, not inactive planets", async () => {
    let now = Date.now();
    const store = new BackendDataStore("https://policy.test", { now: () => now });
    store.setContext("0xabc", "7");
    const reads = { infrastructure: 0, inactive: 0, fleet: 0, research: 0, profile: 0 };
    for (const [name, kind, planetId, active, value] of [
      ["infrastructure", "infrastructure", "7", true, {}],
      ["inactive", "infrastructure", "8", false, {}],
      ["fleet", "fleet-visibility", undefined, true, {}],
      ["research", "research", "7", true, { queue: { active: true } }],
      ["profile", "profile", undefined, true, {}],
    ] as const) {
      const key = store.key(kind, "0xabc", planetId);
      if (active) store.subscribeKey(key, () => {});
      await store.refresh(key, async () => { reads[name]++; return value; }, { wallet: "0xabc", planetId });
    }
    now += 20_000;
    (store as any).refreshGameplay();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toEqual({ infrastructure: 2, inactive: 1, fleet: 2, research: 2, profile: 1 });
    now += 120_000;
    (store as any).refreshGameplay();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads.profile).toBe(2);
    expect(reads.inactive).toBe(1);
    store.dispose();
  });

  test("active settlement keeps recovering beyond eight reads without resubmitting", async () => {
    let now = Date.now();
    let reads = 0;
    const store = new BackendDataStore("https://settlement-recovery.test", { now: () => now });
    store.setContext("0xabc");
    const key = store.queries.settlement("0xabc").key;
    const unsubscribe = store.subscribeKey(key, () => {});
    try {
      await store.refresh(key, async () => ({ hasFirstPlanet: ++reads >= 12 }), { wallet: "0xabc" });
      for (let i = 0; i < 11; i++) {
        now += 20_000;
        (store as any).refreshGameplay();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(reads).toBe(12);
      expect(store.snapshot<any>(key)?.data.hasFirstPlanet).toBe(true);
      store.setContext("0xdef");
      now += 20_000;
      (store as any).refreshGameplay();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(reads).toBe(12);
    } finally { unsubscribe(); store.dispose(); }
  });

  test("a late stale Overview cannot erase missions loaded by the fleet endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let resolveOverview!: (response: Response) => void;
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/overview")
      ? new Promise<Response>(resolve => { resolveOverview = resolve; })
      : Response.json({ outgoing: [{ missionId: "75223" }], returning: [] })) as typeof fetch;
    const store = new BackendDataStore("https://fleet.test");
    try {
      const older = store.overview("0xabc");
      await store.queries.fleetVisibility("0xabc").read();
      resolveOverview(Response.json({ fleetVisibility: { outgoing: [], returning: [] }, planetsResponse: { planets: [] }, queues: {} }));
      await older;
      expect(store.snapshot<any>(store.queries.fleetVisibility("0xabc").key)?.data.outgoing).toEqual([{ missionId: "75223" }]);
    } finally { globalThis.fetch = originalFetch; store.dispose(); }
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
    });

    expect(loads).toBe(1);
    expect(store.snapshot<{ revision: number }>(key)).toMatchObject({
      data: { revision: 1 },
      freshness: "delayed",
    });
  });

  test("a stalled metadata mutation cannot block contract submissions", async () => {
    const store = new BackendDataStore("https://api.test", { transactionStatusReader: appliedTransactionStatusReader });
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
        key: "defense:start:4",
        label: "Defense production",
        send: async () => {
          sent = true;
          return "0xabc";
        },
      }),
    ).resolves.toMatchObject({ outcome: "indexed" });
    expect(sent).toBe(true);

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
