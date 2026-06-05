import { describe, expect, test } from "bun:test";
import { formatProductionPrice, selectedProductionItem } from "../src/components/ProductionCatalog";
import { defenseProductionItems, getDefenseRequirementStates, getQueueBlocker } from "../src/components/DefensePage";
import { defenseCatalog } from "../src/playableMvp";
import type { ChainDefenseState } from "../src/walletFlow";

describe("Defense page display helpers", () => {
  test("formats defense prices like building cost rows", () => {
    expect(formatProductionPrice({ metal: 2_000, crystal: 6_000, deuterium: 0 })).toBe("Metal 2,000, Crystal 6,000");
  });

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

  test("allows different defense types behind the active queue", () => {
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
    })).toBeUndefined();
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
      detailNote: "Attack 80 · Shield 20 · Hull 200",
      durationSeconds: 960,
      status: "ready",
    });
    expect(items.find((item) => item.key === "rocketLauncher")).not.toHaveProperty("description");
    expect(items.find((item) => item.key === "rocketLauncher")?.notes).toBeUndefined();
    expect(items.find((item) => item.key === "lightLaser")).toMatchObject({
      countValue: 3,
      quantity: 4,
      status: "ready",
    });
    expect(items.find((item) => item.key === "gaussCannon")).toMatchObject({
      status: "locked",
    });
  });

  test("uses a typed defense quantity when building the item model", () => {
    const items = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState({
        shipyardLevel: 1,
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
        ],
      }),
      productionAvailable: true,
      quantities: { rocketLauncher: "22" },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
    });

    expect(items.find((item) => item.key === "rocketLauncher")).toMatchObject({
      quantity: 22,
      quantityInput: "22",
      quantityValid: true,
    });
  });

  test("marks invalid defense quantity drafts as non-submittable", () => {
    for (const input of ["", "0", "-1", "2.5", "abc", "9007199254740993"]) {
      const items = defenseProductionItems({
        actionPending: false,
        canTransact: true,
        defenseState: defenseState({
          shipyardLevel: 1,
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
          ],
        }),
        productionAvailable: true,
        quantities: { rocketLauncher: input },
        queue: undefined,
        resources: {
          metal: 100000,
          crystal: 100000,
          deuterium: 100000,
        },
      });

      expect(items.find((item) => item.key === "rocketLauncher")).toMatchObject({
        quantity: 1,
        quantityInput: input,
        quantityValid: false,
      });
    }
  });

  test("preserves an empty defense quantity edit separately from build quantity", () => {
    const items = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState({
        shipyardLevel: 1,
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
        ],
      }),
      productionAvailable: true,
      quantities: { rocketLauncher: "" },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
    });

    expect(items.find((item) => item.key === "rocketLauncher")).toMatchObject({
      quantity: 1,
      quantityInput: "",
      quantityValid: false,
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
        shipyardLevel: 2,
        technologyLevels: {
          "0": 1,
          "1": 3,
        },
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
          {
            id: 1,
            count: 0,
            cost: {
              metal: "1500",
              crystal: "500",
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
    expect(items.find((item) => item.key === "lightLaser")).toMatchObject({
      actionLabel: "Build",
      blockedReason: undefined,
      status: "ready",
    });
  });

  test("counts defense backlog quantities in catalog rows", () => {
    const queue = {
      active: true,
      kind: "defense",
      itemId: 1,
      quantity: 2,
      readyAt: "1700000100",
      cost: {
        metal: "3000",
        crystal: "1000",
        deuterium: "0",
      },
      backlog: [
        {
          active: true,
          kind: "defense",
          itemId: 0,
          quantity: 4,
          readyAt: "1700000200",
          cost: {
            metal: "8000",
            crystal: "0",
            deuterium: "0",
          },
        },
      ],
    };
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
            count: 5,
            cost: {
              metal: "2000",
              crystal: "0",
              deuterium: "0",
            },
          },
          {
            id: 1,
            count: 0,
            cost: {
              metal: "1500",
              crystal: "500",
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
      queued: 4,
      status: "queued",
    });
  });

  test("uses spendable accrued resources in insufficient-resource copy", () => {
    const items = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState({
        shipyardLevel: 1,
        defenses: [
          {
            id: 0,
            count: 0,
            cost: {
              metal: "2000",
              crystal: "0",
              deuterium: "0",
            },
          },
        ],
      }),
      productionAvailable: true,
      productionRates: { metal: 500, crystal: 0, deuterium: 0 },
      quantities: { rocketLauncher: 2 },
      queue: undefined,
      resources: {
        metal: 3_500,
        crystal: 0,
        deuterium: 0,
      },
    });

    expect(items.find((item) => item.key === "rocketLauncher")).toMatchObject({
      blockedReason: "Requires 500 more Metal (affordable in 1h)",
      disabled: true,
    });
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
    naniteLevel: 0,
    missileSiloLevel: 0,
    technologyLevels: {},
    defenses: [],
    queue: null,
    ...overrides,
  };
}
