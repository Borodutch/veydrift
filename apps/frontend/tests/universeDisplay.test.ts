import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ensurePlanetAtCoordinates,
  generateSystem,
  planetImageForType,
  planetsFromSystemResponse
} from "../src/data/mockUniverse";
import { buildingCatalog, shipCatalog } from "../src/playableMvp";
import {
  formatGalaxyHeatLabel,
  formatGalaxyOccupancySource,
  formatGalaxyOccupancySummary
} from "../src/components/GalaxyView";
import { isImageReady, type ImageLoadState } from "../src/imageLoadState";
import { getSrcSet, VARIANT_WIDTHS } from "../src/utils/imageSizes";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const PLANET_TYPES = [
  "scorching-molten",
  "hot-desert",
  "warm-terracotta",
  "temperate-ocean",
  "lush-temperate",
  "cool-misty-blue",
  "cold-tundra",
  "frozen-ice",
  "outer-cryo",
  "metal-planetoid",
  "crystal-violet",
  "deuterium-blue",
] as const;

describe("tester universe display data", () => {
  test("neutral deterministic fallback does not invent owners or alliances", () => {
    const planets = generateSystem(1, 1);

    expect(planets.length).toBeGreaterThanOrEqual(5);
    expect(planets.length).toBeLessThanOrEqual(11);
    expect(planets.every((planet) => planet.owner === null)).toBe(true);
    expect(planets.every((planet) => planet.ownerId === null)).toBe(true);
    expect(planets.every((planet) => planet.alliance === null)).toBe(true);
    expect(planets.every((planet) => planet.occupiedBy === null)).toBe(true);
  });

  test("neutral deterministic fallback leaves stable empty positions", () => {
    const systemOne = generateSystem(1, 1);
    const systemTwo = generateSystem(1, 2);

    expect(systemOne.map((planet) => planet.position)).toEqual(
      generateSystem(1, 1).map((planet) => planet.position)
    );
    expect(systemOne.map((planet) => planet.position)).not.toEqual(
      systemTwo.map((planet) => planet.position)
    );
    expect(systemOne.length).toBeLessThan(15);
    expect(systemTwo.length).toBeLessThan(15);
  });

  test("home coordinates can be shown even when the deterministic slot is empty", () => {
    const planets = generateSystem(1, 1);
    const emptyPosition = Array.from({ length: 15 }, (_, index) => index + 1)
      .find((position) => !planets.some((planet) => planet.position === position));

    expect(emptyPosition).toBeDefined();

    const withHome = ensurePlanetAtCoordinates(planets, {
      galaxy: 1,
      system: 1,
      position: emptyPosition ?? 1,
    });

    expect(withHome.some((planet) => planet.position === emptyPosition)).toBe(true);
    expect(withHome.length).toBe(planets.length + 1);
  });

  test("real indexed occupancy is preserved as an owner address only", () => {
    const planets = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          archetype: "cold-tundra",
          fields: 211,
          galaxy: 2,
          key: "2:44:8",
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 8,
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(planets[0]).toMatchObject({
      alliance: null,
      owner: "0x2222222222222222222222222222222222222222",
      ownerId: "0x2222222222222222222222222222222222222222",
      occupiedBy: {
        owner: "0x2222222222222222222222222222222222222222",
        planetId: "7",
      },
    });
  });

  test("galaxy occupancy summary avoids implementation wording", () => {
    const labels = [
      formatGalaxyOccupancySummary(0),
      formatGalaxyOccupancySummary(3),
      formatGalaxyOccupancySource("api", false),
      formatGalaxyOccupancySource("fallback", false),
      formatGalaxyOccupancySource("api", true),
    ];

    expect(labels).toEqual([
      "No occupants",
      "3 occupied",
      "Current system",
      "Preview system",
      "Home planet shown",
    ]);
    expect(labels.join(" ")).not.toMatch(/\b(indexed|real|fallback|injected|data)\b/i);
  });

  test("galaxy heat label is derived from the orbital temperature range", () => {
    expect(formatGalaxyHeatLabel({ min: 46, max: 74 })).toBe("Scorching Molten");
    expect(formatGalaxyHeatLabel({ min: -28, max: 68 })).toBe("Lush Temperate");
    expect(formatGalaxyHeatLabel({ min: -80, max: 0 })).toBe("Frozen Ice");
  });

  test("visible MVP catalog uses scoped gameplay assets", () => {
    expect(buildingCatalog.every((building) => building.asset.includes("/assets/game/style-pass/generated/buildings/"))).toBe(true);
    expect(shipCatalog).toHaveLength(16);
    expect(shipCatalog.every((ship) => ship.asset.includes("/assets/game/style-pass/generated/ships/"))).toBe(true);
    expect(shipCatalog.some((ship) => ship.asset.includes("/assets/game/ships/"))).toBe(false);
    expect(shipCatalog.find((ship) => ship.key === "smallCargo")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/small-cargo.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "lightFighter")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/light-fighter.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "colonyShip")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/colony-ship.webp"
    );
  });

  test("galaxy planet thumbnails use bundled style-pass assets and responsive variants", () => {
    for (const type of PLANET_TYPES) {
      const image = planetImageForType(type);

      expect(image).toBe(`/assets/game/style-pass/generated/planets/${type}.webp`);
      expect(existsSync(join(PUBLIC_DIR, image.replace("/assets/", "assets/")))).toBe(true);

      for (const width of VARIANT_WIDTHS) {
        const variant = image.replace("/assets/game/", `/assets/game/sizes/${width}/`);
        expect(getSrcSet(image)).toContain(`${variant} ${width}w`);
        expect(existsSync(join(PUBLIC_DIR, variant.replace("/assets/", "assets/")))).toBe(true);
      }
    }
  });

  test("planet views treat cached loaded images as ready", () => {
    expect(isImageReady({ complete: true, naturalWidth: 64 } satisfies ImageLoadState)).toBe(true);
    expect(isImageReady({ complete: true, naturalWidth: 0 } satisfies ImageLoadState)).toBe(false);
    expect(isImageReady({ complete: false, naturalWidth: 64 } satisfies ImageLoadState)).toBe(false);
    expect(isImageReady(null)).toBe(false);
  });
});
