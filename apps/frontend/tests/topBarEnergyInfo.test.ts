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

  test("includes source-level production details when available", () => {
    expect(energyExplanationTitle({
      produced: 96,
      required: 120,
      scaleBps: 8_000,
      sources: {
        solarPlant: 44,
        fusionReactor: 16,
        fusionReactorDeuteriumConsumed: 11,
        solarSatellites: 36,
        solarSatelliteCount: 3,
        solarSatelliteEnergy: 12,
      },
    })).toContain("Production in total: 96. Solar Plant: 44. Fusion Generator: 16 from 11 DEUT/h. Solar Satellites: 36 from 3 satellites (12 E/Sat).");
  });
});
