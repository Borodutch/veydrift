import { describe, expect, test } from "bun:test";
import { galaxyActionsForSlot } from "../src/galaxyActions";
import { galaxyLoadErrorPresentation, galaxyMoonActionsForSlot } from "../src/components/GalaxyView";
import type { Planet } from "../src/types";
import type { ChainShipyardState } from "../src/walletFlow";

describe("GalaxyView moon actions", () => {
  test("distinguishes calm stale data from a blocking initial load without exposing raw errors", () => {
    const rawError = "RPC HTTP 503 from internal-provider.example";

    expect(galaxyLoadErrorPresentation({ hasCurrentSystemData: true, loadError: rawError })).toEqual({
      blocking: false,
      message: "Showing the last loaded system rows. Refresh to try again.",
      title: "Galaxy refresh delayed",
    });
    expect(galaxyLoadErrorPresentation({ hasCurrentSystemData: false, loadError: rawError })).toEqual({
      blocking: true,
      message: "Retry to load this system.",
      title: "Galaxy system unavailable",
    });
  });

  test("builds concise moon-targeted action rows for galaxy moons", () => {
    const wallet = "0x2222222222222222222222222222222222222222";
    const enemy = "0x3333333333333333333333333333333333333333";
    const shipyardState: ChainShipyardState = {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      productionAvailable: true,
      resources: null,
      fleetLaunchAvailable: true,
      fleetSlots: { active: 0, limit: 2 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    };

    const ownPlanet = galaxyPlanet(wallet);
    const enemyPlanet = galaxyPlanet(enemy);
    const ownActions = galaxyActionsForSlot({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownPlanet,
      shipyardState,
    });
    const enemyActions = galaxyActionsForSlot({
      account: wallet,
      defenseState: null,
      homePlanetId: "7",
      isOrigin: false,
      planet: enemyPlanet,
      shipyardState,
    });

    const ownMoonActions = galaxyMoonActionsForSlot({ account: wallet, actions: ownActions, planet: ownPlanet });
    const enemyMoonActions = galaxyMoonActionsForSlot({ account: wallet, actions: enemyActions, planet: enemyPlanet });

    expect(ownMoonActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    expect(ownMoonActions.every((action) => action.enabled && action.defaultTargetIsMoon === true)).toBe(true);
    expect(enemyMoonActions).toHaveLength(1);
    expect(enemyMoonActions[0]).toMatchObject({
      enabled: true,
      kind: "attack",
      label: "Attack",
      mission: "attack",
      defaultTargetIsMoon: true,
    });
  });
});

function galaxyPlanet(owner: string): Planet {
  return {
    alliance: null,
    debrisField: null,
    diameter: 12000,
    fields: 180,
    galaxy: 2,
    hasMoon: true,
    id: "9",
    image: "/assets/game/style-pass/generated/planets/hot-desert.webp",
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000,
    moonChance: null,
    moonName: "Moon",
    name: "Galaxy Row",
    occupiedBy: {
      owner,
      ownerDisplayName: null,
      planetId: "9",
    },
    owner,
    ownerId: owner,
    position: 9,
    resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
    system: 44,
    temperature: { min: -20, max: 40 },
    type: "hot-desert",
  };
}
