import { describe, expect, test } from "bun:test";
import { defenderSurvivingUnits, defenderSurvivorsLabel } from "../src/components/MissionDetailPage";
import type { BattleReport, CombatRoundReport } from "../src/walletFlow";

const noResources = { metal: "0", crystal: "0", deuterium: "0" };

function round(overrides: Partial<CombatRoundReport>): CombatRoundReport {
  return {
    round: 1,
    attackerUnits: "0",
    defenderUnits: "0",
    attackerLosses: noResources,
    defenderLosses: noResources,
    ...overrides,
  };
}

function report(overrides: Partial<BattleReport>): BattleReport {
  return {
    missionId: "1",
    attacker: "0xattacker",
    targetPlanetId: "42",
    outcome: "Draw",
    rounds: 0,
    randomSeed: "0",
    loot: noResources,
    attackerLosses: noResources,
    defenderLosses: noResources,
    debris: { metal: "0", crystal: "0" },
    roundReports: [],
    transactionHash: "0xhash",
    blockNumber: "1",
    ...overrides,
  };
}

describe("defenderSurvivingUnits", () => {
  test("an attacker win means the defender was wiped, even without indexed rounds", () => {
    expect(defenderSurvivingUnits(report({ outcome: "AttackerWin", roundReports: [] }))).toBe(0);
    expect(defenderSurvivingUnits(report({
      outcome: "AttackerWin",
      roundReports: [round({ round: 1, defenderUnits: "5" }), round({ round: 2, defenderUnits: "0" })],
    }))).toBe(0);
  });

  test("uses the final indexed round's remaining defender unit count", () => {
    expect(defenderSurvivingUnits(report({
      outcome: "DefenderWin",
      roundReports: [round({ round: 1, defenderUnits: "120" }), round({ round: 2, defenderUnits: "83" })],
    }))).toBe(83);
  });

  test("a draw keeps whatever survived the final round", () => {
    expect(defenderSurvivingUnits(report({
      outcome: "Draw",
      roundReports: [round({ round: 1, defenderUnits: "10" })],
    }))).toBe(10);
  });

  test("returns null when no rounds were indexed and the attacker did not clear the planet", () => {
    expect(defenderSurvivingUnits(report({ outcome: "DefenderWin", roundReports: [] }))).toBeNull();
    expect(defenderSurvivingUnits(report({ outcome: "Draw", roundReports: [] }))).toBeNull();
  });

  test("non-numeric defender unit counts degrade to unknown rather than NaN", () => {
    expect(defenderSurvivingUnits(report({
      outcome: "DefenderWin",
      roundReports: [round({ round: 1, defenderUnits: "" })],
    }))).toBeNull();
  });
});

describe("defenderSurvivorsLabel", () => {
  test("unknown count flags both composition and retained loot as unpublished", () => {
    const label = defenderSurvivorsLabel(null);
    expect(label).toContain("Not recorded");
    expect(label).toContain("loot retained");
  });

  test("zero survivors reads as a total loss", () => {
    expect(defenderSurvivorsLabel(0)).toContain("All forces destroyed");
  });

  test("positive count is formatted with thousands separators and a composition caveat", () => {
    const label = defenderSurvivorsLabel(1234);
    expect(label).toContain("1,234 units remaining");
    expect(label).toContain("per-type composition");
  });

  test("a single survivor uses the singular unit noun", () => {
    expect(defenderSurvivorsLabel(1)).toContain("1 unit remaining");
  });
});
