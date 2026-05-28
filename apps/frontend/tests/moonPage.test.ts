import { describe, expect, test } from "bun:test";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../src/moonActions";

describe("Moon page helpers", () => {
  test("accepts only positive integer moon ids", () => {
    expect(isPositiveIntegerInput("9")).toBe(true);
    expect(isPositiveIntegerInput(" 9 ")).toBe(true);
    expect(isPositiveIntegerInput("")).toBe(false);
    expect(isPositiveIntegerInput("0")).toBe(false);
    expect(isPositiveIntegerInput("2.5")).toBe(false);
    expect(isPositiveIntegerInput("44abc")).toBe(false);
  });

  test("omits empty jump cargo instead of building an all-zero ship manifest", () => {
    expect(parseMoonJumpShips("", "")).toBeUndefined();
    expect(parseMoonJumpShips("0", "0")).toBeUndefined();
    expect(parseMoonJumpShips("2", "")).toEqual({ smallCargo: 2, largeCargo: 0 });
    expect(parseMoonJumpShips("", "1")).toEqual({ smallCargo: 0, largeCargo: 1 });
    expect(parseMoonJumpShips("1.5", "abc")).toBeNull();
    expect(parseMoonJumpShips("2", "abc")).toBeNull();
  });
});
