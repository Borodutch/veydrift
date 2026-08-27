import { describe, expect, test } from "bun:test";
import {
  formatPlanetType,
  mergePlanetAtCoordinates,
  mergePlanetWithSettlement,
  planetArtTypeFromArchetypeOrCoords,
  planetArtTypeForCoordinates,
  planetFromSettlementPlanet,
  planetsFromSystemResponse,
} from "./data/mockUniverse";
import {
  abandonPlanetUnavailableLabel,
  displayHomeCoordinates,
  shouldShowAbandonPlanetButton,
  type PlanetActionState,
} from "./PlayableMvpApp";
import type { ManagedPlanetResponse } from "./walletFlow";

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

const idleAction = { status: "idle" } satisfies PlanetActionState;

function managedPlanet(overrides: Partial<ManagedPlanetResponse> = {}): ManagedPlanetResponse {
  return {
    planetId: "2",
    owner: settlementPlanet.owner,
    name: null,
    galaxy: 6,
    system: 407,
    position: 15,
    fields: 196,
    temperature: -55,
    metalMultiplierBps: 9600,
    crystalMultiplierBps: 10188,
    deuteriumMultiplierBps: 10875,
    lastSettledAt: "0",
    resources: {
      metal: "0",
      crystal: "0",
      deuterium: "0",
    },
    coordinates: "6:407:15",
    isHomePlanet: false,
    fieldsUsed: 0,
    fieldsCapacity: 196,
    keyLevels: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
    moon: null,
    ...overrides,
  };
}

describe("planet identity", () => {
  test("uses one slot-aware art resolver instead of stale absolute-temperature archetypes", () => {
    const planets = planetsFromSystemResponse({
      galaxy: 1,
      system: 1,
      planets: [
        { galaxy: 1, system: 1, position: 1, fields: 134, temperature: 248, metalMultiplierBps: 10_000, crystalMultiplierBps: 14_000, deuteriumMultiplierBps: 7_840, archetype: "scorching-molten" },
        { galaxy: 1, system: 1, position: 4, fields: 163, temperature: 98, metalMultiplierBps: 10_000, crystalMultiplierBps: 10_000, deuteriumMultiplierBps: 10_840, archetype: "scorching-molten" },
        { galaxy: 1, system: 1, position: 8, fields: 204, temperature: 59, metalMultiplierBps: 13_500, crystalMultiplierBps: 10_000, deuteriumMultiplierBps: 11_620, archetype: "scorching-molten" },
        { galaxy: 1, system: 1, position: 13, fields: 143, temperature: -38, metalMultiplierBps: 10_000, crystalMultiplierBps: 10_000, deuteriumMultiplierBps: 13_560, archetype: "frozen-ice" },
      ],
    });

    expect(planets.map((planet) => planet.type)).toEqual([
      planetArtTypeForCoordinates({ galaxy: 1, system: 1, position: 1 }),
      planetArtTypeForCoordinates({ galaxy: 1, system: 1, position: 4 }),
      planetArtTypeForCoordinates({ galaxy: 1, system: 1, position: 8 }),
      planetArtTypeForCoordinates({ galaxy: 1, system: 1, position: 13 }),
    ]);
    expect(new Set(planets.map((planet) => planet.type)).size).toBe(4);
    expect(planets.slice(1).every((planet) => planet.type !== "scorching-molten")).toBe(true);
  });

  test("normalizes mission and historical archetypes through coordinates", () => {
    const coordinates = { galaxy: 1, system: 1, position: 8 };
    expect(planetArtTypeFromArchetypeOrCoords("scorching-molten", coordinates)).toBe(
      planetArtTypeForCoordinates(coordinates),
    );
    expect(planetArtTypeFromArchetypeOrCoords("scorching-molten", null)).toBe("scorching-molten");
  });

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
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
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
      type: planetArtTypeForCoordinates(settlementPlanet),
      temperature: {
        min: -75,
        max: -35,
      },
      diameter: 14_000,
      image: `/assets/game/style-pass/generated/planets/${planetArtTypeForCoordinates(settlementPlanet)}.webp`,
    });
    expect(formatPlanetType(identity.type)).toBe(formatPlanetType(planetArtTypeForCoordinates(settlementPlanet)));
  });

  test("preserves moon presence on settlement-derived planet identity", () => {
    const identity = planetFromSettlementPlanet({
      ...settlementPlanet,
      moon: { exists: true },
    });

    expect(identity.hasMoon).toBe(true);
  });

  test("preserves a managed planet name in settlement-derived mission identity", () => {
    const identity = planetFromSettlementPlanet({
      ...settlementPlanet,
      name: "New Zion",
    });

    expect(identity.name).toBe("New Zion");
  });

  test("keeps canonical commander and alliance identity when settlement data refreshes galaxy rows", () => {
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
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          temperature: -100,
          occupiedBy: {
            alliance: {
              allianceId: "3",
              name: "Eggs",
              tag: "$EGGS",
            },
            owner: settlementPlanet.owner,
            ownerDisplayName: "borodutch",
            planetId: "2",
          },
        },
      ],
    });

    const identity = mergePlanetWithSettlement(systemPlanet!, settlementPlanet);

    expect(identity.occupiedBy).toMatchObject({
      owner: settlementPlanet.owner,
      ownerDisplayName: "borodutch",
      alliance: {
        allianceId: "3",
        tag: "$EGGS",
      },
    });
    expect(identity.alliance?.tag).toBe("$EGGS");
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
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
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
      type: planetArtTypeForCoordinates(settlementPlanet),
      occupiedBy: {
        planetId: "2",
        owner: settlementPlanet.owner,
      },
    });
  });

  test("preserves API debris fields on galaxy planets", () => {
    const [systemPlanet] = planetsFromSystemResponse({
      galaxy: 6,
      system: 407,
      planets: [
        {
          key: "6:407:15",
          fields: 214,
          galaxy: 6,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          system: 407,
          position: 15,
          temperature: -100,
          debrisField: {
            metal: "27000",
            crystal: "9000",
          },
        },
      ],
    });

    expect(systemPlanet?.debrisField).toEqual({
      metal: 27_000,
      crystal: 9_000,
    });
  });

  test("preserves API moon chance reports on galaxy planets", () => {
    const [systemPlanet] = planetsFromSystemResponse({
      galaxy: 6,
      system: 407,
      planets: [
        {
          key: "6:407:15",
          fields: 214,
          galaxy: 6,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          system: 407,
          position: 15,
          temperature: -100,
          moonChance: {
            battleId: "42",
            targetPlanetId: "2",
            status: "pending",
            outcomeId: "5",
            chanceBps: 1200,
            metalDebris: "900000",
            crystalDebris: "300000",
            randomnessRequestId: "8",
          },
        },
      ],
    });

    expect(systemPlanet?.moonChance).toMatchObject({
      battleId: "42",
      chanceBps: 1200,
      status: "pending",
      targetPlanetId: "2",
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

  test("hides the abandon action for home planets", () => {
    const planet = managedPlanet({ isHomePlanet: true });

    expect(shouldShowAbandonPlanetButton(planet, true, idleAction)).toBe(false);
    expect(abandonPlanetUnavailableLabel(planet, true, idleAction)).toBe("Home planets cannot be abandoned.");
  });

  test("shows the abandon action only for empty inactive-queue colonies", () => {
    expect(shouldShowAbandonPlanetButton(managedPlanet(), true, idleAction)).toBe(true);

    expect(shouldShowAbandonPlanetButton(managedPlanet({
      resources: {
        metal: "1",
        crystal: "0",
        deuterium: "0",
      },
    }), true, idleAction)).toBe(false);

    expect(shouldShowAbandonPlanetButton(managedPlanet({
      queues: {
        building: {
          active: true,
          kind: "building",
          readyAt: "10",
          cost: { metal: "0", crystal: "0", deuterium: "0" },
        },
        defense: null,
        ship: null,
      },
    }), true, idleAction)).toBe(false);
  });
});
