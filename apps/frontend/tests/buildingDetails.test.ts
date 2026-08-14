import { describe, expect, test } from "bun:test";
import {
  buildingLevelInfoColumns,
  buildingLevelInfoRows,
  buildingEnergyDetail,
  buildingUpgradeStatus,
  formatBuildingRequirements,
  formatCost,
  formatDuration,
  formatMissingResources,
  formatNumber,
  mineSolarPlantPrerequisiteFor,
} from "../src/buildingDetails";
import { getBuildingRequirementStates } from "../src/components/InfrastructurePage";
import { buildingRequirementsFor, createInitialPlayableState, unmetBuildingRequirement } from "../src/playableMvp";

const infrastructurePageSource = await Bun.file(new URL("../src/components/InfrastructurePage.tsx", import.meta.url)).text();

describe("building detail helpers", () => {
  test("keeps prerequisite copy in selected building details, not catalog tiles (VEY-KANEO-725)", () => {
    const catalogSource = infrastructurePageSource.slice(
      infrastructurePageSource.indexOf("items={buildingCatalog.map"),
      infrastructurePageSource.indexOf("detail={("),
    );

    expect(catalogSource).not.toContain("Requires ${starterPrerequisite}");
    expect(catalogSource).toContain('starterPrerequisite || missingRequirement ? "Locked"');
    expect(infrastructurePageSource).toContain(
      "<RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={requirementStates} />",
    );
  });

  test("formats costs, durations, and numbers without raw decimals", () => {
    expect(formatNumber(1234.987)).toBe("1,234");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(2 * 60 * 60 + 15 * 60)).toBe("2h 15m");
    expect(formatDuration(3 * 24 * 60 * 60 + 4 * 60 * 60 + 59 * 60)).toBe("3d 4h");
    expect(formatDuration(2 * 7 * 24 * 60 * 60 + 24 * 60 * 60 + 23 * 60 * 60)).toBe("2w 1d");
    expect(formatDuration(62549994824590 * 60 + 13)).toBe("99w+");
    expect(formatCost({ metal: 60, crystal: 15, deuterium: 0 })).toBe("Metal 60, Crystal 15");
  });

  test("reports specific disabled reasons when resources are short", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        solarPlant: 1,
      },
      resources: { metal: 10, crystal: 5_000, deuterium: 5_000 },
    };

    expect(buildingUpgradeStatus(state, "metalMine")).toMatchObject({
      disabled: true,
      reason: "Requires 50 more Metal",
      targetLevel: 1,
    });
  });

  test("appends the affordable-in ETA to a disabled upgrade when production rates are supplied (VEY-KANEO-481)", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        solarPlant: 1,
      },
      resources: { metal: 10, crystal: 5_000, deuterium: 5_000 },
    };

    // 50 Metal short @ 100 Metal/h = 30m.
    expect(buildingUpgradeStatus(state, "metalMine", {
      productionRates: { metal: 100, crystal: 100, deuterium: 0 },
    })).toMatchObject({
      disabled: true,
      reason: "Requires 50 more Metal (affordable in 30m)",
      targetLevel: 1,
    });
  });

  test("threads the backend-sourced upgrade duration onto the status (VEY-KANEO-472)", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: { ...createInitialPlayableState(1_000).buildings, solarPlant: 1 },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    // With a backend duration, the status carries it for the detail panel to render.
    expect(buildingUpgradeStatus(state, "metalMine", {
      chainDurationSeconds: 432,
      spendableResources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    })).toMatchObject({
      disabled: false,
      durationSeconds: 432,
    });

    // Without one (legacy/live-read payloads), no client time is fabricated.
    expect(buildingUpgradeStatus(state, "metalMine").durationSeconds).toBeUndefined();
  });

  test("lists missing resources without an ETA when no production rate is supplied", () => {
    // Live-read payloads without a backend production rate keep the plain missing-resource copy.
    expect(formatMissingResources(
      { metal: 20, crystal: 50, deuterium: 0 },
      { metal: 80, crystal: 80, deuterium: 0 },
    )).toBe("Requires 60 more Metal, 30 more Crystal");

    expect(formatMissingResources(
      { metal: 20, crystal: 50, deuterium: 0 },
      { metal: 80, crystal: 50, deuterium: 10 },
    )).toBe("Requires 60 more Metal, 10 more Deuterium");
  });

  test("keeps screenshot shortfalls visible while another building is upgrading (VEY-KANEO-847)", () => {
    const resources = { metal: 558, crystal: 3_705, deuterium: 5_903 };
    const cost = { metal: 8_444, crystal: 4_222, deuterium: 0 };
    const state = {
      ...createInitialPlayableState(1_000),
      resources,
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 12,
      },
    };

    expect(buildingUpgradeStatus(state, "crystalMine", {
      chainCost: cost,
      now: 1_000,
      spendableResources: resources,
    })).toMatchObject({
      cost,
      disabled: true,
      reason: "Another building is currently upgrading: Metal Mine Level 12",
    });
  });

  test("keeps availability current when the active queue completes (VEY-KANEO-847)", () => {
    const resources = { metal: 558, crystal: 3_705, deuterium: 5_903 };
    const cost = { metal: 8_444, crystal: 4_222, deuterium: 0 };
    const queuedState = {
      ...createInitialPlayableState(1_000),
      resources,
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 12,
      },
    };

    expect(buildingUpgradeStatus(queuedState, "crystalMine", {
      chainCost: cost,
      now: 1_000,
      spendableResources: resources,
    }).reason).toBe("Another building is currently upgrading: Metal Mine Level 12");
    expect(buildingUpgradeStatus({ ...queuedState, queue: undefined }, "crystalMine", {
      chainCost: cost,
      now: 61_000,
      spendableResources: resources,
    }).reason).toBe("Requires 7,886 more Metal, 517 more Crystal");
  });

  test("appends the backend-sourced \"affordable in\" ETA when a production rate is supplied (VEY-KANEO-481)", () => {
    // ETA is the maximum across missing resources: metal 60 short @ 120/h = 30m,
    // crystal 30 short @ 30/h = 1h — so the 1h crystal wait dominates.
    expect(formatMissingResources(
      { metal: 20, crystal: 50, deuterium: 0 },
      { metal: 80, crystal: 80, deuterium: 0 },
      { metal: 120, crystal: 30, deuterium: 0 },
    )).toBe("Requires 60 more Metal, 30 more Crystal (affordable in 1h)");

    // Single missing resource: 60 short @ 120/h = 30m.
    expect(formatMissingResources(
      { metal: 20, crystal: 50, deuterium: 0 },
      { metal: 80, crystal: 50, deuterium: 0 },
      { metal: 120, crystal: 30, deuterium: 0 },
    )).toBe("Requires 60 more Metal (affordable in 30m)");
  });

  test("reports the stalled copy when a needed resource has no production (VEY-KANEO-481)", () => {
    expect(formatMissingResources(
      { metal: 20, crystal: 50, deuterium: 0 },
      { metal: 80, crystal: 80, deuterium: 0 },
      { metal: 120, crystal: 0, deuterium: 0 },
    )).toBe("Requires 60 more Metal, 30 more Crystal (time unavailable: no Crystal production)");
  });

  test("uses spendable accrued resources for building affordability", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        solarPlant: 1,
      },
      resources: { metal: 10, crystal: 5_000, deuterium: 5_000 },
    };

    expect(buildingUpgradeStatus(state, "metalMine", {
      spendableResources: { metal: 60, crystal: 5_000, deuterium: 5_000 },
    })).toMatchObject({
      disabled: false,
      reason: "Ready for Level 1",
    });

    expect(buildingUpgradeStatus(state, "metalMine", {
      spendableResources: { metal: 35, crystal: 5_000, deuterium: 5_000 },
    })).toMatchObject({
      disabled: true,
      reason: "Requires 25 more Metal",
    });
  });

  test("uses action unavailable reason before local affordability", () => {
    expect(
      buildingUpgradeStatus(
        createInitialPlayableState(1_000),
        "metalMine",
        { actionUnavailableReason: "Game state unavailable; upgrades are disabled until your wallet resources load." },
      ),
    ).toMatchObject({
      disabled: true,
      reason: "Game state unavailable; upgrades are disabled until your wallet resources load.",
      targetLevel: 1,
    });
  });

  test("blocks starter-planet mine upgrades behind ordered frontend-only prerequisites", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(mineSolarPlantPrerequisiteFor(state, "metalMine", { starterPlanet: true })).toBe("Solar Plant level 1");
    expect(formatBuildingRequirements("metalMine", { starterPlanet: true })).toBe("Solar Plant level 1");
    expect(buildingUpgradeStatus(state, "metalMine", { starterPlanet: true })).toMatchObject({
      disabled: true,
      reason: "Requires Solar Plant level 1",
      targetLevel: 1,
    });

    expect(formatBuildingRequirements("crystalMine", { starterPlanet: true })).toBe("Metal Mine level 1, Solar Plant level 1");
    expect(buildingUpgradeStatus(state, "crystalMine", { starterPlanet: true })).toMatchObject({
      disabled: true,
      reason: "Requires Metal Mine level 1",
      targetLevel: 1,
    });

    expect(formatBuildingRequirements("deuteriumSynthesizer", { starterPlanet: true })).toBe(
      "Metal Mine level 1, Crystal Mine level 1, Solar Plant level 1",
    );
    expect(buildingUpgradeStatus(state, "deuteriumSynthesizer", { starterPlanet: true })).toMatchObject({
      disabled: true,
      reason: "Requires Metal Mine level 1",
      targetLevel: 1,
    });
  });

  test("allows starter-planet mine upgrades after starter prerequisites exist", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        crystalMine: 1,
        solarPlant: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    for (const key of ["metalMine", "crystalMine", "deuteriumSynthesizer"] as const) {
      expect(mineSolarPlantPrerequisiteFor(state, key, { starterPlanet: true })).toBeUndefined();
      expect(buildingUpgradeStatus(state, key, { starterPlanet: true })).toMatchObject({
        disabled: false,
        reason: `Ready for Level ${state.buildings[key] + 1}`,
        targetLevel: state.buildings[key] + 1,
      });
    }
  });

  test("does not apply starter mine prerequisites on non-starter planets", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    for (const key of ["metalMine", "crystalMine", "deuteriumSynthesizer"] as const) {
      expect(mineSolarPlantPrerequisiteFor(state, key)).toBeUndefined();
      expect(formatBuildingRequirements(key)).toBe("None");
      expect(buildingUpgradeStatus(state, key)).toMatchObject({
        disabled: false,
        reason: "Ready for Level 1",
        targetLevel: 1,
      });
    }
  });

  test("reports the next missing Deuterium Synthesizer starter prerequisite after Metal Mine exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingUpgradeStatus(state, "deuteriumSynthesizer", { starterPlanet: true })).toMatchObject({
      disabled: true,
      reason: "Requires Crystal Mine level 1",
      targetLevel: 1,
    });
  });

  test("exposes starter mine prerequisites as visible requirement flairs only on starter planets", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(getBuildingRequirementStates(state, "deuteriumSynthesizer", { starterPlanet: true })).toEqual([
      { label: "Metal Mine level 1", met: true, target: { kind: "building", key: "metalMine" } },
      { label: "Crystal Mine level 1", met: false, target: { kind: "building", key: "crystalMine" } },
      { label: "Solar Plant level 1", met: false, target: { kind: "building", key: "solarPlant" } },
    ]);
    expect(getBuildingRequirementStates(state, "deuteriumSynthesizer")).toEqual([]);
  });

  test("keeps Solar Plant buildable at level 0", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(mineSolarPlantPrerequisiteFor(state, "solarPlant")).toBeUndefined();
    expect(formatBuildingRequirements("solarPlant")).toBe("None");
    expect(buildingUpgradeStatus(state, "solarPlant")).toMatchObject({
      disabled: false,
      reason: "Ready for Level 1",
      targetLevel: 1,
    });
  });

  test("blocks Research Lab until Robotics Factory 1 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingRequirementsFor("researchLab")).toEqual([
      { type: "building", key: "roboticsFactory", level: 1 },
    ]);
    expect(unmetBuildingRequirement(state, "researchLab")).toEqual({
      type: "building",
      key: "roboticsFactory",
      level: 1,
    });
    expect(formatBuildingRequirements("researchLab")).toBe("Robotics Factory 1");
    expect(buildingUpgradeStatus(state, "researchLab")).toMatchObject({
      disabled: true,
      reason: "Requires Robotics Factory 1",
      targetLevel: 1,
    });
    expect(getBuildingRequirementStates(state, "researchLab")).toEqual([
      { label: "Robotics Factory 1", met: false, target: { kind: "building", key: "roboticsFactory" } },
    ]);
  });

  test("allows Research Lab after Robotics Factory 1 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingUpgradeStatus(state, "researchLab")).toMatchObject({
      disabled: false,
      reason: "Ready for Level 1",
      targetLevel: 1,
    });
    expect(getBuildingRequirementStates(state, "researchLab")).toEqual([
      { label: "Robotics Factory 1", met: true, target: { kind: "building", key: "roboticsFactory" } },
    ]);
  });

  test("blocks Shipyard until Robotics Factory 2 exists", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingRequirementsFor("shipyard")).toEqual([
      { type: "building", key: "roboticsFactory", level: 2 },
    ]);
    expect(buildingUpgradeStatus(state, "shipyard")).toMatchObject({
      disabled: true,
      reason: "Requires Robotics Factory 2",
      targetLevel: 1,
    });
  });

  test("reports queue and energy details from modeled building state", () => {
    const queued = {
      ...createInitialPlayableState(1_000),
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 1,
      },
    };

    expect(buildingUpgradeStatus(queued, "solarPlant", { now: 1_000 })).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Metal Mine Level 1",
    });
    expect(buildingEnergyDetail({ ...queued.buildings, metalMine: 2 }, "metalMine")).toEqual({
      kind: "requires",
      current: 24,
      next: 39,
      delta: 15,
    });
    expect(buildingEnergyDetail({ ...queued.buildings, solarPlant: 1 }, "solarPlant")).toEqual({
      kind: "produces",
      current: 22,
      next: 48,
      delta: 26,
    });
  });

  test("names the active building instead of the selected inactive detail", () => {
    const queued = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        roboticsFactory: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 2,
      },
    };

    expect(buildingUpgradeStatus(queued, "researchLab", { now: 1_000 })).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Metal Mine Level 2",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus(queued, "metalMine", { now: 1_000 })).toMatchObject({
      disabled: true,
      reason: "Metal Mine Level 2 upgrade in progress",
      targetLevel: 2,
    });
    expect(buildingUpgradeStatus(queued, "researchLab", { now: 61_000 })).toMatchObject({
      disabled: true,
      reason: "Metal Mine Level 2 is ready to finish",
      targetLevel: 1,
    });
  });

  test("treats the Rift Stabilizer as a binary build instead of an upgrade ladder", () => {
    const readyState = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        roboticsFactory: 4,
        researchLab: 2,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        energy: 5,
        hyperspace: 1,
      },
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    expect(buildingUpgradeStatus(readyState, "interdimensionalRiftStabilizer")).toMatchObject({
      disabled: false,
      reason: "Ready to build Rift Stabilizer",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus({
      ...readyState,
      buildings: {
        ...readyState.buildings,
        interdimensionalRiftStabilizer: 1,
      },
    }, "interdimensionalRiftStabilizer")).toMatchObject({
      disabled: true,
      reason: "Rift Stabilizer built on this planet",
      targetLevel: 1,
    });
    expect(buildingUpgradeStatus({
      ...readyState,
      queue: {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Rift Stabilizer",
        readyAt: 61_000,
        startedAt: 1_000,
        targetLevel: 1,
      },
    }, "metalMine", { now: 1_000 })).toMatchObject({
      disabled: true,
      reason: "Another building is currently upgrading: Rift Stabilizer",
    });
  });

  test("builds Metal Mine level table rows with costs, production, energy use, and build time", () => {
    // VEY-KANEO-465 dropped per-building production AND build time from the level table.
    // VEY-KANEO-472 restored build time; VEY-KANEO-499 restores production with the same
    // conformance-tested formulas that already derive cost/energy/storage client-side.
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        solarPlant: 2,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "metalMine", undefined, 3);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: false,
      energyRequired: true,
      production: true,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 60, crystal: 15, deuterium: 0 },
      current: true,
      energyRequired: 11,
      level: 1,
      next: false,
      production: { deltaFromPrevious: 32, resource: "metal", value: 32 },
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 90, crystal: 22, deuterium: 0 },
      current: false,
      energyRequired: 24,
      level: 2,
      next: true,
      production: { deltaFromPrevious: 38, resource: "metal", value: 70 },
    });
    expect(rows[2]).toMatchObject({
      level: 3,
      production: { deltaFromPrevious: 46, resource: "metal", value: 116 },
    });
    expect(rows.every((row) => typeof row.durationSeconds === "number" && row.durationSeconds > 0)).toBe(true);
  });

  test("keeps mine level production raw when the selected planet is unpowered or has Solar Satellites", () => {
    const initial = createInitialPlayableState(1_000);
    const profile = {
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
    };
    const cases = [
      { key: "metalMine", values: [33, 72] },
      { key: "crystalMine", values: [22, 48] },
      { key: "deuteriumSynthesizer", values: [11, 24] },
    ] as const;

    for (const { key, values } of cases) {
      const buildings = { ...initial.buildings, [key]: 1, solarPlant: 0 };
      const unpoweredRows = buildingLevelInfoRows(buildings, key, profile, 2, 0, 0);
      const satellitePoweredRows = buildingLevelInfoRows(buildings, key, profile, 2, 0, 100);

      expect(unpoweredRows.map((row) => row.production?.value)).toEqual(values);
      expect(satellitePoweredRows.map((row) => row.production?.value)).toEqual(values);
    }
  });

  test("builds Solar Plant level table rows with energy output", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "solarPlant", undefined, 2);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: true,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 75, crystal: 30, deuterium: 0 },
      energyProduced: 22,
      level: 1,
      next: true,
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 112, crystal: 45, deuterium: 0 },
      energyProduced: 48,
      level: 2,
    });
  });

  test("keeps energy building level rows source-specific when multiple producers exist", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      fusionReactor: 1,
      solarPlant: 11,
    };
    const solarRows = buildingLevelInfoRows(buildings, "solarPlant", undefined, 12, 3);
    const fusionRows = buildingLevelInfoRows(buildings, "fusionReactor", undefined, 2, 3);

    expect(solarRows[10]).toMatchObject({
      energyProduced: 627,
      level: 11,
    });
    expect(solarRows[11]).toMatchObject({
      energyProduced: 753,
      level: 12,
    });
    expect(fusionRows[0]).toMatchObject({
      deuteriumConsumed: 11,
      energyProduced: 32,
      level: 1,
    });
    expect(fusionRows[1]).toMatchObject({
      deuteriumConsumed: 25,
      energyProduced: 69,
      level: 2,
    });
  });

  test("builds Fusion Reactor level table rows with energy output and deuterium use", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "fusionReactor", undefined, 2, 3);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: true,
      effect: false,
      energyProduced: true,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 900, crystal: 360, deuterium: 180 },
      deuteriumConsumed: 11,
      energyProduced: 32,
      level: 1,
      next: true,
    });
    expect(rows[1]).toMatchObject({
      cost: { metal: 1_620, crystal: 648, deuterium: 324 },
      deuteriumConsumed: 25,
      energyProduced: 69,
      level: 2,
    });
    expect(rows.map((row) => row.effect)).toEqual([undefined, undefined]);
  });

  test("reports Solar Plant and Fusion Reactor energy as per-building output", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      fusionReactor: 1,
      solarPlant: 11,
    };

    expect(buildingEnergyDetail(buildings, "solarPlant", 3)).toEqual({
      current: 627,
      delta: 126,
      kind: "produces",
      next: 753,
    });
    expect(buildingEnergyDetail(buildings, "fusionReactor", 3)).toEqual({
      current: 32,
      delta: 37,
      kind: "produces",
      next: 69,
    });
  });

  test("builds storage level table rows without production or energy columns", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "metalStorage", undefined, 2);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: false,
      energyProduced: false,
      energyRequired: false,
      production: false,
      storage: true,
    });
    expect(rows[0]).toMatchObject({
      cost: { metal: 1000, crystal: 0, deuterium: 0 },
      level: 1,
      storage: { resource: "metal", capacity: 20_000 },
    });
  });

  test("builds Missile Silo rows with Veydrift missile slot capacity", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        missileSilo: 1,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "missileSilo", undefined, 4);

    expect(buildingLevelInfoColumns(rows)).toEqual({
      constructionTime: true,
      deuteriumConsumed: false,
      effect: true,
      energyProduced: false,
      energyRequired: false,
      production: false,
      storage: false,
    });
    expect(rows.map(({ effect, level }) => ({ effect, level }))).toEqual([
      { effect: "10 missile slots", level: 1 },
      { effect: "20 missile slots", level: 2 },
      { effect: "30 missile slots", level: 3 },
      { effect: "40 missile slots", level: 4 },
    ]);
    expect(rows[0]).toMatchObject({ current: true, next: false });
    expect(rows[1]).toMatchObject({ current: false, next: true });
  });

  test("builds Shipyard and Nanite rows with speed deltas in the level table", () => {
    const state = createInitialPlayableState(1_000);
    const shipyardRows = buildingLevelInfoRows({ ...state.buildings, shipyard: 1 }, "shipyard", undefined, 2);
    const naniteRows = buildingLevelInfoRows({ ...state.buildings, naniteFactory: 1 }, "naniteFactory", undefined, 2);

    expect(buildingLevelInfoColumns(shipyardRows).effect).toBe(true);
    expect(buildingLevelInfoColumns(naniteRows).effect).toBe(true);
    expect(shipyardRows.map(({ effect, level }) => ({ effect, level }))).toEqual([
      { effect: "x2 ship speed (+100% faster)", level: 1 },
      { effect: "x3 ship speed (+50% faster)", level: 2 },
    ]);
    expect(naniteRows.map(({ effect, level }) => ({ effect, level }))).toEqual([
      { effect: "x2 construction speed (+100% faster)", level: 1 },
      { effect: "x4 construction speed (+100% faster)", level: 2 },
    ]);
  });

  test("builds Research Lab rows with Level 1 as the visible x1 baseline", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        researchLab: 1,
      },
    };
    const rows = buildingLevelInfoRows(state.buildings, "researchLab", undefined, 3);

    expect(buildingLevelInfoColumns(rows).effect).toBe(true);
    expect(rows.map(({ effect, level }) => ({ effect, level }))).toEqual([
      { effect: "x1 research speed", level: 1 },
      { effect: "x2 research speed", level: 2 },
      { effect: "x3 research speed", level: 3 },
    ]);
    expect(rows[0]).toMatchObject({ current: true, next: false });
    expect(rows[1]).toMatchObject({ current: false, next: true });
  });

});
