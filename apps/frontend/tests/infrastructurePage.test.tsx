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

  test("keeps build-level production capacity positive when current power would throttle output", () => {
    const state = createInitialPlayableState(1_000);
    const unpoweredMineBuild = {
      ...state.buildings,
      metalMine: 0,
      solarPlant: 0,
    };

    const mineEffect = buildingEffectMetrics(unpoweredMineBuild, "metalMine");
    const rows = detailEffectRows(mineEffect, buildingEnergyDetail(unpoweredMineBuild, "metalMine"));

    expect(rows).toContainEqual({
      delta: "+24/h",
      label: "Production capacity",
      next: "24 Metal/h",
      value: "0 Metal/h",
    });
    expect(rows).toContainEqual({
      label: "Energy required",
      next: "10 required",
      tone: "warning",
      value: "0 required",
    });
  });

  test("shows Robotics Factory as an OGame construction-time divisor", () => {
    const state = createInitialPlayableState(1_000);
    const effect = buildingEffectMetrics(state.buildings, "roboticsFactory");
    const rows = detailEffectRows(effect, buildingEnergyDetail(state.buildings, "roboticsFactory"));

    expect(rows).toContainEqual({
      delta: "+100% faster than current",
      label: "Construction time divisor",
      next: "x2",
      value: "x1",
    });
    expect(rows.some((row) => row.label === "Energy")).toBe(false);
    expect(rows.some((row) => row.label === "Energy required")).toBe(false);
  });

  test("shows Robotics Factory level 1 to 2 as a 2x to 3x divisor upgrade", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      roboticsFactory: 1,
    };
    const effect = buildingEffectMetrics(buildings, "roboticsFactory");
    const rows = detailEffectRows(effect, buildingEnergyDetail(buildings, "roboticsFactory"));

    expect(rows).toContainEqual({
      delta: "+50% faster than current",
      label: "Construction time divisor",
      next: "x3",
      value: "x2",
    });
  });

  test("shows Research Lab 1 as unlocking research with a 2x denominator", () => {
    const state = createInitialPlayableState(1_000);
    const effect = buildingEffectMetrics(state.buildings, "researchLab");
    const rows = detailEffectRows(effect, buildingEnergyDetail(state.buildings, "researchLab"));

    expect(rows).toContainEqual({
      label: "Research capacity",
      next: "Unlocks research (x2)",
      value: "Unavailable",
    });
  });

  test("shows Research Lab level 1 to 2 as x2 to x3 instead of doubling", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      researchLab: 1,
    };
    const effect = buildingEffectMetrics(buildings, "researchLab");
    const rows = detailEffectRows(effect, buildingEnergyDetail(buildings, "researchLab"));

    expect(rows).toContainEqual({
      delta: "+50% faster",
      label: "Research speed",
      next: "x3",
      value: "x2",
    });
  });
});
