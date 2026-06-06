import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_HERO_IMAGE,
  overviewHeroImage,
} from "../src/overviewHeroImage";
import { productionQueueViewModel } from "../src/components/ProductionCatalog";
import {
  isOverviewResearchReadyToFinish,
  overviewBuildingActionNoticeFor,
  overviewBuildingFinishAction,
  overviewBuildingNoticeForFinishAction,
  overviewBuildingNoticeForReadyFinishAction,
  overviewDefenseFinishAction,
  overviewShipyardFinishAction,
  overviewResearchActionNoticeFor,
  overviewResearchFinishAction,
  shouldShowOverviewBuildingFinishAction,
} from "../src/components/OverviewPage";
import {
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
  defenseQueuePreview,
  overviewPlanetEffects,
  queueProgressBarState,
  queueProgressFillState,
  shipQueuePreview,
} from "../src/overviewData";
import { createInitialPlayableState, defenseCatalog, queueProgressPercent, shipCatalog } from "../src/playableMvp";
import { timestampToMs } from "../src/timestampFormat";
import type { Planet } from "../src/types";

const overviewSource = await Bun.file(new URL("../src/components/OverviewPage.tsx", import.meta.url)).text();
const buildingCompletionWalletPrompt =
  "Building completion: confirm the game-state update in your wallet; token balance changes are not expected.";

const homePlanet: Planet = {
  alliance: null,
  diameter: 12_000,
  fields: 180,
  galaxy: 1,
  hasMoon: false,
  id: "planet-1",
  image: "/assets/game/style-pass/generated/planets/cold-tundra.webp",
  name: "Vey Prime",
  occupiedBy: null,
  owner: "0x1111111111111111111111111111111111111111",
  ownerId: "0x1111111111111111111111111111111111111111",
  position: 7,
  resources: {
    crystal: 50,
    deuterium: 10,
    energy: 0,
    metal: 100,
  },
  system: 42,
  temperature: {
    max: 8,
    min: -32,
  },
  type: "cold-tundra",
};

describe("overview planet hero image", () => {
  test("renders commander identity before the current planet block", () => {
    const commanderIndex = overviewSource.indexOf(">Commander<");
    const planetHeroIndex = overviewSource.indexOf("Planet hero");
    const missionPanelIndex = overviewSource.indexOf("<MissionPanel");

    expect(commanderIndex).toBeGreaterThanOrEqual(0);
    expect(planetHeroIndex).toBeGreaterThanOrEqual(0);
    expect(missionPanelIndex).toBeGreaterThanOrEqual(0);
    expect(commanderIndex).toBeLessThan(planetHeroIndex);
    expect(planetHeroIndex).toBeLessThan(missionPanelIndex);
  });

  test("uses the disconnected default only for local preview state", () => {
    expect(overviewHeroImage(undefined, false, undefined, undefined)).toBe(DISCONNECTED_HERO_IMAGE);
    expect(overviewHeroImage(undefined, true, undefined, "1:42:7")).toBeUndefined();
  });

  test("keeps a real connected home image during rehydration", () => {
    expect(overviewHeroImage(homePlanet, true, undefined, "1:42:7")).toBe(homePlanet.image);
    expect(overviewHeroImage(
      undefined,
      true,
      { image: homePlanet.image, planetKey: "1:42:7" },
      "1:42:7"
    )).toBe(homePlanet.image);
  });

  test("does not reuse a last-known image for a different current planet", () => {
    expect(overviewHeroImage(
      undefined,
      true,
      { image: homePlanet.image, planetKey: "1:42:7" },
      "1:42:8"
    )).toBeUndefined();
  });
});

describe("overview queue progress display", () => {
  test("renders an accessible planet effects info control beside Overview stats", () => {
    expect(overviewSource).toContain('aria-label="Show planet effects"');
    expect(overviewSource).toContain('aria-controls="overview-planet-effects"');
    expect(overviewSource).toContain("<PlanetEffectsPanel");
    expect(overviewSource).toContain("Temperature changes implemented production math");
    expect(overviewSource).toContain('aria-label="Close planet effects"');
  });

  test("derives selected planet effect values from canonical production helpers", () => {
    const state = createInitialPlayableState(1_700_000_000_000);
    state.buildings.deuteriumSynthesizer = 3;
    state.buildings.solarPlant = 4;
    state.buildings.fusionReactor = 1;
    state.buildings.terraformer = 2;
    state.research.energy = 2;
    state.ships.solarSatellite = 2;

    const effects = overviewPlanetEffects({
      buildings: state.buildings,
      energyTechnologyLevel: state.research.energy,
      settlement: {
        wallet: "0x1111111111111111111111111111111111111111",
        hasFirstPlanet: true,
        homePlanetId: "7",
        planet: {
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          name: "Vey Prime",
          galaxy: 1,
          system: 42,
          position: 7,
          fields: 220,
          temperature: 40,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 9_800,
          lastSettledAt: "1700000000",
          resources: { metal: "0", crystal: "0", deuterium: "0" },
        },
      },
      solarSatelliteCount: state.ships.solarSatellite,
      usedFields: 12,
    });

    expect(effects.fields).toBe("12 / 220");
    expect(effects.availableFields).toBe(208);
    expect(effects.fieldPressurePercent).toBeCloseTo(5.45, 2);
    expect(effects.temperature).toBe("20°C to 60°C");
    expect(effects.deuteriumMultiplier).toBe("98%");
    expect(effects.deuteriumCapacityPerHour).toBe(38);
    expect(effects.liveDeuteriumPerHour).toBe(27);
    expect(effects.minePower).toBe("100%");
    expect(effects.solarSatelliteEnergy).toBe(30);
    expect(effects.terraformer).toBe("+10 now, +5 next level");
  });

  test("allows long active building names to wrap beside queue metadata", () => {
    expect(overviewQueueItemLabelClassName).not.toContain("truncate");
    expect(overviewQueueItemLabelClassName).toContain("break-words");
    expect(overviewQueueItemRemainingClassName).not.toContain("shrink-0");
  });

  test("uses the shared anchored action layout for production queue cards", () => {
    for (const actionLabel of ["Build", "Defenses", "Research", "Shipyard"]) {
      expect(overviewSource).toContain(`actionLabel="${actionLabel}"`);
    }

    expect(overviewSource.match(/<QueuePanelContent>/g)?.length).toBeGreaterThanOrEqual(8);
    expect(overviewSource).toContain("function QueuePanelContent");
    expect(overviewSource).toContain("flex min-h-0 flex-1 flex-col gap-2");
    expect(overviewSource).toContain("mt-auto flex min-h-9 w-full min-w-0");
    expect(overviewSource).toContain("mt-auto flex min-h-9 w-full min-w-0 items-center justify-center whitespace-normal break-words");
    expect(overviewSource.match(/mt-auto flex h-9 w-full/g)?.length).toBeGreaterThanOrEqual(2);
    expect(overviewSource).toContain("<ArrowRight");
    expect(overviewSource).not.toContain("max-w-[calc(100vw-1.5rem)]");
  });

  test("uses canonical on-chain timelines for Overview defense and shipyard queues", () => {
    expect(overviewSource).toContain("const defenseStartedAt = queueTimestampMs(onChainQueues?.defense?.startedAt)");
    expect(overviewSource).toContain("startedAt={defenseStartedAt}");
    expect(overviewSource).toContain("const shipStartedAt = queueTimestampMs(onChainQueues?.ship?.startedAt)");
    expect(overviewSource).toContain("startedAt={shipHasCanonicalTimeline ? shipStartedAt : undefined}");
    expect(overviewSource).toContain("const shouldIndeterminate = indeterminate ?? (!hasCanonicalTimeline && progress === undefined)");
    expect(overviewSource).toContain("label={onChainShipQueue.label}");
  });

  test("matches Defense page label, asset, and progress for the same queue snapshot", () => {
    const queue = {
      active: true,
      cost: { metal: "4000", crystal: "0", deuterium: "0" },
      itemId: 0,
      kind: "defense",
      quantity: 2,
      readyAt: "1700000120",
      startedAt: "1700000000",
    };
    const now = 1_700_000_060_000;
    const overview = defenseQueuePreview(queue);
    const detail = productionQueueViewModel(queue, defenseCatalog);

    expect(detail).toBeDefined();
    expect(overview).toEqual({
      asset: detail?.asset,
      label: `${detail?.label} x${detail?.quantity}`,
    });
    expect(queueProgressFillState({
      now,
      readyAt: timestampToMs(queue.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(queue.startedAt),
    }).progress).toBe(queueProgressFillState({
      now,
      readyAt: timestampToMs(detail?.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(detail?.startedAt),
    }).progress);
  });

  test("matches Shipyard page concrete label, asset, and progress for the same queue snapshot", () => {
    const queue = {
      active: true,
      cost: { metal: "4000", crystal: "4000", deuterium: "0" },
      itemId: 0,
      kind: "ship",
      quantity: 1,
      readyAt: "1700000120",
      startedAt: "1700000000",
    };
    const now = 1_700_000_060_000;
    const overview = shipQueuePreview(queue);
    const detail = productionQueueViewModel(queue, shipCatalog);

    expect(detail).toBeDefined();
    expect(overview).toEqual({
      asset: detail?.asset,
      label: `${detail?.label} x${detail?.quantity}`,
    });
    expect(overview.label).toBe("Small Cargo x1");
    expect(overview.label).not.toBe("Ship x1");
    expect(queueProgressFillState({
      now,
      readyAt: timestampToMs(queue.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(queue.startedAt),
    }).progress).toBe(queueProgressFillState({
      now,
      readyAt: timestampToMs(detail?.readyAt),
      remaining: "1m",
      startedAt: timestampToMs(detail?.startedAt),
    }).progress);
  });

  test("renders ready queues as complete even when the source payload was indeterminate", () => {
    expect(queueProgressBarState({
      indeterminate: true,
      remaining: "Ready",
    })).toEqual({
      indeterminate: false,
      progress: 1,
    });
  });

  test("keeps pending unknown-duration queues indeterminate", () => {
    expect(queueProgressBarState({
      indeterminate: true,
      remaining: "Pending",
    })).toEqual({
      indeterminate: true,
      progress: 0,
    });
  });

  test("clamps determinate queue progress", () => {
    expect(queueProgressBarState({
      progress: 1.25,
      remaining: "12s",
    })).toEqual({
      indeterminate: false,
      progress: 1,
    });
  });

  test("derives live fill progress from the canonical queue timeline", () => {
    expect(queueProgressFillState({
      now: 1_700_000_500_000,
      progress: 0,
      readyAt: 1_700_001_000_000,
      remaining: "8m 20s",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 500_000,
      progress: 0.5,
    });
  });

  test("starts live queue progress at the beginning of a canonical timeline", () => {
    expect(queueProgressFillState({
      now: 1_700_000_000_000,
      progress: 0,
      readyAt: 1_700_001_000_000,
      remaining: "16m 40s",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 0,
      progress: 0,
    });
  });

  test("prefers canonical rounded timeline progress over a stale caller progress value", () => {
    expect(queueProgressFillState({
      now: 1_700_000_755_000,
      progress: 0.1,
      readyAt: 1_700_001_000_000,
      remaining: "4m 10s",
      startedAt: 1_700_000_000_000,
    })).toMatchObject({
      animated: false,
      progress: 0.76,
    });
  });

  test("matches infrastructure rounded progress for the same queue and clock", () => {
    const queue = {
      readyAt: 1_700_001_000_000,
      startedAt: 1_700_000_000_000,
    };
    const now = 1_700_000_755_000;
    const infrastructurePercent = queueProgressPercent(queue, now);
    const overviewFill = queueProgressFillState({
      now,
      progress: 0,
      readyAt: queue.readyAt,
      remaining: "4m 5s",
      startedAt: queue.startedAt,
    });

    expect(overviewFill).toMatchObject({
      animated: false,
      progress: infrastructurePercent / 100,
    });
    expect(overviewFill.progress * 100).toBe(infrastructurePercent);
  });

  test("renders ready live queues as complete without continuing animation", () => {
    expect(queueProgressFillState({
      now: 1_700_001_000_000,
      progress: 1,
      readyAt: 1_700_001_000_000,
      remaining: "Ready",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 1_000_000,
      progress: 1,
    });
  });

  test("stops canonical queue animation once elapsed time reaches readyAt", () => {
    expect(queueProgressFillState({
      now: 1_700_001_010_000,
      progress: 0.95,
      readyAt: 1_700_001_000_000,
      remaining: "Ready",
      startedAt: 1_700_000_000_000,
    })).toEqual({
      animated: false,
      durationMs: 1_000_000,
      elapsedMs: 1_000_000,
      progress: 1,
    });
  });

  test("passes catalog thumbnails into active research queues", () => {
    expect(overviewSource).toContain("researchCatalog");
    expect(overviewSource).toContain("thumbnailSrc={onChainResearchAsset}");
    expect(overviewSource).toContain("thumbnailSrc={settledResearchAsset}");
  });

  test("resolves active Shipyard queues to catalog names and thumbnails", () => {
    const preview = shipQueuePreview({
      active: true,
      cost: { metal: "3000", crystal: "1000", deuterium: "0" },
      itemId: 1,
      kind: "ship",
      quantity: 2,
      readyAt: "1700000600",
    });

    expect(preview.label).toBe("Light Fighter x2");
    expect(preview.asset).toContain("light-fighter");
  });

  test("shows the ready building finish action for infrastructure-backed queues", () => {
    const onFinishBuilding = () => undefined;

    expect(shouldShowOverviewBuildingFinishAction({
      isBuildingReadyToFinish: true,
      onFinishBuilding,
    })).toBe(true);
    expect(shouldShowOverviewBuildingFinishAction({
      isBuildingReadyToFinish: false,
      onFinishBuilding,
    })).toBe(false);
    expect(shouldShowOverviewBuildingFinishAction({
      isBuildingReadyToFinish: true,
    })).toBe(false);
  });

  test("derives the ready building finish action from the overview queue when needed", () => {
    const onFinishBuilding = () => undefined;

    expect(shouldShowOverviewBuildingFinishAction({
      now: 1_700_000_000_000,
      onFinishBuilding,
      queue: {
        active: true,
        readyAt: "1700000000",
      },
    })).toBe(true);
    expect(shouldShowOverviewBuildingFinishAction({
      now: 1_700_000_000_000,
      onFinishBuilding,
      queue: {
        active: true,
        readyAt: "1700000000000",
      },
    })).toBe(true);
    expect(shouldShowOverviewBuildingFinishAction({
      now: 1_699_999_999_000,
      onFinishBuilding,
      queue: {
        active: true,
        readyAt: "1700000000",
      },
    })).toBe(false);
  });

  test("hides not-ready building finish controls but keeps pending and ready states visible", () => {
    const queue = {
      kind: "building" as const,
      key: "solarPlant" as const,
      label: "Solar Plant",
      readyAt: 1_700_000_600_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    };
    let calls = 0;
    const onFinishBuilding = () => {
      calls += 1;
    };

    const notReady = overviewBuildingFinishAction({
      isBuildingReadyToFinish: false,
      onFinishBuilding,
      queue,
    });
    expect(notReady).toEqual({
      disabled: false,
      label: "Complete building",
      onFinish: undefined,
      reason: undefined,
      reasonTone: "error",
      visible: false,
    });

    const pending = overviewBuildingFinishAction({
      actionPending: true,
      actionPendingLabel: buildingCompletionWalletPrompt,
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });
    expect(pending).toEqual({
      disabled: true,
      label: "Completing building",
      onFinish: undefined,
      reason: buildingCompletionWalletPrompt,
      reasonTone: "pending",
      visible: true,
    });

    const ready = overviewBuildingFinishAction({
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });
    expect(ready.disabled).toBe(false);
    expect(ready.label).toBe("Complete building");
    ready.onFinish?.();
    expect(calls).toBe(1);
  });

  test("disables ready building finish controls when the backend is unavailable", () => {
    const queue = {
      kind: "building" as const,
      key: "crystalMine" as const,
      label: "Crystal Mine",
      readyAt: 1_700_000_000_000,
      startedAt: 1_699_999_000_000,
      targetLevel: 8,
    };
    const backendUnavailableReason =
      "Infrastructure API is temporarily unavailable. The app will keep retrying, and building actions are paused until current backend state is available.";
    let calls = 0;
    const action = overviewBuildingFinishAction({
      actionUnavailableReason: backendUnavailableReason,
      isBuildingReadyToFinish: true,
      now: 1_700_000_000_000,
      onFinishBuilding: () => {
        calls += 1;
      },
      queue,
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.onFinish).toBeUndefined();
    expect(action.label).toBe("Complete building");
    expect(action.reason).toContain("Infrastructure API is temporarily unavailable");
    expect(action.reason).not.toContain("Syncing building queue");
    expect(action.reason).not.toContain("backend state is restored");
    expect(action.reason).not.toContain("game state sync recovers");
    expect(action.reasonTone).toBe("error");
    expect(calls).toBe(0);
  });

  test("keeps Overview building finish button copy compact without clipping", () => {
    expect(overviewSource).toContain('label: actionPending ? "Completing building" : "Complete building"');
    expect(overviewSource).toContain("w-full min-w-0 items-center justify-center whitespace-normal break-words");
    expect(overviewSource).toContain("max-w-full whitespace-normal break-words [overflow-wrap:anywhere]");
  });

  test("keeps Overview building completion notices bounded on mobile", () => {
    expect(overviewSource).toContain(
      "min-w-0 max-w-full overflow-hidden whitespace-normal break-words rounded-md border",
    );
    expect(overviewSource).toContain("[overflow-wrap:anywhere]");
  });

  test("shows building finish action notices for the active overview queue", () => {
    const notice = {
      buildingKey: "shipyard" as const,
      label: "Can't check game state right now.",
      tone: "error" as const,
    };

    expect(overviewBuildingActionNoticeFor(notice, "shipyard")).toBe(notice);
    expect(overviewBuildingActionNoticeFor(notice, "metalMine")).toBeUndefined();
    expect(overviewBuildingActionNoticeFor(notice, undefined)).toBe(notice);
  });

  test("deduplicates identical ready building completion prompts on Overview", () => {
    const duplicatePrompt = buildingCompletionWalletPrompt;
    const notice = {
      buildingKey: "metalMine" as const,
      label: duplicatePrompt,
      tone: "pending" as const,
    };
    const action = overviewBuildingFinishAction({
      actionPending: true,
      actionPendingLabel: duplicatePrompt,
      isBuildingReadyToFinish: true,
      onFinishBuilding: () => undefined,
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 1_700_000_000_000,
        startedAt: 1_699_999_000_000,
        targetLevel: 9,
      },
    });

    expect(action.reason).toBe(duplicatePrompt);
    expect(overviewBuildingNoticeForFinishAction(notice, action)).toBe(notice);
    expect(overviewBuildingNoticeForFinishAction({
      ...notice,
      label: "Infrastructure API is temporarily unavailable.",
      tone: "error",
    }, action)?.label).toBe("Infrastructure API is temporarily unavailable.");
  });

  test("moves long Overview building completion guidance into a wrapped notice", () => {
    const longReason = "Building completion failed for this ready queue. Refreshing backend state before another finish attempt.";
    const action = overviewBuildingFinishAction({
      actionUnavailableReason: longReason,
      isBuildingReadyToFinish: true,
      onFinishBuilding: () => undefined,
      queue: {
        kind: "building" as const,
        key: "metalMine" as const,
        label: "Metal Mine",
        readyAt: 1_700_000_000_000,
        startedAt: 1_699_999_000_000,
        targetLevel: 9,
      },
    });

    expect(action.label).toBe("Complete building");
    expect(action.reason).toBe(longReason);
    expect(overviewBuildingNoticeForFinishAction(undefined, action)).toEqual({
      label: longReason,
      tone: "error",
    });
  });

  test("keeps stale building-start success copy from disabling ready Overview completion", () => {
    const staleStartedNotice = {
      buildingKey: "crystalMine" as const,
      label: "Building upgrade started.",
      tone: "success" as "success" | "error",
    };
    let calls = 0;
    const action = overviewBuildingFinishAction({
      actionUnavailableReason: staleStartedNotice.tone === "error" ? staleStartedNotice.label : undefined,
      isBuildingReadyToFinish: true,
      onFinishBuilding: () => {
        calls += 1;
      },
      queue: {
        kind: "building" as const,
        key: "crystalMine" as const,
        label: "Crystal Mine",
        readyAt: 1_700_000_000_000,
        startedAt: 1_699_999_000_000,
        targetLevel: 9,
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
    action.onFinish?.();
    expect(calls).toBe(1);
    expect(overviewBuildingNoticeForReadyFinishAction(staleStartedNotice, action)).toBeUndefined();
  });

  test("shows and invokes the ready defense completion action on Overview", () => {
    let calls = 0;
    const action = overviewDefenseFinishAction({
      now: 1_700_000_000_000,
      onFinishDefense: () => {
        calls += 1;
      },
      queue: {
        active: true,
        cost: { metal: "2000", crystal: "0", deuterium: "0" },
        itemId: 0,
        kind: "defense",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action).toMatchObject({
      disabled: false,
      visible: true,
    });
    action.onFinish?.();
    expect(calls).toBe(1);
  });

  test("keeps not-ready defense queues passive on Overview", () => {
    const action = overviewDefenseFinishAction({
      now: 1_699_999_000_000,
      onFinishDefense: () => undefined,
      queue: {
        active: true,
        cost: { metal: "2000", crystal: "0", deuterium: "0" },
        itemId: 0,
        kind: "defense",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(false);
    expect(action.onFinish).toBeUndefined();
  });

  test("disables ready defense completion while a defense transaction is pending", () => {
    const action = overviewDefenseFinishAction({
      actionPending: true,
      now: 1_700_000_000_000,
      onFinishDefense: () => undefined,
      queue: {
        active: true,
        cost: { metal: "2000", crystal: "0", deuterium: "0" },
        itemId: 0,
        kind: "defense",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.onFinish).toBeUndefined();
  });

  test("shows and invokes the ready Shipyard completion action on Overview", () => {
    let calls = 0;
    const action = overviewShipyardFinishAction({
      now: 1_700_000_000_000,
      onFinishShipProduction: () => {
        calls += 1;
      },
      queue: {
        active: true,
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        itemId: 1,
        kind: "ship",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
    action.onFinish?.();
    expect(calls).toBe(1);
  });

  test("keeps not-ready Shipyard queues passive on Overview", () => {
    const action = overviewShipyardFinishAction({
      now: 1_699_999_000_000,
      onFinishShipProduction: () => undefined,
      queue: {
        active: true,
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        itemId: 1,
        kind: "ship",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(false);
    expect(action.onFinish).toBeUndefined();
  });

  test("disables ready Shipyard completion while a Shipyard transaction is pending", () => {
    const action = overviewShipyardFinishAction({
      actionPending: true,
      now: 1_700_000_000_000,
      onFinishShipProduction: () => undefined,
      queue: {
        active: true,
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        itemId: 1,
        kind: "ship",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.onFinish).toBeUndefined();
  });

  test("keeps ready Shipyard completion visible but disabled while backend state is syncing", () => {
    const action = overviewShipyardFinishAction({
      chainStatus: "loading",
      now: 1_700_000_000_000,
      onFinishShipProduction: () => undefined,
      queue: {
        active: true,
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        itemId: 1,
        kind: "ship",
        quantity: 1,
        readyAt: "1700000000",
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.onFinish).toBeUndefined();
    expect(action.reason).toBe("Shipyard state is syncing. Refresh and retry once backend state is ready.");
  });

  test("shows and invokes the ready research completion action on Overview", () => {
    let calls = 0;
    const queue = {
      active: true,
      cost: { metal: "800", crystal: "400", deuterium: "0" },
      itemId: 0,
      kind: "research",
      readyAt: "1700000000",
      targetLevel: 2,
    };
    const action = overviewResearchFinishAction({
      now: 1_700_000_000_000,
      onFinishResearch: () => {
        calls += 1;
      },
      queue,
    });

    expect(isOverviewResearchReadyToFinish(queue, 1_700_000_000_000)).toBe(true);
    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
    action.onFinish?.();
    expect(calls).toBe(1);
  });

  test("keeps not-ready research queues passive on Overview", () => {
    const queue = {
      active: true,
      cost: { metal: "800", crystal: "400", deuterium: "0" },
      itemId: 0,
      kind: "research",
      readyAt: "1700000000",
      targetLevel: 2,
    };
    const action = overviewResearchFinishAction({
      now: 1_699_999_000_000,
      onFinishResearch: () => undefined,
      queue,
    });

    expect(isOverviewResearchReadyToFinish(queue, 1_699_999_000_000)).toBe(false);
    expect(action.visible).toBe(false);
    expect(action.onFinish).toBeUndefined();
  });

  test("disables ready research completion while a research transaction is pending", () => {
    const action = overviewResearchFinishAction({
      actionPending: true,
      now: 1_700_000_000_000,
      onFinishResearch: () => undefined,
      queue: {
        active: true,
        cost: { metal: "800", crystal: "400", deuterium: "0" },
        itemId: 0,
        kind: "research",
        readyAt: "1700000000",
        targetLevel: 2,
      },
    });

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.onFinish).toBeUndefined();
  });

  test("keeps research completion success copy out of the compact Overview card", () => {
    expect(overviewResearchActionNoticeFor({
      status: "success",
      label: "Research completion confirmed.",
    })).toBeUndefined();

    expect(overviewResearchActionNoticeFor({
      status: "pending",
      label: "Research completion: awaiting wallet",
    })).toEqual({
      label: "Research completion: awaiting wallet",
      tone: "pending",
    });

    expect(overviewResearchActionNoticeFor({
      status: "error",
      label: "Research completion failed.",
    })).toEqual({
      label: "Research completion failed.",
      tone: "error",
    });
  });
});
