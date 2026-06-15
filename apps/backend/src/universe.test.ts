import { describe, expect, test } from "bun:test";
import { planetMetadata } from "./universe";

const chainId = 84532;
const settlementContractAddress = "0x1111111111111111111111111111111111111111";

const slotTemperatureProfiles = [
  [1, 40, 120],
  [2, 40, 120],
  [3, 40, 120],
  [4, -10, 80],
  [5, -10, 80],
  [6, -10, 80],
  [7, -40, 40],
  [8, -40, 40],
  [9, -40, 40],
  [10, -80, 10],
  [11, -80, 10],
  [12, -80, 10],
  [13, -120, -20],
  [14, -120, -20],
  [15, -120, -20]
] as const;

describe("backend universe metadata", () => {
  test("uses Veydrift contract temperature bands for every planet position", () => {
    for (const [position, minTemperatureC, maxTemperatureC] of slotTemperatureProfiles) {
      const planet = planetMetadata(chainId, settlementContractAddress, {
        galaxy: 2,
        system: 44,
        position
      });

      expect(planet.temperature).toBeGreaterThanOrEqual(minTemperatureC);
      expect(planet.temperature).toBeLessThanOrEqual(maxTemperatureC);
    }
  });

  test("keeps inner slots hotter than middle and outer slots", () => {
    const slot1 = planetMetadata(chainId, settlementContractAddress, {
      galaxy: 2,
      system: 44,
      position: 1
    });
    const slot8 = planetMetadata(chainId, settlementContractAddress, {
      galaxy: 2,
      system: 44,
      position: 8
    });
    const slot15 = planetMetadata(chainId, settlementContractAddress, {
      galaxy: 2,
      system: 44,
      position: 15
    });

    expect(slot1.temperature).toBeGreaterThan(slot8.temperature);
    expect(slot8.temperature).toBeGreaterThan(slot15.temperature);
  });

  test("matches contract colony traits for the reported unoccupied coordinate", () => {
    const planet = planetMetadata(chainId, settlementContractAddress, {
      galaxy: 6,
      system: 439,
      position: 5
    });

    expect(planet).toMatchObject({
      fields: 176,
      temperature: 26,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 12_280,
      archetype: "warm-terracotta"
    });
    expect(planet.fields).not.toBe(237);
    expect(planet.temperature).not.toBe(63);
    expect(planet.archetype).not.toBe("scorching-molten");
  });

  test("keeps preview metadata pinned to contract-derived golden coordinates", () => {
    const cases = [
      {
        coordinates: { galaxy: 1, system: 1, position: 1 },
        expected: { fields: 167, temperature: 70, deuteriumMultiplierBps: 11_400, archetype: "scorching-molten" }
      },
      {
        coordinates: { galaxy: 2, system: 44, position: 8 },
        expected: { fields: 218, temperature: -29, deuteriumMultiplierBps: 13_380, archetype: "cold-tundra" }
      },
      {
        coordinates: { galaxy: 9, system: 499, position: 15 },
        expected: { fields: 175, temperature: -110, deuteriumMultiplierBps: 15_000, archetype: "frozen-ice" }
      },
      {
        coordinates: { galaxy: 4, system: 250, position: 10 },
        expected: { fields: 195, temperature: -56, deuteriumMultiplierBps: 13_920, archetype: "frozen-ice" }
      }
    ] as const;

    for (const { coordinates, expected } of cases) {
      expect(planetMetadata(chainId, settlementContractAddress, coordinates)).toMatchObject({
        ...coordinates,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        ...expected
      });
    }
  });
});
