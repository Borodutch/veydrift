import { describe, expect, test } from "bun:test";
import {
  generateGalaxy,
  generatePlanet,
  generateSystem,
  listSlotProfiles,
  parsePlanetSlot
} from "../src";

const seed = "veydrift-mainnet-preview";

describe("deterministic universe generation", () => {
  test("generates identical planet metadata for the same seed and coordinates", () => {
    const coordinates = {
      galaxyId: 0,
      systemId: 42,
      slot: 8 as const
    };

    expect(generatePlanet(seed, coordinates)).toEqual(
      generatePlanet(seed, coordinates)
    );
  });

  test("keeps existing galaxies stable when later galaxies are generated", () => {
    const before = generateGalaxy({
      seed,
      galaxyId: 0,
      systemCount: 2
    });
    const laterGalaxy = generateGalaxy({
      seed,
      galaxyId: 1,
      systemCount: 2
    });
    const after = generateGalaxy({
      seed,
      galaxyId: 0,
      systemCount: 2
    });

    expect(laterGalaxy.galaxyId).toBe(1);
    expect(after).toEqual(before);
  });

  test("uses stable OGame-like field and temperature ranges for all slots", () => {
    for (const profile of listSlotProfiles()) {
      const planet = generatePlanet({
        seed,
        galaxyId: 0,
        systemId: 77,
        slot: profile.slot
      });

      expect(planet.fields).toBeGreaterThanOrEqual(profile.minFields);
      expect(planet.fields).toBeLessThanOrEqual(profile.maxFields);
      expect(planet.maxTemperatureC).toBeGreaterThanOrEqual(
        profile.minMaxTemperatureC
      );
      expect(planet.maxTemperatureC).toBeLessThanOrEqual(
        profile.maxMaxTemperatureC
      );
      expect(planet.minTemperatureC).toBe(planet.maxTemperatureC - 40);
    }
  });

  test("makes inner planets hotter and middle slots larger than outer slots", () => {
    const system = generateSystem({
      seed,
      galaxyId: 0,
      systemId: 12
    });
    const slot1 = system.slots[0];
    const slot8 = system.slots[7];
    const slot15 = system.slots[14];

    expect(slot1?.maxTemperatureC).toBeGreaterThan(
      slot8?.maxTemperatureC ?? Number.POSITIVE_INFINITY
    );
    expect(slot8?.maxTemperatureC).toBeGreaterThan(
      slot15?.maxTemperatureC ?? Number.POSITIVE_INFINITY
    );
    expect(slot8?.fields).toBeGreaterThan(
      slot1?.fields ?? Number.POSITIVE_INFINITY
    );
    expect(slot8?.fields).toBeGreaterThan(
      slot15?.fields ?? Number.POSITIVE_INFINITY
    );
    expect(slot15?.resourceBias.deuteriumFormulaBps).toBeGreaterThan(
      slot1?.resourceBias.deuteriumFormulaBps ?? Number.POSITIVE_INFINITY
    );
  });

  test("applies position resource bonuses", () => {
    const slot1 = generatePlanet(seed, {
      galaxyId: 0,
      systemId: 2,
      slot: 1
    });
    const slot8 = generatePlanet(seed, {
      galaxyId: 0,
      systemId: 2,
      slot: 8
    });

    expect(slot1.resourceBias.crystalBonusBps).toBe(4_000);
    expect(slot1.resourceBias.metalBonusBps).toBe(0);
    expect(slot8.resourceBias.metalBonusBps).toBe(3_500);
    expect(slot8.resourceBias.crystalBonusBps).toBe(0);
  });

  test("keeps representative snapshot output stable", () => {
    expect(
      generateSystem({
        seed,
        galaxyId: 0,
        systemId: 1
      })
    ).toMatchSnapshot();
  });

  test("rejects invalid slots", () => {
    expect(() => parsePlanetSlot(0)).toThrow(RangeError);
    expect(() => parsePlanetSlot(16)).toThrow(RangeError);
  });
});
