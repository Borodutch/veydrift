import { describe, expect, test } from "bun:test";

describe("playable chain refresh", () => {
  test("uses backend chain events instead of the old fast unconditional polling loops", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("new window.EventSource");
    expect(source).toContain("/chain/events");
    expect(source).toContain("120_000");
    expect(source).not.toContain("30_000");
    expect(source).not.toContain("2_500");
  });

  test("does not create browser-side gameplay read providers for transaction preflights", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).not.toContain("baseSepoliaReadProvider");
    expect(source).not.toContain("transactionReadProvider");
    expect(source).not.toContain("{ readProvider }");
    expect(source).toContain("const receiptProvider = provider;");
    expect(source).toContain("sendStartBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n          building,\n        )");
    expect(source).not.toContain("building,\n          { readProvider },");
    expect(source).toContain("sendFinishBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n        )");
    expect(source).toContain("sendCollectResourcesTransaction(\n      provider,\n      account,\n      gameContract,\n      planetId,\n    )");
  });
});
