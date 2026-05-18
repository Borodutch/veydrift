import { describe, expect, test } from "bun:test";
import { planetMetadata } from "./universe";

const chainId = 84532;
const settlementContractAddress = "0x1111111111111111111111111111111111111111";

const slotMaxTemperatureProfiles = [
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
  test("uses OGame-style temperature bands for every planet position", () => {
    for (const [position, minMaxTemperatureC, maxMaxTemperatureC] of slotMaxTemperatureProfiles) {
      const planet = planetMetadata(chainId, settlementContractAddress, {
        galaxy: 2,
        system: 44,
        position
      });

      const displayedMinTemperatureC = planet.temperature - 20;
      const displayedMaxTemperatureC = planet.temperature + 20;

      expect(displayedMaxTemperatureC).toBeGreaterThanOrEqual(minMaxTemperatureC);
      expect(displayedMaxTemperatureC).toBeLessThanOrEqual(maxMaxTemperatureC);
      expect(displayedMinTemperatureC).toBe(displayedMaxTemperatureC - 40);
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
});
