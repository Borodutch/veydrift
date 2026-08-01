import { describe, expect, test } from "bun:test";
import type { FleetMissionSummary, FleetMissionVisibilityResponse } from "./walletFlow";
import {
  derivePlanetPickerAttackHighlights,
  planetPickerHasIncomingAttack,
} from "./planetPickerAttackHighlights";

const WALLET_A = "0x2222222222222222222222222222222222222222";
const WALLET_B = "0x3333333333333333333333333333333333333333";

describe("planet picker attack highlights", () => {
  test("stays neutral until authoritative visibility for the current wallet is hydrated", () => {
    const stale = visibility(WALLET_A, [mission({ targetPlanetId: "2" })]);

    const loading = derivePlanetPickerAttackHighlights({
      account: WALLET_A,
      fleetVisibility: stale,
      hydrated: false,
      planetIds: ["1", "2"],
    });

    expect(loading.status).toBe("loading");
    expect(planetPickerHasIncomingAttack(loading, "2", "planet")).toBe(false);
  });

  test("keeps highlights attached to canonical ids through persisted reordering", () => {
    const highlights = derivePlanetPickerAttackHighlights({
      account: WALLET_A,
      fleetVisibility: visibility(WALLET_A, [mission({ targetPlanetId: "2" })]),
      hydrated: true,
      planetIds: ["1", "2", "3"],
    });
    const highlightedRows = (order: string[]) => order.map((planetId) => ({
      highlighted: planetPickerHasIncomingAttack(highlights, planetId, "planet"),
      planetId,
    }));

    expect(highlightedRows(["3", "1", "2"])).toEqual([
      { highlighted: false, planetId: "3" },
      { highlighted: false, planetId: "1" },
      { highlighted: true, planetId: "2" },
    ]);
    expect(highlightedRows(["2", "3", "1"])).toEqual([
      { highlighted: true, planetId: "2" },
      { highlighted: false, planetId: "3" },
      { highlighted: false, planetId: "1" },
    ]);
  });

  test("separates planet and moon targets while handling multiple attacks and roster changes", () => {
    const highlights = derivePlanetPickerAttackHighlights({
      account: WALLET_A,
      fleetVisibility: visibility(WALLET_A, [
        mission({ missionId: "planet", targetPlanetId: "2" }),
        mission({ missionId: "moon", missionType: "AcsAttack", targetIsMoon: true, targetPlanetId: "3" }),
        mission({ missionId: "removed", missionType: "MissileAttack", targetPlanetId: "1" }),
        mission({ missionId: "returning", status: "Returning", targetPlanetId: "4" }),
        mission({ missionId: "owned", owner: WALLET_A, targetPlanetId: "4" }),
      ]),
      hydrated: true,
      planetIds: ["2", "3", "4"],
    });

    expect(highlights.status).toBe("ready");
    expect([...highlights.planetIds]).toEqual(["2"]);
    expect([...highlights.moonParentPlanetIds]).toEqual(["3"]);
    expect(planetPickerHasIncomingAttack(highlights, "3", "planet")).toBe(false);
    expect(planetPickerHasIncomingAttack(highlights, "3", "moon")).toBe(true);
    expect(planetPickerHasIncomingAttack(highlights, "1", "planet")).toBe(false);
    expect(planetPickerHasIncomingAttack(highlights, "4", "planet")).toBe(false);
  });

  test("rejects delayed visibility from another wallet across disconnect and reconnect", () => {
    const delayedWalletA = visibility(WALLET_A, [mission({ targetPlanetId: "2" })]);
    const disconnected = derivePlanetPickerAttackHighlights({
      account: undefined,
      fleetVisibility: delayedWalletA,
      hydrated: false,
      planetIds: ["2", "7"],
    });
    const reconnectingWalletB = derivePlanetPickerAttackHighlights({
      account: WALLET_B,
      fleetVisibility: delayedWalletA,
      hydrated: true,
      planetIds: ["2", "7"],
    });
    const hydratedWalletB = derivePlanetPickerAttackHighlights({
      account: WALLET_B,
      fleetVisibility: visibility(WALLET_B, [mission({ owner: WALLET_A, targetPlanetId: "7" })]),
      hydrated: true,
      planetIds: ["2", "7"],
    });

    expect(planetPickerHasIncomingAttack(disconnected, "2", "planet")).toBe(false);
    expect(planetPickerHasIncomingAttack(reconnectingWalletB, "2", "planet")).toBe(false);
    expect(planetPickerHasIncomingAttack(hydratedWalletB, "7", "planet")).toBe(true);
  });
});

function visibility(wallet: string, incoming: FleetMissionSummary[]): FleetMissionVisibilityResponse {
  return {
    wallet,
    homePlanetId: "1",
    incoming,
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };
}

function mission(overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return {
    missionId: "attack",
    status: "Outbound",
    missionType: "Attack",
    owner: WALLET_B,
    originPlanetId: "99",
    targetPlanetId: "2",
    arrivalAt: "1770000300",
    returnAt: "1770000600",
    fuelCost: "25",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: { lightFighter: "1" },
    transactionHash: "0xabc",
    blockNumber: "1",
    ...overrides,
  };
}
