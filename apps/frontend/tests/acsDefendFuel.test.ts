import { describe, expect, test } from "bun:test";
import {
  ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL,
  acsDefendHoldingFuel,
  acsHoldingFuelCost,
} from "../src/fleetMissionRules";
import { emptyMissionShips } from "../src/galaxyActions";

// VEY-KANEO-440: the frontend preview must match VeydriftAllianceSystem._acsHoldingFuelCost and
// counterplayDefenseFuelContext so the compose UX shows the same holding fuel / Alliance Depot
// support the chain charges.
describe("acs defend holding fuel", () => {
  const ships = (overrides: Partial<ReturnType<typeof emptyMissionShips>>) => ({
    ...emptyMissionShips(),
    ...overrides,
  });

  test("returns zero holding fuel when the fleet does not hold", () => {
    expect(acsHoldingFuelCost(ships({ battleship: 5 }), 0)).toBe(0);
    expect(acsHoldingFuelCost(ships({ battleship: 5 }), -100)).toBe(0);
    expect(acsHoldingFuelCost(emptyMissionShips(), 36_000)).toBe(0);
  });

  test("amortizes per-ship tenths-per-hour over the 10-hour window with ceiling rounding", () => {
    // battleship coefficient is 500 tenths/hour; a full 10h hold burns exactly 500 deuterium.
    expect(acsHoldingFuelCost(ships({ battleship: 1 }), 36_000)).toBe(500);
    // 1h hold => 500 * 3600 / 36000 = 50.
    expect(acsHoldingFuelCost(ships({ battleship: 1 }), 3_600)).toBe(50);
    // Tiny holds round up rather than truncating to zero: 500 * 36 / 36000 = 0.5 => 1.
    expect(acsHoldingFuelCost(ships({ battleship: 1 }), 36)).toBe(1);
    // deathstar coefficient is 1; small cargo is 50.
    expect(acsHoldingFuelCost(ships({ deathstar: 1 }), 36_000)).toBe(1);
    expect(acsHoldingFuelCost(ships({ smallCargo: 1 }), 36_000)).toBe(50);
  });

  test("sums coefficients across a mixed fleet", () => {
    // battleship 500 + cruiser 300 + lightFighter 20 = 820 tenths/hour over 10h.
    expect(acsHoldingFuelCost(ships({ battleship: 1, cruiser: 1, lightFighter: 1 }), 36_000)).toBe(820);
  });

  test("Alliance Depot subsidizes holding fuel up to its per-level capacity", () => {
    expect(ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL).toBe(20_000);

    // 10h hold of one battleship costs 500; a level-1 depot fully covers it.
    const covered = acsDefendHoldingFuel(ships({ battleship: 1 }), 36_000, 1);
    expect(covered).toEqual({ holdSeconds: 36_000, holdingFuel: 500, depotSupport: 500, netHoldingFuel: 0 });

    // No depot => the fleet pays the full holding fuel.
    const noDepot = acsDefendHoldingFuel(ships({ battleship: 1 }), 36_000, 0);
    expect(noDepot).toEqual({ holdSeconds: 36_000, holdingFuel: 500, depotSupport: 0, netHoldingFuel: 500 });

    // Holding fuel above the depot capacity is only partially covered (cap = level * 20000).
    const big = acsDefendHoldingFuel(ships({ battleship: 60 }), 36_000, 1); // 60 * 500 = 30000 gross
    expect(big).toEqual({ holdSeconds: 36_000, holdingFuel: 30_000, depotSupport: 20_000, netHoldingFuel: 10_000 });
  });
});
