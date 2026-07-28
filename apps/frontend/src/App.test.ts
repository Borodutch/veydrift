import { describe, expect, test } from "bun:test";

describe("CCA launch banner", () => {
  test("keeps the main app linked to the same-origin CCA route", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(source).toContain('className="cca-launch-banner"');
    expect(source).toContain('href="/cca"');
    expect(source).toContain("<FirstPlanetSettlementApp />");
    expect(source).not.toContain('pathname.startsWith("/play")');
  });
});
