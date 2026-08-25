import { describe, expect, test } from "bun:test";
import { planetMetadata, systemSnapshot } from "./universe";

const chainId = 84532;
const settlementContractAddress = "0x1111111111111111111111111111111111111111";

const slotTemperatureProfiles = [
  [1, 220, 260],
  [2, 170, 210],
  [3, 120, 160],
  [4, 70, 110],
  [5, 60, 100],
  [6, 50, 90],
  [7, 40, 80],
  [8, 30, 70],
  [9, 20, 60],
  [10, 10, 50],
  [11, 0, 40],
  [12, -10, 30],
  [13, -50, -10],
  [14, -90, -50],
  [15, -130, -90]
] as const;

describe("backend universe metadata", () => {
  test("advertises the classic temperature generator version", () => {
    expect(systemSnapshot(chainId, settlementContractAddress, 2, 44).generatorVersion)
      .toBe("veydrift-universe-v2");
  });

  test("uses classic contract temperature bands for every planet position", () => {
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
      temperature: 96,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_880,
      archetype: "scorching-molten"
    });
  });

  test("keeps preview metadata pinned to contract-derived golden coordinates", () => {
    const cases = [
      {
        coordinates: { galaxy: 1, system: 1, position: 1 },
        expected: { fields: 167, temperature: 250, deuteriumMultiplierBps: 7_800, archetype: "scorching-molten" }
      },
      {
        coordinates: { galaxy: 2, system: 44, position: 8 },
        expected: { fields: 218, temperature: 41, deuteriumMultiplierBps: 11_980, archetype: "hot-desert" }
      },
      {
        coordinates: { galaxy: 9, system: 499, position: 15 },
        expected: { fields: 175, temperature: -120, deuteriumMultiplierBps: 15_200, archetype: "frozen-ice" }
      },
      {
        coordinates: { galaxy: 4, system: 250, position: 10 },
        expected: { fields: 195, temperature: 34, deuteriumMultiplierBps: 12_120, archetype: "warm-terracotta" }
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
