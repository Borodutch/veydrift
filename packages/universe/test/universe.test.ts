import { describe, expect, test } from "bun:test";
import {
  generateGalaxy,
  generatePlanet,
  generateSystem,
  isPlanetSlotPopulated,
  listPopulatedPlanetSlots,
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

  test("uses stable Veydrift field and temperature ranges for all slots", () => {
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
    const slot1 = generatePlanet({
      seed,
      galaxyId: 0,
      systemId: 12,
      slot: 1
    });
    const slot8 = generatePlanet({
      seed,
      galaxyId: 0,
      systemId: 12,
      slot: 8
    });
    const slot15 = generatePlanet({
      seed,
      galaxyId: 0,
      systemId: 12,
      slot: 15
    });

    expect(slot1.maxTemperatureC).toBeGreaterThan(slot8.maxTemperatureC);
    expect(slot8.maxTemperatureC).toBeGreaterThan(slot15.maxTemperatureC);
    expect(slot8.fields).toBeGreaterThan(slot1.fields);
    expect(slot8.fields).toBeGreaterThan(slot15.fields);
    expect(slot15.resourceBias.deuteriumFormulaBps).toBeGreaterThan(
      slot1.resourceBias.deuteriumFormulaBps
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

  test("uses deterministic sparse planet slots per system", () => {
    const system1Slots = listPopulatedPlanetSlots({
      seed,
      galaxyId: 0,
      systemId: 1
    });
    const system42Slots = listPopulatedPlanetSlots({
      seed,
      galaxyId: 0,
      systemId: 42
    });

    expect(system1Slots).toEqual(
      listPopulatedPlanetSlots({
        seed,
        galaxyId: 0,
        systemId: 1
      })
    );
    expect(system1Slots.length).toBeGreaterThanOrEqual(5);
    expect(system1Slots.length).toBeLessThanOrEqual(11);
    expect(system42Slots.length).toBeGreaterThanOrEqual(5);
    expect(system42Slots.length).toBeLessThanOrEqual(11);
    expect(system1Slots).not.toEqual(system42Slots);
    expect(
      isPlanetSlotPopulated({
        seed,
        galaxyId: 0,
        systemId: 1,
        slot: system1Slots[0] ?? 1
      })
    ).toBe(true);
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
