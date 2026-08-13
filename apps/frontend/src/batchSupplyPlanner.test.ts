import { describe, expect, test } from "bun:test";
import {
  buildBatchSupplyPlan,
  hasUsableSupplyCargoFleet,
  type BatchSupplySource,
} from "./batchSupplyPlanner";

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

  test("skips an explicit all-zero manual source shipment without a fuel warning", () => {
    const sources = [
      source({
        planetId: "unused-source",
        resources: { metal: 1_000, crystal: 1_000, deuterium: 100 },
        ships: { smallCargo: 1 },
      }),
      source({
        planetId: "cargo-source",
        coordinates: { galaxy: 1, system: 101, position: 7 },
        resources: { metal: 5_221, crystal: 838, deuterium: 100 },
        ships: { smallCargo: 2 },
      }),
    ];
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 5_221, crystal: 838, deuterium: 0 },
      selectedPlanetIds: new Set(sources.map((item) => item.planetId)),
      sourceCargoOverrides: {
        "unused-source": { metal: 0, crystal: 0, deuterium: 0 },
      },
      sources,
    });

    expect(plan.blockedSources).toEqual([]);
    expect(plan.orders.map((order) => order.originPlanetId)).toEqual(["cargo-source"]);
    expect(plan.delivered).toEqual({ metal: 5_221, crystal: 838, deuterium: 0 });
  });

  test("blocks a nonzero source shipment when no cargo fleet is available", () => {
    const cargoSource = source({
      resources: { metal: 500, crystal: 0, deuterium: 100 },
      ships: {},
    });
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 500 },
      selectedPlanetIds: new Set([cargoSource.planetId]),
      sources: [cargoSource],
    });

    expect(plan.orders).toEqual([]);
    expect(plan.blockedSources).toEqual([{
      planetId: cargoSource.planetId,
      reason: "No cargo fleet with enough deuterium for this route.",
    }]);
    expect(plan.missing).toEqual({ metal: 500, crystal: 0, deuterium: 0 });
  });

  test("keeps a metal and crystal source launchable when deuterium cargo changes from zero to one", () => {
    const cargoSource = source({
      resources: { metal: 500, crystal: 250, deuterium: 100 },
      ships: { smallCargo: 1 },
    });
    const buildPlan = (deuterium: number) => buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 500, crystal: 250, deuterium },
      selectedPlanetIds: new Set([cargoSource.planetId]),
      sourceCargoOverrides: {
        [cargoSource.planetId]: { metal: 500, crystal: 250, deuterium },
      },
      sources: [cargoSource],
    });

    const withoutDeuteriumCargo = buildPlan(0);
    const withDeuteriumCargo = buildPlan(1);

    expect(withoutDeuteriumCargo.blockedSources).toEqual([]);
    expect(withDeuteriumCargo.blockedSources).toEqual([]);
    expect(withoutDeuteriumCargo.orders).toHaveLength(1);
    expect(withDeuteriumCargo.orders).toHaveLength(1);
    expect(withoutDeuteriumCargo.orders[0]?.fuelCost).toBe(withDeuteriumCargo.orders[0]?.fuelCost);
  });

  test("blocks a source whose canonical deuterium balance cannot pay route fuel", () => {
    const cargoSource = source({
      resources: { metal: 500, crystal: 250, deuterium: 100 },
      ships: { smallCargo: 1 },
    });
    const launchable = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 500, crystal: 250 },
      selectedPlanetIds: new Set([cargoSource.planetId]),
      sources: [cargoSource],
    });
    const fuelCost = launchable.orders[0]?.fuelCost ?? 0;
    const buildUnderFuelledPlan = (deuterium: number) => buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 500, crystal: 250, deuterium },
      selectedPlanetIds: new Set([cargoSource.planetId]),
      sourceCargoOverrides: {
        [cargoSource.planetId]: { metal: 500, crystal: 250, deuterium },
      },
      sources: [{ ...cargoSource, resources: { ...cargoSource.resources, deuterium: Math.max(0, fuelCost - 1) } }],
    });
    const expectedBlockedSource = {
      planetId: cargoSource.planetId,
      reason: "No cargo fleet with enough deuterium for this route.",
    };

    expect(fuelCost).toBeGreaterThan(0);
    expect(buildUnderFuelledPlan(0).orders).toEqual([]);
    expect(buildUnderFuelledPlan(0).blockedSources).toEqual([expectedBlockedSource]);
    expect(buildUnderFuelledPlan(1).orders).toEqual([]);
    expect(buildUnderFuelledPlan(1).blockedSources).toEqual([expectedBlockedSource]);
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

  test("uses a player-edited source shipment before automatically filling the balance", () => {
    const sources = [
      source({ planetId: "near", coordinates: { galaxy: 1, system: 100, position: 7 }, resources: { metal: 10_000, crystal: 0, deuterium: 5_000 } }),
      source({ planetId: "far", coordinates: { galaxy: 1, system: 102, position: 7 }, resources: { metal: 10_000, crystal: 0, deuterium: 5_000 } }),
    ];
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 8_000 },
      selectedPlanetIds: new Set(["near", "far"]),
      sourceCargoOverrides: { far: { metal: 1_500 } },
      sources,
    });

    expect(plan.orders.find((order) => order.originPlanetId === "far")?.cargo.metal).toBe(1_500);
    expect(plan.delivered.metal).toBe(8_000);
    expect(plan.orders.find((order) => order.originPlanetId === "near")?.cargo.metal).toBe(6_500);
  });

  test("caps manual shipments to the source reserve and keeps missing resources nonnegative", () => {
    const constrained = source({
      resources: { metal: 100, crystal: 100, deuterium: 5_000 },
      ships: { largeCargo: 1 },
    });
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 100, crystal: 100 },
      selectedPlanetIds: new Set([constrained.planetId]),
      sourceCargoOverrides: { [constrained.planetId]: { metal: 200, crystal: 0 } },
      sources: [constrained],
    });

    expect(plan.orders[0]?.cargo.metal).toBe(100);
    expect(plan.orders[0]?.cargo.crystal).toBe(0);
    expect(plan.missing).toEqual({ metal: 0, crystal: 100, deuterium: 0 });
    expect(plan.delivered).toEqual({ metal: 100, crystal: 0, deuterium: 0 });
  });

  test("keeps a partially committed cargo fleet launchable from the same available snapshot", () => {
    const refreshedSource = source({
      planetId: "partial",
      ships: { largeCargo: 2 },
      resources: { metal: 20_000, crystal: 0, deuterium: 5_000 },
    });
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 20_000 },
      selectedPlanetIds: new Set([refreshedSource.planetId]),
      sources: [refreshedSource],
      maxOrders: 1,
    });

    expect(hasUsableSupplyCargoFleet(refreshedSource.ships)).toBe(true);
    expect(plan.orders).toHaveLength(1);
  });

  test("keeps a fully committed cargo fleet unavailable", () => {
    const fullyCommitted = source({
      planetId: "full",
      ships: { largeCargo: 0, smallCargo: 0, recycler: 0, colonyShip: 0 },
      unavailableReason: "No usable cargo ships are available on this planet.",
    });
    const plan = buildBatchSupplyPlan({
      targetCoordinates: target,
      requested: { metal: 5_000 },
      selectedPlanetIds: new Set(["full"]),
      sources: [fullyCommitted],
      maxOrders: 1,
    });

    expect(hasUsableSupplyCargoFleet(fullyCommitted.ships)).toBe(false);
    expect(plan.orders).toEqual([]);
    expect(plan.blockedSources).toEqual([{
      planetId: "full",
      reason: "No usable cargo ships are available on this planet.",
    }]);
  });
});
