import { describe, expect, test } from "bun:test";
import {
  AttackIntelPanel,
  AttackOutcomePanel,
  buildMissionLaunchDraft,
  DestinationIntelPanel,
  forecastRaidLoot,
  initialMissionShips,
  LootRatioControls,
  MissionCargoPicker,
  type MissionCargoDraft,
  lootRatioFromUpToAmount,
  missionCargoMaxForResource,
  missionBodySelectionVisibility,
  missionConfirmButtonLabel,
  missionDraftBlocker,
  missionSpecificLoadout,
  missionShipOptions,
  missionTimingSummary,
  NonAttackMissionIntelPanel,
  projectedMissionArrivalAtSeconds,
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
import {
  cargoForCargoMissionLaunch,
  joinAttackTargetFromSystemPayload,
  missionMoonShipyardState,
  transportCargoForOrigin,
} from "./PlayableMvpApp";
import type { GalaxyAction } from "./galaxyActions";
import type { Planet } from "./types";

const missionCreationSource = await Bun.file(new URL("./components/MissionCreationPage.tsx", import.meta.url)).text();
const playableMvpAppSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();

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

  test("allows a non-cargo-only Deploy from the selected origin inventory", () => {
    const lightFighterDeploy = {
      ...deployAction,
      ships: {
        ...deployAction.ships,
        smallCargo: 0,
        lightFighter: 3,
      },
    };

    expect(initialMissionShips(lightFighterDeploy, {
      ships: [{ id: 1, count: 3 }],
    })).toEqual({
      ...deployAction.ships,
      smallCargo: 0,
      lightFighter: 3,
    });

    expect(staleSelectedShipQuantityBlocker(
      deployAction,
      { ...deployAction.ships, smallCargo: 0, lightFighter: 4 },
      { ships: [{ id: 1, count: 3 }] },
    )).toContain("Light Fighter 4 selected / 3 available");

    expect(initialMissionShips(transportAction, {
      ships: [{ id: 1, count: 3 }],
    })).toEqual({
      ...transportAction.ships,
      smallCargo: 0,
    });
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

  test("renders a moon indicator on attack target planet art when a moon exists", () => {
    const node = TargetIntelCard({
      coords: { galaxy: 7, system: 41, position: 6 },
      target: targetPlanet({ hasMoon: true }),
    });

    const indicator = findElements(node, "span").find((item) => item.props?.["data-planet-moon-indicator"] === "true");
    expect(indicator?.props?.["aria-label"]).toBe("Moon present");
  });

  test("resolves join-attack target combat intel from the mission system payload", () => {
    const target = joinAttackTargetFromSystemPayload({
      galaxy: 7,
      system: 41,
      planets: [{
        key: "9",
        galaxy: 7,
        system: 41,
        position: 6,
        fields: 180,
        temperature: 32,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        occupiedBy: {
          planetId: "9",
          owner: "0xdefender",
          ownerDisplayName: "Defender",
          alliance: null,
        },
        publicState: {
          fleet: [{ id: 7, count: 3 }],
          defenses: [{ id: 0, count: 40 }],
          stationedDefenders: [],
          research: [{ id: 5, level: 2 }],
        },
      }],
    }, "9", { galaxy: 7, system: 41, position: 6 });

    expect(target?.id).toBe("9");
    expect(target?.publicState?.fleet).toEqual([{ id: 7, count: 3 }]);
    expect(target?.publicState?.research).toEqual([{ id: 5, level: 2 }]);
  });

  test("supports moon body selection for attack missions without reusing parent planet intel", () => {
    expect(missionCreationSource).toContain("const bodyMissionSupported = action.mode === \"mission\" && (action.kind === \"attack\" || cargoSupported);");
    expect(playableMvpAppSource).toContain("pendingGalaxyMission.action.kind === \"attack\"");
    expect(playableMvpAppSource).toContain("const supportsBodyMission = supportsCargoMission || action.kind === \"attack\";");
    expect(playableMvpAppSource).toContain("draft.lootRatio && !originIsMoon && !targetIsMoon");

    const target = targetPlanet({
      hasMoon: true,
      publicMoonState: {
        resources: { metal: "7386", crystal: "2472", deuterium: "1335" },
        fleet: [{ id: 1, count: 2 }],
        defenses: [{ id: 0, count: 1 }],
      },
      publicState: {
        resources: { metal: "100000", crystal: "80000", deuterium: "60000" },
        buildings: null,
        fleet: [{ id: 7, count: 25 }],
        defenses: [{ id: 0, count: 200 }],
        stationedDefenders: [],
        research: [],
        productionPerHour: null,
        storageCaps: null,
        queues: null,
      },
    });

    const moonResourceIntel = targetResourceIntel(target, 600, true);
    const moonBattleForecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 10 },
      target,
      undefined,
      true,
    );

    expect(moonResourceIntel.current).toEqual({ metal: 7_386, crystal: 2_472, deuterium: 1_335 });
    expect(moonResourceIntel.current).not.toEqual({ metal: 100_000, crystal: 80_000, deuterium: 60_000 });
    expect(moonResourceIntel.projectedArrival).toEqual({ metal: 7_386, crystal: 2_472, deuterium: 1_335 });
    expect(moonResourceIntel.projectedArrivalLootable).toEqual({ metal: 3_693, crystal: 1_236, deuterium: 667 });
    expect(moonResourceIntel.projectionDetail).toContain("current public moon resource snapshot");
    expect(moonBattleForecast.defenderPower).toBe(320);
    expect(moonBattleForecast.kind).not.toBe("uncertain");
    expect(moonBattleForecast.sampleReport?.defender.startingShips).toEqual([
      expect.objectContaining({ id: 1, count: 2 }),
    ]);
    expect(moonBattleForecast.sampleReport?.defender.startingDefenses).toEqual([
      expect.objectContaining({ id: 0, count: 1 }),
    ]);
  });

  test("auto-filled body cargo reserves fuel for same-coordinate planet to moon deploy", () => {
    const cargo = transportCargoForOrigin(
      { metal: 10_459, crystal: 14_541, deuterium: 0 },
      { ...deployAction.ships, smallCargo: 0, largeCargo: 1 },
      { galaxy: 4, system: 291, position: 3 },
      { galaxy: 4, system: 291, position: 3 },
      {},
      100,
      { originIsMoon: false, targetIsMoon: true },
    );

    expect(cargo).toEqual({
      metal: "10459",
      crystal: "14540",
      deuterium: "0",
    });
  });

  test("auto-filled moon-origin cargo reads the selected moon resources", () => {
    const cargo = transportCargoForOrigin(
      { metal: 123, crystal: 456, deuterium: 789 },
      { ...transportAction.ships, smallCargo: 1 },
      { galaxy: 4, system: 291, position: 3 },
      { galaxy: 4, system: 291, position: 3 },
      {},
      100,
      { originIsMoon: true, targetIsMoon: false },
    );

    expect(cargo).toEqual({
      metal: "123",
      crystal: "456",
      deuterium: "788",
    });
  });

  test("moon-origin composition uses launchable moon ships and refreshed global slots, never parent ships", () => {
    const state = missionMoonShipyardState({
      moonState: {
        wallet: "0x2222222222222222222222222222222222222222",
        homePlanetId: "7",
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x2222222222222222222222222222222222222222",
          fields: 12,
          diameterKm: 8_777,
          createdAt: "1",
          jumpGateReadyAt: "0",
        },
        resources: { metal: "0", crystal: "0", deuterium: "100" },
        buildings: [],
        defenses: [],
        queue: null,
        launchableShips: [{ id: 0, count: 1, cost: { metal: "2000", crystal: "2000", deuterium: "0" } }],
        ships: [{ id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" } }],
        fleet: [{ id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" } }],
      },
      shipyardState: {
        wallet: "0x2222222222222222222222222222222222222222",
        homePlanetId: "7",
        planetId: "7",
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleetSlots: { active: 5, limit: 6 },
        fleetLaunchAvailable: true,
        shipyardLevel: 1,
        naniteLevel: 0,
        technologyLevels: { "4": 5 },
        ships: [{ id: 0, count: 99, cost: { metal: "2000", crystal: "2000", deuterium: "0" } }],
        queue: null,
      },
    });

    expect(state?.fleetSlots).toEqual({ active: 5, limit: 6 });
    expect(state?.ships.find((ship) => ship.id === 0)?.count).toBe(1);
    expect(playableMvpAppSource).toContain("refreshShipyardState({ clearCachedState: true })");
    expect(playableMvpAppSource).toContain("refreshInfrastructureState()");
  });

  test("seeds Moon to Planet Deploy from the moon fleet instead of the parent planet", () => {
    const moonOriginState = {
      ships: [
        { id: 1, count: 2 },
        { id: 4, count: 2 },
      ],
    };
    const initial = initialMissionShips(deployAction, moonOriginState);

    expect(initial.smallCargo).toBe(0);
    expect(initial.lightFighter).toBe(1);
    expect(staleSelectedShipQuantityBlocker(deployAction, initial, moonOriginState)).toBeUndefined();
    expect(playableMvpAppSource).toContain("const moonOriginShipyardState = missionMoonShipyardState({ moonState, shipyardState });");
    expect(playableMvpAppSource).toContain("shipyardState: moonOriginShipyardState,");
    expect(missionDraftBlocker({
      action: deployAction,
      cargoCapacity: 49,
      cargoSupported: true,
      cargoTotal: 0,
      fleetSlots: { active: 2, limit: 5 },
      fuelCost: 1,
      originCoords: { galaxy: 4, system: 291, position: 11 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 100 },
      selectedShipCount: 1,
      totalCargoCapacity: 50,
    })).toBeUndefined();
    expect(playableMvpAppSource).toContain(
      "validateShipInventory: { originIsMoon, originPlanetId, ships: draft.ships }",
    );
    expect(playableMvpAppSource).toContain(
      "fetchMoonState(apiBaseUrl, account, options.validateShipInventory.originPlanetId)",
    );
  });

  test("shows body selectors only for route sides with moons", () => {
    const visibility = (originMoonAvailable: boolean, targetMoonAvailable: boolean) => missionBodySelectionVisibility({
      bodyMissionSupported: true,
      originMoonAvailable,
      targetMoonAvailable,
    });

    expect(visibility(false, false)).toEqual({
      originVisible: false,
      sectionVisible: false,
      targetVisible: false,
    });
    expect(visibility(true, false)).toEqual({
      originVisible: true,
      sectionVisible: true,
      targetVisible: false,
    });
    expect(visibility(false, true)).toEqual({
      originVisible: false,
      sectionVisible: true,
      targetVisible: true,
    });
    expect(visibility(true, true)).toEqual({
      originVisible: true,
      sectionVisible: true,
      targetVisible: true,
    });
    expect(missionBodySelectionVisibility({
      bodyMissionSupported: false,
      originMoonAvailable: true,
      targetMoonAvailable: true,
    })).toEqual({
      originVisible: false,
      sectionVisible: false,
      targetVisible: false,
    });
    expect(missionCreationSource).not.toContain("Moon bodies keep independent");
  });

  test("mission body selectors can be preselected by Overview moon shortcuts", () => {
    expect(missionCreationSource).toContain("action.defaultOriginIsMoon === true");
    expect(missionCreationSource).toContain("action.defaultTargetIsMoon === true");
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

  test("requires a selected fleet travel time before showing arrival resources", () => {
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

    const zeroTravel = targetResourceIntel(target, 0);
    expect(zeroTravel.projectedArrival).toBeNull();
    expect(zeroTravel.projectedArrivalLootable).toBeNull();
    expect(zeroTravel.projectionDetail).toContain("Select ships");

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
        stationedDefenders: [],
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
        stationedDefenders: [],
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
        stationedDefenders: [],
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
    expect(forecast.attackerLosses?.average).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(forecast.randomness).toMatchObject({
      sampleCount: 128,
      outcomeCounts: { win: 0, draw: 128, defeat: 0 },
    });
    expect(forecast.detail).toContain("not a guarantee");
  });

  test("does not label the mission-8262 shield stalemate as a probable win", () => {
    const forecast = publicTargetBattleForecast({
      ...attackAction.ships,
      smallCargo: 2,
      lightFighter: 3,
    }, targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        // Mission 8262 resolved Draw with no losses. The old power-ratio preview
        // missed that these small stacks cannot break shields/hull in six rounds.
        fleet: [{ id: 9, count: 4 }],
        defenses: [{ id: 0, count: 3 }],
        stationedDefenders: [],
        buildings: [],
        research: [],
        queues: null,
      },
    }));

    expect(forecast).toMatchObject({
      kind: "draw",
      label: "Probable draw",
      attackerLosses: {
        average: { metal: 0, crystal: 0, deuterium: 0 },
        best: { metal: 0, crystal: 0, deuterium: 0 },
        worst: { metal: 0, crystal: 0, deuterium: 0 },
      },
      randomness: {
        sampleCount: 128,
        outcomeCounts: { win: 0, draw: 128, defeat: 0 },
      },
    });
    expect(forecast.detail).toContain("not a guarantee");
  });

  test("surfaces attacker loss ranges when combat randomness changes results", () => {
    const forecast = publicTargetBattleForecast({
      ...attackAction.ships,
      lightFighter: 1,
    }, targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [{ id: 0, count: 1 }],
        defenses: [],
        stationedDefenders: [],
        buildings: [],
        research: [],
        queues: null,
      },
    }), { weapons: 20, shielding: 0, armor: 0 });

    expect(forecast.kind).not.toBe("uncertain");
    if (forecast.kind === "uncertain") throw new Error("Expected a concrete battle forecast");
    expect(forecast.attackerLosses.average.metal + forecast.attackerLosses.average.crystal).toBeGreaterThanOrEqual(0);
    expect(forecast.randomness).not.toBeNull();
    expect(forecast.randomness?.outcomeRange.length).toBeGreaterThan(1);
  });

  test("renders deterministic outcome probabilities and an accessible, mobile-safe sample report", () => {
    const forecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 1 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [{ id: 0, count: 1 }],
          defenses: [],
          stationedDefenders: [],
          buildings: [],
          research: [],
          queues: null,
        },
      }),
      { weapons: 20, shielding: 0, armor: 0 },
    );
    const panel = AttackOutcomePanel({
      battleForecast: forecast,
      lootableAtArrival: { metal: 0, crystal: 0, deuterium: 0 },
      maxLootForecast: { metal: 0, crystal: 0, deuterium: 0 },
    });
    const text = collectText(panel).join(" ");
    const reportTrigger = findElements(panel, "summary").find(
      (element) => element.props?.["aria-label"] === "Open simulated battle report",
    );
    const dialog = findElements(panel, "div").find((element) => element.props?.role === "dialog");
    const closeButton = findElements(panel, "button").find(
      (element) => element.props?.["aria-label"] === "Close simulated battle report",
    );

    expect(text).toMatch(/Win \d+ \(\d+(?:\.\d)?%\)/);
    expect(text).toMatch(/Draw \d+ \(\d+(?:\.\d)?%\)/);
    expect(text).toMatch(/Loss \d+ \(\d+(?:\.\d)?%\)/);
    expect(text).toContain("Illustrative simulation");
    expect(text).toContain("Sample possible battle");
    expect(text).toContain("Random word");
    expect(text).toContain("Combat rounds");
    expect(text).toContain("Rapidfire");
    expect(text).toContain("not the already-determined future on-chain result");
    expect(reportTrigger?.props?.role).toBe("button");
    expect(dialog?.props?.["aria-modal"]).toBe("true");
    expect(dialog?.props?.className).toContain("overflow-y-auto");
    expect(closeButton).toBeDefined();
    expect(missionCreationSource).toContain("max-h-[calc(100dvh-1.5rem)]");
  });

  test("disables the report control when public defender technology is unavailable", () => {
    const panel = AttackOutcomePanel({
      battleForecast: publicTargetBattleForecast(
        { ...attackAction.ships, lightFighter: 1 },
        targetPlanet({
          publicState: {
            resources: { metal: "0", crystal: "0", deuterium: "0" },
            fleet: [{ id: 0, count: 1 }],
            defenses: [],
            stationedDefenders: [],
            buildings: [],
            research: null,
            queues: null,
          },
        }),
      ),
      lootableAtArrival: { metal: 0, crystal: 0, deuterium: 0 },
      maxLootForecast: { metal: 0, crystal: 0, deuterium: 0 },
    });
    const reportButton = findElements(panel, "button").find(
      (element) => element.props?.["aria-label"] === "Open simulated battle report",
    );

    expect(reportButton?.props?.disabled).toBe(true);
    expect(findElements(panel, "div").some((element) => element.props?.role === "dialog")).toBe(false);
  });

  test("applies combat tech levels to public battle forecast power and outcome", () => {
    const selectedShips = { ...attackAction.ships, lightFighter: 1 };
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [{ id: 0, count: 1 }],
        stationedDefenders: [],
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
      kind: "draw",
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
          arrivalAt: "1700000000",
          battleWindowComplete: true,
          laneGroup: 0,
          combatTechnology: { weapons: 4, shielding: 3, armor: 2 },
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
    const timing = { projectedAttackArrivalAt: 1700001800 };

    expect(publicTargetBattleForecast(selectedShips, target, undefined, false, undefined, timing)).toMatchObject({
      kind: "defeat",
      label: "Probable defeat",
    });
    expect(units).toEqual([
      expect.objectContaining({ key: "lightFighter", label: "Light Fighter", count: 40 }),
      expect.objectContaining({ key: "cruiser", label: "Cruiser", count: 2 }),
    ]);
    expect(
      publicTargetBattleForecast(selectedShips, target, undefined, false, undefined, timing)
        .sampleReport?.defender.counterplay[0]?.technology,
    )
      .toEqual({ weapons: 4, shielding: 3, armor: 2 });
  });

  test("qualifies solo DefenseHold fleets at projected arrival with inclusive contract boundaries", () => {
    const defender = {
      missionId: "window-defender",
      defender: "0xdefender",
      defenderDisplayName: "Window Defender",
      arrivalAt: "1900000050",
      battleWindowComplete: true,
      laneGroup: 0,
      combatTechnology: { weapons: 0, shielding: 0, armor: 0 },
      ships: { lightFighter: "50" },
      holdUntil: "1900000100",
      allianceDepotLevel: 0,
    };
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [],
        stationedDefenders: [defender],
        buildings: [],
        research: [],
        queues: null,
      },
    });
    const selectedShips = { ...attackAction.ships, cruiser: 1 };
    const forecastAt = (projectedAttackArrivalAt: number) => publicTargetBattleForecast(
      selectedShips,
      target,
      undefined,
      false,
      undefined,
      { projectedAttackArrivalAt },
    );

    const launchNowMs = 1_900_000_000_000;
    const fastArrival = projectedMissionArrivalAtSeconds(100, launchNowMs)!;
    const slowArrival = projectedMissionArrivalAtSeconds(101, launchNowMs)!;
    const atArrivalBoundary = forecastAt(1900000050);
    const atHoldBoundary = forecastAt(fastArrival);
    const afterHold = forecastAt(slowArrival);

    expect([fastArrival, slowArrival]).toEqual([1900000100, 1900000101]);
    expect(atArrivalBoundary.sampleReport?.defender.counterplay.map((participant) => participant.id))
      .toEqual(["stationed-window-defender"]);
    expect(atHoldBoundary.sampleReport?.defender.counterplay.map((participant) => participant.id))
      .toEqual(["stationed-window-defender"]);
    expect(afterHold.sampleReport?.defender.counterplay).toEqual([]);
    expect(afterHold.randomness?.outcomeCounts).not.toEqual(atHoldBoundary.randomness?.outcomeCounts);
    expect(afterHold.sampleReport?.outcome).not.toBe(atHoldBoundary.sampleReport?.outcome);
  });

  test("fails closed when scheduled or legacy defender battle timing cannot be reconstructed", () => {
    const forecast = publicTargetBattleForecast(
      { ...attackAction.ships, cruiser: 1 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [],
          defenses: [],
          stationedDefenders: [{
            missionId: "scheduled-window-unknown",
            defender: "0xdefender",
            defenderDisplayName: "Scheduled Defender",
            arrivalAt: "1900000050",
            battleWindowComplete: false,
            laneGroup: null,
            combatTechnology: { weapons: 0, shielding: 0, armor: 0 },
            ships: { lightFighter: "50" },
            // Scheduled missions without DefenseHoldStationed expose returnAt only as an upper bound.
            holdUntil: "1900001000",
            allianceDepotLevel: 0,
          }],
          buildings: [],
          research: [],
          queues: null,
        },
      }),
      undefined,
      false,
      undefined,
      { projectedAttackArrivalAt: 1900000100 },
    );

    expect(forecast).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(forecast.detail).toContain("scheduled-window-unknown");
    expect(forecast.detail).toContain("no exact indexed hold window");
  });

  test("fails closed when the public payload does not attest a complete defender timeline", () => {
    const forecast = publicTargetBattleForecast(
      { ...attackAction.ships, cruiser: 1 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [],
          defenses: [],
          stationedDefenders: [],
          stationedDefenderTimelineComplete: false,
          buildings: [],
          research: [],
          queues: null,
        },
      }),
      undefined,
      false,
      undefined,
      { projectedAttackArrivalAt: 1900000100 },
    );

    expect(forecast).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(forecast.detail).toContain("timeline is incomplete");
  });

  test("join-attack forecast includes the lead, visible joiners, and selected joining fleet", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [{ id: 7, count: 3 }],
        defenses: [{ id: 0, count: 40 }],
        stationedDefenders: [],
        buildings: [],
        research: [{ id: 5, level: 2 }, { id: 6, level: 2 }, { id: 7, level: 2 }],
        queues: null,
      },
    });
    const selectedShips = { ...attackAction.ships, lightFighter: 3 };
    const selectedOnly = publicTargetBattleForecast(selectedShips, target, { weapons: 1, shielding: 1, armor: 1 });
    const combined = publicTargetBattleForecast(
      selectedShips,
      target,
      { weapons: 1, shielding: 1, armor: 1 },
      false,
      {
        participants: [
          {
            missionId: "lead-77",
            label: "Lead attack #77",
            owner: "0xlead",
            laneGroup: 0,
            ships: { destroyer: "4" },
            combatTechnology: { weapons: 8, shielding: 7, armor: 6 },
          },
          {
            missionId: "joined-78",
            label: "Joined fleet #78",
            owner: "0xjoined",
            laneGroup: 2,
            ships: { cruiser: "12" },
            combatTechnology: { weapons: 4, shielding: 3, armor: 2 },
          },
        ],
        stationedDefenders: [{
          missionId: "defend-79",
          defender: "0xdefender",
          defenderDisplayName: "Group Defender",
          laneGroup: 2,
          combatTechnology: { weapons: 3, shielding: 5, armor: 7 },
          ships: { lightFighter: "5" },
          holdUntil: "1900000000",
          allianceDepotLevel: 2,
        }],
        selectedAttackerLaneGroup: 3,
      },
    );

    expect(combined.kind).not.toBe("uncertain");
    expect(combined.attackerPower).toBeGreaterThan(selectedOnly.attackerPower);
    expect(combined.randomness?.outcomeCounts).not.toEqual(selectedOnly.randomness?.outcomeCounts);
    expect(combined.sampleReport?.attackers).toHaveLength(3);
    expect(combined.sampleReport?.attackers.map((participant) => participant.id)).toEqual([
      "lead-77",
      "joined-78",
      "selected-attacker",
    ]);
    expect(combined.sampleReport?.attackers[0]?.technology).toEqual({ weapons: 8, shielding: 7, armor: 6 });
    expect(combined.sampleReport?.attackers[1]?.technology).toEqual({ weapons: 4, shielding: 3, armor: 2 });
    expect(combined.sampleReport?.defender.counterplay[0]?.technology).toEqual({ weapons: 3, shielding: 5, armor: 7 });
    expect(combined.sampleReport?.defender.counterplay[0]?.laneGroup).toBe(2);

    const joinPanel = AttackIntelPanel({
      battleForecast: combined,
      coords: { galaxy: 7, system: 41, position: 6 },
      lootableAtArrival: { metal: 0, crystal: 0, deuterium: 0 },
      maxLootForecast: { metal: 0, crystal: 0, deuterium: 0 },
      resourceIntel: targetResourceIntel(target, 60),
      showLoot: false,
      stationedDefenderUnits: [],
      target,
      targetDefenseUnits: [],
      targetFleetUnits: [],
    });
    const reportText = collectText(joinPanel).join(" ");
    expect(reportText).toContain("Lead attack #77");
    expect(reportText).toContain("Joined fleet #78");
    expect(reportText).toContain("Selected joining fleet");
    expect(reportText).toContain("Group Defender");
    expect(reportText).toContain("Inherited from the lead attack group");
    expect(findElements(joinPanel, "summary").some(
      (element) => element.props?.["aria-label"] === "Open simulated battle report",
    )).toBe(true);
  });

  test("stationed display sorting preserves immutable simulation lanes and distribution", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [],
        stationedDefenders: [],
        buildings: [],
        research: [],
        queues: null,
      },
    });
    const defenders = [
      {
        missionId: "hold-later",
        defender: "0xlater",
        defenderDisplayName: "Later",
        laneGroup: 4,
        combatTechnology: { weapons: 0, shielding: 0, armor: 0 },
        ships: { lightFighter: "10" },
        holdUntil: "1900002000",
        allianceDepotLevel: 0,
      },
      {
        missionId: "hold-earlier",
        defender: "0xearlier",
        defenderDisplayName: "Earlier",
        laneGroup: 5,
        combatTechnology: { weapons: 0, shielding: 0, armor: 0 },
        ships: { lightFighter: "7" },
        holdUntil: "1900001000",
        allianceDepotLevel: 0,
      },
    ];
    const forecast = (stationedDefenders: typeof defenders) => publicTargetBattleForecast(
      { ...attackAction.ships, cruiser: 1 },
      target,
      undefined,
      false,
      {
        participants: [{
          missionId: "lead",
          label: "Lead",
          owner: "0xlead",
          laneGroup: 0,
          ships: { cruiser: "1" },
          combatTechnology: { weapons: 0, shielding: 0, armor: 0 },
        }],
        stationedDefenders,
        selectedAttackerLaneGroup: 1,
      },
    );
    const storageOrder = forecast(defenders);
    const displayOrder = forecast([...defenders].reverse());
    const counterplayById = (value: typeof storageOrder) => Object.fromEntries(
      (value.sampleReport?.defender.counterplay ?? []).map((participant) => [
        participant.id,
        { laneGroup: participant.laneGroup, survivors: participant.survivingShips },
      ]),
    );

    expect(displayOrder.randomness?.outcomeCounts).toEqual(storageOrder.randomness?.outcomeCounts);
    expect(counterplayById(displayOrder)).toEqual(counterplayById(storageOrder));
    expect(counterplayById(displayOrder)).toMatchObject({
      "stationed-hold-later": { laneGroup: 4 },
      "stationed-hold-earlier": { laneGroup: 5 },
    });
  });

  test("join-attack forecast fails closed when participant tech or lane intel is missing", () => {
    const target = targetPlanet({
      publicState: {
        resources: { metal: "0", crystal: "0", deuterium: "0" },
        fleet: [],
        defenses: [],
        stationedDefenders: [],
        buildings: [],
        research: [],
        queues: null,
      },
    });
    const missingTech = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 3 },
      target,
      undefined,
      false,
      {
        participants: [{
          missionId: "lead-77",
          label: "Lead attack #77",
          owner: "0xlead",
          laneGroup: 0,
          ships: { destroyer: "4" },
        }],
        stationedDefenders: [],
        selectedAttackerLaneGroup: 1,
      },
    );
    const missingLane = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 3 },
      target,
      undefined,
      false,
      {
        participants: [{
          missionId: "lead-77",
          label: "Lead attack #77",
          owner: "0xlead",
          laneGroup: 0,
          ships: { destroyer: "4" },
          combatTechnology: { weapons: 8, shielding: 7, armor: 6 },
        }],
        stationedDefenders: [],
        selectedAttackerLaneGroup: null,
      },
    );

    expect(missingTech).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(missingTech.detail).toContain("Lead attack #77");
    expect(missingTech.detail).toContain("combat technology");
    expect(missingLane).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(missingLane.detail).toContain("lane");
  });

  test("battle forecast fails closed when a stationed defender lane is missing", () => {
    const forecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 3 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [],
          defenses: [],
          stationedDefenders: [{
            missionId: "legacy-hold",
            defender: "0xdefender",
            defenderDisplayName: "Legacy defender",
            arrivalAt: "1900000000",
            battleWindowComplete: true,
            combatTechnology: { weapons: 1, shielding: 1, armor: 1 },
            ships: { lightFighter: "1" },
            holdUntil: "1900001000",
            allianceDepotLevel: 0,
          }],
          buildings: [],
          research: [],
          queues: null,
        },
      }),
      undefined,
      false,
      undefined,
      { projectedAttackArrivalAt: 1900000500 },
    );

    expect(forecast).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(forecast.detail).toContain("legacy-hold");
    expect(forecast.detail).toContain("lane identity");
  });

  test("fails closed when a stationed defender's owner-specific combat technology is unavailable", () => {
    const forecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 20 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [],
          defenses: [],
          stationedDefenders: [{
            missionId: "held-without-tech",
            defender: "0xdefender",
            defenderDisplayName: "Defender",
            arrivalAt: "1700000000",
            battleWindowComplete: true,
            ships: { lightFighter: "1" },
            holdUntil: "1700003600",
            allianceDepotLevel: 1,
          }],
          buildings: [],
          research: [],
          queues: null,
        },
      }),
      undefined,
      false,
      undefined,
      { projectedAttackArrivalAt: 1700001800 },
    );

    expect(forecast).toMatchObject({
      kind: "uncertain",
      defenderPower: null,
    });
    expect(forecast.detail).toContain("combat technology is not indexed");
  });

  test("fails closed for partial planet or moon force-intel payloads", () => {
    const planetForecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 20 },
      targetPlanet({
        publicState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: [],
          defenses: null,
          stationedDefenders: [],
          research: [],
        },
      }),
    );
    const moonForecast = publicTargetBattleForecast(
      { ...attackAction.ships, lightFighter: 20 },
      targetPlanet({
        hasMoon: true,
        publicMoonState: {
          resources: { metal: "0", crystal: "0", deuterium: "0" },
          fleet: null,
          defenses: [],
        },
        publicState: {
          fleet: [],
          defenses: [],
          stationedDefenders: [],
          research: [],
        },
      }),
      undefined,
      true,
    );

    expect(planetForecast).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(planetForecast.detail).toContain("absent fields are not treated as empty");
    expect(moonForecast).toMatchObject({ kind: "uncertain", defenderPower: null });
    expect(moonForecast.detail).toContain("Parent-planet forces are never substituted");
  });

  test("renders compact attack intel with target, outcome, destination units, and resources", () => {
    const intel = AttackIntelPanel({
      battleForecast: {
        kind: "win",
        label: "Probable win",
        detail: "Visible defender power is lower than the selected fleet.",
        attackerPower: 1_250,
        defenderPower: 200,
        attackerLosses: zeroBattleLosses(),
        randomness: null,
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

  test("uses mission-specific loadouts instead of generic Fleet and Resources sections for Transport and Deploy", () => {
    expect(missionSpecificLoadout(transportAction)).toEqual({
      title: "Transport manifest",
      shipsTitle: "Ships to transport",
      cargoTitle: "Cargo to transport",
    });
    expect(missionSpecificLoadout(deployAction)).toEqual({
      title: "Deployment manifest",
      shipsTitle: "Ships to deploy",
      cargoTitle: "Supplies to deploy",
    });
    expect(missionSpecificLoadout(attackAction)).toBeNull();

    expect(missionCreationSource).toContain("specificLoadout ? (");
    expect(missionCreationSource).toContain("<MissionFormSection title={specificLoadout.title} eyebrow=\"Loadout\">");
    expect(missionCreationSource).not.toContain("<MissionFormSection title=\"Cargo\" eyebrow=\"Resources\">");
    expect(missionCreationSource).toContain("<MissionFormSection title=\"Fleet\" eyebrow=\"Ships\">");
  });

  test("Transport Max controls fill the inventory-limited amount and recompute for reduced capacity", () => {
    let cargo: MissionCargoDraft = { metal: "0", crystal: "200", deuterium: "100" };
    const maxCargoResources = { metal: 750, crystal: 1_200, deuterium: 900 };
    const renderPicker = (cargoCapacity: number) => MissionCargoPicker({
      cargo,
      cargoCapacity,
      maxCargoResources,
      onCargoChange: (updater) => {
        cargo = updater(cargo);
      },
    });

    const inventoryLimited = renderPicker(2_000);
    const buttons = findElements(inventoryLimited, "button");
    expect(buttons.map((button) => button.props?.["aria-label"])).toEqual([
      "Set metal cargo to maximum (750)",
      "Set crystal cargo to maximum (1,200)",
      "Set deuterium cargo to maximum (900)",
    ]);
    expect(buttons.every((button) => button.props?.type === "button")).toBe(true);

    (buttons[0]?.props?.onClick as (() => void) | undefined)?.();
    expect(cargo.metal).toBe("750");
    expect(findElements(renderPicker(2_000), "button")[0]?.props?.disabled).toBe(true);

    cargo = { metal: "750", crystal: "200", deuterium: "100" };
    const capacityLimited = renderPicker(600);
    const metalMax = findElements(capacityLimited, "button")[0];
    expect(metalMax?.props?.["aria-label"]).toBe("Set metal cargo to maximum (300)");
    expect(metalMax?.props?.disabled).toBe(false);
    (metalMax?.props?.onClick as (() => void) | undefined)?.();
    expect(cargo.metal).toBe("300");
  });

  test("Deploy Max controls respect other selections and recompute after inventory and selection changes", () => {
    const maxCargoResources = { metal: 2_000, crystal: 1_000, deuterium: 450 };
    let cargo: MissionCargoDraft = { metal: "500", crystal: "0", deuterium: "50" };

    expect(missionCargoMaxForResource(cargo, 800, maxCargoResources, "crystal")).toBe(250);
    expect(missionCargoMaxForResource(cargo, 800, maxCargoResources, "deuterium")).toBe(300);

    let picker = MissionCargoPicker({
      cargo,
      cargoCapacity: 800,
      maxCargoResources,
      onCargoChange: (updater) => {
        cargo = updater(cargo);
      },
    });
    const crystalMax = findElements(picker, "button")[1];
    expect(crystalMax?.props?.["aria-label"]).toBe("Set crystal cargo to maximum (250)");
    (crystalMax?.props?.onClick as (() => void) | undefined)?.();
    expect(cargo.crystal).toBe("250");

    cargo = { metal: "100", crystal: "250", deuterium: "50" };
    picker = MissionCargoPicker({
      cargo,
      cargoCapacity: 800,
      maxCargoResources: { ...maxCargoResources, crystal: 180 },
      onCargoChange: (updater) => {
        cargo = updater(cargo);
      },
    });
    const recomputedCrystalMax = findElements(picker, "button")[1];
    expect(recomputedCrystalMax?.props?.["aria-label"]).toBe("Set crystal cargo to maximum (180)");
    (recomputedCrystalMax?.props?.onClick as (() => void) | undefined)?.();
    expect(cargo.crystal).toBe("180");
  });

  test("keeps Transport cargo and mixed Deploy fleets in confirmation payloads", () => {
    const cargoShips = {
      ...transportAction.ships,
      smallCargo: 4,
      largeCargo: 2,
    };
    const mixedDeployShips = {
      ...cargoShips,
      lightFighter: 7,
      recycler: 3,
      cruiser: 5,
    };
    const cargo = { metal: "1200", crystal: "340", deuterium: "56" };
    const base = {
      cargo,
      defenseHoldActive: false,
      defenseHoldSeconds: 0,
      effectiveOriginIsMoon: true,
      effectiveTargetIsMoon: false,
      lootRatio: { metal: 34, crystal: 33, deuterium: 33 },
      lootRatioActive: false,
      primaryTargetId: 0,
      quantity: 1,
      ships: cargoShips,
      speedPercent: 70,
    } as const;

    const transportDraft = buildMissionLaunchDraft({ ...base, action: transportAction });
    const deployDraft = buildMissionLaunchDraft({ ...base, action: deployAction, ships: mixedDeployShips });

    expect(transportDraft.ships).toEqual(cargoShips);
    expect(deployDraft.ships).toEqual(mixedDeployShips);
    for (const draft of [transportDraft, deployDraft]) {
      expect(draft.cargo).toEqual(cargo);
      expect(draft.speedPercent).toBe(70);
      expect(draft.originIsMoon).toBe(true);
      expect(draft.targetIsMoon).toBe(false);
    }

    expect(buildMissionLaunchDraft({ ...base, action: attackAction }).cargo).toBeUndefined();
  });

  test("submits a non-cargo-only Deploy with zero resources and preserves body flags", () => {
    const ships = {
      ...deployAction.ships,
      smallCargo: 0,
      lightFighter: 3,
    };
    const draft = buildMissionLaunchDraft({
      action: deployAction,
      cargo: {},
      defenseHoldActive: false,
      defenseHoldSeconds: 0,
      effectiveOriginIsMoon: true,
      effectiveTargetIsMoon: false,
      lootRatio: { metal: 34, crystal: 33, deuterium: 33 },
      lootRatioActive: false,
      primaryTargetId: 0,
      quantity: 1,
      ships,
      speedPercent: 100,
    });

    expect(draft).toMatchObject({
      ships,
      cargo: undefined,
      originIsMoon: true,
      targetIsMoon: false,
    });
    expect(cargoForCargoMissionLaunch({
      actionKind: "deploy",
      autoFilledCargo: { metal: "50", crystal: "25", deuterium: "10" },
      cargo: draft.cargo,
    })).toBeUndefined();
    expect(cargoForCargoMissionLaunch({
      actionKind: "transport",
      autoFilledCargo: { metal: "50", crystal: "25", deuterium: "10" },
      cargo: draft.cargo,
    })).toEqual({ metal: "50", crystal: "25", deuterium: "10" });
    expect(cargoForCargoMissionLaunch({
      actionKind: "deploy",
      autoFilledCargo: { metal: "50", crystal: "25", deuterium: "10" },
      cargo: { metal: "12", crystal: "3", deuterium: "0" },
    })).toEqual({ metal: "12", crystal: "3", deuterium: "0" });
    expect(missionDraftBlocker({
      action: deployAction,
      cargoCapacity: 0,
      cargoSupported: true,
      cargoTotal: 0,
      fleetSlots: { active: 0, limit: 1 },
      fuelCost: 0,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      selectedShipCount: 3,
      totalCargoCapacity: 0,
    })).toBeUndefined();
  });

  test("uses the compact Attack-style intel shell for non-attack mission setup", () => {
    expect(missionCreationSource).toContain("<NonAttackMissionIntelPanel");
    expect(missionCreationSource).toContain("lootRatioSupported || joinAttackMode");
    expect(missionCreationSource).toContain("joinAttackContext");
    expect(missionCreationSource).toContain("<TargetDecisionTable coords={coords} target={target} />");
    expect(missionCreationSource).toContain("<MissionPlanContent");
    expect(missionCreationSource).toContain("<ResourceIntelTable resourceIntel={resourceIntel} />");
    expect(missionCreationSource).toContain("missionPlanTitle(action)");
  });

  test("keeps non-attack mission panels visually shared but mission-specific", () => {
    const target = targetPlanet({
      debrisField: { metal: 27_000, crystal: 9_000 },
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
      destinationIntelVisible: shouldShowDestinationIntel(transportAction),
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
      destinationIntelVisible: shouldShowDestinationIntel(defenseHoldAction),
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
      destinationIntelVisible: shouldShowDestinationIntel(deployAction),
    })).join(" ");

    expect(transportText).toContain("Target");
    expect(transportText).toContain("Transport run");
    expect(transportText).toContain("Own planet");
    expect(transportText).toContain("Manual load / 4,000 capacity");
    expect(transportText).not.toContain("Resources");
    expect(transportText).not.toContain("Forces");
    expect(transportText).not.toContain("Max carry");

    expect(harvestText).toContain("Debris sweep");
    expect(harvestText).toContain("Debris field target");
    expect(harvestText).toContain("2,000 recycler capacity");
    expect(harvestText).toContain("Debris");
    expect(harvestText).toContain("27,000 M");
    expect(harvestText).toContain("9,000 C");
    expect(harvestText).toContain("36,000 total");
    expect(harvestText).toContain("2,000 / 36,000 debris capacity");

    expect(defendText).toContain("Station defense");
    expect(defendText).toContain("Arrive, hold, return");
    expect(defendText).toContain("180 D net");
    expect(defendText).toContain("Level 3 support");
    expect(defendText).toContain("Resources");
    expect(defendText).toContain("Forces");

    expect(deployText).toContain("Deploy fleet");
    expect(deployText).toContain("Own planets only");
    expect(deployText).toContain("One-way arrival");
    expect(deployText).not.toContain("Resources");
    expect(deployText).not.toContain("Forces");
  });

  test("shows no indexed debris state on Harvest mission setup when the target has no debris field", () => {
    const target = targetPlanet({ debrisField: null, publicState: null });
    const text = collectText(NonAttackMissionIntelPanel({
      action: harvestAction,
      cargoCapacity: 0,
      cargoSupported: false,
      coords: { galaxy: 7, system: 41, position: 6 },
      destinationIntelVisible: true,
      holdDepotLevel: 0,
      holdingBreakdown: null,
      resourceIntel: targetResourceIntel(target, 3_600),
      stationedDefenderUnits: [],
      target,
      targetDefenseUnits: [],
      targetFleetUnits: [],
    })).join(" ");

    expect(text).toContain("No indexed debris");
    expect(text).toContain("Nothing to collect");
    expect(text).not.toContain("Unknown");
  });

  test("keeps the legacy standalone outcome and destination panels available for non-attack surfaces", () => {
    const outcome = AttackOutcomePanel({
      battleForecast: {
        kind: "win",
        label: "Probable win",
        detail: "Visible defender power is lower than the selected fleet.",
        attackerPower: 1_250,
        defenderPower: 200,
        attackerLosses: zeroBattleLosses(),
        randomness: null,
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

    expect(text).toContain("Outcome");
    expect(text).toContain("Destination intel");
    expect(text).toContain("Resources now");
  });

  test("hides destination intel for colonize, transport, and deploy mission screens", () => {
    expect(shouldShowDestinationIntel(colonizeAction)).toBe(false);
    expect(shouldShowReturnTiming(colonizeAction, false)).toBe(false);
    expect(shouldShowDestinationIntel(transportAction)).toBe(false);
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
      "Selected ships are not available on the selected origin body: Light Fighter 5 selected / 2 available. Switch the origin body or reduce the quantity before launching."
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
      cargo: { metal: "101", crystal: "0", deuterium: "0" },
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

  test("blocks transport cargo drafts that exceed origin resources", () => {
    expect(missionDraftBlocker({
      action: transportAction,
      cargo: { metal: "751", crystal: "50", deuterium: "0" },
      cargoCapacity: 2_000,
      cargoSupported: true,
      cargoTotal: 801,
      fleetSlots: { active: 0, limit: 1 },
      fuelCost: 100,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 750, crystal: 1_000, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 2_100,
    })).toBe("Cargo exceeds available resources: Metal 751 selected / 750 available.");

    expect(missionDraftBlocker({
      action: transportAction,
      cargo: { metal: "0", crystal: "0", deuterium: "200" },
      cargoCapacity: 2_000,
      cargoSupported: true,
      cargoTotal: 200,
      fleetSlots: { active: 0, limit: 1 },
      fuelCost: 900,
      originCoords: { galaxy: 2, system: 44, position: 7 },
      quantity: 1,
      resources: { metal: 1_000, crystal: 1_000, deuterium: 1_000 },
      selectedShipCount: 1,
      totalCargoCapacity: 2_100,
    })).toBe("Cargo exceeds available resources: Deuterium 1,100 required (900 fuel + 200 cargo) / 1,000 available.");
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
    expect(projectedMissionArrivalAtSeconds(3_900, Date.UTC(2026, 0, 1, 12, 0, 0) + 999))
      .toBe(Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1_000) + 3_900);
  });
});

function targetPlanet(overrides: Partial<Planet> = {}): Planet {
  const target: Planet = {
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
  if (target.publicState) {
    target.publicState = {
      stationedDefenderTimelineComplete: true,
      ...target.publicState,
    };
  }
  return target;
}

function zeroBattleLosses() {
  const zero = { metal: 0, crystal: 0, deuterium: 0 };
  return { average: zero, best: zero, worst: zero };
}

type FoundElement = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function findElements(node: unknown, tag: string): FoundElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, tag));
  if (typeof node !== "object") return [];

  const vnode = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (typeof vnode.type === "function") {
    const render = vnode.type as (props: Record<string, unknown>) => unknown;
    if (render.name === "Icon") return [];
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
