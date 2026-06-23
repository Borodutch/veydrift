import { describe, expect, test } from "bun:test";
import {
  activeBuildingQueueResponse,
  buildingQueueItemForDisplay,
  energyBalanceFromChain,
  infrastructurePlayableState,
  isBuildingQueueReadyToFinish,
  optimisticStartedBuildingQueueResponse,
  researchQueueForDisplay,
} from "./chainState";
import type { ChainInfrastructureState, PlayerQueuesResponse, QueueStateResponse } from "./walletFlow";
import { createInitialPlayableState, progress } from "./playableMvp";

describe("chainState", () => {
  test("derives building queue progress from the backend queue startedAt/readyAt", () => {
    const readyAtSeconds = 1_700_000_060;
    const halfway = (readyAtSeconds - 54) * 1_000;
    const state = infrastructurePlayableState({
      wallet: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      resources: { metal: "0", crystal: "0", deuterium: "0" },
      productionPerHour: null,
      energyBalance: null,
      storageCaps: null,
      buildings: [],
      queue: {
        active: true,
        kind: "building",
        itemId: 0,
        targetLevel: 1,
        // VEY-KANEO-465: backend-provided startedAt anchors the progress bar.
        startedAt: (readyAtSeconds - 108).toString(),
        readyAt: readyAtSeconds.toString(),
        cost: { metal: "60", crystal: "15", deuterium: "0" },
      },
    }, halfway);

    expect(state.queue).toMatchObject({
      kind: "building",
      key: "metalMine",
      label: "Metal Mine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - 108) * 1_000,
    });
    expect(progress(state.queue, halfway)).toBe(0.5);
  });

  test("derives building queue progress from the backend queue startedAt/readyAt", () => {
    const readyAtSeconds = 1_700_000_060;
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 3,
      targetLevel: 1,
      // VEY-KANEO-465: progress is anchored to the backend's queue startedAt, not
      // a client duration estimate.
      startedAt: (readyAtSeconds - 151).toString(),
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "75", crystal: "30", deuterium: "0" },
    }, (readyAtSeconds - 76) * 1_000);

    expect(queue).toMatchObject({
      kind: "building",
      key: "solarPlant",
      label: "Solar Plant",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - 151) * 1_000,
    });
    expect(progress(queue, (readyAtSeconds - 76) * 1_000)).toBeCloseTo(75 / 151, 5);
  });

  test("uses the infrastructure queue when the wallet queues endpoint has not exposed the active building", () => {
    const readyAtSeconds = 1_700_000_060;
    const queues = playerQueues(null);
    const infrastructure = infrastructureWithQueue(buildingQueue({
      itemId: 0,
      readyAt: readyAtSeconds.toString(),
      targetLevel: 1,
    }));
    const queue = activeBuildingQueueResponse(queues, infrastructure);

    expect(queue).toEqual(infrastructure.queue);
    expect(isBuildingQueueReadyToFinish(queue, readyAtSeconds * 1_000)).toBe(true);
    expect(isBuildingQueueReadyToFinish(queue, (readyAtSeconds - 1) * 1_000)).toBe(false);
  });

  test("creates an optimistic started-building queue while the indexer catches up", () => {
    const now = 1_700_000_000_123;
    const queue = optimisticStartedBuildingQueueResponse({
      cost: { metal: "400", crystal: "120", deuterium: "0" },
      durationSeconds: 115,
      itemId: 4,
      now,
      targetLevel: 2,
    });

    expect(queue).toEqual({
      active: true,
      kind: "building",
      itemId: 4,
      targetLevel: 2,
      startedAt: "1700000000",
      readyAt: "1700000115",
      cost: { metal: "400", crystal: "120", deuterium: "0" },
      backlog: [],
      asOfNow: {
        secondsRemaining: 115,
        complete: false,
      },
    });
    expect(buildingQueueItemForDisplay(queue, now)).toMatchObject({
      kind: "building",
      key: "roboticsFactory",
      targetLevel: 2,
    });
    expect(isBuildingQueueReadyToFinish(queue, now + 120_000)).toBe(false);
  });

  test("accepts normalized millisecond readyAt values for ready building completion", () => {
    const readyAtMs = 1_700_000_060_000;
    const queue = buildingQueue({
      readyAt: readyAtMs.toString(),
    });

    expect(isBuildingQueueReadyToFinish(queue, readyAtMs)).toBe(true);
    expect(isBuildingQueueReadyToFinish(queue, readyAtMs - 1)).toBe(false);
    expect(buildingQueueItemForDisplay(queue, readyAtMs)).toMatchObject({
      readyAt: readyAtMs,
    });
  });

  test("keeps invalid readyAt values unavailable for building completion", () => {
    expect(isBuildingQueueReadyToFinish(buildingQueue({ readyAt: "not-a-date" }), 1_700_000_060_000)).toBe(false);
    expect(isBuildingQueueReadyToFinish(buildingQueue({ readyAt: "0" }), 1_700_000_060_000)).toBe(false);
  });

  test("prefers the selected infrastructure building payload when both queue sources are active", () => {
    const queuesBuilding = buildingQueue({ itemId: 3, targetLevel: 1, readyAt: "1700000060" });
    const infrastructureBuilding = buildingQueue({ itemId: 0, targetLevel: 1, readyAt: "1700000060" });

    expect(activeBuildingQueueResponse(
      playerQueues(queuesBuilding),
      infrastructureWithQueue(infrastructureBuilding),
    )).toEqual(infrastructureBuilding);
  });

  test("does not let a stale ready wallet queue override refreshed infrastructure state", () => {
    const walletReadyQueue = buildingQueue({ itemId: 3, targetLevel: 6, readyAt: "1700000000" });
    const infrastructureActiveQueue = buildingQueue({ itemId: 3, targetLevel: 6, readyAt: "1700000600" });

    const queue = activeBuildingQueueResponse(
      playerQueues(walletReadyQueue),
      infrastructureWithQueue(infrastructureActiveQueue),
    );

    expect(queue).toEqual(infrastructureActiveQueue);
    expect(isBuildingQueueReadyToFinish(queue, 1_700_000_000_000)).toBe(false);
  });

  test("adapts contract energy shortage factor for display", () => {
    expect(energyBalanceFromChain({
      produced: "60",
      required: "100",
      scaleBps: "6000",
    })).toEqual({
      deuteriumConsumed: 0,
      produced: 60,
      required: 100,
      scaleBps: 6000,
    });
  });

  test("uses queue startedAt from the backend when a refreshed construction outlives the local duration estimate", () => {
    const startedAtSeconds = 1_700_000_000;
    const readyAtSeconds = 1_700_000_600;
    const halfway = (startedAtSeconds + 300) * 1_000;
    const state = createInitialPlayableState();
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 1,
      targetLevel: 1,
      startedAt: startedAtSeconds.toString(),
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "48", crystal: "24", deuterium: "0" },
    }, halfway);

    expect(queue).toMatchObject({
      kind: "building",
      key: "crystalMine",
      label: "Crystal Mine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: startedAtSeconds * 1_000,
    });
    expect(progress(queue, halfway)).toBe(0.5);
  });

  test("uses queue startedAt from the backend for active research progress", () => {
    const startedAtSeconds = 1_700_000_000;
    const readyAtSeconds = 1_700_000_600;
    const halfway = (startedAtSeconds + 300) * 1_000;
    const queue = researchQueueForDisplay({
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      startedAt: startedAtSeconds.toString(),
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "0", crystal: "1600", deuterium: "800" },
    }, halfway);

    expect(queue).toMatchObject({
      kind: "research",
      key: "energy",
      label: "Energy Technology",
      readyAt: readyAtSeconds * 1_000,
      startedAt: startedAtSeconds * 1_000,
      targetLevel: 2,
    });
    expect(progress(queue, halfway)).toBe(0.5);
  });

  test("derives active research progress from the backend queue startedAt/readyAt", () => {
    const readyAtSeconds = 1_700_002_880;
    const now = 1_700_001_440_000;
    const queue = researchQueueForDisplay({
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      // VEY-KANEO-465: backend-provided startedAt anchors the progress bar — no
      // client research-duration estimate.
      startedAt: "1700000000",
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "0", crystal: "1600", deuterium: "800" },
    }, now);

    expect(queue).toMatchObject({
      kind: "research",
      key: "energy",
      label: "Energy Technology",
      readyAt: readyAtSeconds * 1_000,
      startedAt: 1_700_000_000_000,
      targetLevel: 2,
    });
    expect(progress(queue, now)).toBe(0.5);
  });

  test("keeps active research visible even without enough timeline context", () => {
    const queue = researchQueueForDisplay({
      active: true,
      kind: "research",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1700000600",
      cost: { metal: "0", crystal: "1600", deuterium: "800" },
    }, 1_700_000_300_000);

    expect(queue).toMatchObject({
      kind: "research",
      key: "energy",
      label: "Energy Technology",
      readyAt: 1_700_000_600_000,
      startedAt: 1_700_000_300_000,
      targetLevel: 2,
    });
    expect(progress(queue, 1_700_000_300_000)).toBe(0);
  });

  test("keeps ready building queues complete when the backend omits startedAt", () => {
    const readyAtSeconds = 1_700_000_060;
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 0,
      targetLevel: 1,
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "60", crystal: "15", deuterium: "0" },
    }, (readyAtSeconds + 5) * 1_000);

    // VEY-KANEO-465: with no backend startedAt the progress bar has no fill
    // anchor (startedAt falls back to readyAt) — no client duration estimate. A
    // past-ready queue still reads as complete.
    expect(queue).toMatchObject({
      kind: "building",
      key: "metalMine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: readyAtSeconds * 1_000,
    });
    expect(progress(queue, (readyAtSeconds + 5) * 1_000)).toBe(1);
  });
});

function buildingQueue(overrides: Partial<QueueStateResponse> = {}): QueueStateResponse {
  return {
    active: true,
    kind: "building",
    itemId: 0,
    targetLevel: 1,
    readyAt: "1700000060",
    cost: { metal: "60", crystal: "15", deuterium: "0" },
    ...overrides,
  };
}

function playerQueues(building: QueueStateResponse | null): PlayerQueuesResponse {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    building,
    defense: null,
    ship: null,
    research: null,
  };
}

function infrastructureWithQueue(queue: QueueStateResponse | null): ChainInfrastructureState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    resources: { metal: "0", crystal: "0", deuterium: "0" },
    productionPerHour: null,
    energyBalance: null,
    storageCaps: null,
    buildings: [],
    queue,
  };
}
