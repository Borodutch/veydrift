import { describe, expect, test } from "bun:test";
import { buildingEnergyDetail } from "../src/buildingDetails";
import { detailEffectRows } from "../src/components/InfrastructurePage";
import { buildingEffectMetrics, createInitialPlayableState } from "../src/playableMvp";

describe("Infrastructure page display helpers", () => {
  test("omits redundant delta wording from energy comparison rows", () => {
    const state = createInitialPlayableState(1_000);
    const mineBuildings = {
      ...state.buildings,
      metalMine: 1,
      solarPlant: 1,
    };
    const solarEffect = buildingEffectMetrics(mineBuildings, "solarPlant");
    const solarRows = detailEffectRows(solarEffect, buildingEnergyDetail(mineBuildings, "solarPlant"));

    expect(solarRows).toContainEqual({
      label: "Energy output",
      next: "60 produced",
      value: "30 produced",
    });
    expect(solarRows.some((row) => row.delta?.includes("produced"))).toBe(false);

    const mineEffect = buildingEffectMetrics(mineBuildings, "metalMine");
    const mineRows = detailEffectRows(mineEffect, buildingEnergyDetail(mineBuildings, "metalMine"));

    expect(mineRows).toContainEqual({
      label: "Energy required",
      next: "20 required",
      tone: "warning",
      value: "10 required",
    });
    expect(mineRows.some((row) => row.delta?.includes("required"))).toBe(false);
  });
});
