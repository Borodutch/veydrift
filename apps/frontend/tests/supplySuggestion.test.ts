import { expect, test } from "bun:test";
import { buildBatchSupplyPlan, suggestBatchSupplySourceIds, type BatchSupplySource } from "../src/batchSupplyPlanner";
const targetCoordinates = { galaxy: 6, system: 9, position: 12 };
const requested = { metal: 12300, crystal: 3340, deuterium: 6400 };
const sources: BatchSupplySource[] = [
  { planetId: "astro", label: "Astro", coordinates: { ...targetCoordinates, position: 13 }, resources: { metal: 0, crystal: 0, deuterium: 4825 }, ships: { largeCargo: 1 }, driveLevels: { combustionDrive: 8, impulseDrive: 6, hyperspaceDrive: 7 } },
  { planetId: "montreal", label: "Montreal", coordinates: { ...targetCoordinates, position: 10 }, resources: { metal: 11181, crystal: 5000, deuterium: 2000 }, ships: { largeCargo: 1 }, driveLevels: { combustionDrive: 8, impulseDrive: 6, hyperspaceDrive: 7 } },
  { planetId: "1", label: "New Zion", coordinates: { ...targetCoordinates, position: 1 }, resources: { metal: 1133873, crystal: 855054, deuterium: 54388 }, ships: { largeCargo: 20 }, driveLevels: { combustionDrive: 8, impulseDrive: 6, hyperspaceDrive: 7 } },
];
test("Denver 831 level6 goal: legacy nearby split is complete, suggested Zion shipment is complete in one LC", () => {
  const options = { sources, targetCoordinates, requested, maxOrders: 9 };
  const previous = buildBatchSupplyPlan({ ...options, selectedPlanetIds: new Set(sources.map(s => s.planetId)) });
  expect(previous.missing).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
  expect(previous.orders).toHaveLength(3);
  const selectedPlanetIds = suggestBatchSupplySourceIds(options);
  expect([...selectedPlanetIds]).toEqual(["1"]);
  const plan = buildBatchSupplyPlan({ ...options, selectedPlanetIds });
  expect(plan.delivered).toEqual(requested);
  expect(plan.orders).toHaveLength(1);
  expect(plan.orders[0]!.ships.largeCargo).toBe(1);
  expect(plan.fuelCost).toBe(7);
  expect(suggestBatchSupplySourceIds({ ...options, sources: [...sources].reverse() })).toEqual(selectedPlanetIds);
});
test("suggestion honors slot/moon limits, exclusions, fuel and partial deficits without privileged labels", () => {
  const renamed = sources.map(s => ({ ...s, label: "Colony " + s.planetId }));
  expect([...suggestBatchSupplySourceIds({ sources: renamed, targetCoordinates, requested, maxOrders: 1, targetIsMoon: true })]).toEqual(["1"]);
  const blocked = renamed.map(s => s.planetId === "1" ? { ...s, unavailableReason: "Stale horizon" } : s);
  const options = { sources: blocked, targetCoordinates, requested, maxOrders: 1 };
  const selectedPlanetIds = suggestBatchSupplySourceIds(options);
  const plan = buildBatchSupplyPlan({ ...options, selectedPlanetIds });
  expect(selectedPlanetIds.has("1")).toBe(false);
  expect(plan.orders.length).toBeLessThanOrEqual(1);
  expect(plan.missing.metal + plan.missing.deuterium).toBeGreaterThan(0);
  expect([...suggestBatchSupplySourceIds({ ...options, maxOrders: 0 })]).toEqual([]);
  const combatOnly = [{ ...sources[2]!, ships: { lightFighter: 10000 } }];
  expect(suggestBatchSupplySourceIds({ sources: combatOnly, requested, targetCoordinates }).size).toBe(0);
});

test("residual contribution finds complementary origins outside nearest and largest prefixes", () => {
  const complementary = [
    { ...sources[0]!, planetId: "a", resources: { metal: 1000, crystal: 0, deuterium: 100 } },
    { ...sources[1]!, planetId: "b", resources: { metal: 1000, crystal: 0, deuterium: 100 } },
    { ...sources[2]!, planetId: "c", resources: { metal: 0, crystal: 500, deuterium: 100 } },
  ];
  const options = { sources: complementary, targetCoordinates, requested: { metal: 1000, crystal: 500, deuterium: 0 }, maxOrders: 2 };
  const selectedPlanetIds = suggestBatchSupplySourceIds(options);
  expect([...selectedPlanetIds]).toEqual(["a", "c"]);
  expect(buildBatchSupplyPlan({ ...options, selectedPlanetIds }).missing).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
  expect(suggestBatchSupplySourceIds({ ...options, sources: [...complementary].reverse() })).toEqual(selectedPlanetIds);
});

test("partial candidates and fuel-starved near sources cannot hide an available complete origin", () => {
  const starved = { ...sources[0]!, ships: { largeCargo: 10 }, resources: { metal: 999999, crystal: 999999, deuterium: 0 } };
  const options = { sources: [starved, sources[2]!], targetCoordinates, requested, maxOrders: 1 };
  expect([...suggestBatchSupplySourceIds(options)]).toEqual(["1"]);
  const complementary = [
    { ...sources[0]!, resources: { metal: 12300, crystal: 0, deuterium: 100 } },
    { ...sources[1]!, resources: { metal: 0, crystal: 3340, deuterium: 6410 } },
  ];
  const args = { sources: complementary, targetCoordinates, requested, maxOrders: 2 };
  const plan = buildBatchSupplyPlan({ ...args, selectedPlanetIds: suggestBatchSupplySourceIds(args) });
  expect(plan.orders).toHaveLength(2);
  expect(plan.missing).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
});
