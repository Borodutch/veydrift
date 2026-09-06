import { describe, expect, test } from "bun:test";

import {
  LOCAL_HARVEST_DISTANCE,
  fleetMissionAvailableCargoCapacity,
  fleetMissionCargoCapacity,
  fleetMissionDistance,
  fleetMissionDistanceForMission,
  fleetMissionFuelCost,
  fleetMissionTravelSeconds,
  interplanetaryMissileRange,
  interplanetaryMissileSystemDistance,
  interplanetaryMissileTravelSeconds,
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

describe("fleet mission cargo capacity", () => {
  test("includes combat-ship holds and reserves their deuterium fuel", () => {
    const ships = {
      ...noShips,
      heavyFighter: 5,
      cruiser: 2,
      battleship: 1,
    };
    const distance = 1_025;
    const fuel = fleetMissionFuelCost(ships, distance);

    expect(fleetMissionCargoCapacity(ships)).toBe(3_600);
    expect(fuel).toBe(161);
    expect(fleetMissionAvailableCargoCapacity(ships, distance)).toBe(3_600 - fuel);
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

describe("interplanetaryMissileRange", () => {
  test("mirrors the contract's exact Impulse Drive range and same-galaxy rule", () => {
    expect(interplanetaryMissileRange(0)).toBe(0);
    expect(interplanetaryMissileRange(1)).toBe(4);
    expect(interplanetaryMissileRange(4)).toBe(19);
    expect(interplanetaryMissileSystemDistance(
      { galaxy: 2, system: 7, position: 4 },
      { galaxy: 2, system: 26, position: 11 },
    )).toBe(19);
    expect(interplanetaryMissileSystemDistance(
      { galaxy: 2, system: 7, position: 4 },
      { galaxy: 3, system: 7, position: 4 },
    )).toBeNull();
  });
});

describe("interplanetaryMissileTravelSeconds", () => {
  test("matches classic OGame same-system and cross-system flight times", () => {
    expect(interplanetaryMissileTravelSeconds(0)).toBe(30);
    expect(interplanetaryMissileTravelSeconds(1)).toBe(90);
    expect(interplanetaryMissileTravelSeconds(10)).toBe(630);
    expect(interplanetaryMissileTravelSeconds(10, 2)).toBe(315);
  });
});
