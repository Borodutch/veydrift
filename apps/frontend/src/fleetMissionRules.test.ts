import { describe, expect, test } from "bun:test";

import {
  LOCAL_HARVEST_DISTANCE,
  fleetMissionDistance,
  fleetMissionDistanceForMission,
  fleetMissionFuelCost,
  fleetMissionTravelSeconds,
} from "./fleetMissionRules";
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

describe("fleetMissionDistance", () => {
  const coords = { galaxy: 6, system: 3, position: 5 };

  test("uses OGame classic distance 5 for local planet-moon travel", () => {
    expect(fleetMissionDistance(coords, coords, { originIsMoon: false, targetIsMoon: true })).toBe(5);
    expect(fleetMissionDistance(coords, coords, { originIsMoon: true, targetIsMoon: false })).toBe(5);
  });

  test("keeps same-body same-coordinate distance at zero for legacy callers", () => {
    expect(fleetMissionDistance(coords, coords)).toBe(0);
    expect(fleetMissionDistance(coords, coords, { originIsMoon: true, targetIsMoon: true })).toBe(0);
  });

  test("prices same-planet Harvest through the canonical non-zero local route", () => {
    const ships = { ...noShips, recycler: 1 };
    const distance = fleetMissionDistanceForMission(coords, coords, "harvest");

    expect(distance).toBe(LOCAL_HARVEST_DISTANCE);
    expect(fleetMissionFuelCost(ships, distance)).toBeGreaterThan(0);
    expect(fleetMissionTravelSeconds(distance, ships)).toBeGreaterThan(10);
    expect(fleetMissionDistanceForMission(coords, coords, "transport")).toBe(0);
  });
});
