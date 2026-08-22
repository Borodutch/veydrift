import { describe, expect, test } from "bun:test";

describe("app routing", () => {
  test("renders docs separately and sends every other path to the game", async () => {
    const [source, game, topBar] = await Promise.all([
      Bun.file(new URL("./App.tsx", import.meta.url)).text(),
      Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text(),
      Bun.file(new URL("./components/TopBar.tsx", import.meta.url)).text(),
    ]);

    expect(source).toContain('pathname.startsWith("/docs")');
    expect(source).toContain("return <FirstPlanetSettlementApp />");
    expect(source).not.toMatch(/cca/i);
    expect(game).not.toContain("auctionBanner");
    expect(topBar).not.toContain("auctionBanner");
    expect(topBar).toContain('key="crystal"');
    expect(topBar).toContain('key="deuterium"');
    expect(topBar).not.toContain("tickValueRef");
  });
});
