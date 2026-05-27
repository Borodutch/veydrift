import { describe, expect, test } from "bun:test";
import { galaxyActionsForSlot } from "./galaxyActions";
import type { Planet } from "./types";

const account = "0x1111111111111111111111111111111111111111";

describe("galaxyActions", () => {
  test("enables recycler harvest only when indexed debris and recyclers are present", () => {
    const enemy = planet({
      debrisField: {
        metal: 40_000,
        crystal: 15_000,
      },
    });
    const harvest = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: enemy,
      shipyardState: shipyardState([{ id: 2, count: 2 }]),
    }).find((action) => action.kind === "harvest");

    expect(harvest).toMatchObject({
      enabled: true,
      mode: "mission",
      mission: "harvest",
      ships: {
        recycler: 1,
      },
    });
  });

  test("explains real harvest blockers instead of deployment-not-live copy", () => {
    const noDebris = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({ debrisField: null }),
      shipyardState: shipyardState([{ id: 2, count: 2 }]),
    }).find((action) => action.kind === "harvest");
    const noRecycler = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({
        debrisField: {
          metal: 40_000,
          crystal: 15_000,
        },
      }),
      shipyardState: shipyardState([]),
    }).find((action) => action.kind === "harvest");

    expect(noDebris).toMatchObject({
      enabled: false,
      reason: "No debris field at this coordinate.",
    });
    expect(noRecycler).toMatchObject({
      enabled: false,
      reason: "Requires a recycler on your home planet.",
    });
  });
});

function planet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: "2:44:8",
    name: "Planet 2.44.8",
    type: "cold-tundra",
    image: "/assets/game/style-pass/generated/planets/cold-tundra.webp",
    position: 8,
    galaxy: 2,
    system: 44,
    owner: "Enemy",
    ownerId: "0x3333333333333333333333333333333333333333",
    alliance: null,
    occupiedBy: {
      owner: "0x3333333333333333333333333333333333333333",
      planetId: "9",
    },
    debrisField: null,
    moonChance: null,
    resources: {
      metal: 0,
      crystal: 0,
      deuterium: 0,
      energy: 0,
    },
    temperature: {
      min: -40,
      max: 10,
    },
    diameter: 12_000,
    fields: 180,
    hasMoon: false,
    ...overrides,
  };
}

function shipyardState(ships: Array<{ id: number; count: number }>) {
  return {
    homePlanetId: "7",
    productionAvailable: true,
    resources: null,
    shipyardLevel: 1,
    naniteLevel: 0,
    technologyLevels: {},
    ships: ships.map((ship) => ({
      ...ship,
      cost: {
        metal: "0",
        crystal: "0",
        deuterium: "0",
      },
    })),
    queue: null,
    wallet: account,
  };
}
