import { describe, expect, test } from "bun:test";
import {
  actionNoticeForBuilding,
  buildingKeyForContractId,
  infrastructureActionNoticeFor,
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
});
