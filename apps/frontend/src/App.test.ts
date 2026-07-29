import { describe, expect, test } from "bun:test";

describe("CCA launch banner", () => {
  test("keeps the main app linked to the same-origin CCA route", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(source).toContain('className="cca-launch-banner"');
    expect(source).toContain('href="/cca"');
    expect(source).toContain("<FirstPlanetSettlementApp />");
    expect(source).not.toContain('pathname.startsWith("/play")');
  });

  test("uses the game top bar instead of stacking a second sticky auction header", async () => {
    const [topBar, styles] = await Promise.all([
      Bun.file(new URL("./components/TopBar.tsx", import.meta.url)).text(),
      Bun.file(new URL("./styles.css", import.meta.url)).text(),
    ]);

    expect(topBar).toContain('aria-label="$VEYDRIFT auction"');
    expect(topBar).toContain('href="/cca"');
    expect(styles).toContain("body:has(.playable-starfield) .cca-launch-banner");
    expect(styles).not.toMatch(/\.cca-launch-banner\s*\{[^}]*position:\s*sticky/s);
  });
});
