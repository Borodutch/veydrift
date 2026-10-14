import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { moonStructureBaseCost } from "./components/MoonPage";
import {
  buildingDemolitionDurationSeconds,
  buildingDemolitionPrice,
  moonDemolitionDurationSeconds,
  moonDemolitionPrice,
} from "./demolition";
import { buildingCatalog, type BuildingKey, type Resources } from "./playableMvp";

type Sample = { building: number; level: number; cost: Resources; duration: number };

// Produced by the contract itself: packages/contracts/test/VeydriftMoonSystem.t.sol testDemolitionParityFixture.
const { prices } = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/demolition-parity-fixture.json", import.meta.url), "utf8"),
) as {
  prices: {
    roboticsFactory: number;
    naniteFactory: number;
    moonRoboticsFactory: number;
  } & Record<`ion${0 | 5 | 25}`, Record<`planet${0 | 1 | 2}` | `moon${0 | 1}`, Sample>>;
};
const moonKeys = ["lunarBase", "roboticsFactory", "jumpGate", "shipyard"] as const;

describe("demolition estimates match the contract (#121)", () => {
  const buildings = {
    ...Object.fromEntries(buildingCatalog.map((building) => [building.key, 0])),
    roboticsFactory: prices.roboticsFactory,
    naniteFactory: prices.naniteFactory,
  } as Record<BuildingKey, number>;

  for (const ion of [0, 5, 25] as const) {
    const samples = prices[`ion${ion}`];

    test(`planet price and duration at Ion ${ion}`, () => {
      for (const sample of [samples.planet0, samples.planet1, samples.planet2]) {
        const key = buildingCatalog[sample.building]!.key;
        const price = buildingDemolitionPrice(key, sample.level, ion);
        expect(price.cost).toEqual(sample.cost);
        expect(buildingDemolitionDurationSeconds(buildings, price.fullCost)).toBe(sample.duration);
      }
    });

    test(`moon price and duration at Ion ${ion}`, () => {
      for (const sample of [samples.moon0, samples.moon1]) {
        const price = moonDemolitionPrice(moonStructureBaseCost(moonKeys[sample.building]!), sample.level, ion);
        expect(price.cost).toEqual(sample.cost);
        expect(moonDemolitionDurationSeconds(prices.moonRoboticsFactory, price.fullCost)).toBe(sample.duration);
      }
    });
  }

  test("Ion 25 makes demolition free without shortening it", () => {
    for (const sample of ["planet0", "planet1", "planet2", "moon0", "moon1"] as const) {
      expect(prices.ion25[sample].cost).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
      expect(prices.ion25[sample].duration).toBe(prices.ion0[sample].duration);
      expect(prices.ion5[sample].duration).toBe(prices.ion0[sample].duration);
    }
  });
});
