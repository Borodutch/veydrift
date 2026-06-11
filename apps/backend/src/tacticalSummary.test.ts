import { describe, expect, test } from "bun:test";

import type { PlanetState } from "./evm";
import { deriveDefenseRows, deriveShipRows } from "./readModels";
import { indexedPlanetTacticalSummary } from "./server";

// Ship ids: 1 = Light Fighter (combat), 9 = Solar Satellite (non-combat energy
// platform), 15 = Crawler (non-combat mining support). Defense id 0 = Rocket Launcher.
const LIGHT_FIGHTER_COST = 3_000 + 1_000 + 0; // 4000
const ROCKET_LAUNCHER_COST = 2_000 + 0 + 0; // 2000

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
  test("excludes non-combat ships (Solar Satellites, Crawlers) from combat power and ship count", () => {
    const ships = deriveShipRows((id) => (id === 1 ? 3 : id === 9 ? 10 : id === 15 ? 4 : 0));
    const defenses = deriveDefenseRows((id) => (id === 0 ? 2 : 0));

    const tactical = indexedPlanetTacticalSummary(testPlanet(), [], ships, defenses, {});

    // Only the 3 Light Fighters count as fighting ships; the 10 Solar Satellites and
    // 4 Crawlers are ignored despite carrying a build cost.
    expect(tactical.ships.count).toBe(3);
    expect(tactical.ships.power).toBe(String(3 * LIGHT_FIGHTER_COST));
    expect(tactical.defenses.count).toBe(2);
    expect(tactical.defenses.power).toBe(String(2 * ROCKET_LAUNCHER_COST));
    expect(tactical.combatPower).toBe(String(3 * LIGHT_FIGHTER_COST + 2 * ROCKET_LAUNCHER_COST));
  });

  test("a planet holding only non-combat ships reports zero combat power", () => {
    const ships = deriveShipRows((id) => (id === 9 ? 50 : id === 15 ? 25 : 0));

    const tactical = indexedPlanetTacticalSummary(testPlanet(), [], ships, [], {});

    expect(tactical.ships.count).toBe(0);
    expect(tactical.ships.power).toBe("0");
    expect(tactical.combatPower).toBe("0");
  });
});
