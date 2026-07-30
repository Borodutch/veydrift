import { describe, expect, test } from "bun:test";
import type { PlanetState } from "./evm";

import {
  buildingDurationSeconds,
  deriveBuildingRows,
  deriveDefenseRows,
  deriveInfrastructureFields,
  deriveMoonBuildingRows,
  deriveShipRows,
  deriveTechnologyRows,
  researchDurationSeconds,
  unitDurationSeconds
} from "./readModels";

// VEY-KANEO-472: predicted next-build/upgrade/research durations restored server-side.
// These mirror VeydriftFormulas.{buildingDuration,unitDuration,researchDuration} with the
// deployed constants QUEUE_UNIVERSE_SPEED = 1 and MIN_QUEUE_SECONDS = 1.
describe("duration formulas (VEY-KANEO-472)", () => {
  test("buildingDurationSeconds matches the contract formula and floors at 1 second", () => {
    // ((metal + crystal) * 3600) / (2500 * (robotics + 1) * 2^nanite)
    expect(buildingDurationSeconds(0, 0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.max(1, Math.floor((1_000 * 3_600) / 2_500))
    );
    // Robotics and Nanite both speed the build up.
    expect(buildingDurationSeconds(4, 0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / (2_500 * 5))
    );
    expect(buildingDurationSeconds(0, 3, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / (2_500 * 8))
    );
    // Tiny cost still yields the minimum queue duration, never zero.
    expect(buildingDurationSeconds(0, 0, { metal: 1, crystal: 0, deuterium: 0 })).toBe(1);
  });

  test("researchDurationSeconds matches the contract formula", () => {
    expect(researchDurationSeconds(0, { metal: 1_000, crystal: 0, deuterium: 0 })).toBe(
      Math.floor((1_000 * 3_600) / 1_000)
    );
    expect(researchDurationSeconds(2, { metal: 1_000, crystal: 1_000, deuterium: 0 })).toBe(
      Math.floor((2_000 * 3_600) / (1_000 * 3))
    );
  });

  test("unitDurationSeconds ceils the whole batch and scales with quantity", () => {
    const single = unitDurationSeconds(0, 0, { metal: 4_000, crystal: 0, deuterium: 0 }, 1);
    expect(single).toBe(Math.ceil((4_000 * 3_600) / 2_500));
    const five = unitDurationSeconds(0, 0, { metal: 4_000, crystal: 0, deuterium: 0 }, 5);
    expect(five).toBe(Math.ceil((4_000 * 5 * 3_600) / 2_500));
    // Zero-cost rows floor at the minimum queue duration, never zero.
    expect(unitDurationSeconds(0, 0, { metal: 0, crystal: 0, deuterium: 0 }, 1)).toBe(1);
  });
});

describe("derive*Rows expose predicted durations (VEY-KANEO-472)", () => {
  test("moon rows expose contract-parity costs and durations for all four structures", () => {
    const rows = deriveMoonBuildingRows((id) => (id === 1 ? 2 : 0));
    expect(rows.map(({ id, cost, durationSeconds }) => ({ id, cost, durationSeconds }))).toEqual([
      {
        id: 0,
        cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        durationSeconds: buildingDurationSeconds(2, 0, { metal: 20_000, crystal: 40_000, deuterium: 20_000 })
      },
      {
        id: 1,
        cost: { metal: "1600", crystal: "480", deuterium: "800" },
        durationSeconds: buildingDurationSeconds(2, 0, { metal: 1_600, crystal: 480, deuterium: 800 })
      },
      {
        id: 2,
        cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" },
        durationSeconds: buildingDurationSeconds(2, 0, { metal: 2_000_000, crystal: 4_000_000, deuterium: 2_000_000 })
      },
      {
        id: 3,
        cost: { metal: "400", crystal: "200", deuterium: "100" },
        durationSeconds: buildingDurationSeconds(2, 0, { metal: 400, crystal: 200, deuterium: 100 })
      }
    ]);
  });

  test("building rows always carry a next-upgrade durationSeconds keyed off robotics/nanite", () => {
    // Robotics Factory is building id 4, Nanite Factory is id 11.
    const rows = deriveBuildingRows((id) => (id === 4 ? 3 : id === 11 ? 1 : 0));
    const metalMine = rows.find((row) => row.id === 0)!;
    expect(metalMine.durationSeconds).toBe(
      buildingDurationSeconds(3, 1, {
        metal: Number(metalMine.cost.metal),
        crystal: Number(metalMine.cost.crystal),
        deuterium: Number(metalMine.cost.deuterium)
      })
    );
    expect(metalMine.durationSeconds).toBeGreaterThan(0);
  });

  test("ship rows expose per-unit durations only when shipyard/nanite levels are provided", () => {
    const without = deriveShipRows(() => 0);
    expect(without.every((row) => row.durationSeconds === undefined)).toBe(true);

    const withLevels = deriveShipRows(() => 0, undefined, { shipyardLevel: 2, naniteLevel: 1 });
    const lightFighter = withLevels.find((row) => row.id === 1)!;
    expect(lightFighter.durationSeconds).toBe(
      unitDurationSeconds(2, 1, {
        metal: Number(lightFighter.cost.metal),
        crystal: Number(lightFighter.cost.crystal),
        deuterium: Number(lightFighter.cost.deuterium)
      }, 1)
    );
  });

  test("defense rows expose per-unit durations only when levels are provided", () => {
    expect(deriveDefenseRows(() => 0).every((row) => row.durationSeconds === undefined)).toBe(true);
    const withLevels = deriveDefenseRows(() => 0, { shipyardLevel: 0, naniteLevel: 0 });
    expect(withLevels.find((row) => row.id === 0)!.durationSeconds).toBeGreaterThan(0);
  });

  test("technology rows expose research durations only when the lab level is provided", () => {
    expect(deriveTechnologyRows(() => 0).every((row) => row.durationSeconds === undefined)).toBe(true);
    const withLab = deriveTechnologyRows(() => 0, 4);
    const first = withLab.find((row) => row.id === 0)!;
    expect(first.durationSeconds).toBe(
      researchDurationSeconds(4, {
        metal: Number(first.cost.metal),
        crystal: Number(first.cost.crystal),
        deuterium: Number(first.cost.deuterium)
      })
    );
  });
});

const crawlerTestPlanet: PlanetState = {
  planetId: "1",
  owner: "0x0000000000000000000000000000000000000001",
  name: null,
  galaxy: 1,
  system: 1,
  position: 1,
  fields: 200,
  temperature: 50,
  metalMultiplierBps: 10_000,
  crystalMultiplierBps: 10_000,
  deuteriumMultiplierBps: 10_000,
  lastSettledAt: "0",
  resources: { metal: "0", crystal: "0", deuterium: "0" }
};

describe("deriveInfrastructureFields crawler production", () => {
  test("reports zero crawler effect without production impact", () => {
    const fields = deriveInfrastructureFields(
      crawlerTestPlanet,
      poweredMineRows(),
      deriveShipRows(() => 0),
      {}
    );

    expect(fields.crawlerProduction).toEqual({
      total: 0,
      effective: 0,
      maxEffective: 240,
      boostBps: "0",
      capped: false,
      productionIncreasePerHour: { metal: "0", crystal: "0", deuterium: "0" }
    });
  });

  test("applies active crawler bonus to canonical production", () => {
    const withoutCrawlers = deriveInfrastructureFields(
      crawlerTestPlanet,
      poweredMineRows(),
      deriveShipRows(() => 0),
      {}
    );
    const withCrawlers = deriveInfrastructureFields(
      crawlerTestPlanet,
      poweredMineRows(),
      deriveShipRows((id) => (id === 15 ? 12 : 0)),
      {}
    );

    expect(withCrawlers.crawlerProduction).toMatchObject({
      total: 12,
      effective: 12,
      maxEffective: 240,
      boostBps: "24",
      capped: false
    });
    expect(Number(withCrawlers.productionPerHour?.metal)).toBeGreaterThan(Number(withoutCrawlers.productionPerHour?.metal));
    expect(Number(withCrawlers.crawlerProduction?.productionIncreasePerHour.metal)).toBe(
      Number(withCrawlers.productionPerHour?.metal) - Number(withoutCrawlers.productionPerHour?.metal)
    );
  });

  test("caps effective crawlers by combined mine level", () => {
    const fields = deriveInfrastructureFields(
      crawlerTestPlanet,
      deriveBuildingRows((id) => (id === 0 || id === 1 || id === 2 || id === 3 ? 1 : 0)),
      deriveShipRows((id) => (id === 15 ? 100 : 0)),
      {}
    );

    expect(fields.crawlerProduction).toMatchObject({
      total: 100,
      effective: 24,
      maxEffective: 24,
      boostBps: "48",
      capped: true
    });
  });

  test("matches the contract vector for crawlers and Solar Satellites under an energy deficit", () => {
    const fields = deriveInfrastructureFields(
      {
        ...crawlerTestPlanet,
        temperature: 80,
        deuteriumMultiplierBps: 13_040
      },
      deriveBuildingRows((id) => {
        if (id === 0) return 5;
        if (id === 1) return 4;
        if (id === 2) return 3;
        return 0;
      }),
      deriveShipRows((id) => {
        if (id === 9) return 3;
        if (id === 15) return 50;
        return 0;
      }),
      {}
    );

    expect(fields.energyBalance).toEqual({
      produced: "108",
      required: "217",
      scaleBps: "4976",
      sources: {
        solarPlant: "0",
        fusionReactor: "0",
        fusionReactorDeuteriumConsumed: "0",
        solarSatellites: "108",
        solarSatelliteCount: 3,
        solarSatelliteEnergy: "36"
      }
    });
    expect(fields.crawlerProduction).toMatchObject({
      total: 50,
      effective: 50,
      boostBps: "100"
    });
    expect(fields.productionPerHour).toEqual({
      metal: "120",
      crystal: "58",
      deuterium: "24"
    });
  });
});

function poweredMineRows() {
  return deriveBuildingRows((id) => {
    if (id === 0 || id === 1 || id === 2) return 10;
    if (id === 3) return 30;
    return 0;
  });
}
