import { describe, expect, test } from "bun:test";
import {
  advanceState,
  createInitialGameState,
  getActionReason,
  loadGameState,
  startBuilding,
  startResearch
} from "../src/gameState";

describe("gameState", () => {
  test("allows available building and research starts", () => {
    const now = 1_000;
    const building = startBuilding(createInitialGameState(), "alloy-mine", now);

    expect(building.ok).toBe(true);

    if (!building.ok) {
      return;
    }

    expect(building.state.queue).toHaveLength(1);
    expect(building.state.resources.alloy).toBe(480);

    const research = startResearch(building.state, "orbital-cartography", now);

    expect(research.ok).toBe(true);
  });

  test("blocks locked research until requirements are met", () => {
    const state = createInitialGameState();
    const result = startResearch(state, "adaptive-foundries", 1_000);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.reason).toBe("locked");
  });

  test("blocks insufficient resource actions", () => {
    const state = {
      ...createInitialGameState(),
      resources: {
        alloy: 0,
        energy: 0,
        data: 0,
        crew: 0
      }
    };

    const result = startBuilding(state, "alloy-mine", 1_000);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.reason).toBe("insufficient-resources");
  });

  test("reports pending state while an action is queued", () => {
    const now = 1_000;
    const result = startBuilding(createInitialGameState(), "alloy-mine", now);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(
      getActionReason(result.state, {
        id: "alloy-mine",
        name: "Alloy Mine",
        role: "Resource",
        maxLevel: 5,
        baseSeconds: 12,
        cost: { alloy: 160, energy: 60, crew: 12 },
        effect: ""
      }, "building")
    ).toBe("pending");
  });

  test("completes queued building and research after their timers", () => {
    const now = 1_000;
    const building = startBuilding(createInitialGameState(), "alloy-mine", now);

    expect(building.ok).toBe(true);

    if (!building.ok) {
      return;
    }

    const research = startResearch(building.state, "orbital-cartography", now);

    expect(research.ok).toBe(true);

    if (!research.ok) {
      return;
    }

    const advanced = advanceState(research.state, now + 13_000);

    expect(advanced.buildings["alloy-mine"]).toBe(2);
    expect(advanced.research["orbital-cartography"]).toBe(1);
    expect(advanced.queue).toHaveLength(0);
  });

  test("hydrates persisted state and falls back on invalid storage", () => {
    const state = createInitialGameState();
    const loaded = loadGameState(JSON.stringify({
      ...state,
      resources: { ...state.resources, alloy: 321 }
    }));

    expect(loaded.resources.alloy).toBe(321);
    expect(loadGameState("{bad json").resources.alloy).toBe(state.resources.alloy);
  });
});
