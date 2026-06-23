import { describe, expect, test } from "bun:test";
import {
  actionNoticeForBuilding,
  buildingKeyForContractId,
  infrastructureActionNoticeFor,
  isStartedBuildingQueueSynced,
  recoveredStartedBuildingAction,
  type InfrastructureActionNotice,
} from "./buildingActionNotice";

describe("infrastructure building action notices", () => {
  test("keeps finished-building notices scoped to the affected building", () => {
    const notice = infrastructureActionNoticeFor({
      status: "success",
      buildingKey: "metalMine",
      label: "Building upgrade finished.",
    });

    expect(actionNoticeForBuilding(notice, "metalMine")).toEqual({
      buildingKey: "metalMine",
      label: "Building upgrade finished.",
      tone: "success",
    });
    expect(actionNoticeForBuilding(notice, "crystalMine")).toBeUndefined();
  });

  test("keeps unscoped notices visible for generic infrastructure errors", () => {
    const notice: InfrastructureActionNotice = {
      label: "Infrastructure state unavailable.",
      tone: "error",
    };

    expect(actionNoticeForBuilding(notice, "metalMine")).toBe(notice);
    expect(actionNoticeForBuilding(notice, "solarPlant")).toBe(notice);
  });

  test("maps active queue contract ids back to building keys for finish notices", () => {
    expect(buildingKeyForContractId(0)).toBe("metalMine");
    expect(buildingKeyForContractId("1")).toBe("crystalMine");
    expect(buildingKeyForContractId(undefined)).toBeUndefined();
    expect(buildingKeyForContractId(99)).toBeUndefined();
  });

  test("recognizes a started building queue after a post-transaction sync timeout", () => {
    expect(isStartedBuildingQueueSynced({
      active: true,
      kind: "building",
      itemId: 6,
      targetLevel: 7,
      readyAt: "1782238084",
      cost: { metal: "12800", crystal: "25600", deuterium: "12800" },
    }, { itemId: 6, targetLevel: 7 })).toBe(true);
  });

  test("clears stale started-building sync errors once the active queue catches up", () => {
    const action = recoveredStartedBuildingAction({
      action: {
        status: "error",
        buildingKey: "researchLab",
        label: "Building transaction confirmed, but indexed building queue state is still syncing. Expected item 6 Level 7; Infrastructure page target: missing; Overview target: missing. Try refreshing in a few seconds.",
      },
      activeBuildingQueue: {
        active: true,
        kind: "building",
        itemId: 6,
        targetLevel: 7,
        readyAt: "1782238084",
        cost: { metal: "12800", crystal: "25600", deuterium: "12800" },
      },
      expectation: { itemId: 6, targetLevel: 7 },
    });

    expect(action).toEqual({
      status: "success",
      buildingKey: "researchLab",
      label: "Building upgrade started.",
    });
  });
});
