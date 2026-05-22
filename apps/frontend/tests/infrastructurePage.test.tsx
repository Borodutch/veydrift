import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { buildingEnergyDetail, buildingLevelInfoRows } from "../src/buildingDetails";
import {
  ActiveBuildingQueueDetail,
  BuildingLevelInfoButton,
  BuildingLevelInfoModal,
  detailEffectRows,
} from "../src/components/InfrastructurePage";
import { buildingEffectMetrics, createInitialPlayableState } from "../src/playableMvp";

describe("Infrastructure page display helpers", () => {
  test("renders a compact level info button with the building label", () => {
    const button = BuildingLevelInfoButton({
      buildingLabel: "Metal Mine",
      onClick: () => undefined,
    });

    expect(button.type).toBe("button");
    expect(button.props["aria-label"]).toBe("Open Metal Mine level table");
    expect(button.props.title).toBe("Level table");
  });

  test("renders Metal Mine modal rows with cost, production, energy use, and current/next markers", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
      },
    };
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Metal Mine",
      currentLevel: 1,
      rows: buildingLevelInfoRows(state.buildings, "metalMine", undefined, 3),
      onClose: () => undefined,
    });
    const text = visibleText(modal);

    expect(text).toContain("Metal Mine levels");
    expect(text).toContain("Production");
    expect(text).toContain("Energy use");
    expect(text).toContain("Level 1 Current");
    expect(text).toContain("Level 2 Next");
    expect(text).toContain("Metal 90 / Crystal 22");
    expect(text).toContain("72 Metal/h");
    expect(text).toContain("24 required");
  });

  test("renders Solar Plant modal rows with energy output", () => {
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Solar Plant",
      currentLevel: 0,
      rows: buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "solarPlant", undefined, 2),
      onClose: () => undefined,
    });
    const text = visibleText(modal);

    expect(text).toContain("Solar Plant levels");
    expect(text).toContain("Energy output");
    expect(text).toContain("Level 1 Next");
    expect(text).toContain("Metal 75 / Crystal 30");
    expect(text).toContain("22 produced");
    expect(text).toContain("48 produced");
  });

  test("renders Fusion Reactor modal rows with energy output and deuterium use", () => {
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Fusion Reactor",
      currentLevel: 0,
      rows: buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "fusionReactor", undefined, 2, 3),
      onClose: () => undefined,
    });
    const text = visibleText(modal);

    expect(text).toContain("Fusion Reactor levels");
    expect(text).toContain("Energy output");
    expect(text).toContain("Deuterium use");
    expect(text).toContain("32 produced");
    expect(text).toContain("11 Deuterium/h");
    expect(text).toContain("69 produced");
    expect(text).toContain("25 Deuterium/h");
    expect(text).not.toContain("construction speed");
  });

  test("shows Fusion Reactor detail as power with fuel draw, not construction speed", () => {
    const state = createInitialPlayableState(1_000);
    const effect = buildingEffectMetrics(state.buildings, "fusionReactor", undefined, 3);
    const rows = detailEffectRows(effect, buildingEnergyDetail(state.buildings, "fusionReactor", 3));

    expect(rows).toEqual([
      {
        label: "Energy output",
        next: "32 produced",
        value: "0 produced",
      },
      {
        delta: "(+11/h)",
        label: "Deuterium consumed",
        next: "11/h",
        tone: "warning",
        value: "0/h",
      },
    ]);
  });

  test("renders storage modal rows without production or energy columns", () => {
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Metal Storage",
      currentLevel: 0,
      rows: buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "metalStorage", undefined, 2),
      onClose: () => undefined,
    });
    const text = visibleText(modal);

    expect(text).toContain("Metal Storage levels");
    expect(text).toContain("Storage");
    expect(text).toContain("20,000 Metal");
    expect(text).not.toContain("Production");
    expect(text).not.toContain("Energy use");
    expect(text).not.toContain("Energy output");
  });

  test("shows required energy upgrade deltas without redundant wording", () => {
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
      next: "48 produced",
      value: "22 produced",
    });
    expect(solarRows.some((row) => row.delta?.includes("produced"))).toBe(false);

    const mineEffect = buildingEffectMetrics(mineBuildings, "metalMine");
    const mineRows = detailEffectRows(mineEffect, buildingEnergyDetail(mineBuildings, "metalMine"));

    expect(mineRows).toContainEqual({
      delta: "(+13)",
      label: "Energy required",
      next: "24 required",
      tone: "warning",
      value: "11 required",
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
      delta: "+33/h",
      label: "Production capacity",
      next: "33 Metal/h",
      value: "0 Metal/h",
    });
    expect(rows).toContainEqual({
      delta: "(+11)",
      label: "Energy required",
      next: "11 required",
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

  test("renders selected active building queue timer with progress", () => {
    const queue = {
      kind: "building" as const,
      key: "deuteriumSynthesizer" as const,
      label: "Deuterium Synthesizer",
      readyAt: 1_700_000_120_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    };

    const panel = ActiveBuildingQueueDetail({
      isSelectedBuilding: true,
      now: 1_700_000_060_000,
      queue,
    });
    const text = visibleText(panel);

    expect(text).toContain("Construction in progress");
    expect(text).toContain("Deuterium Synthesizer Level 2 is upgrading");
    expect(text).toContain("50 %");
    expect(text).toContain("Time remaining");
    expect(text).toContain("1m");
    expect(text).toContain("Ready at");
  });

  test("renders active queue context separately for an unselected building", () => {
    const queue = {
      kind: "building" as const,
      key: "solarPlant" as const,
      label: "Solar Plant",
      readyAt: 1_700_000_120_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 3,
    };

    const panel = ActiveBuildingQueueDetail({
      isSelectedBuilding: false,
      now: 1_700_000_030_000,
      queue,
    });
    const text = visibleText(panel);

    expect(text).toContain("Active construction");
    expect(text).toContain("Solar Plant Level 3 is upgrading");
    expect(text).toContain("the selected building is waiting for this queue.");
    expect(text).toContain("25 %");
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

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  return textParts(vnode.props?.children);
}
