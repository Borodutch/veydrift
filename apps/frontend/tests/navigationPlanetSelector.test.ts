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
const gameAssetsSource = await Bun.file(new URL("../src/gameAssets.ts", import.meta.url)).text();
const moonIndicatorSource = await Bun.file(new URL("../src/components/PlanetMoonIndicator.tsx", import.meta.url)).text();
const rankingsSource = await Bun.file(new URL("../src/components/RankingsPage.tsx", import.meta.url)).text();
const topBarSource = await Bun.file(new URL("../src/components/TopBar.tsx", import.meta.url)).text();
const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

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

  test("contains mobile planet picker horizontal overflow inside its own scroller", () => {
    expect(playableSource).toContain('aria-label="Select planet" className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain"');
    expect(playableSource).toContain('className="flex w-max min-w-full gap-2 pb-1"');
    expect(playableSource).toContain('className="playable-starfield relative isolate min-h-dvh overflow-hidden bg-[#05070f] text-slate-100"');
    expect(playableSource).toContain('className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6"');
    expect(playableSource).not.toContain("flex min-w-max gap-2 pb-1");
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

  test("shows full planet names in the picker without permanent truncation", () => {
    expect(playableSource).toContain('aria-label="Select planet" className="hidden w-32 shrink-0');
    expect(playableSource).toContain('className="grid w-24 min-w-0 shrink-0 gap-1"');
    expect(playableSource).toContain("title={label}");
    expect(playableSource).toContain("line-clamp-2 block min-h-8 max-w-full");
    expect(playableSource).toContain("[overflow-wrap:anywhere]");
    expect(playableSource).not.toContain('aria-label="Select planet" className="hidden w-28 shrink-0');
    expect(playableSource).not.toContain('className="grid w-20 min-w-0 shrink-0 gap-1"');
    expect(playableSource).not.toContain("block max-w-full truncate text-[0.68rem]");
  });

  test("renders planet selector thumbnails as circles", () => {
    expect(playableSource).toContain("h-14 w-14 overflow-hidden rounded-full bg-black/30");
  });

  test("shows per-planet queue progress bars in the selector", () => {
    expect(playableSource).toContain("<PlanetSelectorProgressBars now={now} planet={planet} />");
    expect(playableSource).toContain("data-planet-selector-progress-bars={planet.planetId}");
    expect(playableSource).toContain("data-planet-selector-progress={bar.kind}");
    expect(playableSource).toContain("buildingQueuePreview(planet.queues.building)");
    expect(playableSource).toContain("defenseQueuePreview(planet.queues.defense)");
    expect(playableSource).toContain("shipQueuePreview(planet.queues.ship)");
    expect(playableSource).toContain("queueProgress({ readyAt, startedAt }, now)");
  });

  test("hides planet selector progress rows when no displayed queue is active", () => {
    expect(playableSource).toContain("if (bars.every((bar) => !bar.active)) return null;");
    expect(playableSource).toContain("data-planet-selector-progress-active={bar.active ? \"true\" : \"false\"}");
    expect(playableSource).not.toContain("data-planet-selector-progress-bars={planet.planetId} className=\"hidden\"");
    expect(playableSource).not.toContain('className="grid w-full grid-cols-3 gap-1 min-h-');
  });

  test("nests moon picker controls under parent planet items with generated moon imagery", () => {
    expect(playableSource).toContain("data-planet-selector-item={planet.planetId}");
    expect(playableSource).toContain('data-planet-selector-moon="true"');
    expect(playableSource).toContain("<PlanetSelectorMoonButton");
    expect(playableSource).toContain('className="grid w-24 min-w-0 shrink-0 gap-1"');
    expect(playableSource).toContain("grid w-full min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 overflow-hidden");
    expect(playableSource).not.toContain("planets.flatMap((planet) => planetSelectorButtons");
    expect(gameAssetsSource).toContain("frozen-ice.webp");
    expect(moonIndicatorSource).toContain('data-planet-moon-subsection="true"');
    expect(moonIndicatorSource).not.toContain("Child moon body");
    expect(rankingsSource).toContain("<PlanetMoonSubsection");
  });

  test("normal navigation from a selected moon returns to the parent planet context", () => {
    expect(playableSource).toContain('if (target !== "moon")');
    expect(playableSource).toContain('setSelectedBodyKind("planet")');
    expect(playableSource).not.toContain('activeBodyKind === "moon" && (page === "overview" || page === "infrastructure" || page === "defenses" || page === "shipyard")');
    expect(playableSource).toContain('if (page === "moon")');
  });

  test("moon overview actions open moon-origin parent-planet mission flows", () => {
    expect(playableSource).toContain("moonOverviewActions");
    expect(playableSource).toContain("bodySelectionDefaults: { originIsMoon: true, targetIsMoon: false }");
    expect(playableSource).toContain("defaultTargetIsMoon: pendingGalaxyMission.bodySelectionDefaults?.targetIsMoon");
    expect(playableSource).toContain("defaultOriginIsMoon: pendingGalaxyMission.bodySelectionDefaults?.originIsMoon");
    expect(playableSource).toContain("Moon defense stationing is not available in the current mission contract.");
    expect(missionCreationSource).toContain("defaultTargetIsMoon?: boolean");
    expect(missionCreationSource).toContain("Boolean(bodySelection?.defaultTargetIsMoon) || (action.mode === \"mission\" && action.defaultTargetIsMoon === true)");
  });

  test("keeps planet selector selected and keyboard focus states subtle", () => {
    expect(playableSource).toContain("veydrift-planet-selector-button");
    expect(playableSource).toContain("border-cyan-300/35 bg-cyan-300/[0.07]");
    expect(playableSource).toContain("shadow-[inset_0_0_0_1px_rgba(128,241,255,0.10)]");
    expect(playableSource).not.toContain("border-cyan-300/70 bg-cyan-300/12 shadow-lg shadow-cyan-950/25");
    expect(playableSource).not.toContain("focus:ring-2 focus:ring-cyan-300/60");
    expect(stylesSource).toContain(".veydrift-planet-selector-button:focus-visible");
    expect(stylesSource).toContain("outline: 1px solid rgba(128, 241, 255, 0.68)");
    expect(stylesSource).toContain("--tw-ring-shadow: 0 0 0 2px var(--tw-ring-color);");
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
    expect(navSource).toContain('aria-label="Edit player profile"');
    expect(navSource).toContain('aria-haspopup="dialog"');
    expect(navSource).toContain('id="commander-name-editor"');
    expect(navSource).toContain('role="dialog"');
    expect(navSource).toContain("playerDescriptionMaxLength");
    expect(navSource).toContain("fixed inset-0 z-50");
    expect(navSource).not.toContain('className="mt-2 grid gap-2 rounded border border-white/10 bg-black/30 p-2"');
    expect(playableSource).toContain("playerProfile={playerProfile}");
    expect(playableSource).toContain("onUpdatePlayerProfile={handleUpdatePlayerProfile}");
    expect(topBarSource).toContain("max-w-[96rem]");
    expect(navSource).not.toContain("Home Planet");
    expect(navSource).not.toContain("tracking-[0.16em]");
  });

  test("moves alliance invites into their own sidebar tab", () => {
    expect(navSource).toContain('{ key: "raid-target-finder", label: "Raid Finder"');
    expect(navSource).toContain('{ key: "alliance-invites", label: "Invite"');
    expect(navSource.indexOf('{ key: "raid-target-finder"')).toBeLessThan(navSource.indexOf('{ key: "alliance-invites"'));
    expect(playableSource).toContain('if (page === "alliance-invites")');
    expect(playableSource).toContain("<AllianceInvitesPage");
    expect(playableSource).toContain('page === "alliance-invites"');
  });

  test("makes Commander card value fields copy full values with local fade-up feedback", () => {
    expect(navSource).toContain("CopyableCommanderValue");
    expect(navSource).toContain('copyKey="commander"');
    expect(navSource).toContain('copyKey="commander-fallback"');
    expect(navSource).toContain('copyKey="home"');
    expect(navSource).toContain('copyKey="wallet"');
    expect(navSource).toContain("data-copy-value={copyValue}");
    expect(navSource).toContain("aria-label={`Copy ${label}`}");
    expect(navSource).toContain("clipboard.writeText(value)");
    expect(navSource).toContain("catch(() =>");
    expect(navSource).toContain("playerProfile?.displayName?.trim()");
    expect(navSource).toContain("|| account");
    expect(navSource).toContain("copyValue={account}");
    expect(navSource).toContain("copyValue={coordinates}");
    expect(navSource).toContain("veydrift-copy-value-fade-up");
    expect(navSource).toContain('aria-hidden="true"');
    expect(navSource).toContain("absolute inset-x-0 top-0 veydrift-copy-value-fade-up");
    expect(navSource).toContain("<span className={valueClassName}>{value}</span>");
    expect(navSource).toContain("focus-visible:ring-2 focus-visible:ring-cyan-300/55");
    expect(navSource).not.toContain("focus:ring-2 focus:ring-cyan-300/55");
    expect(stylesSource).toContain("@keyframes veydrift-copy-value-fade-up");
    expect(stylesSource).toContain("transform: translateY(-0.45rem)");
    expect(stylesSource).toContain("animation: veydrift-copy-value-fade-up 720ms ease-out both");
  });

  test("moves rename and abandon actions into the overview hero", () => {
    expect(overviewSource).toContain('aria-label="Rename planet"');
    expect(overviewSource).toContain('aria-label="Abandon planet"');
    expect(overviewSource).toContain("canAbandonPlanet");
    expect(overviewSource).not.toContain("Rename\n                </button>");
  });

  test("keeps the planet rename action as a compact pencil icon", () => {
    expect(overviewSource).toContain('className="relative inline-grid h-5 w-5 translate-y-px place-items-center self-center');
    expect(overviewSource).toContain('className="m-0 min-w-0 break-words text-2xl font-semibold leading-none text-white drop-shadow sm:text-3xl"');
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
