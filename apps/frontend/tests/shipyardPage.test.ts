import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { formatProductionPrice, productionQueueViewModel, selectedProductionItem } from "../src/components/ProductionCatalog";
import {
  getBlockedReason,
  getShipRequirementStates,
  shipProductionItems,
  shipyardRefreshButtonState,
  shipyardRefreshErrorLabel,
  shouldShowShipyardInitialLoader,
  StatusPanel,
} from "../src/components/ShipyardPage";
import type { ChainShipyardState } from "../src/walletFlow";
import { shipCatalog, shipyardCatalog } from "../src/playableMvp";
import { formatDuration } from "../src/durationFormat";

describe("Shipyard status panel surfaces only failures", () => {
  test("does not render success or pending action banners", () => {
    for (const status of ["success", "pending"] as const) {
      const panel = StatusPanel({
        actionState: { status, label: `Ship ${status} banner` },
        error: undefined,
        loading: false,
        shipyardState: shipyardState(),
      });
      expect(visibleText(panel)).toBe("");
    }
  });

  test("still renders error action banners", () => {
    const panel = StatusPanel({
      actionState: { status: "error", label: "Ship build failed" },
      error: undefined,
      loading: false,
      shipyardState: shipyardState(),
    });
    expect(visibleText(panel)).toContain("Ship build failed");
  });

  test("keeps the last notice visible during a refresh instead of blinking to null", () => {
    const panel = StatusPanel({
      actionState: { status: "error", label: "Ship build failed" },
      error: undefined,
      loading: true,
      shipyardState: shipyardState(),
    });
    expect(visibleText(panel)).toContain("Ship build failed");
  });
});

function visibleText(node: ComponentChildren): string {
  const parts: string[] = [];
  const walk = (current: ComponentChildren): void => {
    if (current === null || current === undefined || typeof current === "boolean") return;
    if (typeof current === "string" || typeof current === "number") {
      parts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const vnode = current as VNode;
    if (typeof vnode.type === "function") {
      walk(vnode.type(vnode.props));
      return;
    }
    walk(vnode.props?.children as ComponentChildren);
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

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
      resources: undefined,
      shipUnavailable: false,
      shipyardState: null,
    })).toBe("Waiting for chain state");
  });

  test("appends the affordable-in ETA to the unaffordable reason when production rates are supplied (VEY-KANEO-481)", () => {
    // 500 Metal short @ 1000 Metal/h = 30m.
    expect(getBlockedReason({
      affordable: false,
      canTransact: true,
      hasPlanet: true,
      missing: [],
      resources: { metal: 4_500, crystal: 5_000, deuterium: 5_000 },
      shipUnavailable: false,
      shipyardState: shipyardState(),
      totalCost: { metal: 5_000, crystal: 5_000, deuterium: 0 },
      productionRates: { metal: 1_000, crystal: 1_000, deuterium: 0 },
    })).toBe("Requires 500 more Metal (affordable in 30m)");
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

  test("keeps loaded shipyard visible during background refreshes", () => {
    const loadedState = shipyardState();

    expect(shouldShowShipyardInitialLoader({ loading: true, shipyardState: null })).toBe(true);
    expect(shouldShowShipyardInitialLoader({ loading: true, shipyardState: loadedState })).toBe(false);
    expect(shipyardRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(shipyardRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });
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

    expect(items).toHaveLength(shipyardCatalog.length);
    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      actionLabel: "Build",
      countLabel: "At planet",
      countValue: 4,
      detailNote: "Attack 5 · Shield 10 · Hull 400 · Cargo 5,000",
      detailSections: [
        {
          title: "Logistics",
          stats: [
            { label: "Base speed", value: "5,000" },
            { label: "Fuel use", value: "10" },
          ],
        },
        {
          title: "Build",
          stats: [
            {
              label: "At planet",
              value: "4",
            },
            { label: "Price", value: "Metal 6,000, Crystal 6,000", wide: true },
          ],
        },
      ],
      notes: [
        "A nimble freighter for early raids and supply runs. Its hold is modest, but it is cheap enough to mass-produce while a young colony is still finding its footing.",
      ],
      quantity: 3,
      status: "ready",
    });
    expect(JSON.stringify(items.find((item) => item.key === "smallCargo")?.detailSections)).not.toContain(
      "Ships stationed at this planet now. Fleets in flight on missions are not counted here.",
    );
    expect(items.find((item) => item.key === "smallCargo")).not.toHaveProperty("description");
    expect(items.find((item) => item.key === "battleship")).toMatchObject({
      status: "locked",
      statusLabel: "Locked",
    });
  });

  test("hides expedition-only Pathfinder from the shipyard while keeping it in the full catalog", () => {
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

    expect(items.find((item) => item.key === "pathfinder")).toBeUndefined();
    expect(shipyardCatalog.some((ship) => ship.key === "pathfinder")).toBe(false);
    // Contract enum / stats source of truth stays intact for queue labels and combat.
    expect(shipCatalog.some((ship) => ship.key === "pathfinder")).toBe(true);
    expect(shipyardCatalog).toHaveLength(shipCatalog.length - 1);
  });

  test("shows backend per-unit build time scaled by the selected quantity (VEY-KANEO-472)", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: 3 },
      queue: undefined,
      resources: { metal: 100000, crystal: 100000, deuterium: 100000 },
      shipyardLevel: 5,
      // Small Cargo is ship id 0; backend supplies a 60s per-unit duration.
      shipyardState: shipyardState({
        ships: [{ id: 0, count: 4, cost: { metal: "2000", crystal: "2000", deuterium: "0" }, durationSeconds: 60 }],
      }),
    });

    const smallCargo = items.find((item) => item.key === "smallCargo");
    const buildStat = smallCargo?.detailSections
      ?.find((section) => section.title === "Build")
      ?.stats.find((stat) => stat.label === "Build time");
    expect(buildStat?.value).toBe(formatDuration(180));
  });

  test("omits build time when the backend supplies no per-unit duration (VEY-KANEO-472)", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: 3 },
      queue: undefined,
      resources: { metal: 100000, crystal: 100000, deuterium: 100000 },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    const buildStats = items.find((item) => item.key === "smallCargo")?.detailSections
      ?.find((section) => section.title === "Build")
      ?.stats.map((stat) => stat.label);
    expect(buildStats).not.toContain("Build time");
  });

  test("uses a typed shipyard quantity when building the item model", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: "22" },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      quantity: 22,
      quantityInput: "22",
      quantityValid: true,
    });
  });

  test("marks invalid shipyard quantity drafts as non-submittable", () => {
    for (const input of ["", "0", "-1", "2.5", "abc", "9007199254740993"]) {
      const items = shipProductionItems({
        actionPending: false,
        canTransact: true,
        productionAvailable: true,
        quantities: { smallCargo: input },
        queue: undefined,
        resources: {
          metal: 100000,
          crystal: 100000,
          deuterium: 100000,
        },
        shipyardLevel: 5,
        shipyardState: shipyardState(),
      });

      expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
        quantity: 1,
        quantityInput: input,
        quantityValid: false,
      });
    }
  });

  test("preserves an empty shipyard quantity edit separately from build quantity", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: "" },
      queue: undefined,
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      quantity: 1,
      quantityInput: "",
      quantityValid: false,
    });
  });

  test("shows Solar Satellite special behavior without flight-style zero logistics", () => {
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

    const solarSatellite = items.find((item) => item.key === "solarSatellite");
    expect(solarSatellite).toMatchObject({
      detailNote: "Attack 1 · Shield 1 · Hull 200 · No cargo",
      notes: [
        "An orbital energy platform with almost no combat role. Solar Satellites are efficient power sources, but their fragile frames remain exposed during attacks.",
        "Special: generates energy in orbit and cannot move, haul cargo, or spend fuel.",
      ],
    });
    expect(solarSatellite?.detailSections?.find((section) => section.title === "Combat")).toBeUndefined();
    expect(solarSatellite?.detailSections?.find((section) => section.title === "Requirements")).toBeUndefined();
    expect(solarSatellite?.detailSections?.find((section) => section.title === "Logistics")).toEqual({
      title: "Logistics",
      stats: [
        { label: "Base speed", value: "Stationary energy platform" },
        { label: "Fuel use", value: "No fuel" },
      ],
    });
  });

  test("explains the Crawler mine-production boost as a special note", () => {
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
            id: 15,
            count: 2,
            cost: {
              metal: "2000",
              crystal: "2000",
              deuterium: "1000",
            },
          },
        ],
      }),
    });

    const crawler = items.find((item) => item.key === "crawler");
    expect(crawler).toMatchObject({
      notes: [
        "A stationary mining-support unit rather than a fleet ship: crawlers do not fly, haul cargo, or fight. They boost this planet's metal, crystal, and deuterium mine output.",
        "Special: each crawler adds +0.02% to this planet's metal, crystal, and deuterium mine production, counting up to 8 crawlers per combined mine level (Metal Mine + Crystal Mine + Deuterium Synthesizer) and capped at a +50% total bonus. The on-chain bonus activates once the crawler production upgrade is live.",
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
      blockedReason: "Requires 500 more Metal, 100 more Crystal",
      disabled: true,
    });
  });

  test("allows adding ships behind active shipyard production", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { lightFighter: 2 },
      queue: {
        active: true,
        kind: "ship",
        itemId: 0,
        quantity: 3,
        readyAt: "1770000060",
        cost: {
          metal: "6000",
          crystal: "6000",
          deuterium: "0",
        },
      },
      resources: {
        metal: 100000,
        crystal: 100000,
        deuterium: 100000,
      },
      shipyardLevel: 5,
      shipyardState: shipyardState({
        ships: [
          ...shipyardState().ships,
          {
            id: 1,
            count: 0,
            cost: {
              metal: "3000",
              crystal: "1000",
              deuterium: "0",
            },
          },
        ],
      }),
    });

    expect(items.find((item) => item.key === "smallCargo")).toMatchObject({
      blockedReason: undefined,
      disabled: false,
      queued: 3,
      status: "queued",
    });
    expect(items.find((item) => item.key === "lightFighter")).toMatchObject({
      blockedReason: undefined,
      disabled: false,
      quantity: 2,
      status: "ready",
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
