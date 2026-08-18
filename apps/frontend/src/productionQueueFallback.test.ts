import { describe, expect, test } from "bun:test";
import { productionQueueViewModel } from "./components/ProductionCatalog";
import { defenseCatalog, shipCatalog } from "./playableMvp";
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

  test("feeds shared detail queue panels from overview fallbacks when page queues are empty", () => {
    const defenseQueue = activeProductionQueue(null, queueState("defense", 0, 1, {
      readyAt: "1700000120",
      startedAt: "1700000000",
    }), "defense");
    const shipQueue = activeProductionQueue(null, queueState("ship", 0, 2, {
      readyAt: "1700000120",
      startedAt: "1700000000",
    }), "ship");

    expect(productionQueueViewModel(defenseQueue, defenseCatalog)).toMatchObject({
      label: "Rocket Launcher",
      quantity: 1,
      readyAt: "1700000120",
      startedAt: "1700000000",
    });
    expect(productionQueueViewModel(shipQueue, shipCatalog)).toMatchObject({
      label: "Small Cargo",
      quantity: 2,
      readyAt: "1700000120",
      startedAt: "1700000000",
    });
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

  test("uses a matching overview production-timing start when the explicit timestamp is absent", () => {
    const detailedQueue = queueState("defense", 1, 1, { readyAt: "1700000600" });
    const overviewQueue = queueState("defense", 1, 1, {
      readyAt: "1700000600",
      productionTiming: {
        startedAt: "1700000000",
        originalQuantity: 1,
        unitWorkSeconds: "15000000",
        rate: "25000",
      },
    });

    expect(activeProductionQueue(detailedQueue, overviewQueue, "defense")).toMatchObject({
      startedAt: "1700000000",
      productionTiming: overviewQueue.productionTiming,
    });
  });

  test("preserves overview startedAt when the same active defense queue has a newer quantity and ready time", () => {
    const detailedQueue = queueState("defense", 1, 3, { readyAt: "1700000900" });
    const overviewQueue = queueState("defense", 1, 1, {
      readyAt: "1700000600",
      startedAt: "1700000000",
    });

    expect(activeProductionQueue(detailedQueue, overviewQueue, "defense")).toEqual({
      ...detailedQueue,
      startedAt: "1700000000",
    });
  });

  test("does not borrow an unusable overview startedAt for a new active queue timeline", () => {
    const detailedQueue = queueState("defense", 1, 1, { readyAt: "1700000600" });
    const overviewQueue = queueState("defense", 1, 1, {
      readyAt: "1700000500",
      startedAt: "1700000600",
    });

    expect(activeProductionQueue(detailedQueue, overviewQueue, "defense")).toEqual(detailedQueue);
  });

  test("does not borrow per-unit progress from an older same-type queue timeline", () => {
    const detailedQueue = queueState("ship", 1, 2, { readyAt: "1700000900" });
    const overviewQueue = queueState("ship", 1, 1, {
      readyAt: "1700000600",
      startedAt: "1700000000",
      productionTiming: {
        startedAt: "1700000000",
        originalQuantity: 1,
        unitWorkSeconds: "15000000",
        rate: "25000",
      },
      asOfNow: {
        secondsRemaining: 100,
        complete: false,
        completedQuantity: 0,
        remainingQuantity: 1,
        currentUnitSecondsRemaining: 100,
        currentUnitProgressBps: 8333,
        overallProgressBps: 8333,
      },
    });

    expect(activeProductionQueue(detailedQueue, overviewQueue, "ship")).toEqual({
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
