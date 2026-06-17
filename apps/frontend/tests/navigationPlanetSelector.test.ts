import { describe, expect, test } from "bun:test";
import {
  hasUsefulPlanetDetailBackRoute,
  planetDetailBackRouteForCurrentScreen,
} from "../src/inspectRoutes";

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
    // The picker must render for any wallet with at least one planet
    // (not gated behind walletPlanets.length > 1).
    expect(playableSource).toContain("const mobilePlanetPicker = walletPlanets.length > 0");
    expect(playableSource).toContain("{compactPlanetSelector}");
    expect(playableSource).not.toContain("walletPlanets.length > 1 ? mobilePlanetSelector : undefined");
    // The mobile image row no longer hides itself for a single planet.
    expect(playableSource).not.toContain("if (planets.length < 2) return null;");
  });

  test("moves the mobile planet picker into the hamburger menu, not above content", () => {
    // Below `md` the picker is rendered inside the hamburger menu via NavBar.
    expect(playableSource).toContain("planetPicker={mobilePlanetPicker}");
    expect(navSource).toContain("planetPicker?: ComponentChildren");
    expect(navSource).toContain("{planetPicker}");
    // The compact row only fills the md-to-lg gap (no hamburger, no right sidebar),
    // so it must be hidden below `md` and at/above `lg`.
    expect(playableSource).toContain("mb-3 hidden md:block lg:hidden");
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
    expect(navSource).toContain("Commander");
    expect(navSource).toContain("playerDisplayLabel(playerProfile, account)");
    expect(navSource).toContain('aria-label="Edit player display name"');
    expect(playableSource).toContain("playerProfile={playerProfile}");
    expect(playableSource).toContain("onUpdatePlayerDisplayName={handleUpdatePlayerDisplayName}");
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
    expect(overviewSource).toContain('className="m-0 min-w-0 break-words text-base font-semibold leading-tight text-white"');
    expect(overviewSource).toContain("after:-inset-1.5");
    expect(overviewSource).toContain('<Pencil aria-hidden="true" size={11} strokeWidth={2} />');
    expect(overviewSource).toContain('title="Rename planet"');
    expect(overviewSource).not.toContain("Rename planet\n                  </button>");
  });

  test("keeps planet detail to one system navigation action", () => {
    expect(planetDetailSource).toContain("onClick={onBack}");
    expect(playableSource).toContain("onBack={handlePlanetDetailBack}");
    expect(playableSource).not.toContain('onBack={() => setPage("galaxy")}');
    expect(planetDetailSource).not.toContain("View System");
    expect(planetDetailSource).not.toContain("onNavigateSystem");
  });

  test("tracks the useful source route for planet detail back navigation", () => {
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: null,
      missionReportId: null,
      page: "mission-control",
    })).toEqual({ kind: "page", page: "mission-control" });
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: null,
      missionReportId: null,
      page: "rankings",
    })).toEqual({ kind: "page", page: "rankings" });
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: null,
      missionReportId: null,
      page: "raid-target-finder",
    })).toEqual({ kind: "page", page: "raid-target-finder" });
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: null,
      missionReportId: null,
      page: "galaxy",
    })).toEqual({ kind: "page", page: "galaxy" });
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: "42",
      missionReportId: null,
      page: "mission-control",
    })).toEqual({ kind: "mission", missionId: "42" });
  });

  test("keeps direct or coordinate-only planet detail links on the Galaxy fallback path", () => {
    expect(hasUsefulPlanetDetailBackRoute(null)).toBe(false);
    expect(hasUsefulPlanetDetailBackRoute({ kind: "planet", coords: { galaxy: 4, system: 8, position: 15 } })).toBe(false);
    expect(hasUsefulPlanetDetailBackRoute({ kind: "page", page: "planet" })).toBe(false);
    expect(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId: null,
      inspectedPlayerWallet: null,
      missionDetailId: null,
      missionReportId: null,
      page: "planet",
    })).toEqual({ kind: "page", page: "galaxy" });
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
