import { describe, expect, test } from "bun:test";
import {
  ensurePlanetAtCoordinates,
  generateSystem,
  planetsFromSystemResponse
} from "../src/data/mockUniverse";
import { buildingCatalog, shipCatalog } from "../src/playableMvp";

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

  test("visible MVP catalog uses the latest scoped style-pass assets", () => {
    expect(buildingCatalog.every((building) => building.asset.includes("/assets/game/style-pass/generated/buildings/"))).toBe(true);
    expect(shipCatalog).toHaveLength(16);
    expect(shipCatalog.every((ship) => ship.asset.includes("/assets/game/"))).toBe(true);
    expect(shipCatalog.find((ship) => ship.key === "smallCargo")?.asset).toBe(
      "/assets/game/style-pass/high-res/small-cargo-alive-fullship-2k.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "lightFighter")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/light-fighter.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "colonyShip")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/colony-ship.webp"
    );
  });
});
