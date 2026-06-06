import { describe, expect, test } from "bun:test";
import { galaxyActionsForSlot } from "./galaxyActions";
import { planetDetailGalaxyActions } from "./components/PlanetDetail";
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

  test("uses canonical attack protection to block attack actions", () => {
    const attack = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked: target is protected by newbie or score-ratio protection.",
      },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: false,
      reason: "Attack blocked: target is protected by newbie or score-ratio protection.",
    });
  });

  test("labels missing attack fleet separately from state and protection blockers", () => {
    const attack = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: true,
        blockedReason: "none",
        blockedReasonLabel: null,
      },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: false,
      reason: "Requires at least one movable ship on your home planet.",
    });
  });

  test("keeps transport and deploy available for owned non-origin planets", () => {
    const ownColony = planet({
      ownerId: account,
      occupiedBy: {
        owner: account,
        planetId: "9",
      },
    });
    const actions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownColony,
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });

    expect(actions.map((action) => [action.kind, action.enabled])).toEqual([
      ["transport", true],
      ["deploy", true],
    ]);
  });

  test("planet detail reuses galaxy mission actions for occupied, owned, origin, and empty targets", () => {
    const homeCoords = { galaxy: 2, system: 44, position: 7 };
    const enemyActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 8 },
      defenseState: defenseState([{ id: 9, count: 1 }]),
      homeCoords,
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([
        { id: 1, count: 1 },
        { id: 2, count: 1 },
      ]),
    });
    const ownActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 9 },
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: planet({
        position: 9,
        ownerId: account,
        occupiedBy: {
          owner: account,
          planetId: "9",
        },
      }),
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });
    const originActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: homeCoords,
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: planet({
        position: 7,
        ownerId: account,
        occupiedBy: {
          owner: account,
          planetId: "7",
        },
      }),
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });
    const emptyActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 12 },
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: undefined,
      shipyardState: shipyardState([{ id: 3, count: 1 }]),
    });

    expect(enemyActions.map((action) => action.label)).toEqual(["Attack", "Harvest", "Missile"]);
    expect(ownActions.map((action) => action.label)).toEqual(["Transport", "Deploy"]);
    expect(originActions).toEqual([]);
    expect(emptyActions).toMatchObject([{ enabled: true, kind: "colonize", label: "Colonize" }]);
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

function defenseState(defenses: Array<{ id: number; count: number }>) {
  return {
    homePlanetId: "7",
    productionAvailable: true,
    resources: null,
    shipyardLevel: 1,
    naniteLevel: 0,
    missileSiloLevel: 4,
    technologyLevels: {},
    defenses: defenses.map((defense) => ({
      ...defense,
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
