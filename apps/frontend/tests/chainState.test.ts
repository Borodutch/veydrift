import { describe, expect, test } from "bun:test";
import {
  buildingCosts,
  energyBalanceFromChain,
  emptyContractState,
  infrastructurePlayableState,
} from "../src/chainState";
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
      produced: 60,
      required: 100,
      scaleBps: 6000,
    });
  });
});
