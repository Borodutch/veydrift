import { describe, expect, test } from "bun:test";
import {
  formatRiftCountdown,
  isWithdrawalReady,
  riftRequirementFlairs,
  riftRequirementStatus,
} from "./components/RiftPage";

describe("RiftPage helpers", () => {
  test("maps locked Rift requirements to shared clickable requirement flairs", () => {
    expect(riftRequirementFlairs([
      {
        kind: "building",
        key: "interdimensionalRiftStabilizer",
        label: "Interdimensional Rift Stabilizer",
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
      { label: "Interdimensional Rift Stabilizer", met: false, target: { kind: "building", key: "interdimensionalRiftStabilizer" } },
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
    expect(riftRequirementStatus({ currentLevel: null, requiredLevel: 1 })).toBe("Requires Level 1; not available on this deployment");
    expect(riftRequirementStatus({ currentLevel: 0, requiredLevel: 1 })).toBe("Level 0 / 1 required");
    expect(riftRequirementStatus({ currentLevel: 2, requiredLevel: 1 })).toBe("Level 2 / 1");
    expect(riftRequirementStatus({ binary: true, built: null, currentLevel: null, requiredLevel: 1 })).toBe("Not available on this deployment");
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
