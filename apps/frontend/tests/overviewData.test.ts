import { describe, expect, test } from "bun:test";
import {
  displayPlanetStats,
  isWalletPlanetHydrated,
  safePlanetFields,
  safePlanetTemperature,
  safeResourceNumber,
} from "../src/overviewData";

describe("overview data guards", () => {
  test("rejects impossible raw integer planet and resource values", () => {
    expect(safePlanetFields(206)).toBe(206);
    expect(safePlanetFields(2 ** 31)).toBeUndefined();
    expect(safePlanetTemperature(-12)).toBe(-12);
    expect(safePlanetTemperature(1_000_000)).toBeUndefined();
    expect(safeResourceNumber("5000")).toBe(5_000);
    expect(safeResourceNumber("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toBeUndefined();
  });

  test("formats sane game API planet stats as bounded display values", () => {
    expect(displayPlanetStats({
      wallet: "0x1111111111111111111111111111111111111111",
      hasFirstPlanet: true,
      homePlanetId: "1",
      planet: {
        planetId: "1",
        owner: "0x1111111111111111111111111111111111111111",
        galaxy: 1,
        system: 42,
        position: 7,
        fields: 206,
        temperature: -12,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "0",
        resources: {
          metal: "5000",
          crystal: "5000",
          deuterium: "5000",
        },
      },
    }, undefined, 3, "ready")).toEqual({
      fields: "3 / 206",
      temperature: "-32°C to 8°C",
      diameter: "14,353 km",
      status: "Idle",
    });
  });

  test("does not render unavailable API state as local planet stats", () => {
    expect(displayPlanetStats(undefined, undefined, 0, "error")).toEqual({
      fields: "Unavailable",
      temperature: "Unavailable",
      diameter: "Unavailable",
      status: "API error",
    });
  });

  test("keeps connected wallet dashboard gated until planet coordinates and resources hydrate", () => {
    const settlement = {
      wallet: "0x1111111111111111111111111111111111111111",
      hasFirstPlanet: true,
      homePlanetId: "1",
      planet: {
        planetId: "1",
        owner: "0x1111111111111111111111111111111111111111",
        galaxy: 1,
        system: 42,
        position: 7,
        fields: 206,
        temperature: -12,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "0",
        resources: {
          metal: "500",
          crystal: "500",
          deuterium: "0",
        },
      },
    };

    expect(isWalletPlanetHydrated({
      homeCoords: { galaxy: 1, system: 42, position: 7 },
      isWalletConnected: true,
      resources: undefined,
      settlement,
      status: "ready",
    })).toBe(false);
    expect(isWalletPlanetHydrated({
      homeCoords: { galaxy: 1, system: 42, position: 7 },
      isWalletConnected: true,
      resources: { metal: 500, crystal: 500, deuterium: 0 },
      settlement,
      status: "ready",
    })).toBe(true);
  });
});
