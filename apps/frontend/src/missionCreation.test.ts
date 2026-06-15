import { describe, expect, test } from "bun:test";
import {
  forecastRaidLoot,
  initialMissionShips,
  lootRatioFromUpToAmount,
  missionDraftBlocker,
  missionShipOptions,
  missionTimingSummary,
  publicTargetBattleForecast,
  rebalanceLootRatio,
  ShipQuantityRow,
  stationedDefenderCompositionUnits,
  TargetIntelCard,
  targetResourceIntel,
} from "./components/MissionCreationPage";
import type { GalaxyAction } from "./galaxyActions";
import type { Planet } from "./types";

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

  test("starts attack mission ship quantities at zero instead of prefilling Heavy Fighter", () => {
    const initial = initialMissionShips({
      ...attackAction,
      ships: {
        ...attackAction.ships,
        heavyFighter: 1,
        smallCargo: 1,
      },
    });

    expect(initial.heavyFighter).toBe(0);
    expect(initial.smallCargo).toBe(0);
    expect(Object.values(initial).every((count) => count === 0)).toBe(true);
  });

  test("renders attack target intel with planet image, coordinates, commander, and alliance", () => {
    const node = TargetIntelCard({
      coords: { galaxy: 7, system: 41, position: 6 },
      target: targetPlanet(),
    });
    const text = collectText(node).join(" ");
    const images = findElements(node, "img");

    expect(text).toContain("Target");
    expect(text).toContain("New Zion");
    expect(text).toContain("[7:41:6]");
    expect(text).toContain("Commander Vey");
    expect(text).toContain("Veydrift [VEY]");
    expect(text).toContain("#9");
    expect(images.some((image) => image.props?.src === "/assets/game/style-pass/generated/planets/hot-desert.webp")).toBe(true);
  });

  test("renders ship quantity rows with image assets, keyboard input, / N availability, and steppers", () => {
    const heavyFighter = missionShipOptions.find((option) => option.key === "heavyFighter");
    expect(heavyFighter).toBeDefined();

    const row = ShipQuantityRow({
      onChange: () => undefined,
      owned: 5,
      ship: heavyFighter!,
      value: 0,
    });
    const text = collectText(row).join(" ").replace(/\s+/g, " ");
    const buttons = findElements(row, "button");
    const inputs = findElements(row, "input");
    const images = findElements(row, "img");

    expect(text).toContain("Heavy Fighter");
    expect(text).toContain("/ 5");
    expect(buttons.map((button) => button.props?.["aria-label"])).toEqual([
      "Decrease Heavy Fighter",
      "Increase Heavy Fighter",
    ]);
    expect(inputs[0]?.props).toMatchObject({
      "aria-label": "Heavy Fighter quantity",
      inputMode: "numeric",
      max: 5,
      min: 0,
      type: "number",
      value: 0,
    });
    expect(images[0]?.props?.src).toBe(heavyFighter?.asset);
  });

  test("rebalances loot percentages and up-to amount edits to exactly 100%", () => {
    expect(rebalanceLootRatio({ metal: 34, crystal: 33, deuterium: 33 }, "metal", 80)).toEqual({
      metal: 80,
      crystal: 10,
      deuterium: 10,
    });

    expect(lootRatioFromUpToAmount({ metal: 34, crystal: 33, deuterium: 33 }, "crystal", 500, 2_000)).toEqual({
      metal: 38,
      crystal: 25,
      deuterium: 37,
    });
  });

  test("forecasts greedy and custom attack loot with contract-style rollover", () => {
    const lootable = { metal: 500, crystal: 300, deuterium: 100 };

    expect(forecastRaidLoot(lootable, 600, null)).toEqual({
      metal: 500,
      crystal: 100,
      deuterium: 0,
    });

    expect(forecastRaidLoot(lootable, 600, { metal: 10, crystal: 80, deuterium: 10 })).toEqual({
      metal: 240,
      crystal: 300,
      deuterium: 60,
    });
  });

  test("builds target resource intel from public resources and projects lootable arrival state", () => {
    const intel = targetResourceIntel(targetPlanet({
      publicState: {
        resources: { metal: "1000", crystal: "500", deuterium: "200" },
        buildings: [
          { id: 0, level: 2 },
          { id: 1, level: 1 },
          { id: 2, level: 1 },
          { id: 3, level: 10 },
        ],
        fleet: [],
        defenses: [],
        research: [{ id: 0, level: 1 }],
        queues: null,
      },
    }), 3_600);

    expect(intel.current).toEqual({ metal: 1_000, crystal: 500, deuterium: 200 });
    expect(intel.currentLootable).toEqual({ metal: 500, crystal: 250, deuterium: 100 });
    expect(intel.projectedArrival?.metal).toBeGreaterThan(1_000);
    expect(intel.projectedArrivalLootable?.metal).toBeGreaterThan(500);
    expect(intel.projectionDetail).toContain("assume no new production");
  });

  test("forecasts public battle outcome without inventing hidden target state", () => {
    expect(publicTargetBattleForecast(attackAction.ships, targetPlanet()).kind).toBe("uncertain");

    const selectedShips = {
      ...attackAction.ships,
      cruiser: 3,
    };
    expect(publicTargetBattleForecast(selectedShips, targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [],
        buildings: [],
        research: [],
        queues: null,
      },
    }))).toMatchObject({ kind: "win", label: "Probable win" });

    expect(publicTargetBattleForecast({ ...attackAction.ships, lightFighter: 1 }, targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [{ id: 6, count: 3 }],
        buildings: [],
        research: [],
        queues: null,
      },
    }))).toMatchObject({ kind: "defeat", label: "Probable defeat" });
  });

  test("includes public stationed defenders in attack intel and battle forecast", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [],
        stationedDefenders: [{
          missionId: "held-1",
          defender: "0xdefender",
          defenderDisplayName: "Defender",
          ships: { lightFighter: "40", cruiser: "2" },
          holdUntil: "1700003600",
          allianceDepotLevel: 1,
        }],
        buildings: [],
        research: [],
        queues: null,
      },
    });
    const selectedShips = { ...attackAction.ships, lightFighter: 1 };
    const units = stationedDefenderCompositionUnits(target.publicState?.stationedDefenders);

    expect(publicTargetBattleForecast(selectedShips, target)).toMatchObject({
      kind: "defeat",
      label: "Probable defeat",
    });
    expect(units).toEqual([
      expect.objectContaining({ key: "lightFighter", label: "Light Fighter", count: 40 }),
      expect.objectContaining({ key: "cruiser", label: "Cruiser", count: 2 }),
    ]);
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

function targetPlanet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: "9",
    name: "New Zion",
    type: "hot-desert",
    image: "/assets/game/style-pass/generated/planets/hot-desert.webp",
    position: 6,
    galaxy: 7,
    system: 41,
    owner: "0x5e7eec50657a5f283b7e33869af22999cdc9356",
    ownerId: "0x5e7eec50657a5f283b7e33869af22999cdc9356",
    alliance: { allianceId: "1", tag: "VEY", name: "Veydrift" },
    occupiedBy: {
      planetId: "9",
      owner: "0x5e7eec50657a5f283b7e33869af22999cdc9356",
      ownerDisplayName: "Commander Vey",
      alliance: { allianceId: "1", tag: "VEY", name: "Veydrift" },
    },
    debrisField: null,
    moonChance: null,
    publicState: null,
    resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
    temperature: { min: 40, max: 80 },
    diameter: 12_800,
    fields: 163,
    hasMoon: false,
    ...overrides,
  };
}

type FoundElement = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function findElements(node: unknown, tag: string): FoundElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, tag));
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    return findElements(render({ ...(vnode.props ?? {}) }), tag);
  }
  const self = vnode.type === tag ? [vnode] : [];
  return self.concat(findElements(vnode.props?.children, tag));
}

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [String(node)];
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown; title?: unknown; "aria-label"?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    return collectText(render({ ...(vnode.props ?? {}) }));
  }
  const labels = typeof vnode.type === "string"
    ? [vnode.props?.title, vnode.props?.["aria-label"]].filter((value): value is string => typeof value === "string")
    : [];
  return labels.concat(collectText(vnode.props?.children));
}
