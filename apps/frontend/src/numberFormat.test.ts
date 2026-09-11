import { expect, test } from "bun:test";
import { formatIntegerAmount, formatResourceAmount, formatScore, formatStatValue } from "./numberFormat";

test("integer display preserves precision while fractional and textual stats retain their formats", () => {
  expect(formatScore("9007199254740993")).toBe("9,007,199,254,740,993");
  expect(formatResourceAmount("9007199254740993")).toBe(9007199254740993n.toLocaleString());
  expect(formatScore("-1234")).toBe("-1,234");
  expect(formatScore(undefined)).toBe("0");
  expect(formatScore("Unavailable")).toBe("Unavailable");
  expect(formatResourceAmount("1234.5")).toBe((1234.5).toLocaleString());
  expect(formatStatValue("Stationary")).toBe("Stationary");
  expect(formatStatValue(1234.5)).toBe("1,234.5");
});

test("shared integer formatting preserves precision, truncation, and unavailable text", () => {
  expect(formatIntegerAmount("9007199254740993")).toBe("9,007,199,254,740,993");
  expect(formatIntegerAmount("-1234.9")).toBe("-1,234");
  expect(formatIntegerAmount("1234.9")).toBe("1,234");
  expect(formatIntegerAmount(null)).toBe("0");
  expect(formatIntegerAmount(undefined)).toBe("0");
  expect(formatIntegerAmount("Unavailable")).toBe("Unavailable");
});
