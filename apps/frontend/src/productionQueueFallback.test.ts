import { describe, expect, test } from "bun:test";
import { activeProductionQueue } from "./productionQueueFallback";
import type { QueueStateResponse } from "./walletFlow";

describe("production queue fallback", () => {
  test("uses overview ship queue while detailed shipyard state catches up", () => {
    const queue = queueState("ship", 0, 2);

    expect(activeProductionQueue(null, queue, "ship")).toBe(queue);
    expect(activeProductionQueue(queueState("ship", 2, 1), queue, "ship")?.itemId).toBe(2);
    expect(activeProductionQueue(null, queueState("defense", 0, 2), "ship")).toBeUndefined();
  });

  test("uses overview defense queue while detailed defense state catches up", () => {
    const queue = queueState("defense", 0, 2);

    expect(activeProductionQueue(null, queue, "defense")).toBe(queue);
    expect(activeProductionQueue(queueState("defense", 1, 1), queue, "defense")?.itemId).toBe(1);
    expect(activeProductionQueue(null, queueState("ship", 0, 2), "defense")).toBeUndefined();
  });

  test("preserves overview defense startedAt when detailed defense queue lacks it", () => {
    const detailedQueue = queueState("defense", 1, 1, { readyAt: "1700000600" });
    const overviewQueue = queueState("defense", 1, 1, {
      readyAt: "1700000600",
      startedAt: "1700000000",
    });

    expect(activeProductionQueue(detailedQueue, overviewQueue, "defense")).toEqual({
      ...detailedQueue,
      startedAt: "1700000000",
    });
  });
});

function queueState(
  kind: "defense" | "ship",
  itemId: number,
  quantity: number,
  overrides: Partial<QueueStateResponse> = {},
): QueueStateResponse {
  return {
    active: true,
    kind,
    itemId,
    quantity,
    readyAt: "1700000100",
    cost: {
      metal: "4000",
      crystal: "0",
      deuterium: "0",
    },
    ...overrides,
  };
}
