import { describe, expect, test } from "bun:test";

import { fleetMissionFuelCost } from "./fleetMissionRules";
import type { MissionShips } from "./galaxyActions";

const noShips = {
  smallCargo: 0,
  lightFighter: 0,
  recycler: 0,
  colonyShip: 0,
  largeCargo: 0,
  heavyFighter: 0,
  cruiser: 0,
  battleship: 0,
  bomber: 0,
  destroyer: 0,
  deathstar: 0,
  battlecruiser: 0,
  reaper: 0,
  pathfinder: 0,
} satisfies MissionShips;

describe("fleetMissionFuelCost", () => {
  test("matches OGame-style single-ship fuel", () => {
    expect(fleetMissionFuelCost({ ...noShips, smallCargo: 1 }, 1_025)).toBe(2);
  });

  test("charges mixed fleets per ship speed instead of aggregate fleet consumption", () => {
    expect(fleetMissionFuelCost({ ...noShips, smallCargo: 1, lightFighter: 1 }, 1_025)).toBe(4);
    expect(fleetMissionFuelCost({ ...noShips, deathstar: 1, lightFighter: 100 }, 20_000)).toBe(1_360);
    expect(fleetMissionFuelCost({ ...noShips, recycler: 1, battleship: 100 }, 20_000)).toBe(60_527);
    expect(fleetMissionFuelCost({ ...noShips, deathstar: 1, battleship: 100 }, 20_000)).toBe(34_575);
  });

  test("keeps the selected speed discount per ship", () => {
    expect(fleetMissionFuelCost({ ...noShips, deathstar: 1, lightFighter: 100 }, 20_000, {}, 50)).toBeLessThan(
      fleetMissionFuelCost({ ...noShips, deathstar: 1, lightFighter: 100 }, 20_000),
    );
  });
});
