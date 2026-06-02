import { describe, expect, test } from "bun:test";
import { selectedProductionItem } from "../src/components/ProductionCatalog";
import { defenseProductionItems, getDefenseRequirementStates, getQueueBlocker } from "../src/components/DefensePage";
import { defenseCatalog } from "../src/playableMvp";
import type { ChainDefenseState } from "../src/walletFlow";

describe("Defense page display helpers", () => {
  test("allows additions to the matching active defense queue", () => {
    expect(getQueueBlocker(0, {
      active: true,
      kind: "defense",
      itemId: 0,
      quantity: 2,
      readyAt: "1000",
      cost: {
        metal: "4000",
        crystal: "0",
        deuterium: "0",
      },
    })).toBeUndefined();
  });

  test("explains when another defense type is already queued", () => {
    expect(getQueueBlocker(1, {
      active: true,
      kind: "defense",
      itemId: 0,
      quantity: 2,
      readyAt: "1000",
      cost: {
        metal: "4000",
        crystal: "0",
        deuterium: "0",
      },
    })).toBe("Active queue: Rocket Launcher");
  });

  test("returns visible met and unmet requirement states", () => {
    const lightLaser = defenseCatalog.find((item) => item.key === "lightLaser");
    expect(lightLaser).toBeDefined();

    expect(getDefenseRequirementStates(lightLaser!, defenseState({
      shipyardLevel: 2,
      technologyLevels: {
        "0": 1,
        "1": 2,
      },
    }))).toEqual([
      { label: "Shipyard 2", met: true, target: { kind: "building", key: "shipyard" } },
      { label: "Energy 1", met: true, target: { kind: "research", key: "energy" } },
      { label: "Laser 3", met: false, target: { kind: "research", key: "laser" } },
    ]);
  });

  test("builds a dense defense catalog with deployed counts and locked states", () => {
    const items = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState({
        shipyardLevel: 2,
        technologyLevels: {
          "0": 1,
          "1": 3,
        },
        defenses: [
          {
            id: 0,
            count: 12,
            cost: {
              metal: "2000",
              crystal: "0",
              deuterium: "0",
            },
          },
          {
            id: 1,
            count: 3,
            cost: {
              metal: "1500",
              crystal: "500",
              deuterium: "0",
            },
          },
        ],
      }),
      productionAvailable: true,
      quantities: { lightLaser: 4 },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
    });

    expect(items).toHaveLength(defenseCatalog.length);
    expect(items.find((item) => item.key === "rocketLauncher")).toMatchObject({
      countLabel: "Deployed",
      countValue: 12,
      description: expect.stringContaining("kinetic"),
      statRows: expect.arrayContaining([
        expect.objectContaining({ label: "Attack", value: 80 }),
        expect.objectContaining({ label: "Shield", value: 20 }),
        expect.objectContaining({ label: "Hull", value: 200 }),
      ]),
      status: "ready",
    });
    expect(items.find((item) => item.key === "lightLaser")).toMatchObject({
      countValue: 3,
      quantity: 4,
      status: "ready",
    });
    expect(items.find((item) => item.key === "gaussCannon")).toMatchObject({
      status: "locked",
    });
  });

  test("marks matching active defense queues as selectable add targets", () => {
    const queue = {
      active: true,
      kind: "defense",
      itemId: 0,
      quantity: 2,
      readyAt: "1700000100",
      cost: {
        metal: "4000",
        crystal: "0",
        deuterium: "0",
      },
    };
    const items = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState({
        shipyardLevel: 1,
        defenses: [
          {
            id: 0,
            count: 5,
            cost: {
              metal: "2000",
              crystal: "0",
              deuterium: "0",
            },
          },
        ],
        queue,
      }),
      productionAvailable: true,
      quantities: {},
      queue,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
    });

    expect(selectedProductionItem(items, "rocketLauncher")).toMatchObject({
      actionLabel: "Add",
      queued: 2,
      status: "queued",
      statusLabel: "Queued",
    });
    expect(items.find((item) => item.key === "lightLaser")?.blockedReason).toBe("Active queue: Rocket Launcher");
  });
});

function defenseState(overrides: Partial<ChainDefenseState> = {}): ChainDefenseState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    productionAvailable: true,
    resources: {
      metal: "10000",
      crystal: "10000",
      deuterium: "10000",
    },
    shipyardLevel: 0,
    missileSiloLevel: 0,
    technologyLevels: {},
    defenses: [],
    queue: null,
    ...overrides,
  };
}
