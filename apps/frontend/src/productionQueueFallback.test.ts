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
});

function queueState(kind: "defense" | "ship", itemId: number, quantity: number): QueueStateResponse {
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
  };
}
