import { describe, expect, test } from "bun:test";
import {
  hasUsefulPlanetDetailBackRoute,
  inspectRouteForManagedPlanetSelection,
  managedPlanetSelectionForInspectRoute,
  parseInspectRoute,
  planetDetailBackRouteForCurrentScreen,
} from "../src/inspectRoutes";
import { hasPlanetSelectorChoice, isPlanetSelectorParentSelected } from "../src/planetSelectorChoice";

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
  const ownedPlanets = [
    { galaxy: 1, system: 2, position: 3, planetId: "owned-a", moon: { exists: true } },
    { galaxy: 4, system: 5, position: 6, planetId: "owned-b", moon: null },
  ];

  test("builds one canonical owned-body route for an unrelated inspector selection", () => {
    const route = inspectRouteForManagedPlanetSelection("planet", "planet", ownedPlanets[1]);
    expect(route).toEqual({
      kind: "planet",
      coords: { galaxy: 4, system: 5, position: 6 },
    });
    expect(managedPlanetSelectionForInspectRoute(route, ownedPlanets)).toEqual({
      bodyKind: "planet",
      planetId: "owned-b",
    });

    expect(playableSource.match(/onSelect=\{handleSelectManagedPlanet\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(playableSource).toContain("navigateToInspectRoute(nextInspectRoute)");
  });

  test("preserves unrelated inspection while restoring owned deep links and browser history routes", () => {
    const unrelated = parseInspectRoute("#/planet/9/9/9");
    expect(unrelated.kind).toBe("planet");
    expect(managedPlanetSelectionForInspectRoute(
      unrelated.kind === "planet" ? unrelated : null,
      ownedPlanets,
    )).toBeNull();

    const ownedPlanet = parseInspectRoute("#/planet/1/2/3");
    const ownedMoon = parseInspectRoute("#/moon/1/2/3");
    expect(managedPlanetSelectionForInspectRoute(
      ownedPlanet.kind === "planet" ? ownedPlanet : null,
      ownedPlanets,
    )).toEqual({ bodyKind: "planet", planetId: "owned-a" });
    expect(managedPlanetSelectionForInspectRoute(
      ownedMoon.kind === "moon" ? ownedMoon : null,
      ownedPlanets,
    )).toEqual({ bodyKind: "moon", planetId: "owned-a" });
    expect(isPlanetSelectorParentSelected("owned-a", "owned-a")).toBe(true);
    expect(isPlanetSelectorParentSelected("owned-b", "owned-a")).toBe(false);

    // Back/forward applies the location route in either ordering rather than
    // retaining the selection inferred for the previously visited body.
    expect([
      managedPlanetSelectionForInspectRoute(unrelated.kind === "planet" ? unrelated : null, ownedPlanets),
      managedPlanetSelectionForInspectRoute(ownedPlanet.kind === "planet" ? ownedPlanet : null, ownedPlanets),
      managedPlanetSelectionForInspectRoute(unrelated.kind === "planet" ? unrelated : null, ownedPlanets),
    ]).toEqual([null, { bodyKind: "planet", planetId: "owned-a" }, null]);
  });

  test("keeps normal owned-page switching inline outside an inspector", () => {
    expect(inspectRouteForManagedPlanetSelection("overview", "planet", ownedPlanets[0])).toBeNull();
    expect(inspectRouteForManagedPlanetSelection("infrastructure", "planet", ownedPlanets[1])).toBeNull();
    expect(inspectRouteForManagedPlanetSelection("planet", "moon", ownedPlanets[0])).toEqual({
      kind: "moon",
      coords: { galaxy: 1, system: 2, position: 3 },
    });
  });

  test("uses a mobile hamburger menu instead of always-visible mobile tabs", () => {
    expect(navSource).toContain("Open navigation menu");
    expect(navSource).toContain("Close navigation menu");
    expect(navSource).toContain("mobile-navigation-menu");
    // The disclosure is browser-native so opening the menu does not depend on
    // a Preact click handler successfully committing local state first. Its
    // explicit button role keeps the visible hamburger discoverable to
    // assistive technology and semantic click automation.
    expect(navSource).toContain("<details");
    expect(navSource).toContain("<summary");
    expect(navSource).toContain('role="button"');
    expect(navSource).toContain("onToggle={(event) => setMobileMenuOpen(event.currentTarget.open)}");
    expect(navSource).toContain("label={page.label}");
    expect(navSource).not.toContain("onClick={() => setMobileMenuOpen((open) => !open)}");
    expect(navSource).not.toContain("label={page.mobileLabel}");
    expect(navSource).not.toContain("Mobile top tabs");
  });

  test("keeps the mobile menu outside-tap backdrop outside its clipped sticky shell", () => {
    const backdropIndex = navSource.indexOf('className="fixed inset-0 z-10 cursor-default bg-black/40 md:hidden"');
    const stickyShellIndex = navSource.indexOf('className="sticky top-[var(--topbar-h,2.75rem)]');

    expect(backdropIndex).toBeGreaterThan(0);
    expect(backdropIndex).toBeLessThan(stickyShellIndex);
    expect(navSource).not.toContain('className="fixed inset-0 z-[-1] cursor-default bg-black/40"');
  });

  test("keeps mobile planet selection as an image row, not a select dropdown", () => {
    expect(playableSource).toContain('layout="mobile"');
    expect(playableSource).not.toContain("<select");
    expect(playableSource).not.toContain("<option");
  });

  test("contains mobile planet picker horizontal overflow inside its own scroller", () => {
    expect(playableSource).toContain('aria-label="Select planet" className="block min-w-0 max-w-full overflow-x-auto overscroll-x-contain"');
    expect(playableSource).toContain('className="flex w-max min-w-full gap-2 pb-1"');
    // overflow-x-clip, not overflow-hidden: hidden would turn these shells
    // into the sticky scrollport and detach the top bar / mobile nav from
    // the viewport while still clipping horizontal overflow.
    expect(playableSource).toContain('className="playable-starfield relative isolate min-h-dvh w-full max-w-full overflow-x-clip bg-[#05070f] text-slate-100"');
    expect(playableSource).toContain('className="relative z-10 mx-auto flex w-full max-w-[96rem] flex-col overflow-x-clip md:h-[calc(100dvh-var(--topbar-h,2.75rem))] md:flex-row"');
    expect(playableSource).toContain("overflow-visible p-3");
    expect(playableSource).toContain("md:min-h-0 md:overflow-y-auto md:overscroll-contain");
    expect(playableSource).toContain("env(safe-area-inset-bottom)");
    expect(playableSource).not.toContain("flex min-w-max gap-2 pb-1");
  });

  test("hides every planet picker when a single planet is the only selectable body", () => {
    expect(hasPlanetSelectorChoice([])).toBe(false);
    expect(hasPlanetSelectorChoice([{ moon: null }])).toBe(false);
    expect(hasPlanetSelectorChoice([{ moon: { exists: false } }])).toBe(false);

    expect(playableSource).toContain("const showPlanetSelector = hasPlanetSelectorChoice(walletPlanets);");
    expect(playableSource).toContain("const mobilePlanetPicker = showPlanetSelector ? (");
    expect(playableSource).toContain("const planetSidebar = showPlanetSelector ? (");
    expect(playableSource).toContain("{compactPlanetSelector}");
    expect(playableSource).not.toContain("const mobilePlanetPicker = walletPlanets.length > 0");
    expect(playableSource).not.toContain("const planetSidebar = walletPlanets.length > 0");
  });

  test("keeps every planet picker when multiple selectable bodies exist", () => {
    expect(hasPlanetSelectorChoice([{ moon: null }, { moon: null }])).toBe(true);
    expect(hasPlanetSelectorChoice([{ moon: { exists: true } }])).toBe(true);
  });

  test("moves the mobile planet picker into the hamburger menu, not above content", () => {
    // Below `md` the picker is rendered inside the hamburger menu via NavBar.
    expect(playableSource).toContain("planetPicker={mobilePlanetPicker}");
    expect(navSource).toContain("planetPicker?: ComponentChildren");
    expect(navSource).toContain("{planetPicker}");
    // The compact row only fills the md-to-lg gap (no hamburger, no right sidebar),
    // so it must be hidden below `md` and at/above `lg`.
    expect(playableSource).toContain("mb-3 hidden min-w-0 max-w-full overflow-hidden md:block lg:hidden");
  });

  test("constrains mobile nav menu and tiles to the viewport width", () => {
    expect(navSource).toContain('className="sticky top-[var(--topbar-h,2.75rem)] z-20 w-full max-w-full overflow-hidden border-b border-white/10 bg-[#0c111b]/95 backdrop-blur md:hidden"');
    expect(navSource).toContain('className="grid min-w-0 max-w-full gap-3 overflow-hidden border-t border-white/10 bg-[#08101d]/98 p-3 shadow-2xl shadow-black/30"');
    expect(navSource).toContain('className="min-w-0 max-w-full overflow-hidden rounded border border-white/10 bg-white/[0.03] p-2"');
    expect(navSource).toContain('className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5 sm:grid-cols-[repeat(4,minmax(0,1fr))]"');
    expect(navSource).toContain("max-w-full flex-col items-center justify-center");
    expect(navSource).toContain("overflow-hidden rounded border px-1");
    expect(navSource).not.toContain('className="grid grid-cols-3 gap-1.5 sm:grid-cols-4"');
  });

  test("keeps the desktop planet selector compact and selection-only", () => {
    expect(playableSource).not.toContain("Planet Selector");
    expect(playableSource).not.toContain("Owned planets");
    expect(playableSource).not.toContain("active world");
    expect(playableSource).not.toContain("ring-inset");
  });

  test("shows full planet names in the picker without permanent truncation", () => {
    expect(playableSource).toContain('aria-label="Select planet" className="hidden w-32 shrink-0');
    expect(playableSource).toContain("relative grid w-24 min-w-0 shrink-0 gap-1");
    expect(playableSource).toContain("title={label}");
    expect(playableSource).toContain("line-clamp-2 block max-w-full");
    expect(playableSource).toContain("[overflow-wrap:anywhere]");
    expect(playableSource).not.toContain("line-clamp-2 block min-h-8");
    expect(playableSource).not.toContain('aria-label="Select planet" className="hidden w-28 shrink-0');
    expect(playableSource).not.toContain('className="grid w-20 min-w-0 shrink-0 gap-1"');
    expect(playableSource).not.toContain("block max-w-full truncate text-[0.68rem]");
  });

  test("renders planet selector thumbnails as circles", () => {
    expect(playableSource).toContain("h-14 w-14 overflow-hidden rounded-full bg-black/30");
  });

  test("anchors incoming attack warnings to the planet thumbnail", () => {
    expect(playableSource).toContain('className={`absolute -top-1 z-10 grid h-5 w-5 place-items-center rounded-full');
    expect(playableSource).toContain('showMoonIndicator ? "-left-1" : "-right-1"');
    expect(playableSource).toContain('<AlertTriangle className="block h-3 w-3"');
    expect(playableSource).not.toContain('<AlertTriangle className="block translate-y-px"');
  });

  test("hydrates attack highlights as wallet-scoped planet and moon id sets", () => {
    expect(playableSource).toContain("derivePlanetPickerAttackHighlights({");
    expect(playableSource).toContain("hydrated: Boolean(expectedWalletSnapshotKey && hydratedWalletSnapshotKey === expectedWalletSnapshotKey)");
    expect(playableSource).toContain("planetPickerHasIncomingAttack(attackHighlights, planet.planetId, \"planet\")");
    expect(playableSource).toContain("planetPickerHasIncomingAttack(attackHighlights, planet.planetId, \"moon\")");
    expect(playableSource).toContain('hasIncomingPlanetAttack && hasIncomingMoonAttack');
    expect(playableSource).toContain('? "planet-and-moon"');
    expect(playableSource).not.toContain("hasIncomingAttack={planetHasIncomingAttack(fleetVisibility, planet.planetId)}");
  });

  test("shows per-planet queue progress bars in the selector", () => {
    expect(playableSource).toContain('<PlanetSelectorProgressBars planet={planet} progressState={progressState} />');
    expect(playableSource).toContain("data-planet-selector-progress-bars={planet.planetId}");
    expect(playableSource).toContain("data-planet-selector-progress={bar.kind}");
    expect(playableSource).toContain("const bars = planetSelectorQueueProgressBars(planet, progressState).filter((bar) => bar.active);");
    expect(playableSource).toContain('className="grid w-full gap-1"');
    expect(playableSource).toContain('constructionProgressKey(planet.planetId, "planet", "building")');
    expect(playableSource).toContain('constructionProgressKey(planet.planetId, "planet", "defense")');
    expect(playableSource).toContain('constructionProgressKey(planet.planetId, "planet", "ship")');
    expect(playableSource).toContain("progress: totalProgress");
    expect(playableSource).not.toContain('className="grid w-full grid-cols-3 gap-1"');
    expect(playableSource).not.toContain("opacity-45");
  });

  test("hides planet selector progress rows when no displayed queue is active", () => {
    expect(playableSource).toContain("if (bars.length === 0) return null;");
    expect(playableSource).toContain('data-planet-selector-progress-active="true"');
    expect(playableSource).not.toContain("data-planet-selector-progress-bars={planet.planetId} className=\"hidden\"");
    expect(playableSource).not.toContain('className="grid w-full grid-cols-3 gap-1 min-h-');
  });

  test("asks the centralized backend-data store to refresh completed queues for unselected planets", () => {
    const completionRefreshSource = playableSource.slice(
      playableSource.indexOf("const nextEventMs = nextProductionQueueCompletionEventMs("),
      playableSource.indexOf("// Chime when an active production queue reaches completion."),
    );
    expect(completionRefreshSource).toContain("[...constructionQueues.values(), walletResearchQueue]");
    expect(completionRefreshSource).toContain('backendData!.scheduleRefresh(');
    expect(completionRefreshSource).toContain('"production-queue-completion"');
    expect(completionRefreshSource).toContain("`wallet:${account.toLowerCase()}`");
    expect(completionRefreshSource).not.toContain("confirmedConstructionQueues");
    expect(completionRefreshSource).not.toContain('document.visibilityState === "hidden"');
  });

  test("keeps research wallet-global instead of attributing it to a planet selector item", () => {
    expect(playableSource).toContain('backendData.key("queues", account, undefined)');
    expect(playableSource).toContain("const walletResearchQueue = walletResearchQueueFor(walletQueues)");
    expect(playableSource).toContain("progressState={walletResearchProgress}");
    expect(playableSource).toContain("progressState={constructionProgressState}");
    expect(playableSource).not.toContain("researchQueueWithPlanetAttribution");
    expect(playableSource).not.toContain("researchQueueForPlanet");
    expect(playableSource).not.toContain('constructionProgressKey(planet.planetId, "planet", "research")');
    expect(playableSource).not.toContain("function researchQueuePreview(queue: QueueStateResponse | null | undefined)");
    expect(playableSource).not.toContain("<PlanetSelectorResearchProgress");
    expect(playableSource).not.toContain("data-planet-selector-research-progress");
    expect(playableSource).not.toContain("planet.queues.research");
  });

  test("renders one selector tile per planet and represents moons only as unclipped overlays", () => {
    expect(playableSource).toContain("data-planet-selector-item={planet.planetId}");
    expect(playableSource).toContain("const selectorItems = planets.map((planet) => (");
    expect(playableSource).toContain("showMoonIndicator={planet.moon?.exists === true}");
    expect(playableSource).toContain("<PlanetMoonIndicator");
    expect(playableSource).toContain('className="!-right-1 !-top-1 !h-5 !w-5 xl:!h-5 xl:!w-5"');
    expect(playableSource).toContain("relative grid w-24 min-w-0 shrink-0 gap-1");
    expect(playableSource).not.toContain("PlanetSelectorMoonButton");
    expect(playableSource).not.toContain('data-planet-selector-moon="true"');
    expect(playableSource).not.toContain('onSelect(planet.planetId, "moon")');
    expect(playableSource).not.toContain('constructionProgressKey(planet.planetId, "moon"');
    expect(gameAssetsSource).toContain("frozen-ice.webp");
    expect(moonIndicatorSource).toContain('data-planet-moon-subsection="true"');
    expect(moonIndicatorSource).not.toContain("Child moon body");
    expect(rankingsSource).toContain("<PlanetMoonSubsection");
  });

  test("shares persistent accessible planet ordering across every picker layout", () => {
    expect(playableSource).toContain("const orderedWalletPlanets = useMemo(() =>");
    expect(playableSource).toContain("readPlanetPickerOrder(browserPlanetPickerOrderStorage(), planetPickerWallet)");
    expect(playableSource).toContain("writePlanetPickerOrder(browserPlanetPickerOrderStorage(), planetPickerWallet, reconciledIds)");
    expect(playableSource.match(/planets=\{orderedWalletPlanets\}/g)?.length).toBe(2);
    expect(playableSource).toContain("orderedWalletPlanets.map((managedPlanet) => ({");
    expect(playableSource).not.toContain("walletPlanets.map((managedPlanet) => ({");
    expect(playableSource.match(/onOrderChange=\{handlePlanetPickerOrderChange\}/g)?.length).toBe(2);
    expect(playableSource).not.toContain("PlanetPickerReorderHandle");
    expect(playableSource).not.toContain("data-planet-selector-drag-handle");
    expect(playableSource).toContain('data-planet-selector-long-press={bodyKind === "planet" ? planet.planetId : undefined}');
    expect(playableSource).toContain("interaction.current.activatePointer(pointerId)");
    expect(playableSource).toContain("touchReorderingPlanetId.current = activation.planetId");
    expect(playableSource).toContain("installPlanetPickerTouchMoveGuard(buttonRef.current, shouldPreventTouchMove)");
    expect(playableSource).toContain('style={{ touchAction: "pan-x pan-y" }}');
    expect(playableSource).not.toContain('reordering ? "cursor-grabbing touch-none"');
    expect(playableSource).toContain("onPointerDown={(event) => onPlanetPointerDown(planet.planetId, event)}");
    expect(playableSource).toContain("onPointerMove={onPlanetPointerMove}");
    expect(playableSource).toContain("onKeyDown={(event) => onPlanetKeyDown(planet.planetId, event)}");
    expect(playableSource).toContain("interaction.current.reorderFromKey(planetIds, planetId, event.key)");
    expect(playableSource).toContain("interaction.current.reorderPointerTarget(targetPlanetId, position)");
    expect(playableSource).toContain('if (event.key === "Escape")');
    expect(playableSource).toContain("Press and hold to reorder. With the keyboard, use arrow keys, Home, or End");
    expect(playableSource).toContain('aria-live="polite"');
    expect(playableSource).toContain("{reorderAnnouncement}");
    expect(playableSource).toContain("if (onBeforeSelect && !onBeforeSelect(planet.planetId, event)) return;");
    expect(playableSource).toContain("onSelect(planet.planetId, bodyKind);");
  });

  test("keeps a current moon mapped to its selected parent while moon navigation remains active", () => {
    expect(playableSource).toContain("const selected = isPlanetSelectorParentSelected(planet.planetId, selectedPlanet.planetId);");
    expect(playableSource).toContain("selected={selected}");
    expect(playableSource).not.toContain('selectedBodyKind={activeBodyKind}');
    expect(playableSource).toContain('setSelectedBodyKind(nextBodyKind)');
    expect(playableSource).toContain('navigateToInspectRoute({ kind: "page", page: "moon" })');
    expect(playableSource).toContain('if (route.page !== "moon") setSelectedBodyKind("planet")');
  });

  test("normal navigation from a selected moon returns to the parent planet context", () => {
    expect(playableSource).toContain('if (route.page !== "moon") setSelectedBodyKind("planet")');
    expect(playableSource).toContain('setSelectedBodyKind("planet")');
    expect(playableSource).not.toContain('activeBodyKind === "moon" && (page === "overview" || page === "infrastructure" || page === "defenses" || page === "shipyard")');
    expect(playableSource).toContain('if (route.page !== "moon") setSelectedBodyKind("planet")');
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
    expect(playableSource).toContain("border-cyan-300/35");
    expect(playableSource).toContain("bg-cyan-300/[0.07]");
    expect(playableSource).toContain("shadow-[inset_0_0_0_1px_rgba(128,241,255,0.10)]");
    expect(playableSource).toContain("const selectionStateClass = selected");
    expect(playableSource).toContain("const borderStateClass = hasIncomingAttack");
    expect(playableSource).toContain("${selectionStateClass} ${borderStateClass}");
    expect(playableSource).not.toContain("border-cyan-300/70 bg-cyan-300/12 shadow-lg shadow-cyan-950/25");
    expect(playableSource).not.toContain("focus:ring-2 focus:ring-cyan-300/60");
    expect(stylesSource).toContain(".veydrift-planet-selector-button:focus-visible");
    expect(stylesSource).toContain("outline: 1px solid rgba(128, 241, 255, 0.68)");
    expect(stylesSource).toContain("outline-offset: -2px");
    expect(stylesSource).toContain("--tw-ring-shadow: inset 0 0 0 2px var(--tw-ring-color);");
  });

  test("keeps the desktop sidebar footer compact and sticky", () => {
    expect(playableSource).toContain("md:h-[calc(100dvh-var(--topbar-h,2.75rem))]");
    expect(navSource).toContain("h-[calc(100dvh-var(--topbar-h,2.75rem))]");
    expect(navSource).toContain("md:sticky md:top-[var(--topbar-h,2.75rem)]");
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

  test("moves referral invites into their own sidebar tab", () => {
    expect(navSource).toContain('{ key: "raid-target-finder", label: "Raid Finder"');
    expect(navSource).toContain('{ key: "alliance-invites", label: "Earn $10", mobileLabel: "Earn $10", icon: Mail }');
    expect(navSource).not.toContain('{ key: "alliance-invites", label: "Invite"');
    expect(navSource.indexOf('{ key: "raid-target-finder"')).toBeLessThan(navSource.indexOf('{ key: "alliance-invites"'));
    expect(playableSource).toContain('if (page === "alliance-invites")');
    expect(playableSource).toContain("<AllianceInvitesPage");
    expect(playableSource).toContain('page === "alliance-invites"');
    expect(playableSource).toContain("referralProgramPanel={referralProgramPanel}");
    expect(playableSource).toContain("onAcceptInvite={handleAcceptAllianceInvite}");
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
    expect(overviewSource).toContain('className="relative inline-grid h-10 w-10 translate-y-px place-items-center self-center');
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
    expect(missionCreationSource).toContain('aria-label="Mission speed"');
    expect(missionCreationSource).toContain('type="range"');
    expect(galaxySource).not.toContain("Mission speed");
    expect(galaxySource).not.toContain("MISSION_SPEED_OPTIONS.map");
    expect(planetDetailSource).not.toContain("MISSION_SPEED_OPTIONS.map");
    expect(playableSource).toContain("pendingGalaxyMission");
    expect(playableSource).toContain("<MissionCreationPage");
  });
});
