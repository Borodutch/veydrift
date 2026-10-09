import { afterEach, expect, setSystemTime, test } from "bun:test";
import { SettlementIndexer } from "../../backend/src/indexer";
import { createRequestHandler } from "../../backend/src/server";
import { shipQueuedTopic, shipQueueTimingSetTopic, shipCompletedTopic, type SettledPlanetEvent } from "../../backend/src/evm";
import { BackendDataStore } from "../src/backendDataStore";
import { batchSupplySourcesFromSnapshot, batchSupplySourceForPlanet, replanBatchSupplyForConfirmation, batchSupplyPlanMatchesOrders } from "../src/PlayableMvpApp";
import { buildBatchSupplyPlan, maximumBatchSupplyResource } from "../src/batchSupplyPlanner";
import { fleetMissionCargoCapacity, fleetMissionFuelCost, fleetMissionDistance } from "../src/fleetMissionRules";
import type { ChainShipyardState, ManagedPlanetResponse, SupplySourcesResponse } from "../src/walletFlow";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const owner = "0x2222222222222222222222222222222222222222";
const topic = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
const words = (...ns: bigint[]) => "0x" + ns.map(n => topic(n).slice(2)).join("");
const origin = { planetId: "1", name: "New Zion", owner, galaxy: 1, system: 1, position: 1, coordinates: "1:1:1", fields: 100, temperature: 0, resources: { metal: "1121802", crystal: "848981", deuterium: "53067" }, lastSettledAt: "1000", blockNumber: "1", transactionHash: "0xorigin", eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000 } as SettledPlanetEvent & { coordinates: string };
const target = { ...origin, planetId: "580", position: 2, coordinates: "1:1:2" } as unknown as ManagedPlanetResponse;
afterEach(() => setSystemTime());
function fixture() {
  const indexer = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { runStartupBackfill: false });
  indexer.applyEvent(origin);
  (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
  indexer.applyEvent({ ...origin, planetId: "580", position: 2, transactionHash: "0xtarget" });
  const apply = (event: string, quantity: bigint, total: bigint, block = 3n) => indexer.applyLog({ blockNumber: topic(block), blockTimestamp: topic(1030n), transactionHash: "0x" + event.slice(2, 10) + block, logIndex: "0x0", topics: [event, topic(1n), topic(4n)], data: event === planetShipCountChangedTopic ? words(total) : words(quantity, total) });
  indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xqueue", logIndex: "0x0", topics: [shipQueuedTopic, topic(1n), topic(4n)], data: words(3n, 1030n, 0n, 0n, 0n) });
  indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xqueue", logIndex: "0x1", topics: [shipQueueTimingSetTopic, topic(1n), topic(4n), topic(1030n)], data: words(1000n, 3n, 100n, 10n) });
  const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false });
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(String(input), init))) as typeof fetch;
  return { indexer, apply, fetcher };
}
function assertPlan(snapshot: SupplySourcesResponse, shipyard: ChainShipyardState, count: number) {
  const sources = batchSupplySourcesFromSnapshot(snapshot, target);
  expect(sources[0]!.ships.largeCargo).toBe(count);
  expect(sources[0]!.ships).toEqual(batchSupplySourceForPlanet(origin, shipyard).ships);
  for (const mission of ["transport", "deploy"] as const) {
    const options = { sources, targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 0 }, mission };
    expect(buildBatchSupplyPlan(options).orders).toEqual([]);
    const max = maximumBatchSupplyResource(options, "metal");
    if (count === 0) { expect(max).toBe(0); continue; }
    const plan = buildBatchSupplyPlan({ ...options, requested: { metal: max } });
    expect(plan.missing.metal).toBe(0);
    expect(plan.blockedSources).toEqual([]);
    expect(plan.orders).toHaveLength(1);
    const order = plan.orders[0]!;
    expect(order.ships.largeCargo).toBe(count);
    expect(order.ships.lightFighter).toBe(0);
    expect(order.fuelCost).toBe(fleetMissionFuelCost(order.ships, fleetMissionDistance(sources[0]!.coordinates, target), sources[0]!.driveLevels));
    expect(order.cargo.metal + order.fuelCost).toBe(fleetMissionCargoCapacity(order.ships));
    expect(order.fuelCost).toBeLessThanOrEqual(sources[0]!.resources.deuterium);
    expect(plan.shipsReturn).toBe(mission === "transport");
    const confirmed = replanBatchSupplyForConfirmation({ orders: plan.orders, sources, target, shipTypesBySource: {}, maxOrders: 1, mission });
    expect(batchSupplyPlanMatchesOrders(plan.orders, confirmed.orders)).toBe(true);
  }
}
test("warm Supply follows Shipyard through lazy production, partial/final credit and launch debits", async () => {
  setSystemTime(new Date(1009000));
  const { apply, fetcher } = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  let now = 1009000;
  const store = new BackendDataStore("http://localhost", { now: () => now });
  store.setContext(owner, "580");
  const supply = store.queries.supplySources(owner, "580");
  const shipyard = store.queries.shipyard(owner, "1");
  const stop = [store.subscribeKey(supply.key, () => {}), store.subscribeKey(shipyard.key, () => {})];
  try {
    await Promise.all([supply.read(), shipyard.read()]);
    const check = (count: number) => assertPlan(store.snapshot<SupplySourcesResponse>(supply.key)!.data!, store.snapshot<ChainShipyardState>(shipyard.key)!.data!, count);
    check(0);
    // No logs or invalidations: refresh both effective views at the shared cadence.
    for (const [at, count] of [[1019, 1], [1029, 2], [1039, 3]]) {
      now = at! * 1000; setSystemTime(new Date(now));
      (store as any).refreshGameplay();
      await new Promise(resolve => setTimeout(resolve, 0));
      check(count!);
    }
    const refresh = async () => {
      now += 10_000; setSystemTime(new Date(now));
      (store as any).refreshGameplay();
      await new Promise(resolve => setTimeout(resolve, 0));
    };
    apply(shipCompletedTopic, 1n, 1n); await refresh(); check(3);
    apply(shipCompletedTopic, 2n, 3n, 4n); await refresh(); check(3);
    const previousSources = batchSupplySourcesFromSnapshot(store.snapshot<SupplySourcesResponse>(supply.key)!.data!, target);
    const oldPlan = buildBatchSupplyPlan({ sources: previousSources, targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 60_000 } });
    expect(oldPlan.orders[0]!.ships.largeCargo).toBe(3);
    apply(planetShipCountChangedTopic, 0n, 1n, 5n); await refresh(); check(1);
    const currentSources = batchSupplySourcesFromSnapshot(store.snapshot<SupplySourcesResponse>(supply.key)!.data!, target);
    const changedPlan = replanBatchSupplyForConfirmation({ orders: oldPlan.orders, sources: currentSources, target, shipTypesBySource: {}, maxOrders: 1 });
    expect(batchSupplyPlanMatchesOrders(oldPlan.orders, changedPlan.orders)).toBe(false);
    // An already-indexed completion must not resurrect launched units.
    apply(shipCompletedTopic, 2n, 3n, 4n); await refresh(); check(1);
    const snapshot = store.snapshot<SupplySourcesResponse>(supply.key)!.data!;
    const sources = batchSupplySourcesFromSnapshot({ ...snapshot, fleetLaunchAvailable: false, fleetLaunchUnavailableReason: "Pending battle" }, target);
    expect(buildBatchSupplyPlan({ sources, targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 1 } }).orders).toEqual([]);
  } finally { stop.forEach(unsubscribe => unsubscribe()); store.dispose(); globalThis.fetch = originalFetch; }
});


test("Supply never promotes uncertain survivors, dependencies or invalidated horizons", async () => {
  setSystemTime(new Date(1040000));
  for (const scenario of ["return", "deploy", "unknown-combat", "earlier-attack"] as const) {
    const { indexer, apply, fetcher } = fixture();
    // Clear completed production through canonical completion + launch debit.
    apply(shipCompletedTopic, 3n, 3n); apply(planetShipCountChangedTopic, 0n, 0n, 4n);
    const mission = { missionId: "1", statusId: scenario === "deploy" ? 1 : 2, missionTypeId: scenario === "deploy" ? 1 : scenario === "unknown-combat" ? 3 : 0, status: scenario === "deploy" ? "Outbound" : "Returning", missionType: scenario === "deploy" ? "Deploy" : scenario === "unknown-combat" ? "Attack" : "Transport", owner, originPlanetId: scenario === "deploy" ? "580" : "1", targetPlanetId: scenario === "deploy" ? "1" : "580", departureAt: "1000", arrivalAt: "1020", returnAt: "1030", fuelCost: "0", cargo: { metal: "0", crystal: "0", deuterium: "0" }, randomnessRequestId: null, originIsMoon: false, targetIsMoon: false, ships: { largeCargo: "3" } };
    if (scenario === "unknown-combat") {
      (indexer as any).upsertCanonicalFleetMission({ ...mission, statusId: 1, status: "Outbound" });
      const { ships: _launchShips, ...scalarReturn } = mission;
      // A scalar Returning update retains launch composition, not proven survivors.
      (indexer as any).upsertCanonicalFleetMission(scalarReturn);
    } else (indexer as any).upsertCanonicalFleetMission(mission);
    if (scenario === "earlier-attack") (indexer as any).upsertCanonicalFleetMission({ ...mission, missionId: "2", statusId: 1, status: "Outbound", missionTypeId: 3, missionType: "Attack", originPlanetId: "580", targetPlanetId: "1", arrivalAt: "1010", returnAt: "1050" });
    const get = async () => {
      const response = await fetcher("http://localhost/wallet/" + owner + "/supply-sources?planetId=580");
      expect(response.headers.get("cache-control")).toBe("no-store");
      if (response.status !== 200) { expect(response.status).toBe(503); return 0; }
      const snapshot = await response.json() as SupplySourcesResponse;
      return batchSupplySourcesFromSnapshot(snapshot, target)[0]!.ships.largeCargo;
    };
    expect(await get()).toBe(0); // Reader time is not a proof horizon.
    indexer.recordResourceProjectionWatermark("5", "1040", "0x" + "a".repeat(64));
    const proven = scenario === "return" || scenario === "deploy";
    expect(await get()).toBe(proven ? 3 : 0);
    expect(await get()).toBe(proven ? 3 : 0); // Warm HTTP read.
    indexer.invalidateResourceProjectionWatermark("removedLog");
    expect(await get()).toBe(0);
    indexer.recordResourceProjectionWatermark("5", "1040", "0x" + "a".repeat(64));
    (indexer as any).setMetadata("resourceProjectionRevision", "-1");
    expect(await get()).toBe(0);
    indexer.recordResourceProjectionWatermark("5", "1040", "0x" + "a".repeat(64));
    (indexer as any).setMetadata("resourceProjectionTimestamp", "broken");
    expect(await get()).toBe(0);
  }
});
