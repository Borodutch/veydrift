import { describe, expect, test } from "bun:test";

const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
const navSource = await Bun.file(new URL("../src/components/NavBar.tsx", import.meta.url)).text();
const overviewSource = await Bun.file(new URL("../src/components/OverviewPage.tsx", import.meta.url)).text();
const galaxySource = await Bun.file(new URL("../src/components/GalaxyView.tsx", import.meta.url)).text();
const missionCreationSource = await Bun.file(new URL("../src/components/MissionCreationPage.tsx", import.meta.url)).text();
const planetDetailSource = await Bun.file(new URL("../src/components/PlanetDetail.tsx", import.meta.url)).text();
const topBarSource = await Bun.file(new URL("../src/components/TopBar.tsx", import.meta.url)).text();

describe("navigation and planet selector UI source contracts", () => {
  test("uses a mobile hamburger menu instead of always-visible mobile tabs", () => {
    expect(navSource).toContain("Open navigation menu");
    expect(navSource).toContain("Close navigation menu");
    expect(navSource).toContain("mobile-navigation-menu");
    expect(navSource).not.toContain("Mobile top tabs");
  });

  test("keeps mobile planet selection as an image row, not a select dropdown", () => {
    expect(playableSource).toContain('layout="mobile"');
    expect(playableSource).not.toContain("<select");
    expect(playableSource).not.toContain("<option");
  });

  test("shows the planet picker for single-planet wallets across viewports", () => {
    // The compact picker must render for any wallet with at least one planet
    // (not gated behind walletPlanets.length > 1) and be visible below `lg`.
    expect(playableSource).toContain("const compactPlanetSelector = walletPlanets.length > 0");
    expect(playableSource).toContain("{compactPlanetSelector}");
    expect(playableSource).toContain("lg:hidden");
    expect(playableSource).not.toContain("walletPlanets.length > 1 ? mobilePlanetSelector : undefined");
    // The mobile image row no longer hides itself for a single planet.
    expect(playableSource).not.toContain("if (planets.length < 2) return null;");
  });

  test("keeps the desktop planet selector compact and selection-only", () => {
    expect(playableSource).not.toContain("Planet Selector");
    expect(playableSource).not.toContain("Owned planets");
    expect(playableSource).not.toContain("active world");
    expect(playableSource).not.toContain("ring-inset");
  });

  test("keeps the desktop sidebar footer compact and sticky", () => {
    expect(playableSource).toContain("md:h-[calc(100dvh-2.75rem)]");
    expect(navSource).toContain("h-[calc(100dvh-2.75rem)]");
    expect(navSource).toContain("md:sticky md:top-11");
    expect(navSource).toContain("flex w-full items-center");
    expect(navSource).toContain("min-h-0 flex-1 space-y-1 overflow-y-auto");
    expect(navSource).toContain('aria-label="Sidebar account summary"');
    expect(navSource).toContain("sticky bottom-3 shrink-0");
    expect(topBarSource).toContain("max-w-[96rem]");
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
    expect(overviewSource).toContain('className="m-0 min-w-0 break-words text-base font-semibold text-white"');
    expect(overviewSource).toContain("after:-inset-1.5");
    expect(overviewSource).toContain('<Pencil aria-hidden="true" size={11} strokeWidth={2} />');
    expect(overviewSource).toContain('title="Rename planet"');
    expect(overviewSource).not.toContain("Rename planet\n                  </button>");
  });

  test("keeps planet detail to one system navigation action", () => {
    expect(planetDetailSource).toContain("onClick={onBack}");
    expect(planetDetailSource).not.toContain("View System");
    expect(planetDetailSource).not.toContain("onNavigateSystem");
  });

  test("keeps mission speed selection inside mission creation only", () => {
    expect(missionCreationSource).toContain("MISSION_SPEED_OPTIONS.map");
    expect(galaxySource).not.toContain("Mission speed");
    expect(galaxySource).not.toContain("MISSION_SPEED_OPTIONS.map");
    expect(planetDetailSource).not.toContain("MISSION_SPEED_OPTIONS.map");
    expect(playableSource).toContain("pendingGalaxyMission");
    expect(playableSource).toContain("<MissionCreationPage");
  });
});
