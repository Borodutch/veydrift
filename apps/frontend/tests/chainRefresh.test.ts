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

  test("uses the supplied read provider for standard wallet preflights when available", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("const baseSepoliaReadProvider = createJsonRpcProvider(BASE_SEPOLIA.rpcUrls[0]);");
    expect(source).toContain("const transactionReadProvider = readProvider ?? baseSepoliaReadProvider;");
    expect(source).not.toContain("const transactionReadProvider = miniAppMode ? readProvider : undefined;");
  });
});
