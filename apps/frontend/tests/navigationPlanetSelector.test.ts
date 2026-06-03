import { describe, expect, test } from "bun:test";

const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
const navSource = await Bun.file(new URL("../src/components/NavBar.tsx", import.meta.url)).text();
const overviewSource = await Bun.file(new URL("../src/components/OverviewPage.tsx", import.meta.url)).text();

describe("navigation and planet selector UI source contracts", () => {
  test("uses a mobile hamburger menu instead of always-visible mobile tabs", () => {
    expect(navSource).toContain("Open navigation menu");
    expect(navSource).toContain("Close navigation menu");
    expect(navSource).toContain("mobile-navigation-menu");
    expect(navSource).not.toContain("Mobile top tabs");
  });

  test("keeps mobile planet selection as an image row, not a select dropdown", () => {
    expect(playableSource).toContain('layout="mobile"');
    expect(playableSource).toContain("walletPlanets.length > 1 ? mobilePlanetSelector : undefined");
    expect(playableSource).not.toContain("<select");
    expect(playableSource).not.toContain("<option");
  });

  test("keeps the desktop planet selector compact and selection-only", () => {
    expect(playableSource).not.toContain("Planet Selector");
    expect(playableSource).not.toContain("Owned planets");
    expect(playableSource).not.toContain("active world");
    expect(playableSource).not.toContain("ring-inset");
  });

  test("keeps the desktop sidebar footer compact and sticky", () => {
    expect(navSource).toContain("md:sticky md:top-[52px]");
    expect(navSource).toContain("min-h-0 flex-1 space-y-1 overflow-y-auto");
    expect(navSource).toContain('aria-label="Sidebar account summary"');
    expect(navSource).toContain("sticky bottom-3 shrink-0");
    expect(navSource).not.toContain("Home Planet");
    expect(navSource).not.toContain("tracking-[0.16em]");
  });

  test("moves rename and abandon actions into the overview hero", () => {
    expect(overviewSource).toContain('aria-label="Rename planet"');
    expect(overviewSource).toContain('aria-label="Abandon planet"');
    expect(overviewSource).toContain("canAbandonPlanet");
    expect(overviewSource).not.toContain("Rename\n                </button>");
  });

  test("keeps the planet rename action as a compact pencil icon", () => {
    expect(overviewSource).toContain('className="relative inline-grid h-5 w-5 translate-y-px place-items-center self-center');
    expect(overviewSource).toContain("after:-inset-1.5");
    expect(overviewSource).toContain('<Pencil aria-hidden="true" size={11} strokeWidth={2} />');
    expect(overviewSource).toContain('title="Rename planet"');
    expect(overviewSource).not.toContain("Rename planet\n                  </button>");
  });
});
