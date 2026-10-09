import { expect, test, setSystemTime } from "bun:test";
import { BackendDataStore } from "../src/backendDataStore";
import { backendQueryLoading } from "../src/useBackendDataQuery";
import { shouldPreloadSupplyForPage } from "../src/PlayableMvpApp";
import type { SupplySourcesResponse } from "../src/walletFlow";

const payload = (wallet = "0xaaa"): SupplySourcesResponse => ({ wallet, technologyLevels: {}, fleetSlots: { active: 0, limit: 10 }, fleetLaunchAvailable: true, sources: [] });
const readyRead = (store: BackendDataStore, wallet = "0xaaa", target = "7") => {
  const query = store.queries.supplySources(wallet, target);
  return store.isFresh(query.key) ? Promise.resolve(store.snapshot<SupplySourcesResponse>(query.key)!.data!) : query.read();
};

test("Supply preloads only relevant screens and shares fresh/in-flight data with modal readiness", async () => {
  for (const page of ["overview", "infrastructure", "research", "shipyard", "defenses", "moon"] as const) expect(shouldPreloadSupplyForPage(page)).toBe(true);
  for (const page of ["rankings", "galaxy", "mission-control", "rift", "alliance", "planet", "moon-inspect", "battle-reports"] as const) expect(shouldPreloadSupplyForPage(page)).toBe(false);
  const oldFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  store.setContext("0xaaa", "7", "8453");
  let finish!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (() => { calls++; return new Promise(resolve => { finish = resolve; }); }) as typeof fetch;
  try {
    const query = store.queries.supplySources("0xaaa", "7");
    const preload = readyRead(store);
    await Promise.resolve();
    expect(backendQueryLoading(store.snapshot(query.key), true).isInitialLoading).toBe(true);
    const opening = readyRead(store);
    expect(calls).toBe(1);
    finish(Response.json(payload()));
    await Promise.all([preload, opening]);
    expect(backendQueryLoading(store.snapshot(query.key), true).isInitialLoading).toBe(false);
    await readyRead(store); await readyRead(store);
    expect(calls).toBe(1);
    // Confirmation retains its commit barrier, even while the snapshot is fresh.
    const confirming = store.queries.supplySources("0xaaa", "7", { fresh: true }).read();
    await Promise.resolve();
    expect(calls).toBe(2);
    finish(Response.json(payload())); await confirming;
    setSystemTime(new Date(Date.now() + 5_001));
    const expired = readyRead(store);
    await Promise.resolve();
    expect(calls).toBe(3);
    finish(Response.json(payload())); await expired;
  } finally { setSystemTime(); store.dispose(); globalThis.fetch = oldFetch; }
});

test("Supply preload failures are visible and retry without poisoned loading", async () => {
  const oldFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  let calls = 0;
  globalThis.fetch = (async () => ++calls === 1 ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(payload())) as typeof fetch;
  try {
    const key = store.queries.supplySources("0xaaa", "7").key;
    await expect(readyRead(store)).rejects.toThrow();
    expect(store.snapshot(key)?.error).toBeTruthy();
    expect(backendQueryLoading(store.snapshot(key), true).isInitialLoading).toBe(false);
    await readyRead(store);
    expect(store.snapshot(key)?.error).toBeUndefined();
    expect(calls).toBe(2);
  } finally { store.dispose(); globalThis.fetch = oldFetch; }
});

test.each(["wallet", "chain"] as const)("late Supply preloads cannot cross %s changes", async scope => {
  const oldFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  store.setContext("0xaaa", "7", "8453");
  let finish!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (() => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json(payload(scope === "wallet" ? "0xbbb" : "0xaaa")))) as typeof fetch;
  try {
    const oldKey = store.queries.supplySources("0xaaa", "7").key;
    const preload = readyRead(store);
    await Promise.resolve();
    const wallet = scope === "wallet" ? "0xbbb" : "0xaaa";
    store.setContext(wallet, "7", scope === "chain" ? "84532" : "8453");
    finish(Response.json(payload()));
    await preload;
    expect(store.snapshot(oldKey)).toBeUndefined();
    expect(store.isFresh(oldKey)).toBe(false);
    await readyRead(store, wallet);
    expect(calls).toBe(2);
    expect(store.snapshot<SupplySourcesResponse>(store.queries.supplySources(wallet, "7").key)?.data?.wallet).toBe(wallet);
    // Target identity cannot silently exclude the wrong destination from sources.
    expect(store.queries.supplySources(wallet, "8").key).not.toBe(oldKey);
  } finally { store.dispose(); globalThis.fetch = oldFetch; }
});


test("shell hex/gameplay decimal chains and unknown bootstrap IDs preserve ready and pending Supply", async () => {
  const oldFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  store.setContext("0xaaa", "7");
  let finish!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (() => { calls++; return new Promise(resolve => { finish = resolve; }); }) as typeof fetch;
  try {
    const query = store.queries.supplySources("0xaaa", "7");
    const loading = readyRead(store);
    await Promise.resolve();
    store.setContext("0xaaa", undefined, "0x2105");
    store.setContext("0xaaa", "7", "8453");
    store.setContext("0xaaa", "7");
    finish(Response.json(payload())); await loading;
    expect(store.snapshot(query.key)?.data).toEqual(payload());
    for (const chain of ["0x2105", "8453", undefined, "0x02105"]) {
      store.setContext("0xaaa", "7", chain);
      await readyRead(store);
    }
    expect(calls).toBe(1);
    expect(store.isFresh(query.key)).toBe(true);
    store.setContext("0xaaa", "7", "84532");
    expect(store.snapshot(query.key)).toBeUndefined();
  } finally { store.dispose(); globalThis.fetch = oldFetch; }
});
