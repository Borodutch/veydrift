import { describe, expect, test } from "bun:test";
import { infrastructureActionNoticeFor, topBarEnergyFor } from "../src/PlayableMvpApp";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainInfrastructureState } from "../src/walletFlow";

describe("Playable MVP app display helpers", () => {
  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("keeps loaded top bar energy available during infrastructure refresh", () => {
    const settledState = createInitialPlayableState();
    const infrastructureChainState = infrastructureState({
      energyBalance: {
        produced: "100",
        required: "40",
        scaleBps: "10000",
      },
    });

    expect(topBarEnergyFor({
      infrastructureChainState,
      isWalletConnected: true,
      settledState,
    })).toEqual({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("does not invent top bar energy when chain state is missing or errored", () => {
    const settledState = createInitialPlayableState();

    expect(topBarEnergyFor({
      infrastructureChainState: null,
      isWalletConnected: true,
      settledState,
    })).toBeUndefined();

    expect(topBarEnergyFor({
      infrastructureChainState: infrastructureState({ energyBalance: null }),
      infrastructureError: "Infrastructure state could not be loaded.",
      isWalletConnected: true,
      settledState,
    })).toBeUndefined();
  });
});

function infrastructureState({
  energyBalance,
}: Pick<ChainInfrastructureState, "energyBalance">): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    infrastructureAvailable: true,
    resources: { metal: "500", crystal: "500", deuterium: "0" },
    productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
    energyBalance,
    storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
    buildings: [],
    queue: null,
  };
}
