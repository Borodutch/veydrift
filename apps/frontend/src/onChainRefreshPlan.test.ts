import { describe, expect, test } from "bun:test";
import {
  currentPlanetTransactionInputsAvailable,
  shouldRefreshAllianceStateForPage,
} from "./PlayableMvpApp";

const playableMvpAppSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();

describe("shouldRefreshAllianceStateForPage", () => {
  test("loads alliance membership for Mission Control and Raid Finder before the Alliance tab is opened", () => {
    expect(shouldRefreshAllianceStateForPage("mission-control")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("raid-target-finder")).toBe(true);
  });
});

describe("currentPlanetTransactionInputsAvailable", () => {
  test("blocks planet-scoped transactions until the selected planet has a fresh snapshot", () => {
    expect(currentPlanetTransactionInputsAvailable(true, false)).toBe(false);
    expect(currentPlanetTransactionInputsAvailable(true, true)).toBe(true);
    expect(currentPlanetTransactionInputsAvailable(false, true)).toBe(false);
  });

  test("does not turn backend maintenance telemetry into a frontend transaction lock", () => {
    expect(playableMvpAppSource).not.toContain("gameMaintenancePaused");
    expect(playableMvpAppSource).not.toContain("GAME_MAINTENANCE_MESSAGE");
  });
});
