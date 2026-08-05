import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { buildingEnergyDetail, buildingLevelInfoRows, buildingUpgradeStatus } from "../src/buildingDetails";
import {
  ActiveBuildingQueuePanel,
  BuildingLevelInfoButton,
  BuildingLevelInfoModal,
  InfrastructureLoadErrorPanel,
  InfrastructureRefreshErrorPanel,
  MetricDeltaSubtext,
  buildingProductionUpgradeEffect,
  deduplicatedInfrastructureActionNotice,
  detailEffectRows,
  infrastructureUpgradeButtonLabel,
  infrastructureRefreshButtonState,
  infrastructureCatalogTitleTone,
  infrastructureCatalogStatusText,
  selectedInfrastructureBuildingKey,
  shouldShowInfrastructureInitialLoadError,
} from "../src/components/InfrastructurePage";
import { QueueProgressPanel } from "../src/components/QueueProgressPanel";
import { buildingEffectMetrics, createInitialPlayableState } from "../src/playableMvp";

describe("Infrastructure page display helpers", () => {
  test("keeps a freshly clicked building authoritative over a stale parent selection", () => {
    expect(selectedInfrastructureBuildingKey({
      localSelectedKey: "solarPlant",
      selectedBuildingKey: "metalMine",
    })).toBe("solarPlant");
    expect(selectedInfrastructureBuildingKey({
      selectedBuildingKey: "shipyard",
    })).toBe("shipyard");
    expect(selectedInfrastructureBuildingKey({})).toBe("metalMine");
  });

  test("renders load errors without fake infrastructure values", () => {
    const panel = InfrastructureLoadErrorPanel({
      reason: "Infrastructure request failed with 503",
    });
    const text = visibleText(panel);

    expect(text).toContain("Infrastructure state could not be loaded");
    expect(text).toContain("Infrastructure request failed with 503");
    expect(text).toContain("Levels, costs, production effects, storage caps, and upgrade values are unavailable");
    expect(text).not.toMatch(/\bLevel 0\b|Upgrade cost|Production capacity|Ready for Level/);
  });

  test("keeps loaded infrastructure values visible when a background refresh fails", () => {
    expect(shouldShowInfrastructureInitialLoadError({
      hasLoadedInfrastructureState: true,
      loadError: "Infrastructure request failed with 503",
    })).toBe(false);
    expect(infrastructureRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
    expect(infrastructureRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });

    const panel = InfrastructureRefreshErrorPanel({
      reason: "Infrastructure request failed with 503",
    });
    const text = visibleText(panel);

    expect(text).toContain("Infrastructure refresh failed");
    expect(text).toContain("Showing the last loaded building data");
    expect(text).toContain("Infrastructure request failed with 503");
  });

  test("keeps ready Infrastructure catalog titles at normal emphasis", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        solarPlant: 1,
      },
      resources: { metal: 500, crystal: 500, deuterium: 500 },
    };

    expect(infrastructureCatalogTitleTone({
      disabled: false,
      reason: "Ready for Level 1",
    })).toBe("normal");
    expect(infrastructureCatalogTitleTone({
      disabled: false,
      reason: "Ready to build Rift Stabilizer",
    })).toBe("normal");
    expect(infrastructureCatalogTitleTone(
      // Same status helper the Infrastructure detail action uses for affordability.
      buildingUpgradeStatus(state, "metalMine", { starterPlanet: true }),
    )).toBe("normal");
  });

  test("mutes Infrastructure catalog titles when resources are insufficient", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        solarPlant: 1,
      },
      resources: { metal: 35, crystal: 500, deuterium: 500 },
    };

    const status = buildingUpgradeStatus(state, "metalMine", { starterPlanet: true });

    expect(status.reason).toBe("Requires 25 more Metal");
    expect(infrastructureCatalogTitleTone(status)).toBe("muted");
  });

  test("mutes Infrastructure catalog titles when requirements are unmet", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };

    const status = buildingUpgradeStatus(state, "shipyard");

    expect(status.reason).toBe("Requires Robotics Factory 2");
    expect(infrastructureCatalogTitleTone(status)).toBe("muted");
  });

  test("keeps catalog affordability visible while a building queue is active", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      resources: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    };
    const activeQueueState = {
      ...state,
      buildings: {
        ...state.buildings,
        solarPlant: 1,
      },
      queue: {
        kind: "building" as const,
        key: "solarPlant" as const,
        label: "Solar Plant",
        readyAt: 1_700_000_060_000,
        startedAt: 1_700_000_000_000,
        targetLevel: 2,
      },
    };

    expect(infrastructureCatalogTitleTone(
      buildingUpgradeStatus(state, "crystalMine", { starterPlanet: true }),
    )).toBe("muted");
    expect(infrastructureCatalogTitleTone(
      buildingUpgradeStatus(activeQueueState, "metalMine", {
        ignoreActiveQueue: true,
        now: 1_700_000_030_000,
        starterPlanet: true,
      }),
    )).toBe("normal");
    expect(infrastructureCatalogTitleTone(
      buildingUpgradeStatus({
        ...activeQueueState,
        resources: { metal: 0, crystal: 0, deuterium: 0 },
      }, "metalMine", {
        ignoreActiveQueue: true,
        now: 1_700_000_030_000,
        starterPlanet: true,
      }),
    )).toBe("muted");
  });

  test("keeps initial infrastructure load failures in the full load-error state", () => {
    expect(shouldShowInfrastructureInitialLoadError({
      hasLoadedInfrastructureState: false,
      loadError: "Infrastructure request failed with 503",
    })).toBe(true);
  });

  test("suppresses duplicate selected-building server unavailable action notices", () => {
    const unavailableReason = "Servers are unavailable. Retrying in 10 seconds.";

    expect(deduplicatedInfrastructureActionNotice({
      label: unavailableReason,
      tone: "error",
    }, [unavailableReason])).toBeUndefined();
    expect(deduplicatedInfrastructureActionNotice({
      label: unavailableReason,
      tone: "error",
    }, ["Infrastructure request failed with 503."])).toEqual({
      label: unavailableReason,
      tone: "error",
    });
    expect(deduplicatedInfrastructureActionNotice({
      label: unavailableReason,
      tone: "success",
    }, [unavailableReason])).toEqual({
      label: unavailableReason,
      tone: "success",
    });
  });

  test("keeps server unavailable copy out of infrastructure buttons and duplicate notices", () => {
    const unavailableReason =
      "Servers are unavailable. Retrying in 10 seconds. Building actions are paused until current game state is available.";

    expect(infrastructureUpgradeButtonLabel({
      actionUnavailableReason: unavailableReason,
      binary: false,
      defaultLabel: "Upgrade Level 14",
      statusDisabled: true,
    })).toBe("Upgrade Level 14");

    expect(deduplicatedInfrastructureActionNotice({
      label: unavailableReason,
      tone: "error",
    }, [unavailableReason])).toBeUndefined();
    expect(deduplicatedInfrastructureActionNotice({
      label: "Servers are unavailable. Retrying in 10 seconds.",
      tone: "error",
    }, [unavailableReason])).toBeUndefined();
  });

  test("renders a compact level info button with the building label", () => {
    const button = BuildingLevelInfoButton({
      buildingLabel: "Metal Mine",
      onClick: () => undefined,
    });

    expect(button.type).toBe("button");
    expect(button.props["aria-label"]).toBe("Open Metal Mine level table");
    expect(button.props.title).toBe("Level table");
  });

  test("renders Metal Mine modal rows with cost, production, energy use, and build time", () => {
    // VEY-KANEO-465 dropped per-building production AND build time. VEY-KANEO-499 keeps
    // both visible in the level info popup with per-level production deltas.
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        solarPlant: 2,
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
    expect(text).toContain("Energy use");
    expect(text).toContain("Level 1 Current");
    expect(text).toContain("Level 2 Next");
    expect(text).toContain("Metal 90, Crystal 22");
    expect(text).toContain("24 required");
    expect(text).toContain("Build time");
    expect(text).toContain("Production output");
    expect(text).toContain("32 Metal/h (+32/h)");
    expect(text).toContain("70 Metal/h (+38/h)");
    expect(text).toContain("116 Metal/h (+46/h)");
  });

  test("keeps double-digit level labels separate from current and next badges", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 10,
      },
    };
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Metal Mine",
      currentLevel: 10,
      rows: buildingLevelInfoRows(state.buildings, "metalMine", undefined, 12),
      onClose: () => undefined,
    });
    const cells = elementNodes(modal).filter((node) => node.type === "td");
    const level10Cell = cells.find((cell) => visibleText(cell) === "Level 10");
    const level11Cell = cells.find((cell) => visibleText(cell) === "Level 11");
    const currentPill = elementNodes(modal).find((node) => node.type === "span" && visibleText(node) === "Current");
    const nextPill = elementNodes(modal).find((node) => node.type === "span" && visibleText(node) === "Next");

    expect(visibleText(modal)).toContain("Status");
    expect(level10Cell?.props.className).toContain("whitespace-nowrap");
    expect(level11Cell?.props.className).toContain("whitespace-nowrap");
    expect(currentPill?.props.className).toContain("whitespace-nowrap");
    expect(nextPill?.props.className).toContain("whitespace-nowrap");
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
    expect(text).toContain("Metal 75, Crystal 30");
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
        delta: "+32",
        label: "Energy output",
        next: "32 produced",
        value: "0 produced",
      },
      {
        delta: "+11/h",
        label: "Deuterium use",
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
      delta: "+26",
      label: "Energy output",
      next: "48 produced",
      value: "22 produced",
    });
    expect(solarRows.some((row) => row.delta?.includes("produced"))).toBe(false);

    const mineEffect = buildingEffectMetrics(mineBuildings, "metalMine");
    const mineRows = detailEffectRows(mineEffect, buildingEnergyDetail(mineBuildings, "metalMine"));

    expect(mineRows).toContainEqual({
      delta: "+13",
      label: "Energy required",
      next: "24 required",
      value: "11 required",
    });
    expect(mineRows.some((row) => row.delta?.includes("required"))).toBe(false);
  });

  test("renders infrastructure deltas as quiet subtext instead of badges", () => {
    const positiveDelta = MetricDeltaSubtext({
      children: "+126",
    });
    const warningDelta = MetricDeltaSubtext({
      children: "+14/h",
      tone: "warning",
    });

    expect(visibleText(positiveDelta)).toBe("+126");
    expect(visibleText(warningDelta)).toBe("+14/h");
    expect(positiveDelta.props.className).toContain("block");
    expect(positiveDelta.props.className).toContain("text-xs");
    expect(positiveDelta.props.className).toContain("text-signal");
    expect(positiveDelta.props.className).not.toMatch(/border|rounded|bg-/);
    expect(warningDelta.props.className).toContain("text-amber-200");
    expect(warningDelta.props.className).not.toMatch(/border|rounded|bg-/);
  });

  test("keeps Solar Plant and Fusion Reactor energy output deltas source-specific", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      fusionReactor: 1,
      solarPlant: 11,
    };
    const solarRows = detailEffectRows(
      buildingEffectMetrics(buildings, "solarPlant", undefined, 3),
      buildingEnergyDetail(buildings, "solarPlant", 3),
    );

    expect(solarRows).toContainEqual({
      delta: "+126",
      label: "Energy output",
      next: "753 produced",
      value: "627 produced",
    });
    expect(solarRows.some((row) => row.value === "659 produced" || row.next === "785 produced")).toBe(false);
    expect(solarRows.some((row) => row.label === "Deuterium use")).toBe(false);

    const fusionRows = detailEffectRows(
      buildingEffectMetrics(buildings, "fusionReactor", undefined, 3),
      buildingEnergyDetail(buildings, "fusionReactor", 3),
    );

    expect(fusionRows).toContainEqual({
      delta: "+37",
      label: "Energy output",
      next: "69 produced",
      value: "32 produced",
    });
    expect(fusionRows.some((row) => row.value === "659 produced" || row.next === "696 produced")).toBe(false);
    expect(fusionRows).toContainEqual({
      delta: "+14/h",
      label: "Deuterium use",
      next: "25/h",
      tone: "warning",
      value: "11/h",
    });
  });

  test("does not leak Solar Plant output into unbuilt Fusion Reactor details", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      fusionReactor: 0,
      solarPlant: 6,
    };
    const fusionRows = detailEffectRows(
      buildingEffectMetrics(buildings, "fusionReactor"),
      buildingEnergyDetail(buildings, "fusionReactor"),
    );

    expect(fusionRows).toContainEqual({
      delta: "+31",
      label: "Energy output",
      next: "31 produced",
      value: "0 produced",
    });
    expect(fusionRows.some((row) => row.value === "212 produced" || row.next === "243 produced")).toBe(false);
    expect(fusionRows).toContainEqual({
      delta: "+11/h",
      label: "Deuterium use",
      next: "11/h",
      tone: "warning",
      value: "0/h",
    });
  });

  test("keeps Solar Plant and Fusion Reactor outputs separate when both produce energy", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      fusionReactor: 1,
      solarPlant: 11,
    };

    const solarEffect = buildingEffectMetrics(buildings, "solarPlant", undefined, 3);
    const fusionEffect = buildingEffectMetrics(buildings, "fusionReactor", undefined, 3);

    expect(solarEffect).toMatchObject({
      currentProduced: 627,
      deltaProduced: 126,
      kind: "energy",
      nextProduced: 753,
    });
    expect(fusionEffect).toMatchObject({
      currentProduced: 32,
      deltaProduced: 37,
      kind: "energy",
      nextProduced: 69,
    });
    if (solarEffect.kind !== "energy" || fusionEffect.kind !== "energy") {
      throw new Error("Expected Solar Plant and Fusion Reactor to be energy effects");
    }
    expect(solarEffect.currentProduced).not.toBe(fusionEffect.currentProduced);
  });

  test("uses energy research when formatting energy building catalog summaries", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        fusionReactor: 1,
        solarPlant: 11,
      },
      research: {
        ...createInitialPlayableState(1_000).research,
        energy: 3,
      },
    };

    expect(infrastructureCatalogStatusText(state, "solarPlant")).toBe("627 energy");
    expect(infrastructureCatalogStatusText(state, "fusionReactor")).toBe("32 energy");
  });

  test("omits the client-derived production-capacity row but keeps energy required for mines", () => {
    // VEY-KANEO-465: per-building production rate is backend-owned game state; the
    // detail panel no longer derives or shows a client "/h" production-capacity row.
    const state = createInitialPlayableState(1_000);
    const unpoweredMineBuild = {
      ...state.buildings,
      metalMine: 0,
      solarPlant: 0,
    };

    const mineEffect = buildingEffectMetrics(unpoweredMineBuild, "metalMine");
    const rows = detailEffectRows(mineEffect, buildingEnergyDetail(unpoweredMineBuild, "metalMine"));

    expect(rows.some((row) => row.label === "Production capacity")).toBe(false);
    expect(rows).toContainEqual({
      delta: "+11",
      label: "Energy required",
      next: "11 required",
      value: "0 required",
    });
  });

  test("shows raw mine production in details instead of backend live-effective production", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        solarPlant: 2,
      },
    };
    const effect = buildingEffectMetrics(state.buildings, "metalMine");
    const productionUpgrade = buildingProductionUpgradeEffect(
      state,
      "metalMine",
      undefined,
      { metal: 42, crystal: 0, deuterium: 0 },
      effect,
    );
    const rows = detailEffectRows(
      effect,
      buildingEnergyDetail(state.buildings, "metalMine"),
      productionUpgrade,
    );

    expect(rows).toContainEqual({
      delta: "+38/h",
      label: "Metal output",
      next: "70/h",
      value: "32/h",
    });
    expect(rows).toContainEqual({
      delta: "+13",
      label: "Energy required",
      next: "24 required",
      value: "11 required",
    });
  });

  test("keeps catalog cards on raw current production without next-level deltas", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        crystalMine: 1,
        solarPlant: 2,
      },
    };

    expect(infrastructureCatalogStatusText(
      state,
      "crystalMine",
      undefined,
      { metal: 0, crystal: 30, deuterium: 0 },
    )).toBe("22/h");
  });

  test("uses selected colony production multipliers for raw mine detail deltas", () => {
    const state = {
      ...createInitialPlayableState(1_000),
      buildings: {
        ...createInitialPlayableState(1_000).buildings,
        metalMine: 1,
        solarPlant: 2,
      },
    };
    const colonyProfile = {
      metalMultiplierBps: 15_000,
      crystalMultiplierBps: 8_500,
      deuteriumMultiplierBps: 11_000,
    };
    const effect = buildingEffectMetrics(state.buildings, "metalMine", colonyProfile);
    const productionUpgrade = buildingProductionUpgradeEffect(
      state,
      "metalMine",
      colonyProfile,
      { metal: 1, crystal: 0, deuterium: 0 },
      effect,
    );
    const rows = detailEffectRows(
      effect,
      buildingEnergyDetail(state.buildings, "metalMine"),
      productionUpgrade,
    );

    expect(rows).toContainEqual({
      delta: "+59/h",
      label: "Metal output",
      next: "108/h",
      value: "49/h",
    });
  });

  test("shows Robotics Factory as a Veydrift construction-time divisor", () => {
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

  test("shows Shipyard build-speed deltas in details and level rows but not cards", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      shipyard: 1,
    };
    const effect = buildingEffectMetrics(buildings, "shipyard");
    const rows = detailEffectRows(effect, buildingEnergyDetail(buildings, "shipyard"));
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Shipyard",
      currentLevel: 1,
      rows: buildingLevelInfoRows(buildings, "shipyard", undefined, 2),
      onClose: () => undefined,
    });
    const modalText = visibleText(modal);

    expect(rows).toContainEqual({
      delta: "+50% faster",
      label: "Ship production speed",
      next: "x3",
      value: "x2",
    });
    expect(infrastructureCatalogStatusText({ ...state, buildings }, "shipyard")).toBe("x2");
    expect(modalText).toContain("Shipyard levels");
    expect(modalText).toContain("Effect");
    expect(modalText).toContain("x2 ship speed (+100% faster)");
    expect(modalText).toContain("x3 ship speed (+50% faster)");
  });

  test("shows Nanite Factory as construction-speed deltas outside compact cards", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      naniteFactory: 1,
    };
    const effect = buildingEffectMetrics(buildings, "naniteFactory");
    const rows = detailEffectRows(effect, buildingEnergyDetail(buildings, "naniteFactory"));
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Nanite Factory",
      currentLevel: 1,
      rows: buildingLevelInfoRows(buildings, "naniteFactory", undefined, 2),
      onClose: () => undefined,
    });
    const modalText = visibleText(modal);

    expect(rows).toContainEqual({
      delta: "+100% faster than current",
      label: "Construction time divisor",
      next: "x4",
      value: "x2",
    });
    expect(infrastructureCatalogStatusText({ ...state, buildings }, "naniteFactory")).toBe("x2");
    expect(modalText).toContain("Nanite Factory levels");
    expect(modalText).toContain("Effect");
    expect(modalText).toContain("x2 construction speed (+100% faster)");
    expect(modalText).toContain("x4 construction speed (+100% faster)");
    expect(modalText).not.toContain("Level 1Level 2");
  });

  test("renders a compact page-level building queue with its infrastructure asset", () => {
    const queue = {
      kind: "building" as const,
      key: "deuteriumSynthesizer" as const,
      label: "Deuterium Synthesizer",
      readyAt: 1_700_000_120_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    };

    const panel = ActiveBuildingQueuePanel({
      now: 1_700_000_060_000,
      queue,
    });
    const text = visibleText(panel);

    expect(panel.type).toBe(QueueProgressPanel);
    expect(panel.props.asset).toContain("deuterium");
    expect(text).toContain("Construction");
    expect(text).toContain("Deuterium Synthesizer 2");
    expect(text).not.toContain("Deuterium Synthesizer Level 2");
    expect(text).toContain("50%");
    expect(text).not.toContain("Time remaining");
    expect(text).not.toContain("Ready at");
  });

  test("keeps the page-level queue independent of the selected building", () => {
    const queue = {
      kind: "building" as const,
      key: "solarPlant" as const,
      label: "Solar Plant",
      readyAt: 1_700_000_120_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 3,
    };

    const panel = ActiveBuildingQueuePanel({
      now: 1_700_000_030_000,
      queue,
    });
    const text = visibleText(panel);

    expect(text).toContain("Construction");
    expect(text).toContain("Solar Plant 3");
    expect(text).not.toMatch(/selected building is waiting/i);
    expect(text).toContain("25%");
  });

  test("shows Research Lab 1 as unlocking research without a misleading speed multiplier", () => {
    const state = createInitialPlayableState(1_000);
    const effect = buildingEffectMetrics(state.buildings, "researchLab");
    const rows = detailEffectRows(effect, buildingEnergyDetail(state.buildings, "researchLab"));

    expect(rows).toContainEqual({
      label: "Research capacity",
      next: "Unlocks research",
      value: "Unavailable",
    });
  });

  test("shows Research Lab level 1 to 2 as the x1 to x2 baseline upgrade", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      researchLab: 1,
    };
    const effect = buildingEffectMetrics(buildings, "researchLab");
    const rows = detailEffectRows(effect, buildingEnergyDetail(buildings, "researchLab"));

    expect(rows).toContainEqual({
      delta: "+100% faster",
      label: "Research speed",
      next: "x2",
      value: "x1",
    });
  });

  test("shows Research Lab level 2 to 3 as the next visible research speed tier", () => {
    const state = createInitialPlayableState(1_000);
    const buildings = {
      ...state.buildings,
      researchLab: 2,
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

  test("shows Terraformer level rows as field expansion, not construction speed", () => {
    const rows = buildingLevelInfoRows(createInitialPlayableState(1_000).buildings, "terraformer", undefined, 3);
    const modal = BuildingLevelInfoModal({
      buildingLabel: "Terraformer",
      currentLevel: 0,
      rows,
      onClose: () => undefined,
    });
    const text = visibleText(modal);

    expect(text).toContain("Terraformer levels");
    expect(text).toContain("Effect");
    expect(text).toContain("+5 total fields");
    expect(text).toContain("+10 total fields");
    expect(text).toContain("+15 total fields");
    expect(text).not.toContain("construction speed");
  });

  test("shows Terraformer detail as current and next planet field expansion", () => {
    const state = createInitialPlayableState(1_000);
    const unbuiltEffect = buildingEffectMetrics(state.buildings, "terraformer");
    const unbuiltRows = detailEffectRows(unbuiltEffect, buildingEnergyDetail(state.buildings, "terraformer"));

    expect(unbuiltRows).toContainEqual({
      delta: "+5 fields",
      label: "Planet fields",
      next: "+5 total fields",
      value: "No expansion",
    });

    const terraformedBuildings = {
      ...state.buildings,
      terraformer: 1,
    };
    const builtEffect = buildingEffectMetrics(terraformedBuildings, "terraformer");
    const builtRows = detailEffectRows(builtEffect, buildingEnergyDetail(terraformedBuildings, "terraformer"));

    expect(builtRows).toContainEqual({
      delta: "+5 fields",
      label: "Planet fields",
      next: "+10 total fields",
      value: "+5 total fields",
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
  if (vnode.type === QueueProgressPanel) {
    const Component = vnode.type as (props: Record<string, unknown>) => ComponentChildren;
    return textParts(Component(vnode.props ?? {}));
  }

  return textParts(vnode.props?.children);
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function" && ["LevelInfoCell", "LevelPill"].includes(vnode.type.name)) {
    const Component = vnode.type as (props: Record<string, unknown>) => ComponentChildren;
    return [vnode, ...elementNodes(Component(vnode.props ?? {}))];
  }

  return [vnode, ...elementNodes(vnode.props?.children)];
}
