import { describe, expect, test } from "bun:test";
import {
  createInitialPlayableState,
  defenseCatalog,
  missingUnlockRequirements,
  shipCatalog,
  unmetResearchRequirement,
} from "../src/playableMvp";

describe("OGame-style prerequisite gating", () => {
  test("reports a representative locked research prerequisite", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        researchLab: 1,
      },
    };

    expect(unmetResearchRequirement(state, "laser")).toEqual({
      type: "research",
      key: "energy",
      level: 2,
    });
  });

  test("reports representative locked ship prerequisites from chain state", () => {
    const smallCargo = shipCatalog.find((ship) => ship.key === "smallCargo");
    expect(smallCargo).toBeDefined();

    expect(missingUnlockRequirements(smallCargo!.requirements, {
      buildings: { shipyard: 0 },
      research: {},
    })).toEqual([
      "Requires Shipyard 1",
      "Requires Combustion Drive 1",
    ]);

    expect(missingUnlockRequirements(smallCargo!.requirements, {
      buildings: { shipyard: 1 },
      research: { combustionDrive: 1 },
    })).toEqual([]);
  });

  test("reports representative locked defense prerequisites from chain state", () => {
    const lightLaser = defenseCatalog.find((defense) => defense.key === "lightLaser");
    expect(lightLaser).toBeDefined();

    expect(missingUnlockRequirements(lightLaser!.requirements, {
      buildings: { shipyard: 1 },
      research: {},
    })).toEqual(["Requires Laser 1"]);

    expect(missingUnlockRequirements(lightLaser!.requirements, {
      buildings: { shipyard: 1 },
      research: { laser: 1 },
    })).toEqual([]);
  });

  test("deduplicates repeated prerequisite labels but keeps distinct requirements", () => {
    expect(missingUnlockRequirements([
      { kind: "building", key: "researchLab", label: "Research Lab", level: 1 },
      { kind: "building", key: "researchLab", label: "Research Lab", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 2 },
    ], {
      buildings: { researchLab: 0 },
      research: { laser: 0 },
    })).toEqual([
      "Requires Research Lab 1",
      "Requires Laser 1",
      "Requires Laser 2",
    ]);
  });
});
