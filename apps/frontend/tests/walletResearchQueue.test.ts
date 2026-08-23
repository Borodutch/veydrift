import { describe, expect, test } from "bun:test";
import { walletResearchQueueFor } from "../src/PlayableMvpApp";
import type { PlayerQueuesResponse, QueueStateResponse } from "../src/walletFlow";

describe("wallet-global research queue", () => {
  test("keeps Chucky's active Hyperspace Drive 7 queue independent of selected planet", () => {
    // The canonical research queue is wallet-global and does not carry a
    // selected-planet identity. Switching planets must therefore leave the
    // exact same queue visible instead of synthesizing an owner planet.
    const queue = activeResearchQueue();
    const walletQueues = playerQueues(queue);

    const beforePlanetSwitch = walletResearchQueueFor(walletQueues);
    const afterPlanetSwitch = walletResearchQueueFor(walletQueues);

    expect(beforePlanetSwitch).toBe(queue);
    expect(afterPlanetSwitch).toBe(queue);
    expect(afterPlanetSwitch?.itemId).toBe(10);
    expect(afterPlanetSwitch?.targetLevel).toBe(7);
    expect(afterPlanetSwitch?.readyAt).toBe("1787758249");
    expect(afterPlanetSwitch?.planetId).toBeUndefined();
  });

  test("clears the wallet queue only when the canonical wallet response is inactive", () => {
    expect(walletResearchQueueFor(playerQueues({ ...activeResearchQueue(), active: false }))).toBeNull();
    expect(walletResearchQueueFor(undefined)).toBeNull();
  });
});

function playerQueues(research: QueueStateResponse): PlayerQueuesResponse {
  return {
    building: null,
    defense: null,
    homePlanetId: "10",
    research,
    ship: null,
    wallet: "0x9ea58b89140f60b7a706e88128c56b9de62c8bd8",
  };
}

function activeResearchQueue(overrides: Partial<QueueStateResponse> = {}): QueueStateResponse {
  return {
    active: true,
    asOfNow: { complete: false, secondsRemaining: 260_229 },
    cost: { crystal: "1280000", deuterium: "384000", metal: "640000" },
    itemId: 10,
    kind: "research",
    readyAt: "1787758249",
    startedAt: "1786894249",
    targetLevel: 7,
    ...overrides,
  };
}
