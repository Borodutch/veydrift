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
    const moonShip = queue("ship", 0, "1700000020");
    const candidates = productionQueueCompletionCandidates({ moonBuilding, moonDefense, moonShip });

    expect(candidates).toContain(moonBuilding);
    expect(candidates).toContain(moonDefense);
    expect(candidates).toContain(moonShip);
    expect(nextProductionQueueCompletionEventMs(candidates, 1_700_000_000_000)).toBe(1_700_000_020_000);
  });
});

describe("managed moon shared catalogs", () => {
  test("shows moon-buildable ships even at zero inventory with a build action", () => {
    const items = moonShipProductionItems({
      moonState: {
        wallet: "0x123",
        homePlanetId: "7",
        moon: { exists: true, planetId: "7", owner: "0x123", fields: 10, diameterKm: 8000, createdAt: "0", jumpGateReadyAt: "0" },
        resources: { metal: "20000", crystal: "20000", deuterium: "20000" },
        resourcesAsOfNow: { metal: "20000", crystal: "20000", deuterium: "20000" },
        ships: [{ id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" }, durationSeconds: 60 }],
        buildings: [{ id: 3, key: "shipyard", label: "Shipyard", level: 9, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
        queue: null,
        defenses: [],
        technologyLevels: { "3": 2 },
      } as ChainMoonState,
      quantities: {},
    });

    expect(items.find(item => item.key === "smallCargo")).toMatchObject({ countValue: 0, key: "smallCargo", disabled: false });
    expect(items.some(item => item.key === "solarSatellite" || item.key === "crawler")).toBe(false);
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

function queue(kind: "building" | "defense" | "ship", itemId: number, readyAt: string): QueueStateResponse {
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
