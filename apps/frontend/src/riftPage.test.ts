import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatRiftCountdown,
  formatRiftTokens,
  isWithdrawalReady,
  riftAmountCheck,
  riftLockProgress,
  riftRequirementFlairs,
  riftRequirementStatus,
} from "./components/RiftPage";

describe("RiftPage helpers", () => {
  test("omits the redundant page title and manual refresh control", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./components/RiftPage.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("<RefreshButton");
    expect(source).not.toContain("<PageHeader");
    expect(source).not.toContain("InlineSyncIndicator");
    expect(source).not.toContain("Refreshing Rift");
  });

  test("maps locked Rift requirements to shared clickable requirement flairs", () => {
    expect(riftRequirementFlairs([
      {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Rift Stabilizer",
        currentLevel: 0,
        requiredLevel: 1,
        binary: true,
        built: false,
      },
      {
        kind: "building",
        key: "roboticsFactory",
        label: "Robotics Factory",
        currentLevel: 3,
        requiredLevel: 4,
      },
      {
        kind: "building",
        key: "researchLab",
        label: "Research Lab",
        currentLevel: 2,
        requiredLevel: 2,
      },
      {
        kind: "technology",
        key: "energy",
        label: "Energy Technology",
        currentLevel: 4,
        requiredLevel: 5,
      },
      {
        kind: "technology",
        key: "hyperspace",
        label: "Hyperspace Technology",
        currentLevel: 1,
        requiredLevel: 1,
      },
    ])).toEqual([
      { label: "Rift Stabilizer", met: false, target: { kind: "building", key: "interdimensionalRiftStabilizer" } },
      { label: "Robotics Factory 4", met: false, target: { kind: "building", key: "roboticsFactory" } },
      { label: "Research Lab 2", met: true, target: { kind: "building", key: "researchLab" } },
      { label: "Energy Technology 5", met: false, target: { kind: "research", key: "energy" } },
      { label: "Hyperspace Technology 1", met: true, target: { kind: "research", key: "hyperspace" } },
    ]);
  });

  test("keeps locked Rift technology requirements unmet below the required level", () => {
    expect(riftRequirementFlairs([
      {
        kind: "technology",
        key: "hyperspace",
        label: "Hyperspace Technology",
        currentLevel: 0,
        requiredLevel: 1,
      },
    ])).toEqual([
      { label: "Hyperspace Technology 1", met: false, target: { kind: "research", key: "hyperspace" } },
    ]);
  });

  test("formats locked requirement status", () => {
    expect(riftRequirementStatus({ currentLevel: null, requiredLevel: 1 })).toBe("Requires Level 1; currently unavailable");
    expect(riftRequirementStatus({ currentLevel: 0, requiredLevel: 1 })).toBe("Level 0 / 1 required");
    expect(riftRequirementStatus({ currentLevel: 2, requiredLevel: 1 })).toBe("Level 2 / 1");
    expect(riftRequirementStatus({ binary: true, built: null, currentLevel: null, requiredLevel: 1 })).toBe("Currently unavailable");
    expect(riftRequirementStatus({ binary: true, built: false, currentLevel: 0, requiredLevel: 1 })).toBe("Not built");
    expect(riftRequirementStatus({ binary: true, built: true, currentLevel: 1, requiredLevel: 1 })).toBe("Built");
  });

  test("formats withdrawal countdowns", () => {
    const now = Date.parse("2026-05-20T12:00:00.000Z");
    expect(formatRiftCountdown("2026-05-22T15:30:00.000Z", now)).toBe("2d 3h");
    expect(formatRiftCountdown("2026-05-20T14:15:00.000Z", now)).toBe("2h 15m");
    expect(formatRiftCountdown("2026-05-20T12:04:00.000Z", now)).toBe("4m");
    expect(formatRiftCountdown("2026-05-20T11:59:00.000Z", now)).toBe("Ready");
  });

  test("shows raw units as 6-decimal tokens: 1 token = 1,000,000 units", () => {
    expect(formatRiftTokens(929_852n)).toBe("0.929852");
    expect(formatRiftTokens("2500000")).toBe("2.5");
    expect(formatRiftTokens(1_000_000_000_000n)).toBe("1,000,000");
    expect(formatRiftTokens(1n)).toBe("0.000001");
    expect(formatRiftTokens(0n)).toBe("0");
  });

  test("validates injections in tokens and extractions in whole units", () => {
    const short = "Your wallet holds 12.5 vMETAL.";
    expect(riftAmountCheck("2.5", "tokens", 12_500_000n, short)).toEqual({ amount: 2_500_000n });
    expect(riftAmountCheck(" 1,000 ", "tokens", undefined, short)).toEqual({ amount: 1_000_000_000n });
    expect(riftAmountCheck("13", "tokens", 12_500_000n, short)).toEqual({ reason: short });
    expect(riftAmountCheck("0.0000001", "tokens", undefined, short).reason).toBe("Enter a token amount with at most 6 decimals.");
    expect(riftAmountCheck("", "tokens", undefined, short).reason).toBe("Enter an amount.");
    expect(riftAmountCheck("0", "units", 10n, short).reason).toBe("Enter an amount above zero.");
    expect(riftAmountCheck("25,000", "units", 41_870n, "low")).toEqual({ amount: 25_000n });
    expect(riftAmountCheck("1.5", "units", 41_870n, "low").reason).toBe("Enter a whole number of units.");
    expect(riftAmountCheck("41871", "units", 41_870n, "Aurora Prime holds 41,870 Deuterium.")).toEqual({ reason: "Aurora Prime holds 41,870 Deuterium." });
    // The contract amount is a uint128.
    expect(riftAmountCheck((1n << 128n).toString(), "units", undefined, "too much")).toEqual({ reason: "too much" });
  });

  test("measures how far a 28-day lock has run", () => {
    const claim = { requestedAt: "2026-10-01T00:00:00.000Z", unlocksAt: "2026-10-29T00:00:00.000Z" };
    expect(riftLockProgress(claim, Date.parse("2026-10-15T00:00:00.000Z"))).toBe(0.5);
    expect(riftLockProgress(claim, Date.parse("2026-09-01T00:00:00.000Z"))).toBe(0);
    expect(riftLockProgress(claim, Date.parse("2026-11-01T00:00:00.000Z"))).toBe(1);
  });

  test("uses ready flag or unlock time for finish availability", () => {
    const now = Date.parse("2026-05-20T12:00:00.000Z");
    expect(isWithdrawalReady({
      id: "0",
      resource: "metal",
      amount: "1000000",
      requestedAt: "2026-04-20T12:00:00.000Z",
      unlocksAt: "2026-05-20T12:00:00.000Z",
      ready: false,
    }, now)).toBe(true);
    expect(isWithdrawalReady({
      id: "1",
      resource: "crystal",
      amount: "1000000",
      requestedAt: "2026-05-19T12:00:00.000Z",
      unlocksAt: "2026-06-18T12:00:00.000Z",
      ready: true,
    }, now)).toBe(true);
  });
});
