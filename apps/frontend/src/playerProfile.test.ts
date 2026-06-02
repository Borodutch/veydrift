import { describe, expect, test } from "bun:test";
import { publicCommanderRows } from "./components/PlanetDetail";
import type { Planet } from "./types";
import { playerDisplayLabel, validatePlayerDisplayName } from "./walletFlow";

const wallet = "0x1111111111111111111111111111111111111111";

describe("player profile display helpers", () => {
  test("validates display names with stable user-facing errors", () => {
    expect(validatePlayerDisplayName("  Nova  Prime ")).toBeUndefined();
    expect(validatePlayerDisplayName("")).toBe("Enter a display name.");
    expect(validatePlayerDisplayName("A".repeat(33))).toBe("Display names can be at most 32 characters.");
    expect(validatePlayerDisplayName("Nova\nPrime")).toBe("Display names cannot include control or formatting characters.");
  });

  test("prefers saved display name and falls back to stable wallet label", () => {
    expect(playerDisplayLabel({
      wallet,
      displayName: "Nova Prime",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }, wallet)).toBe("Nova Prime");

    expect(playerDisplayLabel({
      wallet,
      displayName: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    }, wallet)).toBe("0x1111...1111");

    expect(playerDisplayLabel(undefined, wallet)).toBe("0x1111...1111");
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
