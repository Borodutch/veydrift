import { expect, test } from "bun:test";
import { productionPlanContext } from "./productionBuildPlanContext";
import { evaluateProductionPlan, maxAddableProduction } from "./productionBuildPlan";
import type { ChainDefenseState, ChainInfrastructureState, ChainMoonState, ChainShipyardState } from "./walletFlow";

const balance = (metal: string) => ({ metal, crystal: "0", deuterium: "0" });
const ship = { id: 0, count: 0, cost: balance("3000"), durationSeconds: 60 };
const defenseUnit = { id: 0, count: 0, cost: balance("3000"), durationSeconds: 90 };

test("planet ship and defense catalogs share only the selected planet's exact budget", () => {
  const states = {
    shipyard: { wallet: "0x123", homePlanetId: "7", resources: balance("5000"), naniteLevel: 0,
      ships: [ship], shipyardLevel: 9, technologyLevels: { "3": 2 }, queue: null } as ChainShipyardState,
    defense: { wallet: "0x123", homePlanetId: "7", resources: balance("5000"), naniteLevel: 0, missileSiloLevel: 0,
      defenses: [defenseUnit], shipyardLevel: 9, technologyLevels: { "3": 2 }, queue: null } as ChainDefenseState,
    infrastructure: { resourcesAsOfNow: balance("5000") } as ChainInfrastructureState,
    moon: { wallet: "0x123", homePlanetId: "7", queue: null, resourcesAsOfNow: balance("8000"),
      ships: [ship], defenses: [defenseUnit], moon: { exists: true, planetId: "7", owner: "0x123", fields: 10,
        diameterKm: 8000, createdAt: "0", jumpGateReadyAt: "0" },
      buildings: [{ id: 3, key: "shipyard", label: "Shipyard", level: 9, cost: balance("0") }],
      technologyLevels: { "3": 2 } } as ChainMoonState,
  };
  const planet = productionPlanContext("planet", states);
  const moon = productionPlanContext("moon", states);
  expect(maxAddableProduction(planet, [], "ship", 0)).toBe(1);
  expect(maxAddableProduction(planet, [{ kind: "ship", id: 0, quantity: 1 }], "defense", 0)).toBe(0);
  expect(evaluateProductionPlan([{ kind: "ship", id: 0, quantity: 1 }, { kind: "defense", id: 0, quantity: 1 }], planet).reason).toMatch(/Insufficient resources/);
  expect(maxAddableProduction(moon, [{ kind: "ship", id: 0, quantity: 1 }], "defense", 0)).toBe(1);
  expect(moon.ships.some(item => item.label === "Solar Satellite" || item.label === "Crawler")).toBe(false);
});
