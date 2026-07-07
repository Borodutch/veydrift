import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  planetImageForType,
  planetsFromSystemResponse
} from "../src/data/mockUniverse";
import { buildingCatalog, defenseCatalog, shipCatalog } from "../src/playableMvp";
import { emptyMissionShips, galaxyActionsForSlot, type GalaxyAction } from "../src/galaxyActions";
import {
  cachedGalaxySystemPlanets,
  clearGalaxySystemCache,
  estimateGalaxyMissionPreview,
  PUBLIC_INTEL_SUMMARY_LABEL,
  formatGalaxyHeatLabel,
  formatAllianceLabel,
  formatAttackBlockReason,
  formatAttackRuleLabels,
  formatGalaxyAllianceIdentityLabel,
  formatGalaxyCommanderLabel,
  formatMoonChanceLabel,
  formatMissionPreview,
  formatGalaxyOccupancySource,
  formatGalaxyOccupancySummary,
  galaxySystemRequestUrl,
  galaxyMissionFuelCost,
  galaxyMissionTravelSeconds,
  planetsForFailedGalaxyLoad,
  rememberGalaxySystemPayload,
  shouldShowGalaxyInitialLoader,
  shouldShowGalaxyRows,
  systemLoadErrorLabel
} from "../src/components/GalaxyView";
import { GAME_UNAVAILABLE_MESSAGE } from "../src/gameUnavailable";
import {
  planetDetailRefreshResultPlanet,
  planetDetailRefreshStartPlanet,
  planetRecordStatusLabel,
  publicCommanderRows,
  publicQueueRows,
  publicPlanetDataRows,
  publicProductionRows,
  publicResourceRows,
  publicStateRows,
  publicStationedDefenderRows,
  publicSignalRows,
  shouldShowPlanetDetailInitialLoader
} from "../src/components/PlanetDetail";
import {
  moonQueueRows,
  moonRecordRows,
  moonResourceRows,
  moonStateRows,
  publicMoonActions,
} from "../src/components/PublicMoonDetail";
import { isImageReady, type ImageLoadState } from "../src/imageLoadState";
import { getSrcSet, VARIANT_WIDTHS } from "../src/utils/imageSizes";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const PLANET_TYPES = [
  "scorching-molten",
  "hot-desert",
  "warm-terracotta",
  "temperate-ocean",
  "lush-temperate",
  "cool-misty-blue",
  "cold-tundra",
  "frozen-ice",
  "outer-cryo",
  "metal-planetoid",
  "crystal-violet",
  "deuterium-blue",
] as const;

const APPROVED_BUILDING_ASSETS = [
  {
    key: "fusionReactor",
    label: "Fusion Reactor",
    sha256: "e95cada20cecb0e8d08b2684cc4cb3e5e6174a9c6a181e197dc7671fd47ebf02",
  },
  {
    key: "missileSilo",
    label: "Missile Silo",
    sha256: "59599920da43538da6aac9dd758e58ec70ab340e4a111dcfd991297517c8b770",
  },
  {
    key: "interdimensionalRiftStabilizer",
    label: "Rift Stabilizer",
    sha256: "ba1c702dc91797791f810c0dc1a7b6db2b5ad8a5034ede515a1dad16805582b9",
  },
] as const;

const APPROVED_MISSILE_DEFENSE_ASSETS = [
  {
    key: "antiBallisticMissile",
    label: "Anti-Ballistic Missile",
    sha256: "4d0acc42e6ba5dbe9acc48bc4a40f3b2874d206471cbad43e8109095d3e8dca4",
  },
  {
    key: "interplanetaryMissile",
    label: "Interplanetary Missile",
    sha256: "2e1912b8d8419e26bcffd80b2f8cfc1617ef6e1bf435571b0c156875ef314620",
  },
] as const;

describe("tester universe display data", () => {
  test("public occupancy is preserved as an owner address only", () => {
    const planets = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          archetype: "cold-tundra",
          fields: 211,
          galaxy: 2,
          key: "2:44:8",
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 8,
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(planets[0]).toMatchObject({
      alliance: null,
      owner: "0x2222222222222222222222222222222222222222",
      ownerId: "0x2222222222222222222222222222222222222222",
      occupiedBy: {
        owner: "0x2222222222222222222222222222222222222222",
        planetId: "7",
      },
    });
  });

  test("keys galaxy system requests only by API base and coordinates", () => {
    expect(galaxySystemRequestUrl("https://api.test/", 2, 44)).toBe(
      "https://api.test/universe/galaxies/2/systems/44"
    );
    expect(galaxySystemRequestUrl("https://api.test", 2, 44)).toBe(
      "https://api.test/universe/galaxies/2/systems/44"
    );
  });

  test("reuses a recently loaded galaxy system payload for instant same-system renders", () => {
    clearGalaxySystemCache();
    const payload = {
      galaxy: 6,
      system: 9,
      planets: [
        {
          fields: 211,
          galaxy: 6,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 1,
          system: 9,
          temperature: -8,
        },
      ],
    };

    const planets = rememberGalaxySystemPayload("https://api.test", 6, 9, payload, 1_000);

    expect(planets).toHaveLength(1);
    expect(cachedGalaxySystemPlanets("https://api.test/", 6, 9, 1_000 + 119_999)?.[0]?.occupiedBy?.planetId).toBe("7");
    expect(cachedGalaxySystemPlanets("https://api.test", 6, 9, 1_000 + 120_001)).toBeUndefined();
  });

  test("galaxy system network failures use the shared unavailable retry copy", () => {
    expect(systemLoadErrorLabel(new TypeError("Failed to fetch"))).toBe(GAME_UNAVAILABLE_MESSAGE);
    expect(systemLoadErrorLabel(new Error("Universe request failed with 503"))).toBe(GAME_UNAVAILABLE_MESSAGE);
  });

  test("public planet detail preserves public state rows and queue labels", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          fields: 211,
          galaxy: 2,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          publicState: {
            resources: {
              metal: "5000",
              crystal: "4900",
              deuterium: "4800",
            },
            buildings: [{ id: 0, level: 12 }],
            fleet: [
              { id: 0, count: 3 },
              { id: 9, count: 5 },
            ],
            defenses: [{ id: 0, count: 7 }],
            research: [{ id: 0, level: 4 }],
            queues: {
              building: {
                active: true,
                itemId: 0,
                kind: "building",
                targetLevel: 13,
                readyAt: "1770000060",
              },
            },
          },
          position: 8,
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(planet.publicState?.resources).toEqual({
      metal: "5000",
      crystal: "4900",
      deuterium: "4800",
    });
    expect(publicResourceRows(planet.publicState?.resources)?.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Metal: 5,000",
      "Crystal: 4,900",
      "Deuterium: 4,800",
    ]);
    expect(publicStateRows(planet.publicState?.buildings, buildingCatalog, "level")).toContainEqual({
      label: "Metal Mine",
      value: "Level 12",
    });
    expect(publicStateRows(planet.publicState?.fleet, shipCatalog, "count")).toContainEqual({
      label: "Small Cargo",
      value: "3",
    });
    expect(publicStateRows(planet.publicState?.fleet, shipCatalog, "count")).toContainEqual({
      label: "Solar Satellite",
      value: "5",
    });
    expect(publicStationedDefenderRows([
      {
        missionId: "41",
        defender: "0x4444444444444444444444444444444444444444",
        defenderDisplayName: "Ally Shield",
        ships: { lightFighter: "15" },
        holdUntil: "1770003600",
        allianceDepotLevel: 2,
      },
    ])).toEqual([
      expect.objectContaining({
        label: "Ally Shield",
        value: expect.stringContaining("15 ships until"),
        tone: "accent",
      }),
    ]);
    expect(publicQueueRows(planet)).toContainEqual({
      label: "Building",
      value: "Metal Mine Level 13",
      tone: "accent",
    });

    expect(publicResourceRows(undefined)).toBeNull();
  });

  test("public occupancy preserves owner alliance intel when the API provides it", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          archetype: "cold-tundra",
          fields: 211,
          galaxy: 2,
          key: "2:44:8",
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            alliance: {
              allianceId: "3",
              tag: "VDFT",
              name: "Veydrift Union",
            },
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 8,
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(planet?.alliance).toEqual({
      allianceId: "3",
      tag: "VDFT",
      name: "Veydrift Union",
    });
    expect(formatAllianceLabel(planet?.alliance ?? null)).toBe("[VDFT] Veydrift Union");
    expect(formatGalaxyAllianceIdentityLabel(planet?.alliance ?? null)).toBe("[VDFT]");
    expect(formatGalaxyCommanderLabel(planet!)).toBe("0x2222...2222");
  });

  test("galaxy row commander and alliance copy stays explicit", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          archetype: "cold-tundra",
          fields: 211,
          galaxy: 2,
          key: "2:44:8",
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            ownerDisplayName: "Nova Prime",
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 8,
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(formatGalaxyCommanderLabel(planet!)).toBe("Nova Prime");
    expect(formatGalaxyAllianceIdentityLabel(planet?.alliance ?? null)).toBe("No alliance");
  });

  test("galaxy attack intel uses clear target and loot copy", () => {
    const sameAllianceStatus = {
      allowed: false,
      blockedReason: "same_alliance" as const,
      blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
      defenderHonorStatus: "honorable" as const,
      defenderInactive: true,
      plunderBps: 7500,
      relation: "weaker" as const,
    };

    expect(formatAttackBlockReason(sameAllianceStatus)).toBe("Attack blocked: target belongs to your alliance.");
    expect(formatAttackRuleLabels(sameAllianceStatus)).toEqual([
      "Weaker target",
      "Honor target",
      "Loot: 75%",
    ]);
    expect(formatAttackRuleLabels(sameAllianceStatus).join(" ")).not.toMatch(/\bHonorable\b|Inactive target\b|plunder/i);
    expect(formatAttackBlockReason({
      allowed: false,
      blockedReason: "same_alliance",
    })).toBe("Attack blocked: target belongs to your alliance.");
  });

  test("galaxy occupancy summary avoids implementation wording", () => {
    const labels = [
      formatGalaxyOccupancySummary(0),
      formatGalaxyOccupancySummary(3),
      formatGalaxyOccupancySource("api", false),
      formatGalaxyOccupancySource("error", false),
      formatGalaxyOccupancySource("api", true),
    ].filter((label): label is string => Boolean(label));

    expect(labels).toEqual([
      "No occupants",
      "3 occupied",
    ]);
    expect(labels.join(" ")).not.toMatch(/\b(indexed|real|fallback|injected|data|current system|home planet shown)\b/i);
  });

  test("keeps current galaxy system rows visible during background refreshes", () => {
    expect(shouldShowGalaxyInitialLoader({
      hasCurrentSystemData: true,
      loading: true,
    })).toBe(false);
    expect(shouldShowGalaxyRows({
      hasCurrentSystemData: true,
    })).toBe(true);
  });

  test("uses the full galaxy loader only before current-system rows exist", () => {
    expect(shouldShowGalaxyInitialLoader({
      hasCurrentSystemData: false,
      loading: true,
    })).toBe(true);
    expect(shouldShowGalaxyRows({
      hasCurrentSystemData: false,
    })).toBe(false);
  });

  test("keeps current planet detail records visible during background refreshes", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 211,
        galaxy: 2,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        position: 8,
        system: 44,
        temperature: -8,
      }],
    });

    expect(shouldShowPlanetDetailInitialLoader({ planet: null, source: "loading" })).toBe(true);
    expect(shouldShowPlanetDetailInitialLoader({ planet, source: "loading" })).toBe(false);
    expect(planetRecordStatusLabel(planet, "loading", false)).toBe("Refreshing public records");
  });

  test("planet detail public records show useful public planet data", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          archetype: "cold-tundra",
          fields: 211,
          galaxy: 2,
          key: "2:44:8",
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
          position: 8,
          system: 44,
          temperature: -8,
          debrisField: {
            metal: "40000",
            crystal: "15000",
          },
          moonChance: {
            battleId: "42",
            targetPlanetId: "7",
            status: "pending",
            chanceBps: 1500,
          },
        },
      ],
    });

    expect(planetRecordStatusLabel(planet, "api", false)).toBe("Occupied public world");
    expect(publicCommanderRows(planet, false).map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Settlement: Occupied",
      "Player: 0x2222...2222",
      "Planet ID: #7",
    ]);
    expect(publicPlanetDataRows(planet).map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Coordinates: [2:44:8]",
      "Type: Cold Tundra",
      "Fields: 211",
      "Diameter: 15,192 km",
      "Temperature: -28°C to 12°C",
      "Debris: 40,000 metal / 15,000 crystal",
      "Moon signal: Moon chance 15% pending",
    ]);
    expect(publicSignalRows(planet)).toEqual(publicPlanetDataRows(planet));
    expect(publicProductionRows(planet).map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Metal: 100%",
      "Crystal: 100%",
      "Deuterium: 100%",
      "Solar satellite: 22 E",
    ]);

    const copy = [
      planetRecordStatusLabel(planet, "api", false),
      ...publicCommanderRows(planet, false).map((row) => row.value),
      ...publicPlanetDataRows(planet).map((row) => row.value),
      ...publicProductionRows(planet).map((row) => row.value),
    ].join(" ");
    expect(copy).not.toMatch(/\b(indexed|indexer|backend|universe data|OGame|ogame)\b/i);
  });

  test("public moon detail rows use indexed moon state from universe responses", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          fields: 211,
          galaxy: 2,
          hasMoon: true,
          key: "2:44:9",
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          position: 9,
          publicMoonState: {
            fields: 12,
            diameterKm: 8777,
            createdAt: "1770000300",
            resources: { metal: "7386", crystal: "2472", deuterium: "1335" },
            buildings: [{ id: 0, level: 2 }, { id: 3, level: 1 }],
            fleet: [{ id: 0, count: 5 }],
            defenses: [{ id: 0, count: 7 }],
            queues: {
              building: null,
              defense: {
                active: true,
                itemId: 0,
                kind: "defense",
                quantity: 3,
                readyAt: "1770000900",
              },
            },
          },
          system: 44,
          temperature: -8,
        },
      ],
    });

    expect(planet.publicMoonState?.resources).toEqual({ metal: "7386", crystal: "2472", deuterium: "1335" });
    expect(moonResourceRows(planet).map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Metal: 7,386",
      "Crystal: 2,472",
      "Deuterium: 1,335",
    ]);
    expect(moonRecordRows(planet).map((row) => `${row.label}: ${row.value}`)).toEqual(expect.arrayContaining([
      "Fields: 12",
      "Diameter: 8,777 km",
      "Parent type: Temperate Ocean",
    ]));
    expect(moonStateRows(planet.publicMoonState?.buildings, [{ id: 0, label: "Lunar Base" }, { id: 3, label: "Shipyard" }], "level")).toEqual([
      { label: "Lunar Base", value: "Level 2" },
      { label: "Shipyard", value: "Level 1" },
    ]);
    expect(moonQueueRows(planet).map((row) => row.label)).toContain("Defense");
  });

  test("public moon detail actions target the moon body when launched", () => {
    const account = "0x1111111111111111111111111111111111111111";
    const enemyOwner = "0x2222222222222222222222222222222222222222";
    const [enemyMoon] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 211,
        galaxy: 2,
        hasMoon: true,
        key: "2:44:9",
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        occupiedBy: { owner: enemyOwner, planetId: "9" },
        position: 9,
        publicMoonState: { resources: { metal: "1", crystal: "2", deuterium: "3" } },
        system: 44,
        temperature: -8,
      }],
    });
    const [ownMoon] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 211,
        galaxy: 2,
        hasMoon: true,
        key: "2:44:1",
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        occupiedBy: { owner: account, planetId: "10" },
        position: 1,
        publicMoonState: { resources: { metal: "1", crystal: "2", deuterium: "3" } },
        system: 44,
        temperature: -8,
      }],
    });
    const shipyardState = {
      homePlanetId: "7",
      productionAvailable: true,
      resources: null,
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
      wallet: account,
    };
    const launched: Array<{ kind: string; defaultTargetIsMoon?: boolean }> = [];
    const base = {
      account,
      actionState: { status: "idle" as const },
      attackProtection: null,
      defenseState: null,
      homeCoords: { galaxy: 2, system: 44, position: 1 },
      homePlanetId: "7",
      onAction: (action: GalaxyAction) => {
        launched.push({
          defaultTargetIsMoon: "defaultTargetIsMoon" in action ? action.defaultTargetIsMoon : undefined,
          kind: action.kind,
        });
      },
      shipyardState: shipyardState as never,
    };

    const enemyActions = publicMoonActions({
      ...base,
      coords: { galaxy: 2, system: 44, position: 9 },
      planet: enemyMoon,
    });
    expect(enemyActions.map((action) => action.kind)).toEqual(["inspect", "attack", "transport", "deploy", "defend"]);
    enemyActions.find((action) => action.kind === "attack")?.onClick?.();

    const ownActions = publicMoonActions({
      ...base,
      coords: { galaxy: 2, system: 44, position: 1 },
      planet: ownMoon,
    });
    ownActions.find((action) => action.kind === "transport")?.onClick?.();
    ownActions.find((action) => action.kind === "deploy")?.onClick?.();

    expect(launched).toEqual([
      { kind: "attack", defaultTargetIsMoon: true },
      { kind: "transport", defaultTargetIsMoon: true },
      { kind: "deploy", defaultTargetIsMoon: true },
    ]);
    expect(ownActions.find((action) => action.kind === "defend")?.disabledReason).toContain("Moon defense stationing");
  });

  test("planet detail uses canonical Solar Satellite E/Sat temperature", () => {
    const [reportedColdPlanet, coldPlanet, hotPlanet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          fields: 211,
          galaxy: 8,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          position: 11,
          system: 490,
          temperature: -59,
        },
        {
          fields: 211,
          galaxy: 2,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          position: 14,
          system: 44,
          temperature: -200,
        },
        {
          fields: 211,
          galaxy: 2,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          position: 1,
          system: 44,
          temperature: 400,
        },
      ],
    });

    expect(publicPlanetDataRows(reportedColdPlanet).map((row) => `${row.label}: ${row.value}`)).toContain("Temperature: -79°C to -39°C");
    expect(publicProductionRows(reportedColdPlanet).map((row) => `${row.label}: ${row.value}`)).toContain("Solar satellite: 13 E");
    expect(publicProductionRows(coldPlanet).map((row) => `${row.label}: ${row.value}`)).toContain("Solar satellite: 1 E");
    expect(publicProductionRows(hotPlanet).map((row) => `${row.label}: ${row.value}`)).toContain("Solar satellite: 65 E");
  });

  test("keeps loaded planet detail visible during same-coordinate background refreshes", () => {
    const [loadedPlanet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 211,
        galaxy: 2,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        position: 8,
        system: 44,
        temperature: -8,
      }],
    });
    const [freshPlanet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 212,
        galaxy: 2,
        key: "2:44:8-fresh",
        metalMultiplierBps: 11_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        position: 8,
        system: 44,
        temperature: -6,
      }],
    });
    const coords = { galaxy: 2, system: 44, position: 8 };

    expect(planetDetailRefreshStartPlanet({
      coords,
      currentPlanet: loadedPlanet,
      trustedHomePlanet: null,
    })).toBe(loadedPlanet);

    expect(planetDetailRefreshResultPlanet({
      apiPlanet: null,
      coords,
      currentPlanet: loadedPlanet,
      trustedHomePlanet: null,
    })).toBe(loadedPlanet);

    expect(planetDetailRefreshResultPlanet({
      apiPlanet: freshPlanet,
      coords,
      currentPlanet: loadedPlanet,
      trustedHomePlanet: null,
    })).toBe(freshPlanet);
  });

  test("uses initial planet detail loader only when the selected coordinates have no loaded data", () => {
    const [loadedPlanet] = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [{
        fields: 211,
        galaxy: 2,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        position: 8,
        system: 44,
        temperature: -8,
      }],
    });

    expect(planetDetailRefreshStartPlanet({
      coords: { galaxy: 2, system: 44, position: 9 },
      currentPlanet: loadedPlanet,
      trustedHomePlanet: null,
    })).toBeNull();
  });

  test("formats moon chance status for galaxy rows", () => {
    expect(formatMoonChanceLabel({
      battleId: "42",
      targetPlanetId: "7",
      status: "pending",
      chanceBps: 1500,
    })).toBe("Moon chance 15% pending");
    expect(formatMoonChanceLabel({
      battleId: "43",
      targetPlanetId: "7",
      status: "created",
      moonDiameterKm: 7000,
    })).toBe("Moon created 7,000 km");
  });

  test("galaxy heat label is derived from the orbital temperature range", () => {
    expect(formatGalaxyHeatLabel({ min: 46, max: 74 })).toBe("Scorching Molten");
    expect(formatGalaxyHeatLabel({ min: -28, max: 68 })).toBe("Lush Temperate");
    expect(formatGalaxyHeatLabel({ min: -80, max: 0 })).toBe("Frozen Ice");
  });

  test("failed galaxy system loads do not generate preview planets", () => {
    expect(planetsForFailedGalaxyLoad()).toEqual([]);
  });

  test("API planets with missing live fields are skipped instead of using fake defaults", () => {
    const planets = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          galaxy: 2,
          system: 44,
          position: 8,
          occupiedBy: {
            owner: "0x2222222222222222222222222222222222222222",
            planetId: "7",
          },
        },
      ],
    });

    expect(planets).toEqual([]);
  });

  test("galaxy mission preview shows slots, fuel timing, and blocked reasons", () => {
    const preview = estimateGalaxyMissionPreview({
      homeCoords: { galaxy: 1, system: 10, position: 5 },
      now: Date.UTC(2026, 4, 21, 17, 0, 0),
      planner: {
        fleetSlots: { active: 1, limit: 3 },
        resources: { deuterium: 250 },
        missionShips: { smallCargo: 2, lightFighter: 1 },
        ships: [{ id: 0, count: 2 }],
      },
      target: { galaxy: 1, system: 20, position: 7 },
    });

    expect(preview).toMatchObject({
      blockedReason: undefined,
      cargoCapacity: 10_035,
      fleetSlots: { active: 1, limit: 3 },
      fuelCost: 15,
    });
    expect(formatMissionPreview(preview!)).toContain("Fleet 1/3 / Fuel 15 D / Cargo 10,035");

    expect(estimateGalaxyMissionPreview({
      homeCoords: { galaxy: 1, system: 10, position: 5 },
      planner: {
        fleetSlots: { active: 3, limit: 3 },
        resources: { deuterium: 250 },
        ships: [{ id: 0, count: 2 }],
      },
      target: { galaxy: 1, system: 20, position: 7 },
    })?.blockedReason).toBe("No fleet slots open — research Computer Technology for more");
  });

  test("galaxy mission preview formulas match contract primitives across distances", () => {
    const origin = { galaxy: 1, system: 1, position: 1 };

    expect(galaxyMissionTravelSeconds(origin, origin)).toBe(10);
    expect(galaxyMissionFuelCost(origin, origin, 3)).toBe(0);

    const nearby = { galaxy: 1, system: 3, position: 4 };
    expect(galaxyMissionTravelSeconds(origin, nearby)).toBe(851);
    expect(galaxyMissionFuelCost(origin, nearby, 3)).toBe(11);

    const distant = { galaxy: 4, system: 499, position: 15 };
    expect(galaxyMissionTravelSeconds(origin, distant)).toBe(3_844);
    expect(galaxyMissionFuelCost(origin, distant, 3)).toBe(207);
  });

  test("galaxy slot actions expose supported public-state missions without espionage", () => {
    const enemy = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          fields: 211,
          galaxy: 2,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          system: 44,
          position: 8,
          temperature: -8,
          occupiedBy: {
            owner: "0x3333333333333333333333333333333333333333",
            planetId: "9",
          },
        },
      ],
    })[0];
    const enemyWithDebris = {
      ...enemy,
      debrisField: {
        metal: 40_000,
        crystal: 15_000,
      },
    };
    const own = planetsFromSystemResponse({
      galaxy: 2,
      system: 44,
      planets: [
        {
          fields: 211,
          galaxy: 2,
          metalMultiplierBps: 10_000,
          crystalMultiplierBps: 10_000,
          deuteriumMultiplierBps: 10_000,
          system: 44,
          position: 9,
          temperature: -8,
          occupiedBy: {
            owner: "0x1111111111111111111111111111111111111111",
            planetId: "10",
          },
        },
      ],
    })[0];
    const shipyardState = {
      homePlanetId: "7",
      productionAvailable: true,
      resources: null,
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 1, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 2, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        { id: 3, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
      wallet: "0x1111111111111111111111111111111111111111",
    };
    const defenseState = {
      homePlanetId: "7",
      productionAvailable: true,
      resources: null,
      shipyardLevel: 1,
      naniteLevel: 0,
      missileSiloLevel: 4,
      technologyLevels: {},
      defenses: [
        { id: 9, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
      wallet: "0x1111111111111111111111111111111111111111",
    };

    const enemyActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: enemy,
      defenseState,
      shipyardState,
    });
    const ownActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: own,
      shipyardState,
    });
    const harvestActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: enemyWithDebris,
      defenseState,
      shipyardState,
    });
    const noRecyclerHarvestActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: enemyWithDebris,
      defenseState,
      shipyardState: {
        ...shipyardState,
        ships: shipyardState.ships.filter((ship) => ship.id !== 2),
      },
    });
    const originActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      isOrigin: true,
      planet: own,
      shipyardState,
    });
    const emptyActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: undefined,
      shipyardState,
    });
    const noCargoActions = galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: own,
      shipyardState: {
        ...shipyardState,
        ships: [
          { id: 1, count: 1, cost: { metal: "0", crystal: "0", deuterium: "0" } },
        ],
      },
    });

    expect(enemyActions.map((action) => action.label)).toEqual([
      "Attack",
      "Harvest",
      "Missile",
    ]);
    expect(enemyActions.map((action) => action.kind)).not.toContain("acsDefend");
    expect(enemyActions.map((action) => action.kind)).not.toContain("intercept");
    expect(enemyActions.find((action) => action.kind === "attack")?.enabled).toBe(true);
    expect(enemyActions.find((action) => action.kind === "missileAttack")).toMatchObject({
      enabled: true,
      mode: "missile",
      primaryTargetId: 0,
      quantity: 1,
    });
    expect(enemyActions.find((action) => action.kind === "harvest")).toMatchObject({
      enabled: false,
      reason: "No debris field at this coordinate.",
    });
    expect(harvestActions.find((action) => action.kind === "harvest")).toMatchObject({
      enabled: true,
      mode: "mission",
      mission: "harvest",
      ships: {
        recycler: 1,
      },
    });
    expect(noRecyclerHarvestActions.find((action) => action.kind === "harvest")).toMatchObject({
      enabled: false,
      reason: "Requires a recycler on your home planet.",
    });
    expect(ownActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    expect(ownActions.find((action) => action.kind === "defenseHold")).toMatchObject({
      enabled: true,
      mode: "mission",
      mission: "defenseHold",
    });
    // The home/launch planet keeps the proactive Defend action visible but disabled (launchDefenseHold
    // reverts with SamePlanet on origin == target) so single-colony wallets still discover the feature
    // and see the eligibility prerequisite (VEY-KANEO-440).
    expect(originActions).toMatchObject([
      {
        kind: "defenseHold",
        enabled: false,
        label: "Defend",
        reason:
          "You can't station a defending fleet at the planet it launches from. Open another colony or an alliance member's planet to defend it.",
      },
    ]);
    expect(emptyActions).toMatchObject([{ enabled: true, kind: "colonize", label: "Colonize" }]);
    expect(noCargoActions).toMatchObject([
      { enabled: false, kind: "transport", reason: "Requires a cargo-capable ship on your home planet." },
      { enabled: false, kind: "deploy", reason: "Requires a cargo-capable ship on your home planet." },
      // A lone Light Fighter cannot carry cargo but is movable, so proactive Defend stays available.
      { enabled: true, kind: "defenseHold", label: "Defend" },
    ]);
    expect([...enemyActions, ...ownActions, ...emptyActions].map((action) => action.label).join(" ")).not.toMatch(/spy|espionage|probe/i);
    expect(PUBLIC_INTEL_SUMMARY_LABEL).toBe("Public intel");
    expect(Object.keys(enemyActions.find((action) => action.kind === "attack" && action.enabled)?.ships ?? {})).toEqual(
      Object.keys(emptyMissionShips())
    );

    expect(galaxyActionsForSlot({
      account: "0x1111111111111111111111111111111111111111",
      homePlanetId: "7",
      planet: enemy,
      defenseState: {
        ...defenseState,
        defenses: [{ id: 9, count: 0, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
      },
      shipyardState,
    }).find((action) => action.kind === "missileAttack")).toMatchObject({
      enabled: false,
      reason: "Requires an interplanetary missile on your active planet.",
    });
  });

  test("visible MVP catalog uses scoped gameplay assets", () => {
    expect(buildingCatalog.every((building) => building.asset.includes("/assets/game/style-pass/generated/buildings/"))).toBe(true);
    expect(shipCatalog).toHaveLength(16);
    expect(shipCatalog.every((ship) => ship.asset.includes("/assets/game/style-pass/generated/ships/"))).toBe(true);
    expect(shipCatalog.some((ship) => ship.asset.includes("/assets/game/ships/"))).toBe(false);
    expect(shipCatalog.find((ship) => ship.key === "smallCargo")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/small-cargo.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "lightFighter")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/light-fighter.webp"
    );
    expect(shipCatalog.find((ship) => ship.key === "colonyShip")?.asset).toBe(
      "/assets/game/style-pass/generated/ships/colony-ship.webp"
    );
  });

  test("approved building assets exist with responsive variants", async () => {
    for (const approvedAsset of APPROVED_BUILDING_ASSETS) {
      const buildingAsset = buildingCatalog.find((building) => building.key === approvedAsset.key)?.asset;

      expect(buildingAsset, approvedAsset.label).toBeDefined();
      expect(buildingAsset, approvedAsset.label).toContain("/assets/game/style-pass/generated/buildings/");
      expect(existsSync(join(PUBLIC_DIR, buildingAsset!.replace("/assets/", "assets/"))), approvedAsset.label).toBe(true);
      expect(await assetHash(buildingAsset!), approvedAsset.label).toBe(approvedAsset.sha256);

      for (const width of VARIANT_WIDTHS) {
        const variant = buildingAsset!.replace("/assets/game/", `/assets/game/sizes/${width}/`);
        expect(getSrcSet(buildingAsset!), approvedAsset.label).toContain(`${variant} ${width}w`);
        expect(existsSync(join(PUBLIC_DIR, variant.replace("/assets/", "assets/"))), approvedAsset.label).toBe(true);
      }
    }
  });

  test("approved missile defense assets exist with responsive variants", async () => {
    for (const approvedAsset of APPROVED_MISSILE_DEFENSE_ASSETS) {
      const defenseAsset = defenseCatalog.find((defense) => defense.key === approvedAsset.key)?.asset;

      expect(defenseAsset, approvedAsset.label).toBeDefined();
      expect(defenseAsset, approvedAsset.label).toContain("/assets/game/style-pass/generated/defenses/");
      expect(existsSync(join(PUBLIC_DIR, defenseAsset!.replace("/assets/", "assets/"))), approvedAsset.label).toBe(true);
      expect(await assetHash(defenseAsset!), approvedAsset.label).toBe(approvedAsset.sha256);

      for (const width of VARIANT_WIDTHS) {
        const variant = defenseAsset!.replace("/assets/game/", `/assets/game/sizes/${width}/`);
        expect(getSrcSet(defenseAsset!), approvedAsset.label).toContain(`${variant} ${width}w`);
        expect(existsSync(join(PUBLIC_DIR, variant.replace("/assets/", "assets/"))), approvedAsset.label).toBe(true);
      }
    }
  });

  test("Fusion Reactor does not reuse Solar Plant artwork", async () => {
    const solarPlantAsset = buildingCatalog.find((building) => building.key === "solarPlant")?.asset;
    const fusionReactorAsset = buildingCatalog.find((building) => building.key === "fusionReactor")?.asset;

    expect(solarPlantAsset).toBeDefined();
    expect(fusionReactorAsset).toBeDefined();
    expect(await assetHash(solarPlantAsset!)).not.toBe(await assetHash(fusionReactorAsset!));
  });

  test("galaxy planet thumbnails use bundled style-pass assets and responsive variants", () => {
    for (const type of PLANET_TYPES) {
      const image = planetImageForType(type);

      expect(image).toBe(`/assets/game/style-pass/generated/planets/${type}.webp`);
      expect(existsSync(join(PUBLIC_DIR, image.replace("/assets/", "assets/")))).toBe(true);

      for (const width of VARIANT_WIDTHS) {
        const variant = image.replace("/assets/game/", `/assets/game/sizes/${width}/`);
        expect(getSrcSet(image)).toContain(`${variant} ${width}w`);
        expect(existsSync(join(PUBLIC_DIR, variant.replace("/assets/", "assets/")))).toBe(true);
      }
    }
  });

  test("planet views treat cached loaded images as ready", () => {
    expect(isImageReady({ complete: true, naturalWidth: 64 } satisfies ImageLoadState)).toBe(true);
    expect(isImageReady({ complete: true, naturalWidth: 0 } satisfies ImageLoadState)).toBe(false);
    expect(isImageReady({ complete: false, naturalWidth: 64 } satisfies ImageLoadState)).toBe(false);
    expect(isImageReady(null)).toBe(false);
  });
});

async function assetHash(asset: string): Promise<string> {
  const bytes = await Bun.file(join(PUBLIC_DIR, asset.replace("/assets/", "assets/"))).arrayBuffer();
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
