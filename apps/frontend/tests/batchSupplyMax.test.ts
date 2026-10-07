import { describe, expect, test } from "bun:test";
import { buildBatchSupplyPlan, maximumBatchSupplyResource, type BatchSupplySource, type SupplyResources } from "../src/batchSupplyPlanner";
import { fleetMissionAvailableCargoCapacity, fleetMissionDistance } from "../src/fleetMissionRules";
import { replanBatchSupplyForConfirmation, launchBatchSupplyTransaction } from "../src/PlayableMvpApp";
import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { defaultVeydriftChainForLocation, type ManagedPlanetResponse } from "../src/walletFlow";

const target = { galaxy: 1, system: 100, position: 8 };
const keys = ["metal", "crystal", "deuterium"] as const;
const zero = { metal: 0, crystal: 0, deuterium: 0 };
function source(planetId = "1", overrides: Partial<BatchSupplySource> = {}): BatchSupplySource {
  return { planetId, label: planetId, coordinates: { ...target, position: 7 },
    resources: { metal: 100_000, crystal: 100_000, deuterium: 100_000 },
    ships: { smallCargo: 2 }, driveLevels: {}, ...overrides };
}
function options(sources = [source()], requested: Partial<SupplyResources> = zero) {
  return { targetCoordinates: target, sources, requested, selectedPlanetIds: new Set(sources.map(s => s.planetId)) };
}
function maxPlan(args: Parameters<typeof buildBatchSupplyPlan>[0], resource: keyof SupplyResources) {
  const maximum = maximumBatchSupplyResource(args, resource);
  const next = { ...args, requested: { ...zero, ...args.requested, [resource]: maximum } };
  const plan = buildBatchSupplyPlan(next);
  expect(maximumBatchSupplyResource(next, resource)).toBe(maximum);
  return { next, plan, maximum };
}

describe("Supply Max preserves the actual shipment", () => {
  for (const order of [["metal", "crystal", "deuterium"], ["metal", "deuterium", "crystal"], ["crystal", "metal", "deuterium"], ["crystal", "deuterium", "metal"], ["deuterium", "metal", "crystal"], ["deuterium", "crystal", "metal"]] as const) {
    test("stable Max in " + order.join(", ") + " order", () => {
      let args = options([source("1", { resources: { metal: 7000, crystal: 3000, deuterium: 100 } }), source("2", { coordinates: { ...target, system: 101 } })], { metal: 100, crystal: 200, deuterium: 300 });
      for (const resource of order) {
        const { next, plan } = maxPlan(args, resource);
        for (const other of keys.filter(key => key !== resource)) expect(plan.delivered[other]).toBe(args.requested[other]!);
        expect(plan.delivered).toEqual(next.requested);
        expect(plan.missing).toEqual(zero);
        const confirmed = replanBatchSupplyForConfirmation({ orders: plan.orders, sources: args.sources, target, maxOrders: 15, shipTypesBySource: {} });
        expect(confirmed.orders).toEqual(plan.orders);
        args = next;
      }
    });
  }

  test("D then C then M preserves a single-source empty draft and later manual edits", () => {
    let args = options();
    for (const resource of ["deuterium", "crystal", "metal"] as const) {
      const { next, plan } = maxPlan(args, resource);
      expect(plan.missing).toEqual(zero);
      expect(plan.delivered).toEqual(next.requested);
      for (const other of keys.filter(key => key !== resource)) expect(next.requested[other]).toBe(args.requested[other]);
      args = next;
    }
    args = { ...args, requested: { metal: 100, crystal: 200, deuterium: 300 } };
    const { next, plan } = maxPlan(args, "metal");
    expect(next.requested).toEqual({ metal: 9497, crystal: 200, deuterium: 300 });
    expect(plan.delivered).toEqual(next.requested);
  });

  test("keeps existing infeasible other requests and preview missing, but can replace an oversized clicked field", () => {
    const args = options([source()], { metal: 3, crystal: 100_000, deuterium: 4 });
    const before = buildBatchSupplyPlan(args);
    expect(maxPlan(args, "metal").plan).toEqual(before);
    expect(maxPlan(args, "deuterium").plan).toEqual(before);
    const replaced = maxPlan(options([source()], { metal: 100_000 }), "metal");
    expect(replaced.maximum).toBeGreaterThan(0);
    expect(replaced.plan.missing).toEqual(zero);
  });

  test("finds the smaller launchable fleet instead of treating an oversized fuel-starved probe as zero", () => {
    const args = options([source("1", { resources: { metal: 100000, crystal: 0, deuterium: 2 }, ships: { smallCargo: 2 } })]);
    expect(buildBatchSupplyPlan({ ...args, requested: { metal: 100000 } }).delivered.metal).toBe(0);
    expect(maxPlan(args, "metal").maximum).toBe(4998);
    const fuelBound = maxPlan(options([source("1", { resources: { metal: 1000, crystal: 1000, deuterium: 100 }, ships: { smallCargo: 2 } })], { metal: 500, crystal: 250 }), "deuterium");
    expect(fuelBound.maximum + fuelBound.plan.fuelCost).toBe(100);
    expect(fuelBound.plan.delivered).toEqual({ metal: 500, crystal: 250, deuterium: fuelBound.maximum });
  });

  test("uses manual overrides including explicit zero, without editing them or displacing other resources", () => {
    const sources = [source("1"), source("2", { coordinates: { ...target, system: 102 } }), source("3")];
    const sourceCargoOverrides = { "1": { metal: 500, crystal: 100, deuterium: 50 }, "3": zero };
    const args = { ...options(sources, { crystal: 500, deuterium: 200 }), sourceCargoOverrides };
    const before = structuredClone(args);
    const { maximum, plan } = maxPlan(args, "metal");
    expect(maximum).toBeGreaterThan(500);
    expect(plan.orders.find(o => o.originPlanetId === "1")!.cargo).toEqual(sourceCargoOverrides["1"]);
    expect(plan.orders.some(o => o.originPlanetId === "3")).toBe(false);
    expect(plan.delivered.crystal).toBe(500);
    expect(plan.delivered.deuterium).toBe(200);
    expect(plan.missing).toEqual(zero);
    expect(args).toEqual(before);
    expect(maxPlan({ ...args, selectedPlanetIds: new Set(["1", "3"]), requested: zero }, "metal").maximum).toBe(500);
  });

  test("honors selection, inventory, unavailable origins, fuel, routes, body and mission limits", () => {
    const sources = [source("1", { ships: { smallCargo: 1, recycler: 10 } }), source("2", { unavailableReason: "Busy" })];
    const args = { ...options(sources, { crystal: 100, deuterium: 50 }), shipTypesBySource: { "1": ["smallCargo"] as const } };
    const { maximum, plan } = maxPlan(args, "metal");
    const capacity = fleetMissionAvailableCargoCapacity({ smallCargo: 1 }, fleetMissionDistance(sources[0]!.coordinates, target));
    expect(maximum).toBe(capacity - 150);
    expect(plan.orders).toHaveLength(1);
    expect(maxPlan({ ...args, shipTypesBySource: { "1": [] }, requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, selectedPlanetIds: new Set(), requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, sources: [source("1", { resources: { metal: 10, crystal: 0, deuterium: 0 } })], requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, maxOrders: 0 }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...options([source()], { metal: 12 }), maxOrders: 0 }, "metal").maximum).toBe(12);
    const multi = options([source("1"), source("2", { coordinates: { ...target, system: 101 } })]);
    const transport = maxPlan(multi, "metal");
    const deploy = maxPlan({ ...multi, mission: "deploy" }, "metal");
    expect(transport.plan.orders).toHaveLength(2);
    expect(deploy.plan.orders).toHaveLength(1);
    expect(deploy.maximum).toBeLessThan(transport.maximum);
    const many = options(Array.from({ length: 16 }, (_, i) => source(String(i), { resources: { metal: 10, crystal: 0, deuterium: 100 } })));
    const batch = maxPlan(many, "metal");
    expect(batch.maximum).toBe(150);
    expect(batch.plan.orders).toHaveLength(15);
    const parent = source("1", { coordinates: target });
    const moon = maxPlan({ ...options([parent]), targetIsMoon: true }, "metal");
    expect(moon.plan.fuelCost).toBeGreaterThan(0);
    expect(moon.maximum).toBeLessThan(maxPlan(options([parent]), "metal").maximum);
    expect(maxPlan({ ...options([parent]), targetIsMoon: true, mission: "deploy" }, "metal").plan.orders).toEqual(moon.plan.orders);
  });

  test("finds a feasible island after an infeasible multi-source fuel boundary", () => {
    const sources = [
      source("0", { coordinates: target, resources: { metal: 55597, crystal: 8866, deuterium: 252 }, ships: { smallCargo: 4 }, driveLevels: { impulseDrive: 3, combustionDrive: 3 } }),
      source("1", { coordinates: { ...target, system: 110 }, resources: { metal: 15097, crystal: 34519, deuterium: 200 }, ships: { smallCargo: 2 }, driveLevels: { impulseDrive: 6, combustionDrive: 4 } }),
      source("2", { coordinates: { ...target, system: 120 }, resources: { metal: 54110, crystal: 24895, deuterium: 161 }, ships: { smallCargo: 2, largeCargo: 2, colonyShip: 1 }, driveLevels: { impulseDrive: 4, combustionDrive: 0 } }),
    ];
    const args = options(sources, { crystal: 17435, deuterium: 111 });
    const feasible = (metal: number) => Object.values(buildBatchSupplyPlan({ ...args, requested: { ...args.requested, metal } }).missing).every(value => value === 0);
    expect(feasible(0)).toBe(true);
    expect(feasible(37500)).toBe(false);
    expect(feasible(62500)).toBe(true);
    expect(feasible(67382)).toBe(true);
    expect(feasible(67383)).toBe(false);
    expect(maxPlan(args, "metal").maximum).toBe(67382);
    // Checking every larger request proves this is the last island, not merely
    // a local maximum found before another fuel transition.
    for (let metal = 67383; metal <= sources.reduce((sum, s) => sum + s.resources.metal, 0); metal++) {
      if (feasible(metal)) throw new Error("Unexpected feasible total " + metal);
    }
  });

  test("matches exhaustive planner maxima for all resources, manual overrides and mixed fleets", () => {
    let seed = 55;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * max); };
    let checked = 0;
    for (const resource of keys) for (let fixture = 0; fixture < 60; fixture++) {
      const sources = Array.from({ length: 3 }, (_, i) => source(String(i), {
        coordinates: { ...target, system: 100 + i * 10 },
        resources: { metal: random(6000), crystal: random(6000), deuterium: random(120), [resource]: random(120) },
        ships: { smallCargo: 1 + random(2), largeCargo: random(2), colonyShip: random(2), recycler: random(2) },
        driveLevels: { impulseDrive: random(8), combustionDrive: random(8) },
      }));
      const requested = { metal: random(8000), crystal: random(8000), deuterium: random(100), [resource]: 0 };
      const args = { ...options(sources, requested), ...(fixture % 3 === 0 ? { sourceCargoOverrides: { "0": { metal: random(1000), crystal: random(1000), deuterium: random(30) } } } : {}) };
      const baseline = buildBatchSupplyPlan(args);
      if (keys.some(key => key !== resource && baseline.missing[key] > 0)) continue;
      checked++;
      let expected = 0;
      for (let value = 0; value <= sources.reduce((sum, s) => sum + s.resources[resource], 0); value++) {
        const plan = buildBatchSupplyPlan({ ...args, requested: { ...requested, [resource]: value } });
        if (keys.every(key => plan.missing[key] === 0)) expected = value;
      }
      expect(maxPlan(args, resource).maximum).toBe(expected);
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("Max totals reach Transport and Deploy calldata unchanged (mock wallet only)", async () => {
    for (const mission of ["transport", "deploy"] as const) {
      let args = { ...options([source()], { metal: 100, crystal: 200, deuterium: 300 }), mission };
      for (const resource of ["deuterium", "crystal", "metal"] as const) args = { ...args, requested: maxPlan(args, resource).next.requested };
      const plan = buildBatchSupplyPlan(args);
      let data = "";
      await launchBatchSupplyTransaction({ request: async <T>(call: { method: string; params?: unknown[] }): Promise<T> => {
        if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
        if (call.method === "eth_call") return "0x" as T;
        if (call.method !== "eth_sendTransaction") throw new Error(call.method);
        data = (call.params as Array<{ data: string }>)[0]!.data;
        return "0xfixture" as T;
      } }, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", { ...target, planetId: "7" } as ManagedPlanetResponse, plan.orders, false, mission);
      const words = decodeAbiParameters(parseAbiParameters("uint256[22]"), ("0x" + data.slice(10)) as Hex)[0];
      const offset = mission === "transport" ? 18 : 17;
      expect(words.slice(offset, offset + 3)).toEqual(keys.map(key => BigInt(plan.delivered[key])));
      expect(plan.delivered).toEqual(args.requested);
    }
  });

  test("large stocks skip resource intervals instead of scanning units", () => {
    const args = options([source("1", { resources: { metal: 1_000_000_000_000, crystal: 1_000_000_000_000, deuterium: 1_000_000_000_000 } })], { crystal: 200, deuterium: 300 });
    expect(maxPlan(args, "metal").maximum).toBe(9497);
  });
});
