import { describe, expect, test } from "bun:test";
import { missionDraftBlocker, missionTimingSummary } from "./components/MissionCreationPage";
import type { GalaxyAction } from "./galaxyActions";

const attackAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "attack",
  label: "Attack",
  mode: "mission",
  mission: "attack",
  ships: {
    smallCargo: 0,
    lightFighter: 1,
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
  },
};

const missileAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "missileAttack",
  label: "Missile",
  mode: "missile",
  primaryTargetId: 0,
  quantity: 1,
};

describe("mission creation", () => {
  test("requires an origin and selected ships for fleet missions", () => {
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: undefined,
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      selectedShipCount: 1,
      totalCargoCapacity: 0,
    })).toBe("Active origin planet is unavailable.");

    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      selectedShipCount: 0,
      totalCargoCapacity: 0,
    })).toBe("Choose at least one ship.");
  });

  test("checks fuel for fleet missions and missile quantity for missile missions", () => {
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 25,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 10 },
      selectedShipCount: 1,
      totalCargoCapacity: 50,
    })).toBe("Need 25 deuterium for fuel.");

    expect(missionDraftBlocker({
      action: missileAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 0,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      selectedShipCount: 0,
      totalCargoCapacity: 0,
    })).toBe("Choose at least one missile.");
  });

  test("blocks fleet missions when fuel alone exceeds selected ship cargo capacity", () => {
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 230,
      originCoords: { galaxy: 1, system: 294, position: 1 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 50,
    })).toBe("Selected ships have 50 cargo capacity, but this mission needs 230 for fuel.");
  });

  test("blocks cargo drafts that exceed selected ship capacity", () => {
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 100,
      cargoSupported: true,
      cargoTotal: 101,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 1_000, crystal: 1_000, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 150,
    })).toBe("Cargo exceeds available capacity.");
  });

  test("summarizes mission timing with duration first and exact clocks preserved", () => {
    const summary = missionTimingSummary(3_900, Date.UTC(2026, 0, 1, 12, 0, 0));

    expect(summary).toMatchObject({
      arrivalDuration: "1h 5m",
      returnDuration: "2h 10m",
    });
    expect(summary?.arrivalClock).toContain("1:05");
    expect(summary?.returnClock).toContain("2:10");
    expect(missionTimingSummary(0)).toBeNull();
  });
});
