import { describe, expect, test } from "bun:test";
import { missionDraftBlocker, missionShipOptions, missionTimingSummary } from "./components/MissionCreationPage";
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

const defenseHoldAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "defenseHold",
  label: "Defend",
  mode: "mission",
  mission: "defenseHold",
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

describe("mission creation", () => {
  test("omits expedition-only Pathfinder from the mission ship picker (VEY-KANEO-493)", () => {
    expect(missionShipOptions.some((option) => option.key === "pathfinder")).toBe(false);
    expect(missionShipOptions.some((option) => /pathfinder/i.test(option.label))).toBe(false);
  });

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

  test("blocks fleet launches at the Computer-tech fleet-slot cap and names the lever", () => {
    const base = {
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 50,
    } as const;

    // At the cap: blocked before submit, message shows the ratio and points at Computer Technology.
    const blocked = missionDraftBlocker({ ...base, fleetSlots: { active: 1, limit: 1 } });
    expect(blocked).toBe(
      "Fleet slots full (1/1) — research Computer Technology to raise the limit, or wait for a fleet to return."
    );
    expect(missionDraftBlocker({ ...base, fleetSlots: { active: 3, limit: 3 } })).toContain("Fleet slots full (3/3)");

    // Below the cap: gate passes through to the normal checks.
    expect(missionDraftBlocker({ ...base, fleetSlots: { active: 0, limit: 1 } })).toBeUndefined();

    // Missiles do not consume fleet slots, so a full fleet must not block a missile launch.
    expect(missionDraftBlocker({ ...base, action: missileAction, fleetSlots: { active: 1, limit: 1 } })).toBeUndefined();

    // Fail open when the backend did not provide slot counts; the on-chain revert stays the backstop.
    expect(missionDraftBlocker(base)).toBeUndefined();
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

  test("gates a proactive DefenseHold on ship selection and total (travel + holding) fuel", () => {
    const base = {
      action: defenseHoldAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      totalCargoCapacity: 50_000,
    } as const;

    // No ships selected — blocked like any other fleet mission.
    expect(missionDraftBlocker({
      ...base,
      fuelCost: 0,
      resources: { metal: 0, crystal: 0, deuterium: 100_000 },
      selectedShipCount: 0,
    })).toBe("Choose at least one ship.");

    // Travel fuel plus net holding fuel exceeds the deuterium balance — surfaced before submit.
    expect(missionDraftBlocker({
      ...base,
      fuelCost: 12_000,
      resources: { metal: 0, crystal: 0, deuterium: 5_000 },
      selectedShipCount: 1,
    })).toBe("Need 12,000 deuterium for fuel.");

    // Enough deuterium and capacity — the proactive defend passes the draft gate.
    expect(missionDraftBlocker({
      ...base,
      fuelCost: 3_000,
      resources: { metal: 0, crystal: 0, deuterium: 50_000 },
      selectedShipCount: 1,
    })).toBeUndefined();
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

  test("blocks attacks whose custom loot ratio does not total 100%", () => {
    const base = {
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 100 },
      selectedShipCount: 1,
      totalCargoCapacity: 100,
    };

    expect(missionDraftBlocker({
      ...base,
      lootRatioActive: true,
      lootRatioTotal: 90,
    })).toBe("Loot ratio must total 100%.");

    expect(missionDraftBlocker({
      ...base,
      lootRatioActive: true,
      lootRatioTotal: 100,
    })).toBeUndefined();

    expect(missionDraftBlocker({
      ...base,
      lootRatioActive: false,
      lootRatioTotal: 0,
    })).toBeUndefined();
  });

  const acsDefendAction: Extract<GalaxyAction, { enabled: true }> = {
    enabled: true,
    kind: "acsDefend",
    label: "Group defend",
    mode: "mission",
    mission: "acsDefend",
    ships: { ...attackAction.ships },
  };

  test("blocks an ACS Defend fleet that cannot reach the planet before the attack", () => {
    const base = {
      action: acsDefendAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 10,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 500,
    } as const;

    // Too slow to arrive before the hostile attack lands -> surfaced before submit.
    expect(missionDraftBlocker({ ...base, acsArrivalTooSlow: true })).toBe(
      "Fleet cannot reach the planet before the attack — pick a faster speed or faster ships."
    );

    // The "too slow" gate only applies once ships are chosen (no ship -> earlier gate wins).
    expect(missionDraftBlocker({ ...base, acsArrivalTooSlow: false })).toBeUndefined();

    // Net holding fuel rides in the fleet's deuterium spend, so the caller passes the combined fuel
    // cost; an underfunded fleet is blocked with the combined figure.
    expect(missionDraftBlocker({ ...base, fuelCost: 1_200 })).toBe("Need 1,200 deuterium for fuel.");
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
