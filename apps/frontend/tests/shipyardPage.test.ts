import { describe, expect, test } from "bun:test";
import { formatProductionPrice, productionQueueViewModel, selectedProductionItem } from "../src/components/ProductionCatalog";
import { getBlockedReason, getShipRequirementStates, shipProductionItems, shipyardRefreshErrorLabel } from "../src/components/ShipyardPage";
import type { ChainShipyardState } from "../src/walletFlow";
import { shipCatalog } from "../src/playableMvp";

describe("Shipyard page display helpers", () => {
  test("formats shipyard prices like building cost rows", () => {
    expect(formatProductionPrice({ metal: 2_000, crystal: 2_000, deuterium: 0 })).toBe("Metal 2,000, Crystal 2,000");
  });

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

  test("labels refresh errors as stale-data notices when shipyard state remains loaded", () => {
    expect(shipyardRefreshErrorLabel({
      error: "Shipyard request failed with 503",
      shipyardState: shipyardState(),
    })).toBe("Refreshing shipyard state: Shipyard request failed with 503");
    expect(shipyardRefreshErrorLabel({
      error: "Shipyard request failed with 503",
      shipyardState: null,
    })).toBeUndefined();
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
      { label: "Shipyard 2", met: true, target: { kind: "building", key: "shipyard" } },
      { label: "Combustion Drive 2", met: false, target: { kind: "research", key: "combustionDrive" } },
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
      detailNote: "Attack 5 · Shield 10 · Hull 400 · Cargo 5,000",
      detailSections: [
        {
          title: "Combat",
          stats: [
            { label: "Structure", value: "400" },
            { label: "Shield", value: "10" },
            { label: "Attack", value: "5" },
          ],
        },
        {
          title: "Logistics",
          stats: [
            { label: "Cargo", value: "5,000" },
            { label: "Base speed", value: "5,000" },
            { label: "Fuel use", value: "10" },
          ],
        },
        expect.objectContaining({ title: "Build" }),
        expect.objectContaining({ title: "Requirements" }),
      ],
      notes: [expect.stringContaining("freighter")],
      quantity: 3,
      status: "ready",
    });
    expect(items.find((item) => item.key === "smallCargo")).not.toHaveProperty("description");
    expect(items.find((item) => item.key === "battleship")).toMatchObject({
      status: "locked",
      statusLabel: "Locked",
    });
  });

  test("keeps Solar Satellite compact ship stats in selected-panel subtext", () => {
    const baseState = shipyardState();
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
      shipyardState: shipyardState({
        ships: [
          ...baseState.ships,
          {
            id: 9,
            count: 3,
            cost: {
              metal: "0",
              crystal: "2000",
              deuterium: "500",
            },
            energyPerUnit: "22",
          },
        ],
      }),
    });

    expect(items.find((item) => item.key === "solarSatellite")).toMatchObject({
      detailNote: "Attack 1 · Shield 1 · Hull 200 · Cargo No cargo",
      detailSections: expect.arrayContaining([
        {
          title: "Logistics",
          stats: [
            { label: "Cargo", value: "No cargo" },
            { label: "Base speed", value: "Stationary energy platform" },
            { label: "Fuel use", value: "No fuel" },
          ],
        },
      ]),
      notes: [
        expect.stringContaining("energy platform"),
        expect.stringContaining("cannot move, haul cargo, or spend fuel"),
      ],
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

  test("uses spendable accrued resources in insufficient-resource copy", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      productionRates: { metal: 500, crystal: 250, deuterium: 0 },
      quantities: { smallCargo: 2 },
      queue: undefined,
      resources: {
        metal: 3_500,
        crystal: 3_900,
        deuterium: 0,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      blockedReason: "Requires 500 more Metal, 100 more Crystal (affordable in 1h)",
      disabled: true,
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
