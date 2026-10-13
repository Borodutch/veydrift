import { describe, expect, test } from "bun:test";
import { buildingDemolitionPrice, demolitionPrice, moonDemolitionPrice } from "../src/demolition";

describe("demolition price", () => {
  test("matches the contract vectors for the metal mine", () => {
    // 16 -> 15 with Ion 1, and 1 -> 0 without Ion.
    expect(buildingDemolitionPrice("metalMine", 16, 1)).toEqual({
      cost: { metal: 16_815, crystal: 4_203, deuterium: 0 },
      fullCost: { metal: 17_515, crystal: 4_378, deuterium: 0 },
      discountPercent: 4,
    });
    expect(buildingDemolitionPrice("metalMine", 1, 0).cost).toEqual({ metal: 40, crystal: 10, deuterium: 0 });
  });

  test("Ion Technology discounts the price but never the duration input", () => {
    const price = demolitionPrice({ metal: 1_000, crystal: 0, deuterium: 0 }, 2, [2, 1], 3);
    expect(price.cost.metal).toBe(880);
    expect(price.fullCost.metal).toBe(1_000);
    expect(price.discountPercent).toBe(12);
  });

  test("is free from Ion Technology 25", () => {
    const price = demolitionPrice({ metal: 1_000, crystal: 500, deuterium: 100 }, 5, [2, 1], 30);
    expect(price.cost).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(price.fullCost.metal).toBe(8_000);
    expect(price.discountPercent).toBe(100);
  });

  test("moon buildings use the flat 2x factor", () => {
    expect(moonDemolitionPrice({ metal: 400, crystal: 120, deuterium: 200 }, 2, 3).cost)
      .toEqual({ metal: 352, crystal: 105, deuterium: 176 });
  });
});
