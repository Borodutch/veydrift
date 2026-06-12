import { describe, expect, test } from "bun:test";

import type { PlanetState } from "./evm";
import { deriveBuildingRows, deriveDefenseRows, deriveShipRows } from "./readModels";
import { indexedPlanetTacticalSummary } from "./server";

// Combat ship ids: 1 = Light Fighter, 6 = Cruiser. Non-combat ship ids: 0 = Small Cargo,
// 2 = Recycler, 3 = Colony Ship, 4 = Large Cargo, 9 = Solar Satellite, 15 = Crawler.
// Defense id 0 = Rocket Launcher.
const LIGHT_FIGHTER_COST = 3_000 + 1_000 + 0; // 4000
const CRUISER_COST = 20_000 + 7_000 + 2_000; // 29000
const ROCKET_LAUNCHER_COST = 2_000 + 0 + 0; // 2000
const NON_COMBAT_SHIP_IDS = [0, 2, 3, 4, 9, 15];

function testPlanet(): PlanetState {
  return {
    planetId: "1",
    owner: "0x0000000000000000000000000000000000000001",
    name: "Test",
    galaxy: 1,
    system: 1,
    position: 1,
    fields: 0,
    temperature: 0,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "0",
    resources: { metal: "0", crystal: "0", deuterium: "0" }
  };
}

describe("indexedPlanetTacticalSummary COMBAT fighting strength (VEY-KANEO-450)", () => {
  test("excludes every non-combat ship from combat power while keeping full ship inventory totals", () => {
    // 3 Light Fighters + 2 Cruisers are the only fighting ships. Every non-combat ship
    // id is also stocked (10 each): they must not contribute to combat power, but they
    // remain in the ship inventory count/power (that is just the fleet roster).
    const ships = deriveShipRows((id) =>
      id === 1 ? 3 : id === 6 ? 2 : NON_COMBAT_SHIP_IDS.includes(id) ? 10 : 0
    );
    const defenses = deriveDefenseRows((id) => (id === 0 ? 2 : 0));

    const tactical = indexedPlanetTacticalSummary(testPlanet(), [], ships, defenses, {});

    const combatShipPower = 3 * LIGHT_FIGHTER_COST + 2 * CRUISER_COST;
    // Inventory totals still include the 60 non-combat ships and their cost.
    expect(tactical.ships.count).toBe(5 + NON_COMBAT_SHIP_IDS.length * 10);
    expect(BigInt(tactical.ships.power)).toBeGreaterThan(BigInt(combatShipPower));
    expect(tactical.defenses.count).toBe(2);
    expect(tactical.defenses.power).toBe(String(2 * ROCKET_LAUNCHER_COST));
    // COMBAT counts only the fighting ships + defenses.
    expect(tactical.combatPower).toBe(String(combatShipPower + 2 * ROCKET_LAUNCHER_COST));
  });

  test("a planet holding only non-combat ships (incl. a lone solar satellite) reports zero combat power", () => {
    // Mirrors the reported "Gojo" case: 1 Solar Satellite, no defenses -> COMBAT must be 0
    // even though the planet still shows 1 ship in its inventory.
    const loneSatellite = indexedPlanetTacticalSummary(
      testPlanet(),
      [],
      deriveShipRows((id) => (id === 9 ? 1 : 0)),
      [],
      {}
    );
    expect(loneSatellite.ships.count).toBe(1);
    expect(loneSatellite.combatPower).toBe("0");

    const allNonCombat = indexedPlanetTacticalSummary(
      testPlanet(),
      [],
      deriveShipRows((id) => (NON_COMBAT_SHIP_IDS.includes(id) ? 25 : 0)),
      [],
      {}
    );
    expect(allNonCombat.ships.count).toBe(NON_COMBAT_SHIP_IDS.length * 25);
    expect(allNonCombat.combatPower).toBe("0");
  });
});

describe("indexedPlanetTacticalSummary LOOT vs gross resources (VEY-KANEO-454)", () => {
  // The recurring QA bounce reads LOOT (~50% of a planet's public resources) as missing
  // production accrual. It is not: accrual is applied at the call site and LOOT is then the
  // deliberate ~50% on-chain plunder rate (RAID_PLUNDER_BPS = 5000, RAID_PROTECTED_STORAGE_BPS = 0).
  // `grossResourceTotal` exposes the full accrued stockpile LOOT is plundered from so the UI
  // can show the math; this test pins LOOT == 50% of gross so the invariant cannot regress.
  test("raidableResourceTotal is ~50% of the full accrued grossResourceTotal", () => {
    const planet: PlanetState = { ...testPlanet(), resources: { metal: "1000", crystal: "500", deuterium: "100" } };
    // At least one building so the plunder-rate path (deriveInfrastructureFields) runs.
    const buildings = deriveBuildingRows((id) => (id === 0 ? 1 : 0));

    const tactical = indexedPlanetTacticalSummary(planet, buildings, [], [], {});

    // Full accrued public stockpile = 1000 + 500 + 100 = 1600.
    expect(tactical.grossResourceTotal).toBe("1600");
    // LOOT = 50% plunder of the unprotected (all, since protected storage = 0) accrued base.
    expect(tactical.raidableResourceTotal).toBe("800");
    expect(BigInt(tactical.raidableResourceTotal) * 2n).toBe(BigInt(tactical.grossResourceTotal));
  });
});
