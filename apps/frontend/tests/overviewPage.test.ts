import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_HERO_IMAGE,
  overviewHeroImage,
} from "../src/overviewHeroImage";
import {
  overviewDefenseFinishAction,
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
});
