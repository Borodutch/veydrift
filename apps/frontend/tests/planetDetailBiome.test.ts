import { describe, expect, test } from "bun:test";
import { planetArchetypeForTemperature } from "../../backend/src/universe";
import {
  formatPlanetType,
  planetArtTypeForCoordinates,
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetImageForType,
  planetsFromSystemResponse,
  type ApiPlanet,
} from "../src/data/mockUniverse";
import { formatGalaxyHeatLabel } from "../src/components/GalaxyView";
import {
  planetDetailRefreshResultPlanet,
  planetEconomyPillRows,
  publicPlanetDataRows,
  shouldShowPlanetDetailInitialLoader,
} from "../src/components/PlanetDetail";

// Reported settled worlds, plus the remaining canonical climate bands.
const cases = [
  { system: 42, position: 14, temperature: -64, deuteriumMultiplierBps: 14080, type: "frozen-ice" },
  { system: 42, position: 15, temperature: -107, deuteriumMultiplierBps: 14740, type: "frozen-ice" },
  { system: 43, position: 14, temperature: -74, deuteriumMultiplierBps: 14280, type: "frozen-ice" },
  { system: 43, position: 15, temperature: -107, deuteriumMultiplierBps: 14940, type: "frozen-ice" },
  { system: 42, position: 11, temperature: 31, deuteriumMultiplierBps: 12180, type: "warm-terracotta" },
  { system: 43, position: 12, temperature: 12, deuteriumMultiplierBps: 12560, type: "lush-temperate" },
  { system: 44, position: 13, temperature: -20, deuteriumMultiplierBps: 13200, type: "cold-tundra" },
  { system: 44, position: 10, temperature: 0, deuteriumMultiplierBps: 12800, type: "temperate-ocean" },
  { system: 44, position: 8, temperature: 45, deuteriumMultiplierBps: 11900, type: "hot-desert" },
  { system: 44, position: 4, temperature: 98, deuteriumMultiplierBps: 10840, type: "scorching-molten" },
] as const;

function apiPlanet(sample: typeof cases[number]): ApiPlanet {
  return {
    galaxy: 8,
    system: sample.system,
    position: sample.position,
    temperature: sample.temperature,
    archetype: sample.type,
    fields: 196,
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: sample.deuteriumMultiplierBps,
    occupiedBy: { planetId: `${sample.system}${sample.position}`, owner: "0x1111111111111111111111111111111111111111" },
  };
}

function parse(planet: ApiPlanet) {
  return planetsFromSystemResponse({ galaxy: planet.galaxy, system: planet.system, planets: [planet] })[0];
}

function settlement(sample: typeof cases[number]) {
  const api = apiPlanet(sample);
  return {
    ...sample,
    galaxy: 8,
    fields: 196,
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    owner: api.occupiedBy!.owner,
    planetId: api.occupiedBy!.planetId,
    name: "My colony",
  };
}

describe("Planet detail separates slot artwork from canonical climate (VEY-890)", () => {
  for (const sample of cases) {
    test(`8:${sample.system}:${sample.position} agrees with Galaxy/API through settled-planet hydration`, () => {
      const api = apiPlanet(sample);
      const galaxyPlanet = parse(api)!;
      const owned = planetFromSettlementPlanet(settlement(sample));
      const refreshed = mergePlanetWithSettlement(galaxyPlanet, settlement(sample));
      const coords = { galaxy: 8, system: sample.system, position: sample.position };
      expect(planetArchetypeForTemperature(sample.temperature)).toBe(sample.type);
      for (const trustedHomePlanet of [null, owned, refreshed]) {
        const detail = planetDetailRefreshResultPlanet({ apiPlanet: galaxyPlanet, coords, currentPlanet: null, trustedHomePlanet })!;
        expect(detail.type).toBe(planetArtTypeForCoordinates(coords));
        expect(formatPlanetType(sample.type)).toBe(formatGalaxyHeatLabel(galaxyPlanet.temperature));
        expect(detail.image).toBe(planetImageForType(planetArtTypeForCoordinates(coords)));
        expect(detail.temperature).toEqual({ min: sample.temperature - 20, max: sample.temperature + 20 });
        expect(publicPlanetDataRows(detail)).toContainEqual({ label: "Climate", value: formatPlanetType(sample.type) });
        expect(planetEconomyPillRows(detail)).toContainEqual({
          label: "Deuterium",
          modifier: `${(Math.round(sample.deuteriumMultiplierBps / 50) / 2).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
        });
      }
    });
  }

  test("keeps coordinate art when climate archetype is missing or obsolete, but requires live stats", () => {
    const api = apiPlanet(cases[0]);
    const { archetype: _, ...withoutArchetype } = api;
    expect(parse(withoutArchetype)?.type).toBe(planetArtTypeForCoordinates(api));
    expect(parse({ ...api, archetype: "deuterium-blue" })?.type).toBe(planetArtTypeForCoordinates(api));
    expect(parse({ ...api, temperature: undefined })).toBeUndefined();
    expect(parse({ ...api, temperature: Number.NaN })).toBeUndefined();
  });

  test("keeps the settled art and climate during loading/failure and does not leak it to another coordinate", () => {
    const sample = cases[4];
    const coords = { galaxy: 8, system: sample.system, position: sample.position };
    const owned = planetFromSettlementPlanet(settlement(sample));
    const fallback = planetDetailRefreshResultPlanet({ apiPlanet: null, coords, currentPlanet: null, trustedHomePlanet: owned });
    expect(fallback?.type).toBe(planetArtTypeForCoordinates(coords));
    expect(fallback?.image).toBe(planetImageForType(planetArtTypeForCoordinates(coords)));
    expect(fallback?.temperature).toEqual({ min: sample.temperature - 20, max: sample.temperature + 20 });
    expect(shouldShowPlanetDetailInitialLoader({ planet: fallback, source: "loading" })).toBe(false);
    const missing = planetDetailRefreshResultPlanet({ apiPlanet: null, coords: { ...coords, position: 1 }, currentPlanet: owned, trustedHomePlanet: owned });
    expect(missing).toBeNull();
    expect(shouldShowPlanetDetailInitialLoader({ planet: missing, source: "loading" })).toBe(true);
    expect(shouldShowPlanetDetailInitialLoader({ planet: missing, source: "error" })).toBe(false);
  });
});
