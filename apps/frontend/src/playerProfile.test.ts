import { describe, expect, test } from "bun:test";
import {
  isSafeProfileDescriptionUrl,
  playerPlanetTacticalSignals,
  playerProfileHomePlanetLabel,
  profileDescriptionParts
} from "./components/InspectPages";
import { publicCommanderRows } from "./components/PlanetDetail";
import type { Planet } from "./types";
import {
  playerDescriptionMaxLength,
  playerDisplayLabel,
  validatePlayerDescription,
  validatePlayerDisplayName,
  type HighscoreEntry,
  type ManagedPlanetResponse,
  type WalletPlanetsResponse
} from "./walletFlow";

const wallet = "0x1111111111111111111111111111111111111111";

describe("player profile display helpers", () => {
  test("validates display names with stable user-facing errors", () => {
    expect(validatePlayerDisplayName("  Nova  Prime ")).toBeUndefined();
    expect(validatePlayerDisplayName("")).toBe("Enter a display name.");
    expect(validatePlayerDisplayName("A".repeat(33))).toBe("Display names can be at most 32 characters.");
    expect(validatePlayerDisplayName("Nova\nPrime")).toBe("Display names cannot include control or formatting characters.");
  });

  test("validates profile descriptions with stable user-facing errors", () => {
    expect(validatePlayerDescription("Line one\nhttps://veydrift.com")).toBeUndefined();
    expect(validatePlayerDescription("")).toBeUndefined();
    expect(validatePlayerDescription("A".repeat(playerDescriptionMaxLength + 1))).toBe("Descriptions can be at most 500 characters.");
    expect(validatePlayerDescription("Nova\u0000Prime")).toBe("Descriptions cannot include control or formatting characters.");
  });

  test("prefers saved display name and falls back to stable wallet label", () => {
    expect(playerDisplayLabel({
      wallet,
      displayName: "Nova Prime",
      description: "Public bio",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }, wallet)).toBe("Nova Prime");

    expect(playerDisplayLabel({
      wallet,
      displayName: null,
      description: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    }, wallet)).toBe("0x1111...1111");

    expect(playerDisplayLabel(undefined, wallet)).toBe("0x1111...1111");
  });

  test("turns only safe plain URLs into profile links", () => {
    expect(profileDescriptionParts("Raid board https://veydrift.com/raid, ping javascript:alert(1)")).toEqual([
      { text: "Raid board " },
      { href: "https://veydrift.com/raid", text: "https://veydrift.com/raid" },
      { text: "," },
      { text: " ping javascript:alert(1)" }
    ]);
    expect(isSafeProfileDescriptionUrl("https://veydrift.com")).toBe(true);
    expect(isSafeProfileDescriptionUrl("http://example.com/path")).toBe(true);
    expect(isSafeProfileDescriptionUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeProfileDescriptionUrl("data:text/html,hi")).toBe(false);
  });

  test("keeps commander descriptions profile-only in source rendering paths", async () => {
    const inspectPagesSource = await Bun.file(new URL("./components/InspectPages.tsx", import.meta.url)).text();
    const galaxySource = await Bun.file(new URL("./components/GalaxyView.tsx", import.meta.url)).text();
    const rankingsSource = await Bun.file(new URL("./components/RankingsPage.tsx", import.meta.url)).text();
    const overviewSource = await Bun.file(new URL("../tests/overviewPage.test.ts", import.meta.url)).text();

    expect(inspectPagesSource).toContain('<Panel title="Profile">');
    expect(inspectPagesSource).toContain("profileDescriptionParts(description)");
    expect(galaxySource).not.toContain("description");
    expect(rankingsSource).not.toContain("description");
    expect(overviewSource).not.toContain("description");
  });

  test("uses display names on public planet profile rows when present", () => {
    const planet = testPlanet({
      occupiedBy: {
        planetId: "7",
        owner: wallet,
        ownerDisplayName: "Nova Prime"
      }
    });

    expect(publicCommanderRows(planet, false)).toContainEqual({
      label: "Player",
      value: "Nova Prime"
    });
  });

  test("uses profile owner home coordinates while keeping distance relative to viewer origin", () => {
    const ownerPlanet = managedPlanet({
      planetId: "72",
      name: "Nal Hutta",
      galaxy: 2,
      system: 72,
      position: 5
    });
    const planets: WalletPlanetsResponse = {
      wallet: "0xf3d95ca6cc810ab74b5670955a1cc0b68e55a1a4",
      homePlanetId: "72",
      planets: [ownerPlanet]
    };
    const highscore = highscoreEntry({
      homePlanetId: "72",
      homePlanet: {
        planetId: "72",
        name: "Nal Hutta",
        coordinates: { galaxy: 2, system: 72, position: 5 },
        archetype: "temperate-ocean"
      },
      planetCount: 1
    });

    expect(playerProfileHomePlanetLabel(planets, highscore)).toBe("[2:72:5]");
    expect(playerProfileHomePlanetLabel(null, null)).toBeUndefined();

    const signals = playerPlanetTacticalSignals(ownerPlanet, { galaxy: 6, system: 9, position: 1 }, null);
    expect(signals).toContainEqual({ label: "Distance", value: "80,000" });
  });
});

function testPlanet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: "2:44:9",
    name: "Eos",
    type: "temperate-ocean",
    image: "/planet.png",
    position: 9,
    galaxy: 2,
    system: 44,
    owner: wallet,
    ownerId: wallet,
    alliance: null,
    occupiedBy: null,
    debrisField: null,
    moonChance: null,
    resources: {
      metal: 0,
      crystal: 0,
      deuterium: 0,
      energy: 0
    },
    temperature: {
      min: -20,
      max: 40
    },
    diameter: 12_800,
    fields: 211,
    hasMoon: false,
    ...overrides
  };
}

function highscoreEntry(overrides: Partial<HighscoreEntry> = {}): HighscoreEntry {
  return {
    rank: 2,
    wallet,
    alliance: null,
    attackProtection: null,
    displayName: "Jabba",
    homePlanetId: null,
    homePlanet: null,
    planetCount: 0,
    score: {
      total: "0",
      economy: "0",
      research: "0",
      researchLevels: "0",
      military: "0",
      fleet: "0",
      fleetCount: "0",
      defense: "0"
    },
    ...overrides
  };
}

function managedPlanet(overrides: Partial<ManagedPlanetResponse> = {}): ManagedPlanetResponse {
  return {
    planetId: "1",
    owner: wallet,
    name: "Eos",
    galaxy: 1,
    system: 1,
    position: 1,
    fields: 211,
    temperature: 20,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "0",
    resources: {
      metal: "0",
      crystal: "0",
      deuterium: "0"
    },
    coordinates: "[1:1:1]",
    isHomePlanet: true,
    fieldsUsed: 0,
    fieldsCapacity: 211,
    keyLevels: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0
    },
    queues: {
      building: null,
      defense: null,
      ship: null
    },
    moon: null,
    ...overrides
  };
}
