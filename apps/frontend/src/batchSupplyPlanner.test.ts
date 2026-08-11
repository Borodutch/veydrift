import { describe, expect, test } from "bun:test";
import { buildBatchSupplyPlan, type BatchSupplySource } from "./batchSupplyPlanner";

const target = { galaxy: 1, system: 100, position: 8 };
const drives = { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 };

function source(overrides: Partial<BatchSupplySource> = {}): BatchSupplySource {
  return {
    planetId: "1",
    label: "Origin",
    coordinates: { galaxy: 1, system: 100, position: 7 },
    resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    ships: { smallCargo: 10, largeCargo: 2 },
    driveLevels: drives,
    ...overrides,
  };
}

describe("buildBatchSupplyPlan", () => {
  test("uses a source's available cargo capacity as a partial contribution", () => {
    const plan = buildBatchSupplyPlan({
      targetCoordinates: { galaxy: 1, system: 10, position: 5 },
      requested: { metal: 80_000 },
      selectedPlanetIds: new Set(["1"]),
      sources: [source({ resources: { metal: 80_000, crystal: 0, deuterium: 20_000 }, ships: { largeCargo: 1 } })],
    });

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]?.cargo.metal).toBeGreaterThan(0);
    expect(plan.orders[0]?.cargo.metal).toBeLessThan(80_000);
    expect(plan.missing.metal).toBeGreaterThan(0);
  });
  test("allocates the requested resources across selected sources and reserves route fuel", () => {
    const sources = [
      source({ planetId: "near", coordinates: { galaxy: 1, system: 100, position: 7 }, resources: { metal: 4_000, crystal: 0, deuterium: 5_000 } }),
      source({ planetId: "far", coordinates: { galaxy: 1, system: 102, position: 7 }, resources: { metal: 7_000, crystal: 2_000, deuterium: 5_000 } }),
    ];
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 8_000, crystal: 1_000, deuterium: 0 },
      selectedPlanetIds: new Set(["near", "far"]),
      sources,
    });

    expect(plan.orders).toHaveLength(2);
    expect(plan.delivered).toEqual({ metal: 8_000, crystal: 1_000, deuterium: 0 });
    expect(plan.missing).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(plan.fuelCost).toBeGreaterThan(0);
    expect(plan.orders.every((order) => order.cargo.deuterium + order.fuelCost <= Number(sources.find((item) => item.planetId === order.originPlanetId)?.resources.deuterium))).toBe(true);
  });

  test("reduces requested deuterium rather than spending fuel from cargo", () => {
    const constrained = source({
      resources: { metal: 0, crystal: 0, deuterium: 100 },
      ships: { smallCargo: 1 },
    });
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { deuterium: 100 },
      selectedPlanetIds: new Set([constrained.planetId]),
      sources: [constrained],
    });

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]!.cargo.deuterium + plan.orders[0]!.fuelCost).toBeLessThanOrEqual(100);
    expect(plan.missing.deuterium).toBeGreaterThan(0);
  });

  test("limits sources by the supplied fleet-slot capacity", () => {
    const sources = Array.from({ length: 4 }, (_, index) => source({ planetId: String(index + 1) }));
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 100 },
      selectedPlanetIds: new Set(sources.map((item) => item.planetId)),
      sources,
      maxOrders: 3,
    });
    expect(plan.sourceLimitReached).toBe(true);
    expect(plan.orders.length).toBeLessThanOrEqual(3);
  });
});
