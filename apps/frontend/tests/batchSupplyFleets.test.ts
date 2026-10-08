import { describe, expect, test } from "bun:test";
import { buildBatchSupplyPlan, defaultSupplyShipTypes, maximumBatchSupplyResource, supplyShipKeys, type BatchSupplySource } from "../src/batchSupplyPlanner";
import { batchSupplyPlanMatchesOrders, batchSupplySourceForPlanet, replanBatchSupplyForConfirmation, prepareBatchSupplyConfirmation, launchBatchSupplyTransaction } from "../src/PlayableMvpApp";
import { fleetMissionAvailableCargoCapacity, fleetMissionCargoCapacity, fleetMissionDistance, fleetMissionFuelCost, fleetMissionTravelSeconds } from "../src/fleetMissionRules";
import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { defaultVeydriftChainForLocation, type ManagedPlanetResponse } from "../src/walletFlow";

import type { BackendDataStore } from "../src/backendDataStore";

const target = { planetId: "9", galaxy: 1, system: 10, position: 8 } as ManagedPlanetResponse;
const zero = { metal: 0, crystal: 0, deuterium: 0 };
const origin: BatchSupplySource = {
  planetId: "1", label: "Origin", coordinates: { ...target, position: 7 },
  ships: { largeCargo: 5, smallCargo: 3, recycler: 4, colonyShip: 1, lightFighter: 70, cruiser: 12, deathstar: 2 },
  resources: { metal: 100_000, crystal: 20_000, deuterium: 100_000 }, driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 3 },
};
const base = { targetCoordinates: target, sources: [origin], selectedPlanetIds: new Set(["1"]), requested: zero };

describe("Opt-in Supply fleets", () => {
  test("default Transport and Deploy retain automatic cargo and never move combat ships", () => {
    expect(defaultSupplyShipTypes).toEqual(["largeCargo", "smallCargo", "colonyShip"]);
    for (const mission of ["transport", "deploy"] as const) {
      expect(buildBatchSupplyPlan({ ...base, mission }).orders).toEqual([]);
      const plan = buildBatchSupplyPlan({ ...base, mission, requested: { metal: 1 } });
      expect(plan.orders[0]!.ships.largeCargo).toBe(1);
      expect(plan.orders[0]!.ships.lightFighter).toBe(0);
      expect(plan.orders[0]!.ships.cruiser).toBe(0);
      expect(plan.orders[0]!.ships.recycler).toBe(0);
    }
  });

  test("explicit combat types always move in full, not merely as spare cargo capacity", () => {
    for (const mission of ["transport", "deploy"] as const) {
      for (const metal of [0, 1, 80_000]) {
        const plan = buildBatchSupplyPlan({ ...base, mission, requested: { metal }, shipTypesBySource: { "1": [...defaultSupplyShipTypes, "lightFighter", "cruiser"] } });
        const order = plan.orders[0]!;
        expect(order.ships.lightFighter).toBe(70);
        expect(order.ships.cruiser).toBe(12);
        expect(order.ships.deathstar).toBe(0);
        expect(order.cargo.metal).toBe(metal);
        expect(plan.shipsReturn).toBe(mission === "transport");
        const distance = fleetMissionDistance(origin.coordinates, target);
        expect(order.fuelCost).toBe(fleetMissionFuelCost(order.ships, distance, origin.driveLevels));
        expect(order.travelSeconds).toBe(fleetMissionTravelSeconds(distance, order.ships, origin.driveLevels));
        expect(metal).toBeLessThanOrEqual(fleetMissionAvailableCargoCapacity(order.ships, distance, origin.driveLevels));
      }
    }
  });

  test("Select all launches entire selected fleets from every source without dummy cargo", () => {
    const sources = [origin, { ...origin, planetId: "2", coordinates: { ...target, system: 12 } }];
    const shipTypesBySource = { "1": supplyShipKeys, "2": ["largeCargo", "lightFighter"] as const };
    const fleetModesBySource = { "1": "all", "2": "all" } as const;
    const args = { ...base, sources, selectedPlanetIds: new Set(["1", "2"]), mission: "deploy" as const, shipTypesBySource, fleetModesBySource };
    const plan = buildBatchSupplyPlan(args);
    expect(plan.orders).toHaveLength(2);
    expect(plan.orders[0]!.ships).toMatchObject(origin.ships);
    expect(plan.orders[1]!.ships).toMatchObject({ largeCargo: 5, lightFighter: 70, cruiser: 0, recycler: 0 });
    expect(plan.orders.every(order => Object.values(order.cargo).every(value => value === 0))).toBe(true);
    const refreshed = replanBatchSupplyForConfirmation({ orders: plan.orders, target, sources, shipTypesBySource, fleetModesBySource, maxOrders: 2, mission: "deploy" });
    expect(batchSupplyPlanMatchesOrders(plan.orders, refreshed.orders)).toBe(true);
    expect(buildBatchSupplyPlan({ ...args, selectedPlanetIds: new Set(["2"]) }).orders).toEqual([plan.orders[1]!]);
    expect(buildBatchSupplyPlan({ ...args, maxOrders: 1 }).sourceLimitReached).toBe(true);
    expect(buildBatchSupplyPlan({ ...args, shipTypesBySource: { "1": [], "2": [] } }).orders).toEqual([]);
    const changed = replanBatchSupplyForConfirmation({ orders: plan.orders, target, sources: [{ ...origin, ships: { ...origin.ships, lightFighter: 69 } }, sources[1]!], shipTypesBySource, fleetModesBySource, maxOrders: 2 });
    expect(batchSupplyPlanMatchesOrders(plan.orders, changed.orders)).toBe(false);
    const faster = replanBatchSupplyForConfirmation({ orders: plan.orders, target, sources: sources.map(source => ({ ...source, driveLevels: { hyperspaceDrive: 10 } })), shipTypesBySource, fleetModesBySource, maxOrders: 2 });
    expect(batchSupplyPlanMatchesOrders(plan.orders, faster.orders)).toBe(false);
  });

  test("combat-only sources are selectable; unavailable inventory stays blocked", () => {
    const planet = { ...target, planetId: "1", name: "Fleet", coordinates: "1:10:7", resources: { metal: "0", crystal: "0", deuterium: "10000" } };
    const source = batchSupplySourceForPlanet(planet, { resources: planet.resources, ships: [{ id: 1, count: 20 }, { id: 9, count: 100 }] });
    expect(source.unavailableReason).toBeUndefined();
    expect(supplyShipKeys).toHaveLength(14);
    expect(buildBatchSupplyPlan({ ...base, sources: [source] }).orders).toEqual([]);
    expect(buildBatchSupplyPlan({ ...base, sources: [source], shipTypesBySource: { "1": ["lightFighter"] } }).orders[0]!.ships.lightFighter).toBe(20);
    expect(buildBatchSupplyPlan({ ...base, sources: [{ ...source, unavailableReason: "Pending battle" }], shipTypesBySource: { "1": ["lightFighter"] } }).blockedSources).toHaveLength(1);
  });

  test("never silently shrinks selected fleets for fuel, including fuel that exceeds their hold", () => {
    const shipTypesBySource = { "1": ["lightFighter"] as const };
    const source = { ...origin, resources: { ...zero, deuterium: 1 }, ships: { lightFighter: 1000 } };
    expect(buildBatchSupplyPlan({ ...base, sources: [source], shipTypesBySource }).blockedSources).toHaveLength(1);
    const distant = { ...origin, coordinates: { galaxy: 20, system: 10, position: 7 }, ships: { lightFighter: 1 } };
    expect(fleetMissionFuelCost(distant.ships, fleetMissionDistance(distant.coordinates, target))).toBeGreaterThan(fleetMissionCargoCapacity(distant.ships));
    expect(buildBatchSupplyPlan({ ...base, sources: [distant], shipTypesBySource }).orders).toEqual([]);
    const supported = buildBatchSupplyPlan({ ...base, sources: [{ ...distant, ships: { lightFighter: 1, largeCargo: 1 } }], shipTypesBySource: { "1": ["lightFighter", "largeCargo"] } });
    expect(supported.orders[0]!.ships).toMatchObject({ lightFighter: 1, largeCargo: 1 });
    expect(supported.orders[0]!.cargo).toEqual(zero);
  });

  test("fleet-only parent-to-moon Deploy retains local body distance and fresh confirmation", () => {
    const source = { ...origin, coordinates: target };
    const shipTypesBySource = { "1": ["cruiser"] as const };
    const plan = buildBatchSupplyPlan({ ...base, sources: [source], shipTypesBySource, targetIsMoon: true, mission: "deploy" });
    expect(plan.orders[0]!.ships.cruiser).toBe(12);
    expect(plan.orders[0]!.fuelCost).toBe(fleetMissionFuelCost(plan.orders[0]!.ships, 5, source.driveLevels));
    expect(plan.orders[0]!.cargo).toEqual(zero);
    const refreshed = replanBatchSupplyForConfirmation({ orders: plan.orders, target, sources: [source], shipTypesBySource, maxOrders: 1, targetIsMoon: true, mission: "deploy" });
    expect(refreshed.orders).toEqual(plan.orders);
  });

  test("Max agrees with exhaustive actual mixed-fleet planning and preserves fixed ships", () => {
    for (const mode of ["auto", "all"] as const) {
      const source = { ...origin, resources: { metal: 100, crystal: 25, deuterium: 40 }, ships: { lightFighter: 3, smallCargo: 2 } };
      const options = { ...base, sources: [source], requested: { metal: 0, crystal: 10, deuterium: 5 }, shipTypesBySource: { "1": ["lightFighter", "smallCargo"] as const }, fleetModesBySource: { "1": mode } };
      let brute = 0;
      for (let metal = 0; metal <= 100; metal++) {
        const plan = buildBatchSupplyPlan({ ...options, requested: { ...options.requested, metal } });
        if (plan.orders.length > 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && Object.values(plan.missing).every(value => value === 0)) brute = metal;
      }
      const maximum = maximumBatchSupplyResource(options, "metal");
      expect(maximum).toBe(brute);
      const plan = buildBatchSupplyPlan({ ...options, requested: { ...options.requested, metal: maximum } });
      expect(plan.orders[0]!.ships.lightFighter).toBe(3);
      if (mode === "all") expect(plan.orders[0]!.ships.smallCargo).toBe(2);
    }
  });

  test("mixed-fleet Max matches a bounded exhaustive oracle across resources and fuel boundaries", () => {
    let seed = 56;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const keys = ["metal", "crystal", "deuterium"] as const;
    for (let fixture = 0; fixture < 80; fixture++) {
      const sources = ["1", "2"].map((planetId, index) => ({ ...origin, planetId,
        coordinates: { ...target, position: 7, system: 10 + index * random(20) },
        resources: { metal: random(60), crystal: random(60), deuterium: random(60) },
        ships: { lightFighter: 1 + random(8), smallCargo: random(2), cruiser: random(2) },
      }));
      for (const resource of keys) {
        const requested = { metal: random(10), crystal: random(10), deuterium: random(10), [resource]: 0 };
        const options = { ...base, requested, sources, selectedPlanetIds: new Set(["1", "2"]),
          shipTypesBySource: { "1": ["smallCargo", "lightFighter", "cruiser"] as const, "2": ["lightFighter"] as const },
          fleetModesBySource: { "1": fixture % 2 ? "auto" as const : "all" as const },
        };
        const baseline = buildBatchSupplyPlan(options);
        if (keys.some(key => key !== resource && baseline.missing[key] > 0)) continue;
        let expected = 0;
        for (let value = 0; value <= sources.reduce((sum, source) => sum + source.resources[resource], 0); value++) {
          const plan = buildBatchSupplyPlan({ ...options, requested: { ...requested, [resource]: value } });
          if (plan.orders.length > 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && keys.every(key => plan.missing[key] === 0)) expected = value;
        }
        expect(maximumBatchSupplyResource(options, resource)).toBe(expected);
      }
    }
  });

  test("fresh confirmation includes all-ships mode and rejects changed fuel or ship stock", async () => {
    const shipTypesBySource = { "1": ["largeCargo", "lightFighter"] as const };
    const fleetModesBySource = { "1": "all" } as const;
    const source = { ...origin, driveLevels: {} };
    const plan = buildBatchSupplyPlan({ ...base, sources: [source], shipTypesBySource, fleetModesBySource, mission: "deploy" });
    let count = 70;
    const queries = { supplySources: () => ({ read: async () => ({
      sources: [{ ...target, ...origin.coordinates, planetId: "1", resources: { metal: "100000", crystal: "20000", deuterium: "100000" }, ships: [{id: 4, count: 5}, {id: 1, count}] }],
      fleetSlots: { limit: 2, active: 0 },
    }) }) } as unknown as BackendDataStore["queries"];
    const confirm = () => prepareBatchSupplyConfirmation({ queries, account: "0x1111111111111111111111111111111111111111", target,
      orders: plan.orders, shipTypesBySource, fleetModesBySource, mission: "deploy", levelSupply: undefined, levelPreview: undefined,
      isCurrent: () => true, onPreview: () => {}, onShortfall: () => {},
    });
    await confirm();
    count = 69;
    await expect(confirm()).rejects.toThrow("inventory changed");
  });

  test("multi-source zero-cargo Deploy encodes exactly one atomic transaction", async () => {
    const sources = [origin, { ...origin, planetId: "2" }];
    const plan = buildBatchSupplyPlan({ ...base, sources, selectedPlanetIds: new Set(["1", "2"]), mission: "deploy", shipTypesBySource: { "1": ["cruiser"], "2": ["lightFighter"] } });
    const sent: string[] = [];
    const provider = { request: async <T>(call: { method: string; params?: unknown[] }): Promise<T> => {
      if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
      if (call.method === "eth_call") return "0x" as T;
      if (call.method === "eth_estimateGas") return "0xf4240" as T;
      if (call.method !== "eth_sendTransaction") throw new Error(call.method);
      sent.push((call.params as Array<{ data: string }>)[0]!.data); return "0xfixture" as T;
    } };
    await launchBatchSupplyTransaction(provider, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", target, plan.orders, false, "deploy");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.slice(0, 10)).toBe("0xc47915ea");
    const words = decodeAbiParameters(parseAbiParameters("uint256[41]"), ("0x" + sent[0]!.slice(10)) as Hex)[0];
    expect(words.slice(0, 3)).toEqual([9n, 64n, 2n]);
    for (const [index, order] of plan.orders.entries()) {
      const offset = 3 + index * 19;
      expect(words[offset]).toBe(BigInt(order.originPlanetId));
      expect(words.slice(offset + 1, offset + 15)).toEqual(supplyShipKeys.map(key => BigInt(order.ships[key])));
      expect(words.slice(offset + 15, offset + 19)).toEqual([0n, 0n, 0n, 100n]);
    }
    expect(() => launchBatchSupplyTransaction(provider, "a", "b", target, plan.orders, true, "deploy")).toThrow("Moon Supply");
    expect(() => launchBatchSupplyTransaction(provider, "a", "b", target, [], false, "deploy")).toThrow("1 and 15");
    expect(() => launchBatchSupplyTransaction(provider, "a", "b", target, Array(16).fill(plan.orders[0]), false, "deploy")).toThrow("1 and 15");
  });
});
