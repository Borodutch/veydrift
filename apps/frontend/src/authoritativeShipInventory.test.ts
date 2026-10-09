import { playerPlanetTacticalSignals } from "./components/InspectPages";
import { planetDetailRefreshResultPlanet } from "./components/PlanetDetail";
import { expect, test } from "bun:test";
import { missionShipInventoryBlocker, prepareBatchSupplyConfirmation, shipyardStateForMissionActions, supplyLaunchSlots, batchSupplySourceForPlanet, batchSupplySourcesFromSnapshot, missionMoonShipyardState } from "./PlayableMvpApp";
import { fleetLaunchRequirementBlocker, missionInventory, type ChainMoonState, type SupplySourcesResponse } from "./walletFlow";
import { buildBatchSupplyPlan, maximumBatchSupplyResource } from "./batchSupplyPlanner";
const resources = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const planet = { planetId: "1", name: "Origin", coordinates: "1:1:1", galaxy: 1, system: 1, position: 1, resources };
test("explicit unknown launchable counts cannot revive stale canonical ships", () => {
  const raw = { ships: [{ id: 4, count: 6, cost: resources }], launchableShips: null };
  expect(missionInventory(raw).ships[0]!.count).toBe(0);
  expect(batchSupplySourceForPlanet(planet, { ...raw, resources, technologyLevels: {} }).ships.largeCargo).toBe(0);
  const moon = { wallet: "owner", homePlanetId: "1", moon: { exists: true, planetId: "1" }, fleet: raw.ships, ships: raw.ships, launchableShips: null } as unknown as ChainMoonState;
  expect(missionMoonShipyardState({ moonState: moon, shipyardState: null })?.ships).toEqual([]);
});
test("nine-source authoritative zero and null resources block six-ship proposals", () => {
  const snapshot: SupplySourcesResponse = { wallet: "owner", fleetLaunchAvailable: true, fleetSlots: { active: 0, limit: 15 }, technologyLevels: {}, sources: Array.from({length: 9}, (_, i) => ({ ...planet, planetId: String(i + 1), position: i + 1, launchableShips: [{ id: 4, count: 6 }] })) };
  const target = { galaxy: 1, system: 2, position: 1 };
  const options = { targetCoordinates: target, selectedPlanetIds: new Set(snapshot.sources.map(s => s.planetId)), requested: { metal: 9 * 140000 }, sourceCargoOverrides: Object.fromEntries(snapshot.sources.map(s => [s.planetId, { metal: 140000 }])) };
  const plan = buildBatchSupplyPlan({ ...options, sources: batchSupplySourcesFromSnapshot(snapshot, target) });
  expect(plan.orders).toHaveLength(9);
  expect(plan.orders.every(o => o.ships.largeCargo === 6)).toBe(true);
  for (const missing of ["ships", "resources"] as const) {
    const next = { ...snapshot, sources: snapshot.sources.map(s => ({ ...s, ...(missing === "ships" ? { launchableShips: [{ id: 4, count: 0 }] } : { resources: null }) })) };
    const sources = batchSupplySourcesFromSnapshot(next, target);
    expect(sources.every(s => Boolean(s.unavailableReason))).toBe(true);
    expect(buildBatchSupplyPlan({ ...options, sources }).orders).toEqual([]);
  }
});

test("batch slot constraints are distinct from effective display slots and null fails closed", () => {
  const snapshot = { fleetSlots: { active: 0, limit: 15 }, batchFleetSlots: { active: 15, limit: 15 } } as SupplySourcesResponse;
  expect(supplyLaunchSlots(snapshot, false)).toEqual({ active: 15, limit: 15 });
  expect(supplyLaunchSlots(snapshot, true)).toEqual({ active: 0, limit: 15 });
  expect(supplyLaunchSlots({ ...snapshot, batchFleetSlots: null }, false)).toBeNull();
  const { batchFleetSlots, ...oldBackend } = snapshot;
  expect(supplyLaunchSlots(oldBackend, false)).toEqual(oldBackend.fleetSlots);
});

test("failed authoritative read cannot leave a cached mission inventory launchable", () => {
  const state = shipyardStateForMissionActions({ account: "owner", activePlanetId: "1", homePlanetId: "1", shipyardError: "503", shipyardLoading: false,
    shipyardState: { wallet: "owner", homePlanetId: "1", resources, shipyardLevel: 1, naniteLevel: 0, technologyLevels: {}, ships: [{ id: 4, count: 6, cost: resources }], fleetLaunchAvailable: true, queue: null } });
  expect(state?.fleetLaunchAvailable).toBe(false);
  expect(missionInventory(state!).ships[0]!.count).toBe(0);
});

test("fresh batch preflight rejects canonical full slots before the wallet send boundary", async () => {
  const target = { ...planet, planetId: "99", system: 2 } as any;
  const snapshot = { wallet: "owner", fleetSlots: { active: 0, limit: 15 }, batchFleetSlots: { active: 15, limit: 15 }, fleetLaunchAvailable: true, technologyLevels: {}, sources: [{ ...planet, launchableShips: [{ id: 4, count: 6 }] }] } satisfies SupplySourcesResponse;
  const orders = buildBatchSupplyPlan({ sources: batchSupplySourcesFromSnapshot(snapshot, target), targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal: 140000 } }).orders;
  expect(orders[0]?.ships.largeCargo).toBe(6);
  let reads = 0;
  const queries = { supplySources: (_wallet: string, _target: string, options: { fresh: boolean }) => ({ read: async () => { reads++; expect(options.fresh).toBe(true); return snapshot; } }) } as any;
  await expect(prepareBatchSupplyConfirmation({ queries, account: "owner", target, orders, shipTypesBySource: {}, levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview() {}, onShortfall() {} })).rejects.toThrow("Supply inventory changed");
  expect(reads).toBe(1);
});

test("moon current response owns its launch guard instead of the parent snapshot", () => {
  const moon = { wallet: "owner", homePlanetId: "1", moon: { exists: true, planetId: "1" }, ships: [{ id: 4, count: 6 }], fleetLaunchAvailable: false, fleetLaunchUnavailableReason: "Moon battle pending", fleetSlots: { active: 1, limit: 15 } } as unknown as ChainMoonState;
  const parent = { wallet: "owner", homePlanetId: "1", resources, shipyardLevel: 1, naniteLevel: 0, technologyLevels: {}, ships: [{ id: 4, count: 6, cost: resources }], fleetLaunchAvailable: true, fleetSlots: { active: 0, limit: 15 }, queue: null };
  const result = missionMoonShipyardState({ moonState: moon, shipyardState: parent });
  expect(result?.fleetLaunchAvailable).toBe(false);
  expect(result?.fleetLaunchUnavailableReason).toBe("Moon battle pending");
  expect(result?.fleetSlots?.active).toBe(1);
});

test("public detail and tactical panels do not resurrect positive unknown balances", () => {
  const owned = { ...planet, fieldsUsed: 0, fieldsCapacity: 100, moon: null, queues: { building: null, defense: null, ship: null }, tactical: { raidableResources: null } } as any;
  expect(playerPlanetTacticalSignals(owned, undefined, undefined).find(row => row.label === "Resources")?.value).toBe("Resources unavailable");
  const trusted = { ...planet, publicState: { resources, fleet: [{ id: 4, count: 6 }] }, publicMoonState: { resources } } as any;
  const fresh = { ...trusted, publicState: null, publicMoonState: null };
  const merged = planetDetailRefreshResultPlanet({ apiPlanet: fresh, currentPlanet: trusted, trustedHomePlanet: trusted, coords: planet });
  expect(merged?.publicState).toBeNull();
  expect(merged?.publicMoonState).toBeNull();
});

test.each([false, true])("selected launch respects body constraints without hiding effective inventory moon=%s", moon => {
  const constraints = { ships: [{ id: 4, count: 100 }], resources, fleetSlots: { active: 1, limit: 16 } };
  const state = { wallet: "owner", homePlanetId: "1", resources, shipyardLevel: 1, naniteLevel: 0, technologyLevels: {}, ships: [{ id: 4, count: 106, cost: resources }], launchableShips: [{ id: 4, count: 106 }], fleetLaunchConstraints: constraints, fleetLaunchAvailable: true, fleetSlots: { active: 0, limit: 16 }, queue: null };
  const origin = moon ? missionMoonShipyardState({ moonState: { ...state, moon: { exists: true, planetId: "1" } } as unknown as ChainMoonState, shipyardState: state })! : state;
  expect(missionInventory(origin).ships[0]!.count).toBe(106);
  expect(missionShipInventoryBlocker({ shipyardState: origin, ships: { largeCargo: 1 } })).toBeUndefined();
  expect(missionShipInventoryBlocker({ shipyardState: origin, ships: { largeCargo: 106 } })).toContain("not yet ready for launch");
  const empty = { ...origin, fleetLaunchConstraints: { ...constraints, ships: [{ id: 4, count: 0 }] } };
  expect(missionShipInventoryBlocker({ shipyardState: empty, ships: { largeCargo: 6 } })).toContain("not yet ready for launch");
  expect(missionShipInventoryBlocker({ shipyardState: { ...origin, fleetLaunchAvailable: false }, ships: { largeCargo: 1 } })).toBeDefined();
});

test("Supply keeps display proposals and blocks only selected requirements before send", async () => {
  const target = { ...planet, planetId: "99", system: 2 } as any;
  const constraints = { ships: [{ id: 4, count: 100 }], resources, fleetSlots: { active: 1, limit: 16 } };
  const snapshot: SupplySourcesResponse = { wallet: "owner", technologyLevels: {}, fleetSlots: { active: 0, limit: 16 }, fleetLaunchAvailable: true, sources: [{ ...planet, launchableShips: [{ id: 4, count: 106 }], fleetLaunchConstraints: constraints }] };
  const plan = (next = snapshot, metal = 1) => buildBatchSupplyPlan({ sources: batchSupplySourcesFromSnapshot(next, target), targetCoordinates: target, selectedPlanetIds: new Set(["1"]), requested: { metal } });
  expect(batchSupplySourcesFromSnapshot(snapshot, target)[0]!.ships.largeCargo).toBe(106);
  expect(plan().orders[0]?.ships.largeCargo).toBe(1);
  expect(plan().blockedSources).toEqual([]);
  const next = { ...snapshot, sources: snapshot.sources.map(source => ({ ...source, fleetLaunchConstraints: { ...constraints, ships: [{ id: 4, count: 0 }] } })) };
  const blocked = plan(next, 140000);
  expect(blocked.orders).toEqual([]);
  expect(blocked.missing.metal).toBe(140000);
  expect(blocked.blockedSources).toHaveLength(1);
  const queries = { supplySources: () => ({ read: async () => next }) } as any;
  await expect(prepareBatchSupplyConfirmation({ queries, account: "owner", target, orders: plan(snapshot, 140000).orders, shipTypesBySource: {}, levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview() {}, onShortfall() {} })).rejects.toThrow("Supply inventory changed");
  const noFuel = { ...snapshot, sources: snapshot.sources.map(source => ({ ...source, fleetLaunchConstraints: { ...constraints, resources: { ...resources, deuterium: "0" } } })) };
  expect(plan(noFuel).blockedSources).toHaveLength(1);
  expect(plan(noFuel).orders).toEqual([]);
  expect(fleetLaunchRequirementBlocker({ ...constraints, resources: null }, [{ id: 4, count: 1 }], { metal: 1 })).toBeDefined();
  expect(fleetLaunchRequirementBlocker({ ...constraints, fleetSlots: { active: 16, limit: 16 } }, [{ id: 4, count: 1 }])).toContain("Fleet slots");
});

test("Supply Max finds conservative feasible inventory rather than skipping its interval", () => {
  const source = batchSupplySourceForPlanet(planet, { resources, technologyLevels: {}, launchableShips: [{ id: 4, count: 106 }], fleetLaunchConstraints: { ships: [{ id: 4, count: 1 }], resources, fleetSlots: { active: 1, limit: 16 } } });
  const options = { sources: [source], targetCoordinates: { galaxy: 1, system: 2, position: 1 }, selectedPlanetIds: new Set(["1"]), requested: { metal: 1 } };
  const max = maximumBatchSupplyResource(options, "metal");
  expect(max).toBeGreaterThan(20000);
  expect(max).toBeLessThanOrEqual(25000);
  const plan = buildBatchSupplyPlan({ ...options, requested: { metal: max } });
  expect(plan.orders[0]?.ships.largeCargo).toBe(1);
  expect(plan.blockedSources).toEqual([]);
  expect(source.ships.largeCargo).toBe(106);
});

test("multi-source Max replays the exact constrained allocation with effective displays intact", () => {
  const sources = [1, 2].map(id => batchSupplySourceForPlanet({ ...planet, planetId: String(id), position: id }, {
    resources, technologyLevels: {}, launchableShips: [{ id: 4, count: 106 }],
    fleetLaunchConstraints: { ships: [{ id: 4, count: 1 }], resources, fleetSlots: { active: 1, limit: 16 } },
  }));
  const options = { sources, targetCoordinates: { galaxy: 1, system: 2, position: 1 }, selectedPlanetIds: new Set(["1", "2"]), requested: { metal: 1 } };
  const maximum = maximumBatchSupplyResource(options, "metal");
  expect(maximum).toBeGreaterThan(49000);
  const replay = buildBatchSupplyPlan({ ...options, requested: { metal: maximum } });
  expect(replay.orders.map(order => order.ships.largeCargo)).toEqual([1, 1]);
  expect(replay.blockedSources).toEqual([]);
  expect(replay.missing.metal).toBe(0);
  expect(sources.map(source => source.ships.largeCargo)).toEqual([106, 106]);
});

test.each(["all", "combat"] as const)("Max does not shrink an impossible explicit %s fleet", mode => {
  const source = batchSupplySourceForPlanet(planet, {
    resources, technologyLevels: {}, launchableShips: [{ id: 4, count: 106 }, { id: 7, count: 5 }],
    fleetLaunchConstraints: { ships: [{ id: 4, count: 1 }, { id: 7, count: 1 }], resources, fleetSlots: { active: 1, limit: 16 } },
  });
  const options = { sources: [source], targetCoordinates: { galaxy: 1, system: 2, position: 1 }, selectedPlanetIds: new Set(["1"]), requested: { metal: 123 },
    shipTypesBySource: { "1": mode === "all" ? ["largeCargo" as const] : ["largeCargo" as const, "battleship" as const] },
    fleetModesBySource: { "1": mode === "all" ? "all" as const : "auto" as const },
  };
  expect(buildBatchSupplyPlan(options).blockedSources).toHaveLength(1);
  expect(maximumBatchSupplyResource(options, "metal")).toBe(123);
  expect(source.ships.largeCargo).toBe(106);
  expect(source.ships.battleship).toBe(5);
});
