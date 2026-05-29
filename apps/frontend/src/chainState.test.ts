import { describe, expect, test } from "bun:test";
import {
  activeBuildingQueueResponse,
  buildingQueueItemForDisplay,
  energyBalanceFromChain,
  infrastructurePlayableState,
  isBuildingQueueReadyToFinish,
} from "./chainState";
import type { ChainInfrastructureState, PlayerQueuesResponse, QueueStateResponse } from "./walletFlow";
import { createInitialPlayableState, progress } from "./playableMvp";

describe("chainState", () => {
  test("derives stable building queue progress from readyAt and upgrade duration", () => {
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

  test("derives building queue progress from the queues endpoint payload", () => {
    const readyAtSeconds = 1_700_000_060;
    const state = createInitialPlayableState();
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 3,
      targetLevel: 1,
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "75", crystal: "30", deuterium: "0" },
    }, state.buildings, (readyAtSeconds - 76) * 1_000);

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

  test("prefers the wallet queues building payload when both queue sources are active", () => {
    const queuesBuilding = buildingQueue({ itemId: 3, targetLevel: 1, readyAt: "1700000060" });
    const infrastructureBuilding = buildingQueue({ itemId: 0, targetLevel: 1, readyAt: "1700000060" });

    expect(activeBuildingQueueResponse(
      playerQueues(queuesBuilding),
      infrastructureWithQueue(infrastructureBuilding),
    )).toEqual(queuesBuilding);
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
    }, state.buildings, halfway);

    expect(queue).toMatchObject({
      kind: "building",
      key: "crystalMine",
      label: "Crystal Mine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: startedAtSeconds * 1_000,
    });
    expect(progress(queue, halfway)).toBe(0.5);
  });

  test("uses Nanite Factory level when estimating active building queue progress without startedAt", () => {
    const readyAtSeconds = 1_700_003_600;
    const state = createInitialPlayableState();
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 7,
      targetLevel: 1,
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "10000", crystal: "5000", deuterium: "0" },
    }, {
      ...state.buildings,
      roboticsFactory: 2,
      naniteFactory: 1,
    }, (readyAtSeconds - 1_800) * 1_000);

    expect(queue).toMatchObject({
      kind: "building",
      key: "metalStorage",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - 3_600) * 1_000,
    });
    expect(progress(queue, (readyAtSeconds - 1_800) * 1_000)).toBe(0.5);
  });

  test("keeps ready building queues complete when startedAt is missing", () => {
    const readyAtSeconds = 1_700_000_060;
    const state = createInitialPlayableState();
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 0,
      targetLevel: 1,
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "60", crystal: "15", deuterium: "0" },
    }, state.buildings, (readyAtSeconds + 5) * 1_000);

    expect(queue).toMatchObject({
      kind: "building",
      key: "metalMine",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - 108) * 1_000,
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
