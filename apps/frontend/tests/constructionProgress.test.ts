import { describe, expect, test } from "bun:test";
import {
  constructionQueueState,
  constructionProgressKey,
  projectConstructionProgress,
  selectActiveConstructionQueue,
  type ConstructionQueueObservation,
} from "../src/constructionProgress";
import type { QueueStateResponse } from "../src/walletFlow";

const startedAtSeconds = 1_800_000_000;
const readyAtSeconds = startedAtSeconds + 100;

describe("central construction progress", () => {
  test("projects one canonical percentage and ETA for every consumer", () => {
    const observation = planetBuilding(activeQueue());
    const queues = constructionQueueState([observation]);
    const state = projectConstructionProgress(queues, [observation], (startedAtSeconds + 25) * 1_000);
    const shared = state.get(constructionProgressKey("7", "planet", "building"));

    expect(shared).toMatchObject({
      active: true,
      complete: false,
      indeterminate: false,
      progress: 0.25,
      remaining: "1m 15s",
    });
    // Selector, page card, and queue panel receive this exact projection object.
    expect(state.get(constructionProgressKey("7", "planet", "building"))).toBe(shared);
  });

  test("does not retain a previous queue when the current backend state is unavailable", () => {
    const current = constructionQueueState([planetBuilding(undefined)]);
    const state = projectConstructionProgress(current, [planetBuilding(undefined)], (startedAtSeconds + 60) * 1_000);

    expect(state.get(constructionProgressKey("7", "planet", "building"))).toMatchObject({
      active: false,
      queue: null,
      remaining: "Idle",
    });
  });

  test("clears every surface on a confirmed idle/completed refresh", () => {
    const completed = constructionQueueState([planetBuilding(null)]);
    const state = projectConstructionProgress(completed, [planetBuilding(null)], readyAtSeconds * 1_000);

    expect(state.get(constructionProgressKey("7", "planet", "building"))).toMatchObject({
      active: false,
      progress: 0,
      remaining: "Idle",
      queue: null,
    });
  });

  test("uses the latest observation for a body-scoped queue", () => {
    const rosterQueue = activeQueue();
    const observations = [planetBuilding(rosterQueue), planetBuilding(null)];
    const queues = constructionQueueState(observations);
    const state = projectConstructionProgress(queues, observations, readyAtSeconds * 1_000);

    expect(state.get(constructionProgressKey("7", "planet", "building"))).toMatchObject({
      active: false,
      queue: null,
    });
  });

  test("keeps an active queue visible while one indexed surface catches up", () => {
    const rosterQueue = activeQueue();
    expect(selectActiveConstructionQueue([null, rosterQueue])).toBe(rosterQueue);
    expect(selectActiveConstructionQueue([null, null])).toBeNull();
  });

  test("fills a detailed queue's missing timeline from the matching roster queue", () => {
    const rosterQueue = activeQueue({ asOfNow: { complete: false, secondsRemaining: 75 } });
    const detailedQueue = activeQueue({ asOfNow: undefined, startedAt: undefined });
    const selected = selectActiveConstructionQueue([detailedQueue, rosterQueue]);

    expect(selected).toMatchObject({
      asOfNow: rosterQueue.asOfNow,
      startedAt: rosterQueue.startedAt,
    });
  });

  test("keeps planet and moon construction timelines body-scoped", () => {
    const observations: ConstructionQueueObservation[] = [
      planetBuilding(activeQueue({ itemId: 0 })),
      {
        bodyKind: "moon",
        kind: "moon-building",
        planetId: "7",
        queue: activeQueue({ itemId: 2, readyAt: String(readyAtSeconds + 100) }),
      },
    ];
    const queues = constructionQueueState(observations);
    const state = projectConstructionProgress(queues, observations, (startedAtSeconds + 50) * 1_000);

    expect(state.get(constructionProgressKey("7", "planet", "building"))?.progress).toBe(0.5);
    expect(state.get(constructionProgressKey("7", "moon", "moon-building"))?.progress).toBe(0.25);
    expect(state.get(constructionProgressKey("7", "planet", "building"))?.queue?.itemId).toBe(0);
    expect(state.get(constructionProgressKey("7", "moon", "moon-building"))?.queue?.itemId).toBe(2);
  });

  test("keeps an active queue visible until the backend marks it complete", () => {
    const observation = planetBuilding(activeQueue());
    const queues = constructionQueueState([observation]);
    const partial = projectConstructionProgress(queues, [observation], (readyAtSeconds - 1) * 1_000);
    const ready = projectConstructionProgress(queues, [observation], readyAtSeconds * 1_000);

    expect(partial.get(constructionProgressKey("7", "planet", "building"))?.progress).toBe(0.99);
    expect(ready.get(constructionProgressKey("7", "planet", "building"))).toMatchObject({
      active: true,
      complete: false,
      queue: observation.queue,
    });
  });

  test("clears a backend-confirmed completed queue without waiting for body selection", () => {
    const observation = planetBuilding(activeQueue({
      asOfNow: { complete: true, overallProgressBps: 10_000, secondsRemaining: 0 },
      readyAt: null,
      startedAt: undefined,
    }));
    const queues = constructionQueueState([observation]);
    const state = projectConstructionProgress(queues, [observation], startedAtSeconds * 1_000);

    expect(state.get(constructionProgressKey("7", "planet", "building"))).toMatchObject({
      active: false,
      complete: true,
      queue: null,
      remaining: "Idle",
    });
  });
});

function planetBuilding(queue: QueueStateResponse | null | undefined): ConstructionQueueObservation {
  return { bodyKind: "planet", kind: "building", planetId: "7", queue };
}

function activeQueue(overrides: Partial<QueueStateResponse> = {}): QueueStateResponse {
  return {
    active: true,
    cost: { metal: "100", crystal: "50", deuterium: "0" },
    itemId: 0,
    kind: "building",
    readyAt: String(readyAtSeconds),
    startedAt: String(startedAtSeconds),
    targetLevel: 2,
    ...overrides,
  };
}
