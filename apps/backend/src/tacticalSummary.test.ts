import { describe, expect, test } from "bun:test";

import type { PlanetState } from "./evm";
import { deriveBuildingRows, deriveDefenseRows, deriveShipRows } from "./readModels";
import { indexedPlanetTacticalSummary } from "./server";

// Fighting ship ids here include mobile support hulls because cargo/recyclers/colony
// ships can be committed to Attack/Raid combat. Stationary support ids stay excluded.
// Defense id 0 = Rocket Launcher.
const SMALL_CARGO_COST = 2_000 + 2_000 + 0; // 4000
const LIGHT_FIGHTER_COST = 3_000 + 1_000 + 0; // 4000
const RECYCLER_COST = 10_000 + 6_000 + 2_000; // 18000
const COLONY_SHIP_COST = 10_000 + 20_000 + 10_000; // 40000
const LARGE_CARGO_COST = 6_000 + 6_000 + 0; // 12000
const CRUISER_COST = 20_000 + 7_000 + 2_000; // 29000
const ROCKET_LAUNCHER_COST = 2_000 + 0 + 0; // 2000
const STATIONARY_SUPPORT_SHIP_IDS = [9, 15];

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
  test("counts mobile cargo/support hulls as combat power while keeping full ship inventory totals", () => {
    // Cargo, recyclers, and colony ships can be part of an Attack/Raid battle. They
    // must therefore contribute to COMBAT; only stationary support stays excluded.
    const ships = deriveShipRows((id) =>
      id === 0 ? 10
        : id === 1 ? 3
          : id === 2 ? 10
            : id === 3 ? 10
              : id === 4 ? 10
                : id === 6 ? 2
                  : STATIONARY_SUPPORT_SHIP_IDS.includes(id) ? 10
                    : 0
    );
    const defenses = deriveDefenseRows((id) => (id === 0 ? 2 : 0));

    const tactical = indexedPlanetTacticalSummary(testPlanet(), [], ships, defenses, {});

    const combatShipPower =
      10 * SMALL_CARGO_COST
      + 3 * LIGHT_FIGHTER_COST
      + 10 * RECYCLER_COST
      + 10 * COLONY_SHIP_COST
      + 10 * LARGE_CARGO_COST
      + 2 * CRUISER_COST;
    // Inventory totals still include the stationary support ships and their cost.
    expect(tactical.ships.count).toBe(45 + STATIONARY_SUPPORT_SHIP_IDS.length * 10);
    expect(BigInt(tactical.ships.power)).toBeGreaterThan(BigInt(combatShipPower));
    expect(tactical.defenses.count).toBe(2);
    expect(tactical.defenses.power).toBe(String(2 * ROCKET_LAUNCHER_COST));
    expect(tactical.combatShips.count).toBe(45);
    expect(tactical.combatShips.units.map((unit) => unit.id)).toEqual([0, 1, 2, 3, 4, 6]);
    expect(tactical.combatPower).toBe(String(combatShipPower + 2 * ROCKET_LAUNCHER_COST));
  });

  test("a planet holding only stationary support ships reports zero combat power", () => {
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
      deriveShipRows((id) => (STATIONARY_SUPPORT_SHIP_IDS.includes(id) ? 25 : 0)),
      [],
      {}
    );
    expect(allNonCombat.ships.count).toBe(STATIONARY_SUPPORT_SHIP_IDS.length * 25);
    expect(allNonCombat.combatPower).toBe("0");
  });

  test("cargo-only fighting fleets do not read as harmless", () => {
    const tactical = indexedPlanetTacticalSummary(
      testPlanet(),
      [],
      deriveShipRows((id) => (id === 0 ? 3 : id === 4 ? 2 : 0)),
      [],
      {}
    );

    expect(tactical.ships.count).toBe(5);
    expect(tactical.combatShips.count).toBe(5);
    expect(tactical.combatShips.units.map((unit) => unit.id)).toEqual([0, 4]);
    expect(tactical.combatPower).toBe(String(3 * SMALL_CARGO_COST + 2 * LARGE_CARGO_COST));
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
