import { describe, expect, test } from "bun:test";
import { energyExplanationTitle } from "../src/topBarEnergyInfo";

describe("top bar energy info", () => {
  test("explains powered energy balance", () => {
    expect(energyExplanationTitle({
      produced: 120,
      required: 80,
      scaleBps: 10_000,
    })).toBe("Energy powers mines. Solar Plant and Solar Satellites produce it; mines consume it. 120 produced / 80 consumed. Surplus 40 Mine output is fully powered.");
  });

  test("explains reduced output during an energy shortage", () => {
    expect(energyExplanationTitle({
      produced: 60,
      required: 100,
      scaleBps: 6_000,
    })).toBe("Energy powers mines. Solar Plant and Solar Satellites produce it; mines consume it. 60 produced / 100 consumed. Shortage 40 Mine output is reduced to 60% until energy production catches up.");
  });
});
