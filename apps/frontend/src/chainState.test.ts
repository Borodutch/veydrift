import { describe, expect, test } from "bun:test";
import { buildingQueueItemForDisplay, energyBalanceFromChain, infrastructurePlayableState } from "./chainState";
import { createInitialPlayableState, progress } from "./playableMvp";

describe("chainState", () => {
  test("derives stable building queue progress from readyAt and upgrade duration", () => {
    const readyAtSeconds = 1_700_000_060;
    const durationSeconds = 108;
    const halfway = readyAtSeconds * 1_000 - (durationSeconds * 1_000) / 2;
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
      startedAt: (readyAtSeconds - durationSeconds) * 1_000,
    });
    expect(progress(state.queue, halfway)).toBe(0.5);
  });

  test("derives building queue progress from the queues endpoint payload", () => {
    const readyAtSeconds = 1_700_000_060;
    const durationSeconds = 151;
    const quarter = readyAtSeconds * 1_000 - durationSeconds * 750;
    const state = createInitialPlayableState();
    const queue = buildingQueueItemForDisplay({
      active: true,
      kind: "building",
      itemId: 3,
      targetLevel: 1,
      readyAt: readyAtSeconds.toString(),
      cost: { metal: "75", crystal: "30", deuterium: "0" },
    }, state.buildings, quarter);

    expect(queue).toMatchObject({
      kind: "building",
      key: "solarPlant",
      label: "Solar Plant",
      readyAt: readyAtSeconds * 1_000,
      startedAt: (readyAtSeconds - durationSeconds) * 1_000,
    });
    expect(progress(queue, quarter)).toBe(0.25);
  });

  test("adapts contract energy shortage factor for display", () => {
    expect(energyBalanceFromChain({
      produced: "60",
      required: "100",
      scaleBps: "6000",
    })).toEqual({
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

  test("keeps ready building queues complete when startedAt is missing", () => {
    const readyAtSeconds = 1_700_000_060;
    const durationSeconds = 108;
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
      startedAt: (readyAtSeconds - durationSeconds) * 1_000,
    });
    expect(progress(queue, (readyAtSeconds + 5) * 1_000)).toBe(1);
  });
});
