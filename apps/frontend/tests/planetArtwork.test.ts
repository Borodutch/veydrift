import { describe, expect, test } from "bun:test";
import { planetArchetypeForTemperature } from "../../backend/src/universe";
import { planetTypeFromCoordinates as socialArt } from "../scripts/serve.mjs";
import { debrisTargetPlanetForMission, highscorePlanetForMission, planetImageForManagedPlanet, raidTargetPlanetForMission } from "../src/PlayableMvpApp";
import { playerInspectPlanetImage } from "../src/components/InspectPages";
import { formatGalaxyHeatLabel } from "../src/components/GalaxyView";
import { planetDetailRefreshResultPlanet, publicPlanetDataRows } from "../src/components/PlanetDetail";
import { missionEndpoint } from "../src/components/missionRoute";
import { formatPlanetType, mergePlanetWithSettlement, planetArtTypeForCoordinates, planetArtTypeFromArchetypeOrCoords, planetFromSettlementPlanet, planetImageForType, planetsFromSystemResponse } from "../src/data/mockUniverse";
import { overviewHeroImage } from "../src/overviewHeroImage";
import { buildDebrisTargets, buildRaidTargets } from "../src/raidTargetFinder";
import type { FleetMissionSummary, HighscoreEntry, HighscorePlanet } from "../src/walletFlow";

const owner = "0x1111111111111111111111111111111111111111";
const slotGroups = [
  ["scorching-molten", "hot-desert", "warm-terracotta"],
  ["temperate-ocean", "lush-temperate"],
  ["cool-misty-blue", "cold-tundra"],
  ["frozen-ice", "outer-cryo"],
  ["metal-planetoid", "crystal-violet", "deuterium-blue"],
];

function livePlanet(position: number, system = 9, temperature = 98) {
  return { galaxy: 6, system, position, temperature, fields: 196, planetId: String(position), owner,
    metalMultiplierBps: 10000, crystalMultiplierBps: 10188, deuteriumMultiplierBps: 10840 };
}

describe("slot-aware artwork without climate changes (VEY-890)", () => {
  test("restores the reported 6:9 fleet of worlds exactly", () => {
    const expected = new Map([[1, "warm-terracotta"], [2, "hot-desert"], [3, "hot-desert"], [4, "temperate-ocean"], [6, "temperate-ocean"], [7, "cool-misty-blue"], [8, "cold-tundra"], [9, "cold-tundra"], [13, "metal-planetoid"]]);
    for (const [position, art] of expected) expect(planetFromSettlementPlanet(livePlanet(position)).type).toBe(art);
  });

  test("all 12 families are reachable in hydrated records and stay inside their slot groups", () => {
    const seen = new Set<string>();
    for (let system = 1; system <= 40; system++) {
      for (let position = 1; position <= 15; position++) {
        const planet = planetFromSettlementPlanet(livePlanet(position, system));
        expect(slotGroups[Math.floor((position - 1) / 3)]).toContain(planet.type);
        seen.add(planet.type);
      }
    }
    expect([...seen].sort()).toEqual(slotGroups.flat().sort());
  });

  for (let position = 1; position <= 15; position++) {
    test(`slot ${position} agrees across hydrated Galaxy/Overview/detail, selector, rankings, missions, raid/debris and social art`, () => {
      const live = livePlanet(position);
      const type = planetArtTypeForCoordinates(live);
      const image = planetImageForType(type);
      const [galaxy] = planetsFromSystemResponse({ galaxy: 6, system: 9, planets: [{ ...live, archetype: "scorching-molten" }] });
      const owned = planetFromSettlementPlanet(live);
      const merged = mergePlanetWithSettlement(galaxy!, live);
      const detail = planetDetailRefreshResultPlanet({ apiPlanet: galaxy!, coords: live, currentPlanet: null, trustedHomePlanet: merged })!;
      for (const planet of [galaxy!, owned, merged, detail]) {
        expect(planet.type).toBe(type);
        expect(planet.image).toBe(image);
        expect(planet.temperature).toEqual({ min: 78, max: 118 });
        expect(planet.resources).toEqual({ metal: 200, crystal: 204, deuterium: 217, energy: 0 });
        expect(planet.deuteriumMultiplierBps).toBe(10840);
        expect(publicPlanetDataRows(planet)).toContainEqual({ label: "Climate", value: "Scorching Molten" });
        expect(publicPlanetDataRows(planet)).toContainEqual({ label: "Art family", value: formatPlanetType(type) });
      }
      expect(overviewHeroImage(owned, undefined, undefined)).toBe(image);
      expect(planetImageForManagedPlanet(live)).toBe(image);
      expect(playerInspectPlanetImage(live)).toBe(image);
      const ranked: HighscorePlanet = { planetId: live.planetId, name: "Colony", coordinates: live };
      const entry = { wallet: owner, homePlanet: ranked, planets: [ranked], attackProtection: null } as unknown as HighscoreEntry;
      expect(highscorePlanetForMission(ranked, entry).image).toBe(image);
      const [raid] = buildRaidTargets({ entries: [entry] });
      expect(raid!.archetype).toBe(type);
      expect(raidTargetPlanetForMission(raid!).image).toBe(image);
      const [debris] = buildDebrisTargets({ targets: [{ ...ranked, owner, debris: { metal: "100", crystal: "200" } }] });
      expect(debris!.archetype).toBe(type);
      expect(debrisTargetPlanetForMission(debris!).image).toBe(image);
      const mission = { owner, targetPlanetId: live.planetId, targetPlanet: { ...live, coordinates: `6:9:${position}`, archetype: "scorching-molten" } } as unknown as FleetMissionSummary;
      expect(missionEndpoint(mission, "target", new Map()).archetype).toBe(type);
      expect(socialArt(6, 9, position)).toBe(type);
    });
  }

  test("changing climate does not change art or substitute visual values into economics", () => {
    for (const temperature of [-100, -35, -10, 0, 25, 40, 55, 248]) {
      const live = livePlanet(7, 9, temperature);
      const planet = planetFromSettlementPlanet(live);
      expect(planet.type).toBe("cool-misty-blue");
      expect(formatGalaxyHeatLabel(planet.temperature)).toBe(formatPlanetType(planetArchetypeForTemperature(temperature)));
      expect(planet.temperature).toEqual({ min: temperature - 20, max: temperature + 20 });
      expect(planet.deuteriumMultiplierBps).toBe(live.deuteriumMultiplierBps);
    }
  });

  test("historical coordinate-only art is deterministic and coordinate-less records retain their fallback", () => {
    const coords = { galaxy: 6, system: 9, position: 7 };
    expect(planetArtTypeFromArchetypeOrCoords(undefined, coords)).toBe("cool-misty-blue");
    expect(planetArtTypeFromArchetypeOrCoords("scorching-molten", coords)).toBe("cool-misty-blue");
    expect(planetArtTypeFromArchetypeOrCoords("crystal-violet", null)).toBe("crystal-violet");
    expect(planetArtTypeFromArchetypeOrCoords(undefined, null)).toBeNull();
  });
});
