import { describe, expect, test } from "bun:test";
import { productionQueueViewModel, selectedProductionItem } from "../src/components/ProductionCatalog";
import { getBlockedReason, getShipRequirementStates, shipProductionItems } from "../src/components/ShipyardPage";
import type { ChainShipyardState } from "../src/walletFlow";
import { shipCatalog } from "../src/playableMvp";

describe("Shipyard page display helpers", () => {
  test("reports a per-ship deployment mismatch without treating the whole page as unloaded", () => {
    expect(getBlockedReason({
      affordable: false,
      canTransact: true,
      hasPlanet: true,
      missing: ["Unavailable on current deployment"],
      queueActive: false,
      resources: {
        metal: 5000,
        crystal: 5000,
        deuterium: 5000,
      },
      shipUnavailable: true,
      shipyardState: {
        wallet: "0x2222222222222222222222222222222222222222",
        homePlanetId: "7",
        productionAvailable: true,
        resources: {
          metal: "5000",
          crystal: "5000",
          deuterium: "5000",
        },
        fleetSlots: {
          active: 0,
          limit: 1,
        },
        shipyardLevel: 5,
        naniteLevel: 0,
        technologyLevels: {},
        ships: [],
        queue: null,
      },
    })).toBe("Ship unavailable on current deployment");
  });

  test("still distinguishes an entirely unloaded shipyard state", () => {
    expect(getBlockedReason({
      affordable: false,
      canTransact: true,
      hasPlanet: false,
      missing: [],
      queueActive: false,
      resources: undefined,
      shipUnavailable: false,
      shipyardState: null,
    })).toBe("Waiting for chain state");
  });

  test("returns visible met and unmet ship requirement states", () => {
    const smallCargo = shipCatalog.find((item) => item.key === "smallCargo");
    expect(smallCargo).toBeDefined();

    expect(getShipRequirementStates(smallCargo!, shipyardState({
      shipyardLevel: 2,
      technologyLevels: {
        "3": 1,
      },
    }))).toEqual([
      { label: "Shipyard 2", met: true },
      { label: "Combustion Drive 2", met: false },
    ]);
  });

  test("builds a dense catalog with owned counts and ready or locked states", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: 3 },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(items).toHaveLength(shipCatalog.length);
    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      actionLabel: "Build",
      countLabel: "Owned",
      countValue: 4,
      quantity: 3,
      status: "ready",
    });
    expect(items.find((item) => item.key === "battleship")).toMatchObject({
      status: "locked",
      statusLabel: "Locked",
    });
  });

  test("keeps catalog context while selected item drives the build panel model", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: {},
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(selectedProductionItem(items, "recycler")?.label).toBe("Recycler");
    expect(selectedProductionItem(items, undefined)?.label).toBe("Small Cargo");
  });

  test("maps an active shipyard queue into the shared queue panel model", () => {
    const queue = productionQueueViewModel({
      active: true,
      kind: "ship",
      itemId: 0,
      quantity: 2,
      readyAt: "1700000120",
      startedAt: "1700000000",
      cost: {
        metal: "4000",
        crystal: "4000",
        deuterium: "0",
      },
    }, shipCatalog);

    expect(queue).toMatchObject({
      label: "Small Cargo",
      quantity: 2,
      readyAt: "1700000120",
      startedAt: "1700000000",
    });
  });
});

function shipyardState(overrides: Partial<ChainShipyardState> = {}): ChainShipyardState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    productionAvailable: true,
    resources: {
      metal: "100000",
      crystal: "100000",
      deuterium: "100000",
    },
    fleetSlots: {
      active: 0,
      limit: 1,
    },
    shipyardLevel: 5,
    naniteLevel: 0,
    technologyLevels: {
      "3": 6,
      "6": 2,
    },
    ships: [
      {
        id: 0,
        count: 4,
        cost: {
          metal: "2000",
          crystal: "2000",
          deuterium: "0",
        },
      },
      {
        id: 2,
        count: 1,
        cost: {
          metal: "10000",
          crystal: "6000",
          deuterium: "2000",
        },
      },
      {
        id: 7,
        count: 0,
        cost: {
          metal: "45000",
          crystal: "15000",
          deuterium: "0",
        },
      },
    ],
    queue: null,
    ...overrides,
  };
}
