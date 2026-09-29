import { describe, expect, test } from "bun:test";
import {
  batchSupplyMissionLimitError,
  batchSupplySourceLimitReason,
  supplyResourceInputValues,
} from "./BatchSupplyModal";

const batchSupplyModalSource = await Bun.file(new URL("./BatchSupplyModal.tsx", import.meta.url)).text();

describe("Batch Supply source row presentation", () => {
  test("prefills only the missing resources supplied by an action", () => {
    expect(supplyResourceInputValues({
      metal: 197_455,
      crystal: 48_857,
      deuterium: 0,
    })).toEqual({
      metal: "197455",
      crystal: "48857",
      deuterium: "",
    });
  });

  test("does not misreport unreadable fleet capacity as every slot being occupied", () => {
    expect(batchSupplyModalSource).toContain("fleetSlotsKnown && maxSources === 0");
  });

  test("blocks only Supply plans above the 15-mission contract limit and clears when reduced", () => {
    expect(batchSupplyMissionLimitError(8)).toBeUndefined();
    expect(batchSupplyMissionLimitError(9)).toBeUndefined();
    expect(batchSupplyMissionLimitError(15)).toBeUndefined();
    expect(batchSupplyMissionLimitError(16)).toBe("A Supply batch can launch at most 15 missions. Reduce the plan before launching.");
    expect(batchSupplyMissionLimitError(15)).toBeUndefined();
  });

  test("explains source-limit disabling without replacing a real unavailable reason", () => {
    expect(batchSupplySourceLimitReason({
      checked: false,
      maxSources: 4,
      selectedSourceCount: 4,
    })).toBe("Deselect another source to use this planet (4 fleet slots available).");

    expect(batchSupplySourceLimitReason({
      checked: false,
      maxSources: 0,
      selectedSourceCount: 0,
    })).toBe("No fleet slots are available for another transport.");

    expect(batchSupplySourceLimitReason({
      checked: false,
      maxSources: 4,
      selectedSourceCount: 4,
      unavailableReason: "No usable cargo ships are available on this planet.",
    })).toBeUndefined();
  });

});
