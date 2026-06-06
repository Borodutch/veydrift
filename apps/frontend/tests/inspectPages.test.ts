import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { playerInspectPlanetImage, playerInspectScoreItems, playerPlanetTacticalSignals } from "../src/components/InspectPages";
import type { HighscoreEntry, ManagedPlanetResponse } from "../src/walletFlow";

describe("inspect pages", () => {
  test("builds compact player score summary without wallet duplication", () => {
    const items = playerInspectScoreItems(highscoreEntry());

    expect(items.map((item) => item.label)).toEqual([
      "Total",
      "Economy",
      "Military",
      "Fleet",
      "Defense",
      "Research",
      "Research Lvls",
      "Ships",
    ]);
    expect(items.map((item) => item.label)).not.toContain("Wallet");
    expect(items.find((item) => item.label === "Total")?.value).toBe("4,400");
    expect(items.find((item) => item.label === "Ships")?.value).toBe("42");
  });

  test("summarizes player planet tactical signals from indexed public data", () => {
    const signals = playerPlanetTacticalSignals(
      managedPlanet(),
      { galaxy: 2, system: 44, position: 7 },
      {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked by score protection.",
      },
    );

    expect(signals).toContainEqual({ label: "Distance", value: "1,010" });
    expect(signals).toContainEqual({ label: "Raidable", value: "12.5K M / 3K C / 400 D" });
    expect(signals).toContainEqual({ label: "Protection", value: "Attack blocked by score protection." });
    expect(signals).toContainEqual({ label: "Ships/Def", value: "Not indexed publicly" });
    expect(signals).toContainEqual({ label: "Queues", value: "Building, Defense" });
    expect(signals).toContainEqual({ label: "Moon", value: "Yes" });
  });

  test("omits attackable risk copy from player planet tactical signals", () => {
    const signals = playerPlanetTacticalSignals(
      managedPlanet(),
      { galaxy: 2, system: 44, position: 7 },
      { allowed: true, blockedReason: "none", blockedReasonLabel: null },
    );

    expect(signals.some((signal) => signal.label === "Risk")).toBe(false);
    expect(signals.some((signal) => signal.value === "Attackable")).toBe(false);
  });

  test("uses compact planet imagery based on indexed temperature", () => {
    expect(playerInspectPlanetImage(managedPlanet())).toBe("/assets/game/style-pass/generated/planets/hot-desert.webp");
  });

  test("keeps player inspect wording aligned with the shared page treatment", () => {
    const source = readFileSync(new URL("../src/components/InspectPages.tsx", import.meta.url), "utf8");

    expect(source).toContain('label="Home planet"');
    expect(source).not.toContain('label="Origin"');
    expect(source).not.toContain('value="Attackable"');
    expect(source).not.toContain('bg-[#080d16]');
  });
});

function highscoreEntry(overrides: Partial<HighscoreEntry> = {}): HighscoreEntry {
  return {
    alliance: { allianceId: "7", name: "Veydrift Union", tag: "VDFT" },
    attackProtection: null,
    displayName: "Nova Prime",
    homePlanet: null,
    homePlanetId: "11",
    planetCount: 2,
    rank: 9,
    score: {
      defense: "1100",
      economy: "2500",
      fleet: "900",
      fleetCount: "42",
      military: "1200",
      research: "700",
      researchLevels: "12",
      total: "4400",
    },
    wallet: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}

function managedPlanet(): ManagedPlanetResponse {
  return {
    coordinates: "2:44:9",
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000,
    fields: 163,
    fieldsCapacity: 163,
    fieldsUsed: 28,
    galaxy: 2,
    isHomePlanet: true,
    keyLevels: {
      crystalMine: 4,
      deuteriumSynthesizer: 2,
      metalMine: 5,
      researchLab: 1,
      roboticsFactory: 2,
      shipyard: 1,
      solarPlant: 6,
      terraformer: 0,
    },
    lastSettledAt: "2026-06-05T00:00:00.000Z",
    metalMultiplierBps: 10000,
    moon: { exists: true },
    name: "Eos",
    owner: "0x1111111111111111111111111111111111111111",
    planetId: "11",
    position: 9,
    queues: {
      building: {
        active: true,
        cost: { crystal: "2", deuterium: "0", metal: "1" },
        kind: "building",
        readyAt: "2026-06-05T01:00:00.000Z",
      },
      defense: {
        active: true,
        cost: { crystal: "0", deuterium: "0", metal: "2" },
        kind: "defense",
        quantity: 2,
        readyAt: "2026-06-05T01:00:00.000Z",
      },
      ship: null,
    },
    resources: { crystal: "3000", deuterium: "400", metal: "12500" },
    system: 44,
    temperature: 42,
  };
}
