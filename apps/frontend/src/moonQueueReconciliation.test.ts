import { describe, expect, test } from "bun:test";
import {
  nextProductionQueueCompletionEventMs,
  productionQueueCompletionCandidates,
} from "./PlayableMvpApp";
import { MoonActionStrip, moonShipProductionItems } from "./components/MoonPage";
import type { ChainMoonState, QueueStateResponse } from "./walletFlow";

describe("managed moon queue reconciliation", () => {
  test("includes both moon queues in completion scheduling", () => {
    const moonBuilding = queue("building", 1, "1700000060");
    const moonDefense = queue("defense", 2, "1700000030");
    const candidates = productionQueueCompletionCandidates({ moonBuilding, moonDefense });

    expect(candidates).toContain(moonBuilding);
    expect(candidates).toContain(moonDefense);
    expect(nextProductionQueueCompletionEventMs(candidates, 1_700_000_000_000)).toBe(1_700_000_030_000);
  });
});

describe("managed moon shared catalogs", () => {
  test("shows only stationed ships and marks their shared detail as read-only", () => {
    const items = moonShipProductionItems({
      moonState: {
        fleet: [{
          id: 0,
          count: 3,
          cost: { metal: "2000", crystal: "2000", deuterium: "0" },
        }],
      } as ChainMoonState,
      quantities: {},
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ countValue: 3, key: "smallCargo", readOnly: true });
  });

  test("omits unavailable overview actions instead of rendering disabled controls", () => {
    expect(MoonActionStrip({
      actions: [{
        kind: "attack",
        label: "Attack",
        disabledReason: "No fleet available",
        onClick: () => undefined,
      }],
    })).toBeNull();
  });
});

function queue(kind: "building" | "defense", itemId: number, readyAt: string): QueueStateResponse {
  return {
    active: true,
    cost: { metal: "0", crystal: "0", deuterium: "0" },
    itemId,
    kind,
    quantity: 1,
    readyAt,
    startedAt: "1700000000",
  };
}
