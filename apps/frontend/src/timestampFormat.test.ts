import { describe, expect, test } from "bun:test";
import { formatUserTimestamp, timestampToMs } from "./timestampFormat";

describe("timestamp formatting", () => {
  test("normalizes chain seconds, milliseconds, and ISO timestamps", () => {
    expect(timestampToMs("1770000000")).toBe(1_770_000_000_000);
    expect(timestampToMs(1_770_000_000_000)).toBe(1_770_000_000_000);
    expect(timestampToMs("2026-02-03T09:20:00.000Z")).toBe(1_770_110_400_000);
    expect(timestampToMs("0")).toBeUndefined();
    expect(timestampToMs("not-a-date")).toBeUndefined();
  });

  test("renders browser-locale date and time instead of the raw epoch", () => {
    expect(formatUserTimestamp("1770000000", {
      locale: "en-US",
      timeZone: "UTC",
    })).toBe("Feb 2, 2026, 2:40 AM");
  });

  test("allows compact locale-specific exact time formatting when needed", () => {
    expect(formatUserTimestamp(1_770_000_000_000, {
      locale: "en-GB",
      timeZone: "UTC",
      dateStyle: "short",
      timeStyle: "short",
    })).toBe("02/02/2026, 02:40");
  });
});
