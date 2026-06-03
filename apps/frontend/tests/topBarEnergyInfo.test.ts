import { describe, expect, test } from "bun:test";
import { energyExplanationTitle } from "../src/topBarEnergyInfo";

describe("top bar energy info", () => {
  test("explains powered energy balance", () => {
    expect(energyExplanationTitle({
      produced: 120,
      required: 80,
      scaleBps: 10_000,
    })).toBe("Energy powers mines and other production buildings. 120 produced / 80 required. Surplus 40 Resource production is fully powered.");
  });

  test("explains reduced output during an energy shortage", () => {
    expect(energyExplanationTitle({
      produced: 60,
      required: 100,
      scaleBps: 6_000,
    })).toBe("Energy powers mines and other production buildings. 60 produced / 100 required. Shortage 40 Resource production is reduced to 60%.");
  });
});
