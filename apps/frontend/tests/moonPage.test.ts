import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MoonPage, MoonStructureLevelInfoModal, moonBuildingRequirementRows, moonFieldSummary, moonJumpGateAvailable, moonJumpGateDestinations, moonJumpGateStatus, moonStructureHasLevelInfo, moonStructureLevelInfoColumns, moonStructureLevelInfoRows, moonStructureStatus, queueReady } from "../src/components/MoonPage";
import type { ChainMoonState } from "../src/walletFlow";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../src/moonActions";

const moonPageSource = await Bun.file(new URL("../src/components/MoonPage.tsx", import.meta.url)).text();
const infrastructurePageSource = await Bun.file(new URL("../src/components/InfrastructurePage.tsx", import.meta.url)).text();
const levelInfoModalSource = await Bun.file(new URL("../src/components/LevelInfoModal.tsx", import.meta.url)).text();

describe("Moon page helpers", () => {
  test("accepts only positive integer moon ids", () => {
    expect(isPositiveIntegerInput("9")).toBe(true);
    expect(isPositiveIntegerInput(" 9 ")).toBe(true);
    expect(isPositiveIntegerInput("")).toBe(false);
    expect(isPositiveIntegerInput("0")).toBe(false);
    expect(isPositiveIntegerInput("2.5")).toBe(false);
    expect(isPositiveIntegerInput("44abc")).toBe(false);
  });

  test("omits empty jump cargo instead of building an all-zero ship manifest", () => {
    expect(parseMoonJumpShips("", "")).toBeUndefined();
    expect(parseMoonJumpShips("0", "0")).toBeUndefined();
    expect(parseMoonJumpShips("2", "")).toEqual({ smallCargo: 2, largeCargo: 0 });
    expect(parseMoonJumpShips("", "1")).toEqual({ smallCargo: 0, largeCargo: 1 });
    expect(parseMoonJumpShips("1.5", "abc")).toBeNull();
    expect(parseMoonJumpShips("2", "abc")).toBeNull();
  });

  test("keeps loaded moon systems visible during a background refresh", () => {
    const page = MoonPage({
      loading: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 1,
          cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        }],
        queue: null,
      },
      onRefresh: () => undefined,
    });
    const text = visibleText(page);
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(text).toContain("Refreshing moon state");
    expect(systemsPanel?.props?.moon?.fields).toBe(3);
    expect(systemsPanel?.props?.moonState?.buildings?.[0]?.label).toBe("Lunar Base");
    expect(text).not.toContain("No moon in orbit");
  });

  test("renders moon-owned resources and units instead of parent planet state", () => {
    const page = MoonPage({
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        bodyKind: "moon",
        homePlanetId: "7",
        parentPlanetId: "7",
        resources: { metal: "101", crystal: "202", deuterium: "303" },
        resourcesAsOfNow: { metal: "111", crystal: "222", deuterium: "333" },
        ships: [{ id: 1, count: 4, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
        defenses: [{ id: 2, count: 5, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
        buildings: [],
        queue: null,
      },
    });
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(systemsPanel?.props?.moonState?.resourcesAsOfNow).toEqual({ metal: "111", crystal: "222", deuterium: "333" });
    expect(systemsPanel?.props?.moonState?.ships).toEqual([{ id: 1, count: 4, cost: { metal: "0", crystal: "0", deuterium: "0" } }]);
    expect(systemsPanel?.props?.moonState?.defenses).toEqual([{ id: 2, count: 5, cost: { metal: "0", crystal: "0", deuterium: "0" } }]);
  });

  test("hides Burning Chickens when the selected planet already has a moon", () => {
    const page = MoonPage({
      burningChicken: {
        configured: true,
        maxMoonsPerPlayer: 2,
        moonCount: 1,
      },
      canBurnChicken: true,
      moonState: loadedMoonState({
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
      }),
    });

    expect(visibleText(page)).not.toContain("Burning Chickens");
    expect(visibleText(page)).not.toContain("Burn for Moon");
  });

  test("keeps moon resources compact and leaves units to shipyard and defense surfaces", () => {
    expect(moonPageSource).toContain("moonState?.ships ?? moonState?.fleet ?? []");
    expect(moonPageSource).toContain("MoonShipyardSection");
    expect(moonPageSource).toContain("MoonDefenseSection");
    expect(moonPageSource).not.toContain("Stationed Units");
    expect(moonPageSource).not.toContain("<h3 className=\"text-sm font-semibold text-white\">Moon Units</h3>");
    expect(moonPageSource).not.toContain("Created {formatMoonReadyAt(moon.createdAt)}");
    expect(moonPageSource).toContain("Moon orbiting {moonOrbitParentLabel(parentPlanetLabel, moon.planetId)}");
  });

  test("renders selected moon primary actions with clear unavailable states", () => {
    const page = MoonPage({
      moonActions: [
        { kind: "inspect", label: "Inspect", onClick: () => undefined },
        { kind: "transport", label: "Transport", onClick: () => undefined },
        { kind: "deploy", label: "Deploy", onClick: () => undefined },
        { kind: "defend", label: "Defend", disabledReason: "Moon defense stationing is not available yet." },
      ],
      moonState: loadedMoonState({
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
      }),
    });
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(systemsPanel?.props?.moonActions?.map((action: { label: string }) => action.label)).toEqual(["Inspect", "Transport", "Deploy", "Defend"]);
    expect(moonPageSource).toContain('aria-label="Moon actions"');
    expect(moonPageSource).toContain('kind: "inspect" | "attack" | "transport" | "deploy" | "defend"');
  });

  test("uses the larger page title styling without redundant section helper copy", () => {
    expect(moonPageSource).toContain('titleSize="xl"');
    expect(moonPageSource).toContain('<h3 className="text-base font-semibold text-white">Moon Structures</h3>');
    expect(moonPageSource).toContain('<h3 className="text-base font-semibold text-white">Moon Shipyard</h3>');
    expect(moonPageSource).toContain('<h3 className="text-base font-semibold text-white">Moon Defenses</h3>');
    expect(moonPageSource).not.toContain("Lunar Base expands fields. Jump Gate supports fleet movement between owned moons.");
    expect(moonPageSource).not.toContain("Enter a Chicken ID to burn it on Base mainnet");
    expect(moonPageSource).not.toContain("Burn a verified Chicken to grant a moon to this planet");
    expect(moonPageSource).not.toContain("same selectable catalog pattern as the planet Shipyard");
    expect(moonPageSource).not.toContain("same selectable catalog and detail controls as the planet Defenses screen");
  });

  test("shows Jump Gate destinations only when another ready moon gate is available", () => {
    const baseMoonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 3,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      buildings: [{
        id: 2,
        key: "jumpGate",
        label: "Jump Gate",
        level: 1,
        cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" },
      }],
    });
    const withoutDestinations = moonJumpGateDestinations(baseMoonState);

    expect(withoutDestinations).toEqual([]);
    expect(moonJumpGateAvailable(baseMoonState.moon!, baseMoonState, withoutDestinations)).toBe(false);
    expect(moonJumpGateStatus(baseMoonState.moon!, baseMoonState, withoutDestinations)).toBe("Needs another moon");

    const readyMoonState = {
      ...baseMoonState,
      jumpGateDestinations: [{ planetId: "9", label: "Ice Moon", coordinates: "1:44:9", jumpGateReadyAt: "0" }],
    };
    const withDestinations = moonJumpGateDestinations(readyMoonState);

    expect(withDestinations).toEqual([{ planetId: "9", label: "Ice Moon", coordinates: "1:44:9", jumpGateReadyAt: "0" }]);
    expect(moonJumpGateAvailable(readyMoonState.moon!, readyMoonState, withDestinations)).toBe(true);
    expect(moonJumpGateStatus(readyMoonState.moon!, readyMoonState, withDestinations)).toBe("1 destination");
    expect(moonPageSource).toContain("Destination moon");
    expect(moonPageSource).toContain("Deploy");
  });

  test("renders manual Burning Chicken token entry", () => {
    const page = MoonPage({
      burningChicken: {
        configured: true,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
    });
    const text = visibleText(page);

    expect(text).toContain("Chicken ID");
    expect(text).toContain("Burn for Moon");
    expect(text).toContain("Any Chicken NFT from the OpenSea collection can be burned for a moon at any planet.");
    expect(text).not.toContain("verifies this wallet owns the chicken");
    expect(text).not.toContain("Example Chicken");
    expect(text).not.toContain("#73166 on OpenSea");
    expect(text).not.toContain("During testnet");
    expect(text).not.toContain("testnet Chicken moons used");
    expect(text).not.toContain("No eligible Burning Chickens");
    expect(moonPageSource).toContain("https://opensea.io/collection/chickens-by-eggs");
    expect(moonPageSource).not.toContain("https://opensea.io/item/base/0x84eea2be67b17698b0e09b57eeeda47aa921bbf0/73166");
  });

  test("renders Burning Chicken config unavailable state", () => {
    const page = MoonPage({
      burningChicken: {
        configured: false,
      },
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });

    expect(visibleText(page)).toContain("Burning Chicken burn config is not available yet.");
  });

  test("keeps Burning Chicken ownership errors visible", () => {
    const page = MoonPage({
      action: { status: "error", label: "Chicken #164 was not found on Base mainnet." },
      burningChicken: {
        configured: true,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });

    expect(visibleText(page)).toContain("Chicken #164 was not found on Base mainnet.");
  });

  test("does not show a per-wallet Chicken moon limit", () => {
    const page = MoonPage({
      burningChicken: {
        configured: true,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });
    expect(visibleText(page)).toContain("Burn for Moon");
    expect(visibleText(page)).not.toContain("Moon limit reached");
    expect(visibleText(page)).not.toContain("testnet Chicken moons used");
  });

  test("previews moon structures before a moon is granted", () => {
    const page = MoonPage({
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 0,
          cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        }, {
          id: 2,
          key: "jumpGate",
          label: "Jump Gate",
          level: 0,
          cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" },
        }],
        queue: null,
      },
    });
    const text = visibleText(page);

    expect(text).toContain("No moon in orbit");
    expect(text).toContain("Moon structures");
    expect(text).toContain("Lunar Base");
    expect(text).toContain("Adds moon fields so more lunar structures can be built.");
    expect(text).toContain("Jump Gate");
    expect(text).toContain("Moves fleets between owned moons when the gate is ready.");
  });

  test("renders moon facilities and moon defenses separately", () => {
    const page = MoonPage({
      canTransact: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 4,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 1,
          cost: { metal: "40000", crystal: "80000", deuterium: "40000" },
        }, {
          id: 1,
          key: "roboticsFactory",
          label: "Robotics Factory",
          level: 2,
          cost: { metal: "1600", crystal: "480", deuterium: "800" },
        }, {
          id: 3,
          key: "shipyard",
          label: "Shipyard",
          level: 1,
          cost: { metal: "800", crystal: "400", deuterium: "200" },
        }],
        queue: null,
        defenses: [{
          id: 0,
          count: 3,
          cost: { metal: "2000", crystal: "0", deuterium: "0" },
          durationSeconds: 1440,
        }],
        defenseQueue: {
          active: true,
          kind: "moon-defense",
          itemId: 0,
          quantity: 1,
          readyAt: "1770000300",
          cost: { metal: "2000", crystal: "0", deuterium: "0" },
        },
      },
      onStartBuilding: () => undefined,
      onStartDefense: () => undefined,
    });
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(systemsPanel?.props?.moonState?.buildings.map((building: { label: string }) => building.label)).toContain("Robotics Factory");
    expect(systemsPanel?.props?.moonState?.buildings.map((building: { label: string }) => building.label)).toContain("Shipyard");
    expect(systemsPanel?.props?.moonState?.defenses?.[0]).toMatchObject({ id: 0, count: 3 });
    expect(systemsPanel?.props?.moonState?.defenseQueue).toMatchObject({
      kind: "moon-defense",
      itemId: 0,
      quantity: 1,
    });
  });

  test("uses shared planet production and inspect layout patterns for moon systems", () => {
    expect(moonPageSource).toContain("InspectTwoColumnLayout");
    expect(moonPageSource).toContain("InspectCatalogTile");
    expect(moonPageSource).toContain("InspectDetailShell");
    expect(moonPageSource).toContain("ProductionCatalog");
    expect(moonPageSource).toContain("MoonStructuresSection");
    expect(moonPageSource).toContain("MoonShipyardSection");
    expect(moonPageSource).toContain("MoonDefenseSection");
    expect(moonPageSource).toContain("Moon Structures");
    expect(moonPageSource).toContain("Moon Shipyard");
    expect(moonPageSource).toContain("Moon Defenses");
    expect(moonPageSource).not.toContain("Moon Shipyard and Defenses");
    expect(moonPageSource).toContain('sizes="(min-width: 1280px) 38vw, (min-width: 768px) 46vw, 100vw"');
    expect(moonPageSource).toContain("lunar-base.webp");
    expect(moonPageSource).toContain("jump-gate.webp");
  });

  test("previews moon fields and building requirements from indexed moon state", () => {
    const moonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 4,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      buildings: [{
        id: 0,
        key: "lunarBase",
        label: "Lunar Base",
        level: 1,
        cost: { metal: "40000", crystal: "80000", deuterium: "40000" },
      }, {
        id: 1,
        key: "roboticsFactory",
        label: "Robotics Factory",
        level: 1,
        cost: { metal: "1600", crystal: "480", deuterium: "800" },
      }, {
        id: 2,
        key: "jumpGate",
        label: "Jump Gate",
        level: 0,
        cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" },
      }, {
        id: 3,
        key: "shipyard",
        label: "Shipyard",
        level: 0,
        cost: { metal: "800", crystal: "400", deuterium: "200" },
      }],
      technologyLevels: { "8": 6 },
    });

    expect(moonFieldSummary(moonState.moon!, moonState)).toEqual({ capacity: 4, used: 2, open: 2 });
    expect(moonBuildingRequirementRows(moonState.buildings[3], moonState.moon!, moonState)).toContainEqual({
      label: "Robotics Factory level 2",
      met: false,
      status: "Current level 1",
      target: { kind: "moonStructure", key: "roboticsFactory" },
    });
    expect(moonBuildingRequirementRows(moonState.buildings[2], moonState.moon!, moonState)).toContainEqual({
      label: "Hyperspace level 7",
      met: false,
      status: "Current level 6",
    });
  });

  test("softly requires Lunar Base as the first moon build", () => {
    const moonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 4,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      buildings: [{
        id: 0,
        key: "lunarBase",
        label: "Lunar Base",
        level: 0,
        cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
      }, {
        id: 1,
        key: "roboticsFactory",
        label: "Robotics Factory",
        level: 0,
        cost: { metal: "400", crystal: "120", deuterium: "200" },
      }],
    });

    expect(moonFieldSummary(moonState.moon!, moonState)).toEqual({ capacity: 1, used: 0, open: 1 });
    expect(moonBuildingRequirementRows(moonState.buildings[1], moonState.moon!, moonState)).toContainEqual({
      label: "Lunar Base level 1",
      met: false,
      status: "Current level 0",
      target: { kind: "moonStructure", key: "lunarBase" },
    });
  });

  test("keeps moon structure affordability copy out of the selected UI", () => {
    const moonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 4,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      resourcesAsOfNow: { metal: "0", crystal: "0", deuterium: "0" },
      buildings: [{
        id: 0,
        key: "lunarBase",
        label: "Lunar Base",
        level: 0,
        cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        durationSeconds: 1440,
      }, {
        id: 1,
        key: "roboticsFactory",
        label: "Robotics Factory",
        level: 0,
        cost: { metal: "400", crystal: "120", deuterium: "200" },
      }],
    });
    const status = moonStructureStatus(moonState.buildings[0], moonState.moon!, moonState, { canTransact: true });

    expect(status.disabled).toBe(true);
    expect(status.reason).toBe("Moon resources are below the build cost.");
    expect(status.targetLevel).toBe(1);
    expect(moonPageSource).toContain("Build ${building.label}");
    expect(moonPageSource).not.toContain("Upgrade Level {building.level + 1}");
    expect(moonPageSource).not.toContain("formatMissingResources");
    expect(moonPageSource).not.toContain("{status.reason}");
    expect(moonPageSource).not.toContain('title={status.disabled ? status.reason : undefined}');
  });

  test("renders moon structure details with readable clickable requirements", () => {
    expect(moonPageSource).toContain("onOpenRequirement={onOpenRequirement}");
    expect(moonPageSource).toContain('label: "Lunar Base level 1"');
    expect(moonPageSource).toContain('label: "Robotics Factory level 2"');
    expect(moonPageSource).toContain('? { kind: "moonStructure", key }');
    expect(moonPageSource).toContain("MoonStructureComparisonMetric");
    expect(moonPageSource).toContain("MoonStructureLevelInfoButton");
    expect(moonPageSource).toContain("MoonStructureLevelInfoModal");
    expect(moonPageSource).toContain("moonStructureCatalogStatusText(building)");
    expect(moonPageSource).toContain("moonStructureBuildDurationSeconds");
    expect(moonPageSource).toContain("isBinaryMoonStructure(building.key)");
    expect(moonPageSource).not.toContain('InspectInfoBlock label="Current level"');
    expect(moonPageSource).not.toContain('InspectInfoBlock label="Current effect"');
    expect(moonPageSource).not.toContain('InspectInfoBlock label="Next effect"');
    expect(moonPageSource).not.toContain('label: "Lunar Base first"');
    expect(moonPageSource).not.toContain('label: "Open field"');
    expect(moonPageSource).not.toContain("{fieldSummary.used} / {fieldSummary.capacity} fields");
    expect(moonPageSource).not.toContain('statusText={status.disabled ? status.reason : formatCost(status.cost)}');
    expect(moonPageSource).not.toContain("statusText={status.costAvailable ? formatCost(status.cost) : \"Cost pending\"}");
    expect(moonPageSource).not.toContain("Cost unavailable");
    expect(moonPageSource).not.toContain("required`,");
    expect(moonPageSource).not.toContain("\"Pending\" : formatDuration(row.durationSeconds)");
    expect(moonPageSource).not.toContain(": \"Met\"");
    expect(moonPageSource).not.toContain('<MoonMetric icon={Orbit} label="Jump Gate"');
  });

  test("reuses the Infrastructure level popup for Moon structures and omits Jump Gate info", () => {
    expect(moonStructureHasLevelInfo("lunarBase")).toBe(true);
    expect(moonStructureHasLevelInfo("roboticsFactory")).toBe(true);
    expect(moonStructureHasLevelInfo("shipyard")).toBe(true);
    expect(moonStructureHasLevelInfo("jumpGate")).toBe(false);
    expect(moonPageSource).toContain('from "./LevelInfoModal"');
    expect(infrastructurePageSource).toContain('from "./LevelInfoModal"');
    expect(moonPageSource).toContain("moonStructureHasLevelInfo(building.key)");
    expect(moonPageSource).toContain("isInfoOpen ?");
    expect(moonPageSource).not.toContain('aria-labelledby="moon-building-level-info-title"');
  });

  test("adapts Moon Robotics Factory and Shipyard data into the shared level layout", () => {
    const moonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 6,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      buildings: [{
        id: 0,
        key: "lunarBase",
        label: "Lunar Base",
        level: 1,
        cost: { metal: "40000", crystal: "80000", deuterium: "40000" },
      }, {
        id: 1,
        key: "roboticsFactory",
        label: "Robotics Factory",
        level: 1,
        cost: { metal: "800", crystal: "240", deuterium: "400" },
        durationSeconds: 120,
      }, {
        id: 3,
        key: "shipyard",
        label: "Shipyard",
        level: 0,
        cost: { metal: "400", crystal: "200", deuterium: "100" },
        durationSeconds: 180,
      }],
    });
    const robotics = moonState.buildings[1]!;
    const shipyard = moonState.buildings[2]!;
    const roboticsRows = moonStructureLevelInfoRows(robotics, moonState.moon!, moonState);
    const shipyardRows = moonStructureLevelInfoRows(shipyard, moonState.moon!, moonState);
    const roboticsModal = MoonStructureLevelInfoModal({
      buildingKey: robotics.key,
      buildingLabel: robotics.label,
      currentLevel: robotics.level,
      onClose: () => undefined,
      rows: roboticsRows,
    });
    const shipyardModal = MoonStructureLevelInfoModal({
      buildingKey: shipyard.key,
      buildingLabel: shipyard.label,
      currentLevel: shipyard.level,
      onClose: () => undefined,
      rows: shipyardRows,
    });

    expect(visibleText(roboticsModal)).toContain("Robotics Factory levels");
    expect(visibleText(roboticsModal)).toContain("Metal 800, Crystal 240, Deuterium 400");
    expect(visibleText(roboticsModal)).toContain("Moon structure build divisor x2");
    expect(visibleText(shipyardModal)).toContain("Shipyard levels");
    expect(visibleText(shipyardModal)).toContain("Robotics Factory level 2");
    expect(visibleText(shipyardModal)).toContain("Moon defense build divisor x2");
  });

  test("omits Lunar Base requirements and portals the shared popup above detail cards", () => {
    const modal = MoonStructureLevelInfoModal({
      buildingKey: "lunarBase",
      buildingLabel: "Lunar Base",
      currentLevel: 1,
      onClose: () => undefined,
      rows: [{
        cost: { metal: 40_000, crystal: 80_000, deuterium: 40_000 },
        durationSeconds: 120,
        effect: "+3 gross fields, 1 field used",
        level: 1,
        requirements: "1 open field",
        status: "current",
      }],
    }) as VNode;
    const closeButton = componentNodes(modal).find((node) => node.type === "button" && node.props?.["aria-label"] === "Close level table");

    expect(moonStructureLevelInfoColumns("lunarBase").map((column) => column.label)).toEqual([
      "Upgrade cost",
      "Build time",
      "Effect",
    ]);
    expect(visibleText(modal)).not.toContain("Requirements");
    expect(modal.props?.["data-level-info-layer"]).toBe("viewport");
    expect(String(modal.props?.className)).toContain("z-[100]");
    expect(closeButton).toBeDefined();
    expect(levelInfoModalSource).toContain("createPortal(layer, document.body)");
    expect(levelInfoModalSource).toContain("100dvh");
    expect(levelInfoModalSource).toContain("overflow-auto overscroll-contain");
  });

  test("falls back to known moon structure catalog costs when indexed cost is zero", () => {
    const moonState = loadedMoonState({
      moon: {
        exists: true,
        planetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        fields: 4,
        diameterKm: 8774,
        createdAt: "1770000000",
        jumpGateReadyAt: "0",
      },
      resourcesAsOfNow: { metal: "100000", crystal: "100000", deuterium: "100000" },
      buildings: [{
        id: 0,
        key: "lunarBase",
        label: "Lunar Base",
        level: 0,
        cost: { metal: "0", crystal: "0", deuterium: "0" },
        durationSeconds: 1440,
      }],
    });
    const status = moonStructureStatus(moonState.buildings[0], moonState.moon!, moonState, { canTransact: true });

    expect(status.costAvailable).toBe(true);
    expect(status.cost).toEqual({ metal: 20000, crystal: 40000, deuterium: 20000 });
  });

  test("marks ready moon queues available for completion only after backend readiness", () => {
    expect(queueReady({
      active: true,
      kind: "moon-building",
      itemId: 0,
      targetLevel: 2,
      readyAt: "1770000300",
      cost: { metal: "40000", crystal: "80000", deuterium: "40000" },
      asOfNow: { secondsRemaining: 0, complete: true },
    })).toBe(true);

    expect(queueReady({
      active: true,
      kind: "moon-defense",
      itemId: 0,
      quantity: 1,
      readyAt: "1770000300",
      cost: { metal: "2000", crystal: "0", deuterium: "0" },
      asOfNow: { secondsRemaining: 12, complete: false },
    })).toBe(false);
  });

  test("passes transaction sync copy into loaded moon systems while actions are gated", () => {
    const page = MoonPage({
      canTransact: false,
      loading: false,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 1,
          cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        }],
        queue: null,
      },
      onRefresh: () => undefined,
      transactionUnavailableReason: "Ship production: syncing indexed state...",
    });
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(systemsPanel?.props?.canTransact).toBe(false);
    expect(systemsPanel?.props?.transactionUnavailableReason).toBe("Ship production: syncing indexed state...");
  });

  test("renders indexed-not-ready Moon state without the telemetry loader", () => {
    const page = MoonPage({
      loading: false,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: null,
        moonAvailable: false,
        unavailableReason: "Moon indexed state is still warming. Refresh shortly.",
        indexedNotReady: true,
        moon: null,
        buildings: [],
        queue: null,
      },
      onRefresh: () => undefined,
    });
    const text = visibleText(page);

    expect(text).toContain("Moon state is indexing");
    expect(text).toContain("Moon indexed state is still warming. Refresh shortly.");
    expect(text).not.toContain("Reading lunar telemetry");
    expect(text).not.toContain("No moon in orbit");
  });
});

function loadedMoonState(overrides: Partial<ChainMoonState> = {}): ChainMoonState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    moon: null,
    buildings: [],
    queue: null,
    defenses: [],
    defenseQueue: null,
    ...overrides,
  };
}

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if (vnode.type.name === "MoonSystemsPanel") {
      return [];
    }
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return textParts(vnode.type(vnode.props));
  }
  return textParts(vnode.props?.children as ComponentChildren);
}

function componentNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(componentNodes);
  }

  const vnode = node as VNode;
  return [vnode, ...componentNodes(vnode.props?.children as ComponentChildren)];
}
