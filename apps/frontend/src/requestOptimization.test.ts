import { expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import type { Eip1193Provider } from "./walletFlow";

const wallet = "0x2222222222222222222222222222222222222222";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("resume, deferred tags and SSE-ready share recovery; real events still refresh after an in-flight read", async () => {
  const originals = ["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const lifecycle = new Map<string, () => void>();
  const events = new Map<string, (event: MessageEvent) => void>();
  class EventSource {
    addEventListener(name: string, listener: (event: MessageEvent) => void) { events.set(name, listener); }
    close() {}
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { EventSource, addEventListener: (name: string, listener: () => void) => lifecycle.set(name, listener), removeEventListener() {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener: (name: string, listener: () => void) => lifecycle.set(name, listener), removeEventListener() {} } });
  const store = new BackendDataStore("https://recovery.test");
  store.setContext(wallet);
  const key = store.key("infrastructure", wallet, "7");
  const unsubscribe = store.subscribeKey(key, () => {});
  let loads = 0;
  let release: (() => void) | undefined;
  try {
    await store.refresh(key, async () => {
      loads++;
      if (loads === 2) await new Promise<void>(resolve => { release = resolve; });
      return { loads };
    }, { wallet, planetId: "7" });
    store.connectChainEvents(wallet, { debounceMs: 0 });
    (store as unknown as { deferHiddenRefresh(tags: string[]): void }).deferHiddenRefresh([`wallet:${wallet}`, "kind:infrastructure"]);
    lifecycle.get("online")!();
    lifecycle.get("pageshow")!();
    lifecycle.get("visibilitychange")!();
    events.get("sync-status")!({ data: JSON.stringify({ ready: true, connected: true, subscribedToHeads: false, subscribedToLogs: true }) } as MessageEvent);
    await tick();
    expect(loads).toBe(2);
    lifecycle.get("pageshow")!();
    lifecycle.get("online")!();
    // Ordinary healthy heartbeats are not reconnect barriers.
    events.get("sync-status")!({ data: JSON.stringify({ ready: true, connected: true, subscribedToHeads: false, subscribedToLogs: true }) } as MessageEvent);
    await tick();
    release!(); await tick(); await tick();
    expect(loads).toBe(2);
    // A second resync starts a read; real post-commit events must not be suppressed.
    const pending = store.refresh(key, async () => {
      loads++;
      if (loads === 3) await new Promise<void>(resolve => { release = resolve; });
      return { loads };
    }, { wallet, planetId: "7" });
    await tick();
    for (let index = 0; index < 10; index++) events.get("chain-event")!({ data: JSON.stringify({ wallets: [wallet], planetIds: ["7"] }) } as MessageEvent);
    await tick();
    release!(); await pending; await tick(); await tick();
    expect(loads).toBe(4);
    // A reconnect after a read starts must close the missed-event window.
    const beforeReconnect = store.refresh(key, async () => {
      loads++;
      if (loads === 5) await new Promise<void>(resolve => { release = resolve; });
      return { loads };
    }, { wallet, planetId: "7" });
    await tick();
    events.get("sync-status")!({ data: JSON.stringify({ connected: false }) } as MessageEvent);
    events.get("sync-status")!({ data: JSON.stringify({ ready: true, connected: true, subscribedToHeads: false, subscribedToLogs: true }) } as MessageEvent);
    await tick();
    release!(); await beforeReconnect; await tick(); await tick();
    expect(loads).toBe(6);
  } finally {
    release?.(); unsubscribe(); store.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("scoped planet events spare off-chain metadata, but retain alliance scores and unknown-event recovery", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new Map<string, (event: MessageEvent) => void>();
  class EventSource {
    addEventListener(name: string, listener: (event: MessageEvent) => void) { events.set(name, listener); }
    close() {}
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { EventSource } });
  const store = new BackendDataStore("https://events.test");
  const counts = new Map<string, number>();
  const unsubs: Array<() => void> = [];
  try {
    for (const kind of ["infrastructure", "profile", "entity-media", "runtime-config", "alliance"]) {
      const key = store.key(kind, wallet);
      unsubs.push(store.subscribeKey(key, () => {}));
      await store.refresh(key, async () => { counts.set(kind, (counts.get(kind) ?? 0) + 1); return {}; }, { wallet });
    }
    store.connectChainEvents(wallet, { debounceMs: 0 });
    events.get("chain-event")!({ data: JSON.stringify({ wallets: ["0xother"], planetIds: ["7"] }) } as MessageEvent);
    await tick(); expect(counts.get("infrastructure")).toBe(1);
    events.get("chain-event")!({ data: JSON.stringify({ wallets: [wallet], planetIds: ["7"] }) } as MessageEvent);
    await tick(); await tick();
    expect(counts.get("infrastructure")).toBe(2);
    expect(counts.get("alliance")).toBe(2);
    for (const kind of ["profile", "entity-media", "runtime-config"]) expect(counts.get(kind)).toBe(1);
    events.get("chain-event")!({ data: "{}" } as MessageEvent);
    await tick(); await tick();
    for (const kind of ["profile", "entity-media", "runtime-config"]) expect(counts.get(kind)).toBe(2);
  } finally {
    unsubs.forEach(unsubscribe => unsubscribe()); store.dispose();
    if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("home queue consumers share transport; colony queues remain independent", async () => {
  const store = new BackendDataStore("https://queues.test");
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const releases: Array<() => void> = [];
  globalThis.fetch = (async url => {
    urls.push(String(url));
    return new Promise<Response>(resolve => releases.push(() => resolve(Response.json({ homePlanetId: "1", research: { planetId: "1" } }))));
  }) as typeof fetch;
  try {
    await store.refresh(store.key("settlement", wallet), async () => ({ homePlanetId: "1" }), { wallet });
    expect(store.queries.queues(wallet, "2").key).not.toBe(store.queries.queues(wallet, "1").key);
    expect(store.indexing.production(wallet, "1", "shipyard").keys.filter(key => key.startsWith("queues:")))
      .toEqual([store.queries.queues(wallet, "1").key, store.queries.queues(wallet).key]);
    expect(store.indexing.production(wallet, "2", "shipyard").keys.filter(key => key.startsWith("queues:")))
      .toEqual([store.queries.queues(wallet, "2").key, store.queries.queues(wallet).key]);
    const reads = [store.queries.queues(wallet, "1").read(), store.queries.queues(wallet, "1").read(), store.queries.queues(wallet, "2").read()];
    await tick();
    expect(urls).toHaveLength(2);
    expect(urls.some(url => url.includes("planetId=2"))).toBe(true);
    releases[1]!();
    await expect(reads[2]).resolves.toMatchObject({ research: { planetId: "1" } });
    releases[0]!();
    await Promise.all(reads);
  } finally { releases.forEach(release => release()); globalThis.fetch = originalFetch; store.dispose(); }
});

test("watch and profile mutations refresh dependencies without touching shipyard or other wallets", async () => {
  const store = new BackendDataStore("https://mutations.test");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ wallet, displayName: "New name", description: "Hello" })) as unknown as typeof fetch;
  const provider = { request: async () => "0x1234" } as Eip1193Provider;
  const counts = new Map<string, number>();
  const unsubs: Array<() => void> = [];
  const kinds = ["watched-planets", "profile", "player-highscore", "planets", "shipyard", "alliance"];
  try {
    for (const owner of [wallet, "0xother"]) for (const kind of kinds) {
      const key = store.key(kind, owner);
      unsubs.push(store.subscribeKey(key, () => {}));
      await store.refresh(key, async () => { counts.set(key, (counts.get(key) ?? 0) + 1); return {}; }, { wallet: owner });
    }
    await store.setPlanetWatched(provider, wallet, "7", true);
    expect(counts.get(store.key("watched-planets", wallet))).toBe(2);
    expect(counts.get(store.key("shipyard", wallet))).toBe(1);
    expect(counts.get(store.key("watched-planets", "0xother"))).toBe(1);
    await store.savePlayerProfile(provider, wallet, "New name", "Hello");
    expect(counts.get(store.key("player-highscore", wallet))).toBe(2);
    expect(counts.get(store.key("planets", wallet))).toBe(2);
    expect(counts.get(store.key("profile", wallet))).toBe(1);
    expect(store.value<{ displayName: string }>("profile", wallet)?.displayName).toBe("New name");
    expect(counts.get(store.key("shipyard", wallet))).toBe(1);
    expect(counts.get(store.key("planets", "0xother"))).toBe(1);
  } finally { unsubs.forEach(unsubscribe => unsubscribe()); store.dispose(); globalThis.fetch = originalFetch; }
});

test("archive safety refresh is slow while active mission counts keep refreshing", async () => {
  let now = Date.now();
  const store = new BackendDataStore("https://poll.test", { now: () => now });
  store.setContext(wallet);
  const counts = new Map<string, number>();
  const unsubs: Array<() => void> = [];
  try {
    for (const kind of ["fleet-archive", "global-mission-archive", "missile-archive", "global-active-mission-count"]) {
      const key = store.key(kind);
      unsubs.push(store.subscribeKey(key, () => {}));
      await store.refresh(key, async () => { counts.set(kind, (counts.get(kind) ?? 0) + 1); return {}; });
    }
    const poll = () => (store as unknown as { refreshGameplay(): void }).refreshGameplay();
    now += 11_000;
    poll(); await tick();
    expect(counts.get("global-active-mission-count")).toBe(2);
    expect(counts.get("fleet-archive")).toBe(1);
    expect(counts.get("global-mission-archive")).toBe(1);
    expect(counts.get("missile-archive")).toBe(1);
    await store.invalidate(["kind:fleet-archive"]);
    expect(counts.get("fleet-archive")).toBe(2);
    now += 121_000;
    poll(); await tick();
    expect(counts.get("global-mission-archive")).toBe(2);
  } finally { unsubs.forEach(unsubscribe => unsubscribe()); store.dispose(); }
});
