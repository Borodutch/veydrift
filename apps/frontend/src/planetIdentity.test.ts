import { describe, expect, test } from "bun:test";
import {
  formatPlanetType,
  mergePlanetAtCoordinates,
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetsFromSystemResponse,
} from "./data/mockUniverse";
import { displayHomeCoordinates } from "./PlayableMvpApp";

const settlementPlanet = {
  planetId: "2",
  owner: "0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE",
  galaxy: 6,
  system: 407,
  position: 15,
  fields: 196,
  temperature: -55,
  metalMultiplierBps: 9600,
  crystalMultiplierBps: 10188,
  deuteriumMultiplierBps: 10875,
};

describe("planet identity", () => {
  test("uses settlement stats and art family for the home planet identity", () => {
    const [systemPlanet] = planetsFromSystemResponse({
      galaxy: 6,
      system: 407,
      planets: [
        {
          key: "6:407:15",
          galaxy: 6,
          system: 407,
          position: 15,
          fields: 214,
          temperature: -100,
          archetype: "metal-planetoid",
        },
      ],
    });

    const identity = mergePlanetWithSettlement(systemPlanet!, settlementPlanet);

    expect(identity).toMatchObject({
      name: "Planet 6.407.15",
      galaxy: 6,
      system: 407,
      position: 15,
      fields: 196,
      type: "frozen-ice",
      temperature: {
        min: -75,
        max: -35,
      },
      diameter: 14_000,
      image: "/assets/game/style-pass/generated/planets/frozen-ice.webp",
    });
    expect(formatPlanetType(identity.type)).toBe("Frozen Ice");
  });

  test("replaces the generated galaxy row with the authoritative home planet", () => {
    const generated = planetsFromSystemResponse({
      galaxy: 6,
      system: 407,
      planets: [
        {
          key: "6:407:15",
          galaxy: 6,
          system: 407,
          position: 15,
          fields: 214,
          temperature: -100,
          archetype: "metal-planetoid",
        },
      ],
    });
    const home = planetFromSettlementPlanet(settlementPlanet);

    const merged = mergePlanetAtCoordinates(generated, home);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      fields: 196,
      type: "frozen-ice",
      occupiedBy: {
        planetId: "2",
        owner: settlementPlanet.owner,
      },
    });
  });

  test("uses canonical home coordinates for shell chrome instead of stale settlement props", () => {
    const home = planetFromSettlementPlanet({
      ...settlementPlanet,
      galaxy: 2,
      system: 246,
      position: 3,
      temperature: 16,
    });

    expect(displayHomeCoordinates(
      home,
      { galaxy: 2, system: 246, position: 3 },
      "9:280:15"
    )).toBe("2:246:3");
  });
});
