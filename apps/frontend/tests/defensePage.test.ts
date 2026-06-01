import { describe, expect, test } from "bun:test";
import { getDefenseRequirementStates, getQueueBlocker } from "../src/components/DefensePage";
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
      { label: "Shipyard 2", met: true },
      { label: "Energy 1", met: true },
      { label: "Laser 3", met: false },
    ]);
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
