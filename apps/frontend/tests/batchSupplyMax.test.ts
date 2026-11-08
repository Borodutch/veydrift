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
// Exact maxima must not depend on how fast a (possibly overloaded) runner is: lift the click's
// 150 ms budget here. The deadline fallback has its own fake-clock tests below.
const unbounded = Infinity;
function maxPlan(args: Parameters<typeof buildBatchSupplyPlan>[0], resource: keyof SupplyResources) {
  const maximum = maximumBatchSupplyResource(args, resource, unbounded);
  const next = { ...args, requested: { ...zero, ...args.requested, [resource]: maximum } };
  const plan = buildBatchSupplyPlan(next);
  expect(maximumBatchSupplyResource(next, resource, unbounded)).toBe(maximum);
  return { next, plan, maximum };
}

// Injected fake clock. reads: [start, ...] → the clock reads after the start one, all returning `later`.
// With the default 150 ms budget, 151 spends the exact search's budget and 301 the fallback's too.
const clock = (later: number) => { let read = 0; return () => (read++ === 0 ? 0 : later); };
function launches(args: Parameters<typeof buildBatchSupplyPlan>[0], resource: keyof SupplyResources, value: number) {
  const plan = buildBatchSupplyPlan({ ...args, requested: { ...zero, ...args.requested, [resource]: value } });
  return plan.orders.length > 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && keys.every(key => plan.missing[key] === 0);
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

  test("finds the smaller launchable fleet instead of treating an oversized fuel-starved request as zero", () => {
    const args = options([source("1", { resources: { metal: 100000, crystal: 0, deuterium: 2 }, ships: { smallCargo: 2 } })]);
    // An oversized request no longer blocks a fuel-starved source: it sends what an affordable fleet carries.
    const oversized = buildBatchSupplyPlan({ ...args, requested: { metal: 100000 } });
    expect(oversized.delivered.metal).toBe(4998);
    expect(oversized.blockedSources).toEqual([]);
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

  test("preserves the request rather than claiming a maximum while an explicit fleet is blocked", () => {
    const sources = [source("1", { ships: { largeCargo: 1 }, resources: { metal: 100, crystal: 0, deuterium: 100 } }),
      source("2", { ships: { lightFighter: 1000 }, resources: { metal: 0, crystal: 0, deuterium: 0 } })];
    const args = { ...options(sources, { metal: 37 }), shipTypesBySource: { "2": ["lightFighter"] as const } };
    expect(buildBatchSupplyPlan(args).missing).toEqual(zero);
    expect(buildBatchSupplyPlan(args).blockedSources).toHaveLength(1);
    expect(maxPlan(args, "metal").maximum).toBe(37);
    const withoutBlocked = maxPlan({ ...args, selectedPlanetIds: new Set(["1"]) }, "metal");
    expect(withoutBlocked.maximum).toBe(100);
    expect(withoutBlocked.plan.blockedSources).toEqual([]);
  });

  test("honors selection, inventory, unavailable origins, fuel, routes, body and mission limits", () => {
    const sources = [source("1", { ships: { smallCargo: 1, recycler: 10 } }), source("2", { unavailableReason: "Busy" })];
    const args = { ...options(sources, { crystal: 100, deuterium: 50 }), selectedPlanetIds: new Set(["1"]), shipTypesBySource: { "1": ["smallCargo"] as const } };
    const { maximum, plan } = maxPlan(args, "metal");
    const capacity = fleetMissionAvailableCargoCapacity({ smallCargo: 1 }, fleetMissionDistance(sources[0]!.coordinates, target));
    expect(maximum).toBe(capacity - 150);
    expect(plan.orders).toHaveLength(1);
    const blockedSelection = { ...args, requested: { ...args.requested, metal: 17 }, selectedPlanetIds: new Set(["1", "2"]) };
    expect(maxPlan(blockedSelection, "metal").maximum).toBe(17);
    expect(maxPlan(blockedSelection, "metal").plan.blockedSources).toHaveLength(1);
    expect(maxPlan({ ...args, shipTypesBySource: { "1": [] }, requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, selectedPlanetIds: new Set(), requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, sources: [source("1", { resources: { metal: 10, crystal: 0, deuterium: 0 } })], requested: zero }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...args, maxOrders: 0 }, "metal").maximum).toBe(0);
    expect(maxPlan({ ...options([source()], { metal: 12 }), maxOrders: 0 }, "metal").maximum).toBe(12);
    const multi = options([source("1"), source("2", { coordinates: { ...target, system: 101 } })]);
    const transport = maxPlan(multi, "metal");
    const deploy = maxPlan({ ...multi, mission: "deploy" }, "metal");
    expect(transport.plan.orders).toHaveLength(2);
    expect(deploy.plan.orders).toHaveLength(2);
    expect(deploy.maximum).toBe(transport.maximum);
    const many = options(Array.from({ length: 16 }, (_, i) => source(String(i), { resources: { metal: 10, crystal: 0, deuterium: 100 } })));
    const batch = maxPlan(many, "metal");
    expect(batch.maximum).toBe(0); // Never silently discard a sixteenth selected source.
    expect(batch.plan.sourceLimitReached).toBe(true);
    const bounded = maxPlan({ ...many, selectedPlanetIds: new Set(many.sources.slice(0, 15).map(source => source.planetId)) }, "metal");
    expect(bounded.maximum).toBe(150);
    expect(bounded.plan.orders).toHaveLength(15);
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
    const feasible = (metal: number) => {
      const plan = buildBatchSupplyPlan({ ...args, requested: { ...args.requested, metal } });
      return plan.orders.length > 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && Object.values(plan.missing).every(value => value === 0);
    };
    expect(feasible(0)).toBe(true);
    expect(feasible(37500)).toBe(false);
    expect(feasible(62500)).toBe(true);
    expect(feasible(67382)).toBe(true);
    expect(feasible(67383)).toBe(false);
    expect(maxPlan(args, "metal").maximum).toBe(67382);
    // Scanning all larger requests in steps of 25 (islands here are ~5,000 wide) shows this is the
    // last island, not merely a local maximum found before another fuel transition. The step keeps it
    // cheap on a loaded CI runner; the exhaustive-oracle test below checks every value on small fixtures.
    for (let metal = 67383; metal <= sources.reduce((sum, s) => sum + s.resources.metal, 0); metal += 25) {
      if (feasible(metal)) throw new Error("Unexpected feasible total " + metal);
    }
  }, 30_000);

  test("matches exhaustive planner maxima for all resources, manual overrides and mixed fleets", () => {
    let seed = 55;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * max); };
    let checked = 0;
    for (const resource of keys) for (let fixture = 0; fixture < 20; fixture++) {
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
        if (plan.orders.length > 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && keys.every(key => plan.missing[key] === 0)) expected = value;
      }
      expect(maxPlan(args, resource).maximum).toBe(expected);
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000); // About 1 s on an idle Mac; the shared CI runner has taken over 6 s.

  test("Max totals reach Transport and Deploy calldata unchanged (mock wallet only)", async () => {
    for (const mission of ["transport", "deploy"] as const) {
      let args = { ...options([source()], { metal: 100, crystal: 200, deuterium: 300 }), mission };
      for (const resource of ["deuterium", "crystal", "metal"] as const) args = { ...args, requested: maxPlan(args, resource).next.requested };
      const plan = buildBatchSupplyPlan(args);
      let data = "";
      await launchBatchSupplyTransaction({ request: async <T>(call: { method: string; params?: unknown[] }): Promise<T> => {
        if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
        if (call.method === "eth_call") return "0x" as T;
        if (call.method === "eth_estimateGas") return "0xf4240" as T;
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

  test("fuel-starved nine and fifteen source fleets skip unaffordable ship boundaries", () => {
    for (const count of [9, 15]) {
      const sources = Array.from({ length: count }, (_, i) => source(String(i), {
        coordinates: { galaxy: 6, system: 10 + i, position: 14 },
        resources: { metal: 250_000_000, crystal: 1_000_000, deuterium: 10 },
        ships: { largeCargo: 10_000 }, driveLevels: {},
      }));
      const args = { ...options(sources), targetCoordinates: { galaxy: 6, system: 9, position: 12 }, maxOrders: 15 };
      for (const mission of ["transport", "deploy"] as const) for (const resource of keys) {
        // The exact search reads the clock once per traced interval. Counting reads instead of
        // timing them catches the old boundary scan (thousands of intervals) on any runner.
        let reads = 0;
        expect(maximumBatchSupplyResource({ ...args, mission }, resource, unbounded, () => { reads++; return 0; })).toBe(0);
        expect(reads).toBeLessThan(20);
      }
    }
  });

  test("homogeneous fuel bounds retain exact maxima and other cargo for both missions", () => {
    for (const mission of ["transport", "deploy"] as const) for (const resource of keys) {
      for (const fuel of [0, 1, 2, 3, 20, 100]) {
        const sources = [source("1", { resources: { metal: 150, crystal: 150, deuterium: fuel }, ships: { smallCargo: 10000 } })];
        const requested = { metal: 10, crystal: 10, deuterium: 0, [resource]: 0 };
        const args = { ...options(sources, requested), mission };
        const baseline = buildBatchSupplyPlan(args);
        let expected = requested[resource];
        if (keys.every(key => key === resource || baseline.missing[key] === 0)) {
          for (let value = 0; value <= sources[0]!.resources[resource]; value++) {
            const plan = buildBatchSupplyPlan({ ...args, requested: { ...requested, [resource]: value } });
            if (plan.orders.length && !plan.blockedSources.length && keys.every(key => plan.missing[key] === 0)) expected = value;
          }
        }
        expect(maximumBatchSupplyResource(args, resource, unbounded)).toBe(expected);
      }
    }
  });

  test("past the 150 ms click budget, Max falls back to a launchable bisected total (fake clock)", () => {
    // An empty draft is a valid floor: the fallback must not answer 0 just because nothing launches at 0 (CI run 157).
    const many = options(Array.from({ length: 15 }, (_, i) => source(String(i), { resources: { metal: 10, crystal: 0, deuterium: 100 } })));
    expect(maximumBatchSupplyResource(many, "metal", 150, clock(151))).toBe(150);
    expect(maximumBatchSupplyResource(options([source()]), "metal", 150, clock(151))).toBe(maximumBatchSupplyResource(options([source()]), "metal", unbounded));
    // Non-monotone fleets: the default budget is exactly 150 ms; past it the bisected total launches but may be lower.
    const island = options([
      source("0", { coordinates: target, resources: { metal: 55597, crystal: 8866, deuterium: 252 }, ships: { smallCargo: 4 }, driveLevels: { impulseDrive: 3, combustionDrive: 3 } }),
      source("1", { coordinates: { ...target, system: 110 }, resources: { metal: 15097, crystal: 34519, deuterium: 200 }, ships: { smallCargo: 2 }, driveLevels: { impulseDrive: 6, combustionDrive: 4 } }),
      source("2", { coordinates: { ...target, system: 120 }, resources: { metal: 54110, crystal: 24895, deuterium: 161 }, ships: { smallCargo: 2, largeCargo: 2, colonyShip: 1 }, driveLevels: { impulseDrive: 4, combustionDrive: 0 } }),
    ], { crystal: 17435, deuterium: 111 });
    expect(maximumBatchSupplyResource(island, "metal", undefined, clock(150))).toBe(67382);
    const bisected = maximumBatchSupplyResource(island, "metal", undefined, clock(151));
    expect(bisected).not.toBe(67382);
    expect(bisected).toBeGreaterThan(0);
    expect(launches(island, "metal", bisected)).toBe(true);
    // A request that already launches is the floor: the fallback never lowers it to an earlier island.
    const typed = maximumBatchSupplyResource({ ...island, requested: { ...island.requested, metal: 62500 } }, "metal", undefined, clock(151));
    expect(typed).toBeGreaterThanOrEqual(62500);
    expect(launches(island, "metal", typed)).toBe(true);
    // The bisection has its own 150 ms. Once that is spent too, it stops at the first launchable total it
    // holds: never 0 for an empty draft while a total launches (#533), and a launchable typed request (12, 62500) as is.
    const spent = maximumBatchSupplyResource(island, "metal", undefined, clock(301));
    expect(spent).toBeGreaterThan(0);
    expect(launches(island, "metal", spent)).toBe(true);
    expect(maximumBatchSupplyResource({ ...island, requested: { metal: 12 } }, "metal", undefined, clock(301))).toBe(12);
    expect(maximumBatchSupplyResource({ ...island, requested: { ...island.requested, metal: 62500 } }, "metal", undefined, clock(301))).toBe(62500);
    // 0 is clean but nothing launches at any total (no deuterium for fuel): like the exact search, keep the request.
    const unfueled = options([source("1", { resources: { metal: 10, crystal: 0, deuterium: 0 } })], { metal: 12 });
    expect(launches(unfueled, "metal", 12)).toBe(false);
    expect(maximumBatchSupplyResource(unfueled, "metal", undefined, clock(151))).toBe(12);
    expect(maximumBatchSupplyResource(unfueled, "metal", unbounded)).toBe(12);
  });

  test("a stalled clock never turns an empty draft's Max into 0 while a total launches (#533)", () => {
    // D → C → M from an empty single-source draft. With the fallback's time left (151) each bisected Max
    // is exact (this source is monotone); with both budgets spent (301) it is still a launchable total above 0.
    let exact = options();
    let spent = options();
    for (const resource of ["deuterium", "crystal", "metal"] as const) {
      const fallback = maximumBatchSupplyResource(exact, resource, undefined, clock(151));
      expect(fallback).toBe(maximumBatchSupplyResource(exact, resource, unbounded));
      exact = { ...exact, requested: { ...exact.requested, [resource]: fallback } };
      const late = maximumBatchSupplyResource(spent, resource, undefined, clock(301));
      expect(late).toBeGreaterThan(0);
      expect(launches(spent, resource, late)).toBe(true);
      spent = { ...spent, requested: { ...spent.requested, [resource]: late } };
    }
    expect(exact.requested.deuterium).toBe(9997);
    // An oversized clicked field still gives way to 0 when only 0 launches, as in the exact search.
    const oversized = options([source("1", { resources: { metal: 0, crystal: 100, deuterium: 100 } })], { metal: 50, crystal: 100 });
    expect(maximumBatchSupplyResource(oversized, "metal", unbounded)).toBe(0);
    for (const later of [151, 301]) expect(maximumBatchSupplyResource(oversized, "metal", undefined, clock(later))).toBe(0);
  });

  test("large stocks skip resource intervals instead of scanning units", () => {
    const args = options([source("1", { resources: { metal: 1_000_000_000_000, crystal: 1_000_000_000_000, deuterium: 1_000_000_000_000 } })], { crystal: 200, deuterium: 300 });
    expect(maxPlan(args, "metal").maximum).toBe(9497);
  });
});
