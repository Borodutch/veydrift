import { describe, expect, test } from "bun:test";
import { bodyFleetVisibility, planetBuildingTiles, queueLine } from "../src/components/EmpireOverview";
import type { FleetMissionVisibilityResponse } from "../src/walletFlow";

const mission = (id: string, origin: string, target: string, extra: object = {}) =>
  ({ missionId: id, originPlanetId: origin, targetPlanetId: target, ...extra }) as FleetMissionVisibilityResponse["incoming"][number];

describe("empire overview", () => {
  test("scopes missions to the body they arrive at, leave from, or return to", () => {
    const visibility = {
      incoming: [mission("a", "9", "1"), mission("b", "1", "2"), mission("m", "9", "1", { targetIsMoon: true })],
      outgoing: [mission("c", "1", "9"), mission("d", "2", "1")],
      returning: [mission("e", "1", "9"), mission("f", "1", "9", { originIsMoon: true })],
    } as FleetMissionVisibilityResponse;
    const planet = bodyFleetVisibility(visibility, "1", "planet");
    expect([...planet.incoming, ...planet.outgoing, ...planet.returning].map((m) => m.missionId)).toEqual(["a", "c", "e"]);
    const moon = bodyFleetVisibility(visibility, "1", "moon");
    expect([...moon.incoming, ...moon.outgoing, ...moon.returning].map((m) => m.missionId)).toEqual(["m", "f"]);
  });

  test("builds queue lines only for active queues", () => {
    expect(queueLine("ship", null)).toBeUndefined();
    const line = queueLine("defense", { active: true, kind: "defense", itemId: 0, quantity: 5, readyAt: "200", startedAt: "100", cost: { metal: "0", crystal: "0", deuterium: "0" } });
    expect(line).toMatchObject({ kind: "defense", label: "Rocket Launcher ×5", startedAt: 100_000, readyAt: 200_000 });
  });

  test("lists built infrastructure in catalog order, skipping unbuilt levels", () => {
    expect(planetBuildingTiles([{ id: 3, level: 2 }, { id: 0, level: 7 }, { id: 1, level: 0 }]).map((tile) => `${tile.key}:${tile.value}`)).toEqual(["metalMine:7", "solarPlant:2"]);
  });
});
