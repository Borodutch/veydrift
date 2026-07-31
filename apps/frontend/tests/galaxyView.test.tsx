import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  galaxyActionsForMoonSlot,
  GalaxyActionButtons,
  galaxyLoadErrorPresentation,
  withOwnedPlanetNames,
} from "../src/components/GalaxyView";
import type { Planet } from "../src/types";
import type { ChainShipyardState } from "../src/walletFlow";

describe("GalaxyView moon actions", () => {
  test("overlays renamed owned planets without discarding public galaxy intel", () => {
    const owner = "0x2222222222222222222222222222222222222222";
    const publicPlanet = {
      ...galaxyPlanet(owner),
      debrisField: { metal: 4_000, crystal: 2_000 },
      name: "Planet 2.44.9",
    };
    const ownedPlanet = {
      ...galaxyPlanet(owner),
      name: "New Ottawa",
    };

    const [merged] = withOwnedPlanetNames([publicPlanet], [ownedPlanet]);

    expect(merged?.name).toBe("New Ottawa");
    expect(merged?.debrisField).toEqual({ metal: 4_000, crystal: 2_000 });
    expect(merged?.occupiedBy).toEqual(publicPlanet.occupiedBy);
  });

  test("keeps unavailable explanations in native browser titles", () => {
    const tree = GalaxyActionButtons({
      actions: [{
        enabled: false,
        kind: "transport",
        label: "Transport",
        mode: "mission",
        mission: "transport",
        reason: "Transport is unavailable for this target.",
      }],
      busy: false,
      coords: { galaxy: 2, system: 44, position: 9 },
      onAction: () => undefined,
      planet: galaxyPlanet("0x2222222222222222222222222222222222222222"),
    });
    const titledButton = nodesWithProp(
      tree,
      "title",
      "Transport: Transport is unavailable for this target.",
    )[0];

    expect(titledButton).toBeDefined();
    expect(nodesWithProp(tree, "role", "tooltip")).toEqual([]);
  });

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
    const ownActions = galaxyActionsForMoonSlot({
      account: wallet,
      attackProtection: undefined,
      defenseState: null,
      homePlanetId: "7",
      planet: ownPlanet,
      shipyardState,
    });
    const enemyActions = galaxyActionsForMoonSlot({
      account: wallet,
      attackProtection: undefined,
      defenseState: null,
      homePlanetId: "7",
      planet: enemyPlanet,
      shipyardState,
    });

    expect(ownActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    expect(ownActions.slice(0, 2).every((action) => action.enabled && action.defaultTargetIsMoon === true)).toBe(true);
    expect(ownActions[2]).toMatchObject({
      enabled: false,
      kind: "defenseHold",
      reason: "Stationed defense can only target planets in the current mission contract.",
    });
    expect(enemyActions).toHaveLength(1);
    expect(enemyActions[0]).toMatchObject({
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

function nodesWithProp(
  node: ComponentChildren,
  key: string,
  value: unknown,
): VNode[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodesWithProp(child, key, value));
  const vnode = node as VNode;
  const props = (vnode.props ?? {}) as Record<string, unknown>;
  const own = props[key] === value ? [vnode] : [];
  return [...own, ...nodesWithProp(props.children as ComponentChildren, key, value)];
}
