import { describe, expect, test } from "bun:test";

describe("CCA launch banner", () => {
  test("keeps the main app linked to the same-origin CCA route", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(source).toContain("<CcaLaunchBanner />");
    expect(source).toContain("<FirstPlanetSettlementApp />");
    expect(source).not.toContain('pathname.startsWith("/play")');
  });

  test("keeps the landing banner sticky while embedding the same banner in the game header", async () => {
    const [game, styles] = await Promise.all([
      Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text(),
      Bun.file(new URL("./styles.css", import.meta.url)).text(),
    ]);

    expect(game).toContain("<CcaLaunchBanner embedded />");
    expect(styles).toContain(".cca-launch-banner--game");
    expect(styles).toContain("position: static");
    expect(styles).toMatch(/\.cca-launch-banner\s*\{[^}]*position:\s*sticky/s);
  });
});
