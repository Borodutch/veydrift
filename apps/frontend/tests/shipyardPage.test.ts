import { describe, expect, test } from "bun:test";
import { getBlockedReason, getShipRequirementStates } from "../src/components/ShipyardPage";
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

    expect(getShipRequirementStates(smallCargo!, {
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
      shipyardLevel: 2,
      naniteLevel: 0,
      technologyLevels: {
        "3": 1,
      },
      ships: [],
      queue: null,
    })).toEqual([
      { label: "Shipyard 2", met: true },
      { label: "Combustion Drive 2", met: false },
    ]);
  });
});
