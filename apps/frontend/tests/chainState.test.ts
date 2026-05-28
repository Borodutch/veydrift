import { describe, expect, test } from "bun:test";
import {
  buildingCosts,
  energyBalanceFromChain,
  emptyContractState,
  infrastructurePlayableState,
} from "../src/chainState";
import { buildingUpgradeStatus } from "../src/buildingDetails";
import type { ChainInfrastructureState } from "../src/walletFlow";

const infrastructureState: ChainInfrastructureState = {
  wallet: "0x2222222222222222222222222222222222222222",
  homePlanetId: "7",
  infrastructureAvailable: true,
  resources: {
    metal: "1234",
    crystal: "567",
    deuterium: "89",
  },
  productionPerHour: {
    metal: "30",
    crystal: "15",
    deuterium: "8",
  },
  energyBalance: {
    produced: "60",
    required: "100",
    scaleBps: "6000",
  },
  storageCaps: {
    metal: "10000",
    crystal: "10000",
    deuterium: "10000",
  },
  buildings: [
    {
      id: 0,
      level: 2,
      cost: {
        metal: "240",
        crystal: "60",
        deuterium: "0",
      },
    },
  ],
  queue: null,
};

describe("contract state adapters", () => {
  test("empty contract state cannot masquerade as local gameplay progress", () => {
    const state = emptyContractState(1_000);

    expect(state.resources).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(state.queue).toBeUndefined();
    expect(state.researchQueue).toBeUndefined();
    expect(state.buildings.metalMine).toBe(0);
  });

  test("infrastructure display state only hydrates values supplied by chain API", () => {
    const state = infrastructurePlayableState(infrastructureState, 1_000);

    expect(state.resources).toEqual({ metal: 1234, crystal: 567, deuterium: 89 });
    expect(state.buildings.metalMine).toBe(2);
    expect(state.buildings.crystalMine).toBe(0);
    expect(buildingCosts(infrastructureState).metalMine).toEqual({
      metal: 240,
      crystal: 60,
      deuterium: 0,
    });
    expect(energyBalanceFromChain(infrastructureState.energyBalance)).toEqual({
      deuteriumConsumed: 0,
      produced: 60,
      required: 100,
      scaleBps: 6000,
    });
  });

  test("indexed infrastructure levels do not turn zero placeholder costs into no-cost upgrades", () => {
    const indexedState: ChainInfrastructureState = {
      ...infrastructureState,
      source: "contract-state-indexer",
      stale: true,
      energyBalance: null,
      productionPerHour: null,
      storageCaps: null,
      buildings: [
        { id: 0, level: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 3, level: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
    };

    const state = infrastructurePlayableState(indexedState, 1_000);
    const costs = buildingCosts(indexedState);
    const status = buildingUpgradeStatus(state, "metalMine", {
      chainCost: costs.metalMine,
    });

    expect(state.buildings.metalMine).toBe(1);
    expect(state.buildings.solarPlant).toBe(1);
    expect(costs.metalMine).toBeUndefined();
    expect(status.targetLevel).toBe(2);
    expect(status.cost).toEqual({ metal: 90, crystal: 22, deuterium: 0 });
    expect(status.reason).not.toContain("No resource cost");
  });
});
