import { describe, expect, test } from "bun:test";
import {
  formatRiftCountdown,
  isWithdrawalReady,
  riftRequirementStatus,
} from "./components/RiftPage";

describe("RiftPage helpers", () => {
  test("formats locked requirement status", () => {
    expect(riftRequirementStatus(null, 1)).toBe("Requires Level 1; not available on this deployment");
    expect(riftRequirementStatus(0, 1)).toBe("Level 0 / 1 required");
    expect(riftRequirementStatus(2, 1)).toBe("Level 2 / 1");
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
