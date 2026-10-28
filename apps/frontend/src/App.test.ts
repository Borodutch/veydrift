import { describe, expect, test } from "bun:test";

describe("app routing", () => {
  test("puts the auction banner above every page, renders docs separately and sends every other path to the game", async () => {
    const [source, game, topBar] = await Promise.all([
      Bun.file(new URL("./App.tsx", import.meta.url)).text(),
      Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text(),
      Bun.file(new URL("./components/TopBar.tsx", import.meta.url)).text(),
    ]);

    expect(source).toContain("<AuctionBanner />");
    expect(source).toContain('path === "/docs" || path.startsWith("/docs/")');
    expect(source).not.toContain("CcaApp");
    expect(source).not.toContain("Pact");
    expect(source).toContain('home: () => import("./FirstPlanetSettlementApp")');
    expect(game).not.toContain("auctionBanner");
    expect(topBar).not.toContain("auctionBanner");
    expect(topBar).toContain('key="crystal"');
    expect(topBar).toContain('key="deuterium"');
    expect(topBar).not.toContain("tickValueRef");
  });
});
