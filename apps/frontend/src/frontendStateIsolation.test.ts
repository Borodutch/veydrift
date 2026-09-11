import { expect, test } from "bun:test";
import { BackendDataStore, backendScopeTags } from "./backendDataStore";
import { backendQueryLoading } from "./useBackendDataQuery";
import { batchSupplySourcesFromSnapshot } from "./PlayableMvpApp";
import { fetchGameApiJson, resolvePaidAllianceInvite } from "./walletFlow";

test("query loading distinguishes first load, background refresh, errors, and disabled keys", () => {
  expect(backendQueryLoading(undefined, false)).toEqual({ isInitialLoading: false, isRefreshing: false });
  expect(backendQueryLoading(undefined, true)).toEqual({ isInitialLoading: true, isRefreshing: false });
  expect(backendQueryLoading({ freshness: "failed", generation: 1 }, true)).toEqual({ isInitialLoading: false, isRefreshing: false });
  expect(backendQueryLoading({ freshness: "refreshing", generation: 2, data: [] }, true))
    .toEqual({ isInitialLoading: false, isRefreshing: true });
  expect(backendQueryLoading({ freshness: "delayed", generation: 3, data: [] }, true))
    .toEqual({ isInitialLoading: false, isRefreshing: false });
});

test("ten planet reads start independently and a slow refresh cannot block another planet or endpoint", async () => {
  const store = new BackendDataStore("https://independent.test");
  const releases: Array<(value: number) => void> = [];
  const reads = Array.from({ length: 10 }, (_, i) => store.refresh(`planet:${i}:resources`, () =>
    new Promise<number>(resolve => { releases[i] = resolve; })));
  await Promise.resolve();
  try {
    expect(releases.filter(Boolean)).toHaveLength(10);
    releases[1]!(11);
    await expect(reads[1]).resolves.toBe(11);
    expect(backendQueryLoading(store.snapshot("planet:0:resources"), true).isInitialLoading).toBe(true);
    expect(backendQueryLoading(store.snapshot("planet:1:resources"), true).isInitialLoading).toBe(false);
    await expect(store.refresh("planet:0:shipyard", async () => ["cargo"])).resolves.toEqual(["cargo"]);
  } finally {
    releases.forEach((release, i) => release(i));
    await Promise.all(reads);
  }
  let releaseRefresh!: (value: number) => void;
  const refresh = store.refresh("planet:0:resources", () => new Promise<number>(resolve => { releaseRefresh = resolve; }));
  await Promise.resolve();
  try {
    expect(store.snapshot("planet:0:resources")?.data).toBe(0);
    expect(backendQueryLoading(store.snapshot("planet:0:resources"), true))
      .toEqual({ isInitialLoading: false, isRefreshing: true });
    await expect(store.refresh("planet:1:resources", async () => 12)).resolves.toBe(12);
    await expect(store.refresh("planet:2:resources", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(store.snapshot("planet:2:resources")?.data).toBe(2);
    expect(backendQueryLoading(store.snapshot("planet:1:resources"), true).isRefreshing).toBe(false);
  } finally {
    releaseRefresh(10);
    await refresh;
    store.dispose();
  }
});

test("API writes keep independent transports and never retry a failed mutation", async () => {
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  const requests: Array<{ url: string; init?: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return String(url).endsWith("/resolve") ? new Promise<Response>(resolve => { release = resolve; }) : Response.json({ ready: true });
  }) as typeof fetch;
  try {
    const pending = resolvePaidAllianceInvite("https://api.test", "secret-fixture");
    await expect(fetchGameApiJson("https://api.test/planet/2", "Planet")).resolves.toEqual({ ready: true });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ secret: "secret-fixture" });
    expect(requests[0]?.init?.signal).not.toBe(requests[1]?.init?.signal);
    release(Response.json({ message: "Temporarily unavailable" }, { status: 503 }));
    await expect(pending).rejects.toThrow();
    expect(requests).toHaveLength(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Supply projects the same sorted sources for opening and confirmation; scopes stay exact", () => {
  const source = (planetId: string, position: number) => ({
    planetId, name: planetId, galaxy: 1, system: 1, position, coordinates: `1:1:${position}`,
    resources: { metal: "10", crystal: "20", deuterium: "30" }, launchableShips: [{ id: 0, count: 2 }],
  });
  const snapshot = { wallet: "0xaaa", fleetSlots: { active: 0, limit: 5 }, technologyLevels: {}, sources: [source("far", 12), source("near", 2)] };
  const projected = batchSupplySourcesFromSnapshot(snapshot, { galaxy: 1, system: 1, position: 1 });
  expect(projected.map(source => source.planetId)).toEqual(["near", "far"]);
  expect(snapshot.sources.map(source => source.planetId)).toEqual(["far", "near"]);
  expect(backendScopeTags("0xABC", "2", "kind:shipyard", "kind:queues"))
    .toEqual(["wallet:0xabc", "planet:2", "kind:shipyard", "kind:queues"]);
  expect(backendScopeTags(undefined, undefined, "kind:research")).toEqual(["kind:research"]);
});
