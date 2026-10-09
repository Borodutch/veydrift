import { describe, expect, test } from "bun:test";
import {
  batchSupplyMissionLimitError,
  batchSupplySourceLimitReason,
  supplyResourceInputValues,
} from "./BatchSupplyModal";

const batchSupplyModalSource = await Bun.file(new URL("./BatchSupplyModal.tsx", import.meta.url)).text();

describe("Batch Supply source row presentation", () => {
  test("keeps selected source cargo controls without duplicated shipments", () => {
    expect(batchSupplyModalSource).not.toContain("<details");
    expect(batchSupplyModalSource).not.toContain("<summary");
    expect(batchSupplyModalSource).not.toContain("Ships return after delivery");
    expect(batchSupplyModalSource).not.toContain("Proposed shipments");
    expect(batchSupplyModalSource).toContain("aria-label={label} title={label} aria-pressed={mission === kind}");
    expect(batchSupplyModalSource).toContain("Ships · planned / available");
    expect(batchSupplyModalSource).not.toContain("Selected cargo");
    expect(batchSupplyModalSource).not.toContain("Auto-plan cargo");
    expect(batchSupplyModalSource).not.toContain("Recalculate with latest");
    expect(batchSupplyModalSource).not.toContain("Use only this source");
    expect(batchSupplyModalSource).toContain("{checked ? <>");
    expect(batchSupplyModalSource).toContain("Available: M");
    expect(batchSupplyModalSource).toContain("disabled={!checked || loading");
  });
  test("uses Empire mission icons without substitutes", async () => {
    const empire = await Bun.file(new URL("./OverviewPage.tsx", import.meta.url)).text();
    expect(empire).toContain('missionType === "Transport") return <Package');
    expect(empire).toContain('missionType === "Deploy") return <Rocket');
    expect(batchSupplyModalSource).toContain('kind === "transport" ? Package : Rocket');
  });
  test("Max shares all preview inputs and submission uses that same preview", () => {
    expect(batchSupplyModalSource).toContain("buildBatchSupplyPlan(planOptions)");
    expect(batchSupplyModalSource).toContain("setSelectedSourceIds(suggestBatchSupplySourceIds(");
    expect(batchSupplyModalSource).toContain("useBatchSupplyMax(planOptions, target.planetId");
    expect(batchSupplyModalSource).not.toContain("maximumBatchSupplyResource(");
    expect(batchSupplyModalSource).toContain("!maximum.busy");
    expect(batchSupplyModalSource).toContain("onConfirm(plan.orders, shipTypesBySource, mission, fleetModesBySource)");
    expect(batchSupplyModalSource).not.toContain("Number.MAX_SAFE_INTEGER");
  });

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
