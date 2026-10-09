import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "../../backend/src/indexer";
import { createRequestHandler } from "../../backend/src/server";
import { moonCreatedTopic, type SettledPlanetEvent } from "../../backend/src/evm";
import { BackendDataStore } from "../src/backendDataStore";
import { batchSupplySourcesFromSnapshot, batchSupplySourceForPlanet, missionInventoryAfterRead, missionMoonShipyardState, prepareBatchSupplyConfirmation, prepareMissionLaunchInventory } from "../src/PlayableMvpApp";
import { buildBatchSupplyPlan, maximumBatchSupplyResource } from "../src/batchSupplyPlanner";
import { emptyMissionShips } from "../src/galaxyActions";
import { currentResources } from "../src/currentResources";
import { fetchGameApiJson, type ChainShipyardState, type ManagedPlanetResponse, type SupplySourcesResponse } from "../src/walletFlow";
import { fetchGameApiJson as legacyFetch, playerPlanetTacticalSignals as legacySignals } from "./fixtures/legacyInventory65";
import { playerPlanetTacticalSignals } from "../src/components/InspectPages";
const owner = "0x2222222222222222222222222222222222222222";
const resources = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const origin = { planetId: "1", name: "Origin", owner, galaxy: 1, system: 1, position: 1, coordinates: "1:1:1", fields: 100, temperature: 0, resources, lastSettledAt: "1000", blockNumber: "1", transactionHash: "0xp", eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000 } as SettledPlanetEvent & { coordinates: string };
const target = { ...origin, planetId: "580", position: 2 } as unknown as ManagedPlanetResponse;
const topic = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
function fixture() {
  const db = new Database(":memory:");
  const indexer = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { database: db, runStartupBackfill: false });
  indexer.applyEvent(origin); indexer.applyEvent({ ...origin, planetId: "580", position: 2, transactionHash: "0xt" });
  indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xships", logIndex: "0x0", topics: ["0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf", topic(1n), topic(4n)], data: topic(6n) });
  indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xmoon", logIndex: "0x0", topics: [moonCreatedTopic, "0x" + owner.slice(2).padStart(64, "0"), topic(1n)], data: "0x" + [1n, 1n, 1n, 12n, 8777n].map(n => topic(n).slice(2)).join("") });
  db.query("INSERT OR REPLACE INTO contract_moon_resources VALUES ('1','1000000','1000000','1000000','1000','0xmoon','2','0')").run();
  (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
  const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => handler(new Request(String(input), init))) as typeof fetch;
  const store = new BackendDataStore("http://localhost"); store.setContext(owner, "1");
  return { indexer, handler, store, close() { store.dispose(); globalThis.fetch = originalFetch; db.close(); } };
}
const normal = { originPlanetId: "1", origin, target, ships: { ...emptyMissionShips(), largeCargo: 1 }, mission: "transport", speedPercent: 100, cargo: { metal: "10000" } };
function supply(store: BackendDataStore, orders: ReturnType<typeof buildBatchSupplyPlan>["orders"], targetIsMoon = false) {
  return prepareBatchSupplyConfirmation({ queries: store.queries, account: owner, target, targetIsMoon, orders, shipTypesBySource: {}, levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview() {}, onShortfall() {} });
}

test("real cached HTTP/store invalidation retains six canonical ships only as display, never send authority", async () => {
  const f = fixture();
  try {
    expect(f.indexer.resourceProjectionContext().canonicalBaseline).toBe(true);
    expect(f.indexer.moonResourcesAsOfNow("1")).toEqual(resources);
    // Genuine legacy no-anchor data still works, not a blanket cold-index ban.
    await prepareMissionLaunchInventory(f.store, owner, normal);
    f.indexer.recordResourceProjectionWatermark("3", "1000", "0x" + "a".repeat(64));
    const query = f.store.queries.shipyard(owner, "1");
    const good = await query.read();
    const snapshot = await f.store.queries.supplySources(owner, "580").read();
    const options = { targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 10000 }, sources: batchSupplySourcesFromSnapshot(snapshot, target) };
    const orders = buildBatchSupplyPlan(options).orders;
    expect(orders).toHaveLength(1);
    await supply(f.store, orders);
    f.indexer.invalidateResourceProjectionWatermark("removedLog");
    expect(f.indexer.resourceProjectionContext()).toMatchObject({ timestamp: null, safeToProject: false, canonicalBaseline: false });
    expect(f.indexer.planet("1")?.resources).toEqual(resources);
    expect(f.indexer.shipRows("1").find(s => s.id === 4)?.count).toBe(6);
    expect(f.indexer.moonResourcesAsOfNow("1")).toBeNull();
    await expect(f.store.shipyard(owner, "1", { fresh: true })).rejects.toThrow();
    const retained = f.store.snapshot<ChainShipyardState>(query.key)!;
    expect(retained.data?.ships.find(s => s.id === 4)?.count).toBe(6);
    expect(missionInventoryAfterRead(retained.data!, retained.error)?.fleetLaunchAvailable).toBe(false);
    let sends = 0;
    const send = () => { sends++; };
    await expect(prepareMissionLaunchInventory(f.store, owner, normal).then(send)).rejects.toThrow();
    await expect(prepareMissionLaunchInventory(f.store, owner, { ...normal, originIsMoon: true }).then(send)).rejects.toThrow();
    await expect(supply(f.store, orders).then(send)).rejects.toThrow();
    await expect(supply(f.store, orders, true).then(send)).rejects.toThrow();
    // Exercise the production coordinated write boundary, not just the planner promise.
    const provider = { async request() { sends++; throw new Error("Unexpected wallet send"); } };
    for (const [i, prepare] of [
      () => prepareMissionLaunchInventory(f.store, owner, normal),
      () => prepareMissionLaunchInventory(f.store, owner, { ...normal, originIsMoon: true }),
      () => supply(f.store, orders),
      () => supply(f.store, orders, true),
    ].entries()) {
      const outcome = await f.store.runWriteTransaction({ key: "invalidated:" + i, label: "Launch", prepare,
        send: async beforeSend => { beforeSend(); return provider.request(); } });
      expect(outcome.outcome).toBe("not-submitted");
      expect(outcome.error).toBeDefined();
    }
    expect(sends).toBe(0);
    expect(good.ships.find(s => s.id === 4)?.count).toBe(6);
    expect(orders[0]?.cargo.metal).toBe(10000); // Never rewrite the user's draft.
    // Clearing repair status alone must not turn a removed anchor into a legacy baseline.
    f.indexer.clearPendingReconciliationReason(f.indexer.snapshot().pendingReconciliationReason!);
    expect(f.indexer.resourceProjectionContext().canonicalBaseline).toBe(false);
    expect(f.indexer.moonResourcesAsOfNow("1")).toBeNull();
    f.indexer.recordResourceProjectionWatermark("3", "1000", "0x" + "b".repeat(64));
    await prepareMissionLaunchInventory(f.store, owner, normal);
    await supply(f.store, orders);
  } finally { f.close(); }
});

for (const unsafe of [{ stale: true }, { degraded: true }, { safeToProject: false }, { indexer: { safeToProject: false } }, { indexer: { safeToServeIndexedState: false } }] as const) {
  test("successful unsafe snapshots fail fresh normal/Supply/moon-parent preparation: " + JSON.stringify(unsafe), async () => {
    const f = fixture();
    try {
      const good = await f.store.shipyard(owner, "1");
      const snapshot = await f.store.queries.supplySources(owner, "580").read();
      const options = { targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 10000 }, sources: batchSupplySourcesFromSnapshot(snapshot, target) };
      const orders = buildBatchSupplyPlan(options).orders;
      expect(orders).toHaveLength(1);
      const bad = { ...good, ...unsafe };
      const sources = batchSupplySourcesFromSnapshot({ ...snapshot, ...unsafe }, target);
      expect(buildBatchSupplyPlan({ ...options, sources }).orders).toHaveLength(0);
      expect(maximumBatchSupplyResource({ ...options, requested: { metal: 0 }, sources }, "metal")).toBe(0);
      expect(batchSupplySourceForPlanet(target, bad).unavailableReason).toBeDefined();
      expect(missionMoonShipyardState({ shipyardState: bad, moonState: { ...good, stale: false, moon: { exists: true, planetId: "1" } } as any })?.fleetLaunchAvailable).toBe(false);
      // Ordinary store still transports a successful HTTP response: no rejecting mock read.
      globalThis.fetch = (async input => Response.json(String(input).includes("supply-sources") ? { ...snapshot, ...unsafe } : bad)) as typeof fetch;
      let sends = 0;
      await expect(prepareMissionLaunchInventory(f.store, owner, normal).then(() => { sends++; })).rejects.toThrow("Current fleet inventory");
      await expect(supply(f.store, orders).then(() => { sends++; })).rejects.toThrow("Current fleet inventory");
      // A healthy Supply snapshot does not sanitize its unsafe moon-parent shipyard.
      globalThis.fetch = (async input => Response.json(String(input).includes("supply-sources") ? snapshot : bad)) as typeof fetch;
      await expect(supply(f.store, orders, true).then(() => { sends++; })).rejects.toThrow("Current fleet inventory");
      expect(sends).toBe(0);
      expect(orders[0]?.cargo.metal).toBe(10000);
    } finally { f.close(); }
  });
}

test("actual deployed legacy transport cannot feed nullable new HTTP stock to its positive-fallback renderer", async () => {
  const f = fixture();
  try {
    // A per-body unavailable projection preserves the healthy global index and raw history.
    f.indexer.hasPendingPlanetResources = id => id === "1";
    const url = "http://localhost/wallet/" + owner + "/planets";
    for (let warm = 0; warm < 2; warm++) {
      const current = await fetchGameApiJson<any>(url, "Planets");
      const planet = current.planets.find((p: any) => p.planetId === "1");
      expect(planet.resources).toEqual(resources);
      expect(planet.resourcesAsOfNow).toBeNull();
      expect(planet.tactical.raidableResources).toBeNull();
      expect(playerPlanetTacticalSignals(planet, undefined, null).find(r => r.label === "Resources")?.value).toBe("Resources unavailable");
      // Demonstrate the real historical bug, not a rewritten imitation of the consumer.
      expect(legacySignals(planet, undefined, null).find(r => r.label === "Resources")?.value).toContain("1M M");
      let rendered = false;
      await expect(legacyFetch<any>(url, "Planets").then(payload => { rendered = true; return legacySignals(payload.planets[0], undefined, null); })).rejects.toMatchObject({ status: 503, code: "resource_view_upgrade_required" });
      expect(rendered).toBe(false);
      const response = await f.handler(new Request(url));
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("vary")).toContain("Accept");
    }
    // The same fence owns warm public caches and compressed responses, not only wallet routes.
    for (const path of ["/highscores?live=1&pageSize=10", "/universe/galaxies/1/systems/1?detail=full"]) {
      for (let warm = 0; warm < 2; warm++) {
        const capable = await f.handler(new Request("http://localhost" + path, { headers: { accept: "application/json; resource-view=nullable-v1", "accept-encoding": "gzip" } }));
        expect(capable.status).toBe(200);
        await capable.arrayBuffer();
        const legacy = await f.handler(new Request("http://localhost" + path, { headers: { "accept-encoding": "gzip" } }));
        expect(legacy.status).toBe(503);
        expect(legacy.headers.get("content-encoding")).toBeNull();
        expect((await legacy.json() as any).error).toBe("resource_view_upgrade_required");
      }
    }
    f.indexer.hasPendingPlanetResources = () => false;
    const healthy = await legacyFetch<any>(url, "Planets");
    expect(legacySignals(healthy.planets[0], undefined, null).find(r => r.label === "Resources")?.value).toContain("500K M");
  } finally { f.close(); }
});

test("new client old backend keeps legacy omitted-current fields usable without CORS preflight", async () => {
  const originalFetch = globalThis.fetch;
  const old = { resources, ships: [{ id: 4, count: 6 }], fleetSlots: { active: 0, limit: 1 }, fleetLaunchAvailable: true, technologyLevels: {} };
  globalThis.fetch = (async (_input, init) => {
    expect(new Headers(init?.headers).get("accept")).toBe("application/json; resource-view=nullable-v1");
    expect([...new Headers(init?.headers).keys()]).toEqual(["accept"]);
    return Response.json(old); // Old producer ignores media parameters and omits new fields.
  }) as typeof fetch;
  const store = new BackendDataStore("http://localhost"); store.setContext(owner, "1");
  try {
    expect(currentResources(await store.shipyard(owner, "1"))).toEqual(resources);
    await prepareMissionLaunchInventory(store, owner, normal);
  } finally { store.dispose(); globalThis.fetch = originalFetch; }
});


test("baseline removal invalidates warm caches even without a prior numeric horizon, across reader restart", async () => {
  const f = fixture();
  try {
    const versions = () => [f.indexer.responseCacheVersion(), f.indexer.walletResponseCacheVersion(owner), f.indexer.universeSystemSummaryVersion(1, 1)];
    const baselineVersions = versions();
    const url = "http://localhost/universe/galaxies/1/systems/1?detail=full";
    const before = await fetchGameApiJson<any>(url, "System");
    expect(before.planets.find((p: any) => p.occupiedBy?.planetId === "1").publicState.resources).toEqual(resources);
    f.indexer.invalidateResourceProjectionWatermark("removedLog");
    f.indexer.clearPendingReconciliationReason(f.indexer.snapshot().pendingReconciliationReason!);
    expect(versions().every((version, i) => version !== baselineVersions[i])).toBe(true);
    const after = await fetchGameApiJson<any>(url, "System");
    expect(after.planets.find((p: any) => p.occupiedBy?.planetId === "1").publicState.resources).toBeNull();
    const reader = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { database: (f.indexer as any).db, readOnly: true, assumeSchemaReady: true, runStartupBackfill: false });
    expect(reader.resourceProjectionContext()).toMatchObject({ safeToProject: false, canonicalBaseline: false, timestamp: null });
    expect(reader.moonResourcesAsOfNow("1")).toBeNull();
  } finally { f.close(); }
});
