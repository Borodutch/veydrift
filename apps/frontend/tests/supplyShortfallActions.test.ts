import { describe, expect, test } from "bun:test";
import { defenseProductionItems } from "../src/components/DefensePage";
import { shipProductionItems } from "../src/components/ShipyardPage";
import type { ChainDefenseState, ChainShipyardState } from "../src/walletFlow";

const appSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
const infrastructureSource = await Bun.file(new URL("../src/components/InfrastructurePage.tsx", import.meta.url)).text();
const researchSource = await Bun.file(new URL("../src/components/ResearchPage.tsx", import.meta.url)).text();
const structureSource = await Bun.file(new URL("../src/components/StructureCatalog.tsx", import.meta.url)).text();

describe("resource-shortfall Supply actions", () => {
  test("targets the selected planet and forwards the prefilled request to the existing Supply modal", () => {
    expect(appSource).toContain("handleOpenBatchSupply(selectedManagedPlanet, resources)");
    expect(appSource).toContain("initialRequested={batchSupplyInitialRequested}");
    expect(appSource.match(/onSupply=\{handleSupplyCurrentPlanet\}/g)).toHaveLength(4);
    expect(appSource).toContain("batchSupplySourceLoadIdRef.current !== sourceLoadId");
    expect(appSource).toContain("order.originPlanetId === target.planetId");
  });

  test("keeps Infrastructure and Research Supply inline to the right of the primary action", () => {
    expect(infrastructureSource).toContain("secondaryAction={supplyShortfall && onSupply");
    expect(structureSource).toContain('secondaryAction ? "grid-cols-2" : "grid-cols-1"');
    expect(researchSource).toContain('supplyRequest && onSupply ? "grid-cols-2" : "grid-cols-1"');
    expect(researchSource.indexOf("{status.actionLabel}")).toBeLessThan(researchSource.indexOf(">\n            Supply\n"));
  });

  test("requires authoritative Infrastructure and Research costs and balances", () => {
    expect(infrastructureSource).toContain("supplyResourceShortfall(spendableResources, chainCost)");
    expect(researchSource).toContain("supplyResourceShortfall(spendableResources, chainCost)");
  });

  test("uses the selected ship quantity when prefilling missing resources", () => {
    const items = shipProductionItems({
      actionPending: false,
      canTransact: true,
      productionAvailable: true,
      quantities: { smallCargo: 3 },
      queue: undefined,
      resources: { metal: 2_500, crystal: 1_000, deuterium: 0 },
      shipyardLevel: 5,
      shipyardState: shipyardState(),
    });

    expect(items.find((item) => item.key === "smallCargo")?.supplyRequest).toEqual({
      metal: 3_500,
      crystal: 5_000,
      deuterium: 0,
    });
  });

  test("uses the selected defense quantity and omits Supply once affordable", () => {
    const expensive = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState(),
      productionAvailable: true,
      quantities: { rocketLauncher: 4 },
      queue: undefined,
      resources: { metal: 3_000, crystal: 10_000, deuterium: 10_000 },
    });
    const affordable = defenseProductionItems({
      actionPending: false,
      canTransact: true,
      defenseState: defenseState(),
      productionAvailable: true,
      quantities: { rocketLauncher: 4 },
      queue: undefined,
      resources: { metal: 8_000, crystal: 0, deuterium: 0 },
    });

    expect(expensive.find((item) => item.key === "rocketLauncher")?.supplyRequest).toEqual({
      metal: 5_000,
      crystal: 0,
      deuterium: 0,
    });
    expect(affordable.find((item) => item.key === "rocketLauncher")?.supplyRequest).toBeUndefined();
  });
});

function shipyardState(): ChainShipyardState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    productionAvailable: true,
    resources: { metal: "2500", crystal: "1000", deuterium: "0" },
    shipyardLevel: 5,
    ships: [{ id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" } }],
    buildingLevels: {},
    technologyLevels: { "3": 2 },
    queue: null,
  };
}

function defenseState(): ChainDefenseState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    productionAvailable: true,
    resources: { metal: "3000", crystal: "10000", deuterium: "10000" },
    shipyardLevel: 2,
    missileSiloLevel: 0,
    defenses: [{ id: 0, count: 0, cost: { metal: "2000", crystal: "0", deuterium: "0" } }],
    technologyLevels: {},
    queue: null,
  };
}
