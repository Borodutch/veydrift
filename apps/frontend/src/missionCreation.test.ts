import { describe, expect, test } from "bun:test";
import {
  AttackIntelPanel,
  AttackOutcomePanel,
  DestinationIntelPanel,
  forecastRaidLoot,
  initialMissionShips,
  LootRatioControls,
  lootRatioFromUpToAmount,
  missionConfirmButtonLabel,
  missionDraftBlocker,
  missionShipOptions,
  missionTimingSummary,
  NonAttackMissionIntelPanel,
  publicTargetBattleForecast,
  rebalanceLootRatio,
  ShipQuantityRow,
  shouldShowDestinationIntel,
  shouldShowReturnTiming,
  staleSelectedShipQuantityBlocker,
  stationedDefenderCompositionUnits,
  TargetIntelCard,
  targetResourceIntel,
} from "./components/MissionCreationPage";
import type { GalaxyAction } from "./galaxyActions";
import type { Planet } from "./types";

const missionCreationSource = await Bun.file(new URL("./components/MissionCreationPage.tsx", import.meta.url)).text();

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

const deployAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "deploy",
  label: "Deploy",
  mode: "mission",
  mission: "deploy",
  ships: {
    smallCargo: 1,
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
  },
};

const transportAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "transport",
  label: "Transport",
  mode: "mission",
  mission: "transport",
  ships: {
    smallCargo: 1,
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
  },
};

const harvestAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "harvest",
  label: "Harvest",
  mode: "mission",
  mission: "harvest",
  ships: {
    smallCargo: 0,
    lightFighter: 0,
    recycler: 1,
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

const colonizeAction: Extract<GalaxyAction, { enabled: true }> = {
  enabled: true,
  kind: "colonize",
  label: "Colonize",
  mode: "colonize",
  ships: {
    smallCargo: 0,
    lightFighter: 0,
    recycler: 0,
    colonyShip: 1,
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

  test("keeps attack confirm visibly pending while transaction and indexing settle", () => {
    expect(missionConfirmButtonLabel({ actionPendingLabel: "Attack mission: syncing indexed state..." }))
      .toBe("Attack mission: syncing indexed state...");
    expect(missionConfirmButtonLabel({ joinAttackMode: true })).toBe("Join Attack");
    expect(missionConfirmButtonLabel({ acsDefendMode: true })).toBe("Coordinate defense");
    expect(missionCreationSource).toContain("actionPendingLabel?: string | undefined;");
    expect(missionCreationSource).toContain("disabled={Boolean(blockedReason) || actionPending}");
    expect(missionCreationSource).toContain("const visibleBlockedReason = actionPending ? undefined : blockedReason;");
    expect(missionCreationSource).toContain("missionConfirmButtonLabel({");
    expect(missionCreationSource).toContain("if (actionPendingLabel) return actionPendingLabel;");
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

  test("builds target resource intel from backend production and projects lootable arrival state", () => {
    const intel = targetResourceIntel(targetPlanet({
      publicState: {
        resources: { metal: "1000", crystal: "500", deuterium: "200" },
        productionPerHour: { metal: "120", crystal: "60", deuterium: "24" },
        storageCaps: { metal: "2000", crystal: "1000", deuterium: "300" },
        buildings: null,
        fleet: [],
        defenses: [],
        research: [{ id: 0, level: 1 }],
        queues: null,
      },
    }), 3_600);

    expect(intel.current).toEqual({ metal: 1_000, crystal: 500, deuterium: 200 });
    expect(intel.currentLootable).toEqual({ metal: 500, crystal: 250, deuterium: 100 });
    expect(intel.projectedArrival).toEqual({ metal: 1_120, crystal: 560, deuterium: 224 });
    expect(intel.projectedArrivalLootable).toEqual({ metal: 560, crystal: 280, deuterium: 112 });
    expect(intel.projectionDetail).toContain("public production rate");
  });

  test("projects public building production with energy shortage reflected", () => {
    const intel = targetResourceIntel(targetPlanet({
      publicState: {
        resources: { metal: "1000", crystal: "500", deuterium: "200" },
        productionPerHour: null,
        storageCaps: null,
        buildings: [
          { id: 0, level: 2 },
          { id: 3, level: 1 },
        ],
        fleet: [],
        defenses: [],
        research: [],
        queues: null,
      },
    }), 3_600);

    expect(intel.current).toEqual({ metal: 1_000, crystal: 500, deuterium: 200 });
    expect(intel.projectedArrival).toEqual({ metal: 1_065, crystal: 500, deuterium: 200 });
    expect(intel.projectedArrivalLootable).toEqual({ metal: 532, crystal: 250, deuterium: 100 });
    expect(intel.projectionDetail).toContain("public building/resource preview math");
  });

  test("keeps arrival resources unchanged for zero travel or no production data", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "1000", crystal: "500", deuterium: "200" },
        productionPerHour: { metal: "120", crystal: "60", deuterium: "24" },
        storageCaps: { metal: "2000", crystal: "1000", deuterium: "300" },
        buildings: null,
        fleet: [],
        defenses: [],
        research: [],
        queues: null,
      },
    });

    expect(targetResourceIntel(target, 0).projectedArrival).toEqual({ metal: 1_000, crystal: 500, deuterium: 200 });

    const noProduction = targetResourceIntel(targetPlanet({
      publicState: {
        resources: { metal: "1000", crystal: "500", deuterium: "200" },
        buildings: null,
        fleet: [],
        defenses: [],
        research: [],
        queues: null,
      },
    }), 3_600);
    expect(noProduction.projectedArrival).toEqual({ metal: 1_000, crystal: 500, deuterium: 200 });
    expect(noProduction.projectedArrivalLootable).toEqual({ metal: 500, crystal: 250, deuterium: 100 });
  });

  test("forecasts public battle outcome without inventing hidden target state", () => {
    const uncharted = publicTargetBattleForecast(attackAction.ships, targetPlanet());
    expect(uncharted.kind).toBe("uncertain");
    expect(uncharted.detail).not.toContain("not charted in the public indexed state");

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

  test("does not label the mission-1791 cargo defender shape as a probable win", () => {
    const forecast = publicTargetBattleForecast({
      ...attackAction.ships,
      smallCargo: 2,
      lightFighter: 1,
    }, targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        // Mission 1791 resolved Draw against three defending Small Cargo. Cargo has
        // contract battle stats and soaks rounds, so this close matchup must not be
        // presented as a confident win.
        fleet: [{ id: 0, count: 3 }],
        defenses: [],
        buildings: [],
        research: [],
        queues: null,
      },
    }));

    expect(forecast).toMatchObject({
      kind: "draw",
      label: "Probable draw",
      attackerPower: 210,
      defenderPower: 165,
    });
  });

  test("applies combat tech levels to public battle forecast power and outcome", () => {
    const selectedShips = { ...attackAction.ships, lightFighter: 1 };
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [{ id: 0, count: 1 }],
        buildings: [],
        research: [],
        queues: null,
      },
    });

    const baseForecast = publicTargetBattleForecast(selectedShips, target);
    const techForecast = publicTargetBattleForecast(selectedShips, target, {
      weapons: 10,
      shielding: 10,
      armor: 10,
    });

    expect(baseForecast).toMatchObject({
      kind: "defeat",
      attackerTechLevels: { weapons: 0, shielding: 0, armor: 0 },
      defenderTechKnown: true,
      defenderTechLevels: { weapons: 0, shielding: 0, armor: 0 },
    });
    expect(techForecast.attackerPower).toBeGreaterThan(baseForecast.attackerPower);
    expect(techForecast).toMatchObject({
      kind: "win",
      label: "Probable win",
      attackerTechLevels: { weapons: 10, shielding: 10, armor: 10 },
    });
  });

  test("renders shipyard-sourced attacker combat techs and increased attack power", () => {
    const selectedShips = { ...attackAction.ships, lightFighter: 1 };
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [{ id: 0, count: 1 }],
        buildings: [],
        research: [],
        queues: null,
      },
    });

    const baseForecast = publicTargetBattleForecast(selectedShips, target);
    const shipyardOnlyForecast = publicTargetBattleForecast(selectedShips, target, {
      weapons: 4,
      shielding: 0,
      armor: 5,
    });
    const intel = AttackIntelPanel({
      battleForecast: shipyardOnlyForecast,
      coords: { galaxy: 7, system: 41, position: 6 },
      lootableAtArrival: { metal: 0, crystal: 0, deuterium: 0 },
      maxLootForecast: { metal: 0, crystal: 0, deuterium: 0 },
      target,
      resourceIntel: targetResourceIntel(target, 0),
      stationedDefenderUnits: [],
      targetDefenseUnits: [],
      targetFleetUnits: [],
    });
    const text = collectText(intel).join(" ");

    expect(shipyardOnlyForecast.attackerPower).toBeGreaterThan(baseForecast.attackerPower);
    expect(shipyardOnlyForecast.attackerTechLevels).toEqual({ weapons: 4, shielding: 0, armor: 5 });
    expect(text).toMatch(/Tech W4 S0 A5/);
    expect(text).toMatch(/\/ W0 S0 A0/);
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

  test("renders compact attack intel with target, outcome, destination units, and resources", () => {
    const intel = AttackIntelPanel({
      battleForecast: {
        kind: "win",
        label: "Probable win",
        detail: "Visible defender power is lower than the selected fleet.",
        attackerPower: 1_250,
        defenderPower: 200,
      },
      coords: { galaxy: 7, system: 41, position: 6 },
      lootableAtArrival: { metal: 500, crystal: 250, deuterium: 100 },
      maxLootForecast: { metal: 300, crystal: 150, deuterium: 50 },
      target: targetPlanet(),
      resourceIntel: {
        current: { metal: 1_000, crystal: 500, deuterium: 200 },
        projectedArrival: { metal: 1_100, crystal: 550, deuterium: 225 },
        currentLootable: { metal: 500, crystal: 250, deuterium: 100 },
        projectedArrivalLootable: { metal: 550, crystal: 275, deuterium: 112 },
        projectionDetail: "Arrival projection uses public building/resource preview math.",
      },
      stationedDefenderUnits: [],
      targetDefenseUnits: [{ key: "rocketLauncher", label: "Rocket Launcher", count: 3 }],
      targetFleetUnits: [{ key: "smallCargo", label: "Small Cargo", count: 2 }],
    });
    const text = collectText(intel).join(" ");

    expect(text).toContain("Target");
    expect(text).toContain("New Zion");
    expect(text).toContain("[7:41:6]");
    expect(text).toContain("Outcome");
    expect(text).toContain("Probable win");
    expect(text).toContain("Tech");
    expect(text).toContain("DEF unknown");
    expect(text).toContain("Max loot");
    expect(text).toContain("Resources");
    expect(text).toContain("Max carry");
    expect(text).toContain("Forces");
    expect(text).toContain("Fleet");
    expect(text).toContain("Small Cargo");
    expect(text).toContain("Rocket Launcher");
    expect(text).toContain("Now");
    expect(text).toMatch(/1,000\s+M/);
    expect(text).not.toContain("Public state");
    expect(text).not.toContain("Destination intel");
    expect(text).not.toContain("Projected arrival resources use");
    expect(text).not.toContain("not charted");
  });

  test("keeps Attack Mission setup compact with aligned intel rows and no rejected section clutter", () => {
    expect(missionCreationSource).toContain("<MissionFormSection title=\"Fleet\" eyebrow=\"Ships\">");
    expect(missionCreationSource).toContain("<MissionFormSection title=\"Speed\" eyebrow=\"Flight plan\">");
    expect(missionCreationSource).toContain("<MissionFormSection title=\"Loot\" eyebrow=\"Plunder\">");
    expect(missionCreationSource).toContain("<h3 className=\"text-sm font-semibold text-white\">Launch</h3>");
    expect(missionCreationSource).toContain("ResourceIntelTable");
    expect(missionCreationSource).toContain("ForceIntelTable");
    expect(missionCreationSource).toContain("CompactFactRow label={holdingBreakdown ? \"Reach\" : \"Arrival\"}");
    expect(missionCreationSource).not.toContain("Launch decision");
    expect(missionCreationSource).not.toContain("Mission Summary");
    expect(missionCreationSource).not.toContain("MissionStatCard");
    expect(missionCreationSource).not.toContain("Projected arrival resources use");
  });

  test("uses the compact Attack-style intel shell for non-attack mission setup", () => {
    expect(missionCreationSource).toContain("<NonAttackMissionIntelPanel");
    expect(missionCreationSource).toContain("<TargetDecisionTable coords={coords} target={target} />");
    expect(missionCreationSource).toContain("<MissionPlanContent");
    expect(missionCreationSource).toContain("<ResourceIntelTable resourceIntel={resourceIntel} />");
    expect(missionCreationSource).toContain("missionPlanTitle(action)");
  });

  test("keeps non-attack mission panels visually shared but mission-specific", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "1200", crystal: "800", deuterium: "400" },
        buildings: [],
        research: [],
        fleet: [{ id: 2, count: 3 }],
        defenses: [{ id: 0, count: 4 }],
        stationedDefenders: [],
      },
    });
    const resourceIntel = targetResourceIntel(target, 3_600);
    const panelProps = {
      coords: { galaxy: 7, system: 41, position: 6 },
      destinationIntelVisible: true,
      holdDepotLevel: 0,
      holdingBreakdown: null,
      resourceIntel,
      stationedDefenderUnits: [],
      target,
      targetDefenseUnits: [{ key: "rocketLauncher", label: "Rocket Launcher", count: 4 }],
      targetFleetUnits: [{ key: "recycler", label: "Recycler", count: 3 }],
    };

    const transportText = collectText(NonAttackMissionIntelPanel({
      ...panelProps,
      action: transportAction,
      cargoCapacity: 4_000,
      cargoSupported: true,
    })).join(" ");
    const harvestText = collectText(NonAttackMissionIntelPanel({
      ...panelProps,
      action: harvestAction,
      cargoCapacity: 2_000,
      cargoSupported: false,
    })).join(" ");
    const defendText = collectText(NonAttackMissionIntelPanel({
      ...panelProps,
      action: defenseHoldAction,
      cargoCapacity: 0,
      cargoSupported: false,
      holdDepotLevel: 3,
      holdingBreakdown: {
        depotSupport: 120,
        holdSeconds: 3_600,
        holdingFuel: 300,
        netHoldingFuel: 180,
      },
    })).join(" ");
    const deployText = collectText(NonAttackMissionIntelPanel({
      ...panelProps,
      action: deployAction,
      cargoCapacity: 4_000,
      cargoSupported: true,
      destinationIntelVisible: false,
    })).join(" ");

    expect(transportText).toContain("Target");
    expect(transportText).toContain("Transport run");
    expect(transportText).toContain("Own or alliance planet");
    expect(transportText).toContain("Manual load / 4,000 capacity");
    expect(transportText).toContain("Resources");
    expect(transportText).not.toContain("Max carry");

    expect(harvestText).toContain("Debris sweep");
    expect(harvestText).toContain("Debris field target");
    expect(harvestText).toContain("Recycler holds for debris");

    expect(defendText).toContain("Station defense");
    expect(defendText).toContain("Arrive, hold, return");
    expect(defendText).toContain("180 D net");
    expect(defendText).toContain("Level 3 support");

    expect(deployText).toContain("Deploy fleet");
    expect(deployText).toContain("Own planets only");
    expect(deployText).toContain("One-way arrival");
    expect(deployText).not.toContain("Resources");
    expect(deployText).not.toContain("Forces");
  });

  test("keeps the legacy standalone outcome and destination panels available for non-attack surfaces", () => {
    const outcome = AttackOutcomePanel({
      battleForecast: {
        kind: "win",
        label: "Probable win",
        detail: "Visible defender power is lower than the selected fleet.",
        attackerPower: 1_250,
        defenderPower: 200,
      },
      lootableAtArrival: { metal: 500, crystal: 250, deuterium: 100 },
      maxLootForecast: { metal: 300, crystal: 150, deuterium: 50 },
    });
    const destination = DestinationIntelPanel({
      resourceIntel: {
        current: { metal: 1_000, crystal: 500, deuterium: 200 },
        projectedArrival: { metal: 1_100, crystal: 550, deuterium: 225 },
        currentLootable: { metal: 500, crystal: 250, deuterium: 100 },
        projectedArrivalLootable: { metal: 550, crystal: 275, deuterium: 112 },
        projectionDetail: "Arrival projection uses public building/resource preview math.",
      },
      stationedDefenderUnits: [],
      targetDefenseUnits: [{ key: "rocketLauncher", label: "Rocket Launcher", count: 3 }],
      targetFleetUnits: [{ key: "smallCargo", label: "Small Cargo", count: 2 }],
    });
    const text = collectText([outcome, destination]).join(" ");

    expect(text).toContain("Probable outcome");
    expect(text).toContain("Destination intel");
    expect(text).toContain("Resources now");
  });

  test("hides destination intel for colonize and deploy mission screens", () => {
    expect(shouldShowDestinationIntel(colonizeAction)).toBe(false);
    expect(shouldShowReturnTiming(colonizeAction, false)).toBe(false);
    expect(shouldShowDestinationIntel(deployAction)).toBe(false);
    expect(shouldShowReturnTiming(deployAction, false)).toBe(true);

    expect(shouldShowDestinationIntel(attackAction)).toBe(true);
    expect(shouldShowReturnTiming(attackAction, false)).toBe(true);
    expect(shouldShowReturnTiming(attackAction, true)).toBe(false);
    expect(shouldShowDestinationIntel(harvestAction)).toBe(true);
    expect(shouldShowDestinationIntel(defenseHoldAction)).toBe(true);
  });

  test("renders Greedy off as manual loot fields and Greedy on as concise copy only", () => {
    const manual = LootRatioControls({
      cargoCapacity: 600,
      greedyLootEnabled: false,
      lootRatio: { metal: 34, crystal: 33, deuterium: 33 },
      lootRatioTotal: 100,
      onAmountChange: () => undefined,
      onGreedyChange: () => undefined,
      onPercentChange: () => undefined,
      onResetEven: () => undefined,
    });
    const greedy = LootRatioControls({
      cargoCapacity: 600,
      greedyLootEnabled: true,
      lootRatio: { metal: 34, crystal: 33, deuterium: 33 },
      lootRatioTotal: 100,
      onAmountChange: () => undefined,
      onGreedyChange: () => undefined,
      onPercentChange: () => undefined,
      onResetEven: () => undefined,
    });
    const manualText = collectText(manual).join(" ");
    const greedyText = collectText(greedy).join(" ");
    const manualInputs = findElements(manual, "input");
    const greedyInputs = findElements(greedy, "input");

    expect(manualText).toContain("Greedy");
    expect(manualText).toContain("Metal %");
    expect(manualText).toContain("Metal up to");
    expect(manualText).toContain("Even split");
    expect(manualInputs).toHaveLength(7);
    expect(manualInputs[0]?.props?.checked).toBe(false);

    expect(greedyText).toContain("Greedy fills cargo from available loot automatically");
    expect(greedyText).not.toContain("Metal %");
    expect(greedyText).not.toContain("Metal up to");
    expect(greedyInputs).toHaveLength(1);
    expect(greedyInputs[0]?.props?.checked).toBe(true);
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
      fleetSlots: { active: 0, limit: 1 },
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
    const blocked = missionDraftBlocker({ ...base, fleetSlots: { active: 5, limit: 5 } });
    expect(blocked).toBe(
      "Fleet slots full (5/5) — research Computer Technology to raise the limit, or wait for a fleet to return."
    );
    expect(missionDraftBlocker({ ...base, fleetSlots: { active: 3, limit: 3 } })).toContain("Fleet slots full (3/3)");

    // Below the cap: gate passes through to the normal checks.
    expect(missionDraftBlocker({ ...base, fleetSlots: { active: 0, limit: 1 } })).toBeUndefined();

    // Missiles do not consume fleet slots, so a full fleet must not block a missile launch.
    expect(missionDraftBlocker({ ...base, action: missileAction, fleetSlots: { active: 1, limit: 1 } })).toBeUndefined();

    // Missing slot counts are stale for fleet launches; block before wallet submission rather than
    // letting an expected FleetSlotLimitReached revert escape through the wallet flow.
    expect(missionDraftBlocker(base)).toBe(
      "Fleet slot state is still loading — wait for Computer Technology limits to sync before launching."
    );
    expect(missionDraftBlocker({ ...base, fleetSlots: { active: 0, limit: 0 } })).toContain("Fleet slot state is still loading");
    expect(missionDraftBlocker({
      ...base,
      fleetSlots: { active: 0, limit: 5 },
      fleetSlotsUnavailableReason: "Fleet slot state is waiting for mission settlement.",
    })).toBe("Fleet slot state is waiting for mission settlement.");
  });

  test("shows previous-mission indexing as the primary launch blocker", () => {
    const blocker = "Waiting for previous mission to index.";

    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      submitBlocker: blocker,
      totalCargoCapacity: 50,
    })).toBe(blocker);
  });

  test("shows transaction sync as the primary mission-compose blocker", () => {
    const blocker = "Ship production: syncing indexed state...";

    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      submitBlocker: blocker,
      totalCargoCapacity: 50,
    })).toBe(blocker);
  });

  test("blocks non-Galaxy station-defense launches at the same Computer-tech fleet-slot cap", () => {
    const blocked = missionDraftBlocker({
      action: defenseHoldAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fleetSlots: { active: 5, limit: 5 },
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 50,
    });

    expect(blocked).toContain("Fleet slots full (5/5)");
    expect(blocked).toContain("Computer Technology");
  });

  test("blocks stale over-selected ship quantities before launch", () => {
    const staleBlocker = staleSelectedShipQuantityBlocker(
      attackAction,
      { ...attackAction.ships, lightFighter: 5 },
      { ships: [{ id: 1, count: 2 }] },
    );

    expect(staleBlocker).toBe(
      "Selected ship quantities are stale: Light Fighter 5 selected / 2 available. Refresh mission state or reduce the quantities before launching."
    );
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fleetSlots: { active: 0, limit: 1 },
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 1_000 },
      selectedShipCount: 5,
      staleShipQuantityBlocker: staleBlocker,
      totalCargoCapacity: 250,
    })).toBe(staleBlocker);
    expect(staleSelectedShipQuantityBlocker(
      attackAction,
      { ...attackAction.ships, lightFighter: 2 },
      { ships: [{ id: 1, count: 2 }] },
    )).toBeUndefined();
    expect(staleSelectedShipQuantityBlocker(
      missileAction,
      { ...attackAction.ships, lightFighter: 5 },
      { ships: [{ id: 1, count: 2 }] },
    )).toBeUndefined();
  });

  test("checks fuel for fleet missions and missile quantity for missile missions", () => {
    expect(missionDraftBlocker({
      action: attackAction,
      cargoCapacity: 0,
      cargoSupported: false,
      cargoTotal: 0,
      fleetSlots: { active: 0, limit: 1 },
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
      fleetSlots: { active: 0, limit: 1 },
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
      fleetSlots: { active: 0, limit: 1 },
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
      fleetSlots: { active: 0, limit: 1 },
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
      fleetSlots: { active: 0, limit: 1 },
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
      fleetSlots: { active: 0, limit: 1 },
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
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
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
