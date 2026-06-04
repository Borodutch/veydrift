import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_HERO_IMAGE,
  overviewHeroImage,
} from "../src/overviewHeroImage";
import {
  isOverviewResearchReadyToFinish,
  overviewBuildingActionNoticeFor,
  overviewBuildingFinishAction,
  overviewBuildingNoticeForFinishAction,
  overviewDefenseFinishAction,
  overviewResearchActionNoticeFor,
  overviewResearchFinishAction,
  shouldShowOverviewBuildingFinishAction,
} from "../src/components/OverviewPage";
import {
  overviewQueueItemLabelClassName,
  overviewQueueItemRemainingClassName,
  queueProgressBarState,
  queueProgressFillState,
} from "../src/overviewData";
import { queueProgressPercent } from "../src/playableMvp";
import type { Planet } from "../src/types";

const overviewSource = await Bun.file(new URL("../src/components/OverviewPage.tsx", import.meta.url)).text();

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
    expect(overviewSource.match(/mt-auto flex h-9 w-full/g)?.length).toBeGreaterThanOrEqual(3);
    expect(overviewSource).toContain("<ArrowRight");
    expect(overviewSource).not.toContain("max-w-[calc(100vw-1.5rem)]");
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
      label: "Finish upgrade",
      onFinish: undefined,
      reason: undefined,
      visible: false,
    });

    const pending = overviewBuildingFinishAction({
      actionPending: true,
      actionPendingLabel: "Building completion: unlock your wallet if needed, then confirm in your wallet.",
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });
    expect(pending).toEqual({
      disabled: true,
      label: "Building completion: unlock your wallet if needed, then confirm in your wallet.",
      onFinish: undefined,
      reason: "Building completion: unlock your wallet if needed, then confirm in your wallet.",
      visible: true,
    });

    const ready = overviewBuildingFinishAction({
      isBuildingReadyToFinish: true,
      onFinishBuilding,
      queue,
    });
    expect(ready.disabled).toBe(false);
    expect(ready.label).toBe("Finish upgrade");
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
      "Infrastructure API is temporarily unavailable while backend state is restored. The app will retry when game state sync recovers.";
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
    expect(action.label).toContain("Infrastructure API is temporarily unavailable");
    expect(action.label).not.toContain("Syncing building queue");
    expect(calls).toBe(0);
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
    const duplicatePrompt = "Building completion: unlock your wallet if needed, then confirm in your wallet.";
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
    expect(overviewBuildingNoticeForFinishAction(notice, action)).toBeUndefined();
    expect(overviewBuildingNoticeForFinishAction({
      ...notice,
      label: "Infrastructure API is temporarily unavailable.",
      tone: "error",
    }, action)?.label).toBe("Infrastructure API is temporarily unavailable.");
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

    expect(action.visible).toBe(true);
    expect(action.disabled).toBe(false);
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
