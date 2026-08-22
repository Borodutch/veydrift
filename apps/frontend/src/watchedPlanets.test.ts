import { describe, expect, test } from "bun:test";
import { planetsFromSystemResponse } from "./data/mockUniverse";
import { managedPlanetOverviewDisplayName, shouldRenderWatchedPlanetsPanel } from "./components/OverviewPage";
import { nextWatchedPlanetsPageAfterToggle, watchedPlanetsPanelRange } from "./watchedPlanetsView";
import type { ManagedPlanetResponse } from "./walletFlow";

const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
const galaxySource = await Bun.file(new URL("./components/GalaxyView.tsx", import.meta.url)).text();
const overviewSource = await Bun.file(new URL("./components/OverviewPage.tsx", import.meta.url)).text();
const watchableRowSource = await Bun.file(new URL("./components/WatchablePlanetRow.tsx", import.meta.url)).text();

describe("watched planets UI", () => {
  test("keeps the Overview watched-planets panel hidden when there are no watched planets", () => {
    expect(
      shouldRenderWatchedPlanetsPanel({
        error: undefined,
        isWalletConnected: true,
        loading: false,
        planetCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRenderWatchedPlanetsPanel({
        error: undefined,
        isWalletConnected: true,
        loading: false,
        planetCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldRenderWatchedPlanetsPanel({
        error: "Watched planets API failed",
        isWalletConnected: true,
        loading: false,
        planetCount: 0,
      }),
    ).toBe(true);
  });

  test("maps backend watched planet payloads through the same planet parser Galaxy uses", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 0,
      system: 0,
      planets: [
        {
          archetype: "temperate-ocean",
          fields: 180,
          galaxy: 2,
          system: 44,
          position: 9,
          temperature: 10,
          metalMultiplierBps: 10000,
          crystalMultiplierBps: 10000,
          deuteriumMultiplierBps: 10000,
          occupiedBy: {
            owner: "0x1111111111111111111111111111111111111111",
            ownerDisplayName: null,
            planetId: "9",
          },
        },
      ],
    });

    expect(planet).toMatchObject({
      galaxy: 2,
      system: 44,
      position: 9,
      occupiedBy: {
        planetId: "9",
      },
    });
  });

  test("moves back a page only when unwatching the last visible watched planet", () => {
    expect(
      nextWatchedPlanetsPageAfterToggle({
        currentPage: 3,
        currentPagePlanetCount: 1,
        wasWatched: true,
      }),
    ).toBe(2);
    expect(
      nextWatchedPlanetsPageAfterToggle({
        currentPage: 3,
        currentPagePlanetCount: 2,
        wasWatched: true,
      }),
    ).toBe(3);
    expect(
      nextWatchedPlanetsPageAfterToggle({
        currentPage: 3,
        currentPagePlanetCount: 1,
        wasWatched: false,
      }),
    ).toBe(3);
    expect(
      nextWatchedPlanetsPageAfterToggle({
        currentPage: 1,
        currentPagePlanetCount: 1,
        wasWatched: true,
      }),
    ).toBe(1);
  });

  test("derives stable Overview pagination ranges", () => {
    expect(watchedPlanetsPanelRange({ page: 1, pageSize: 25, total: 0 })).toEqual({ start: 0, end: 0 });
    expect(watchedPlanetsPanelRange({ page: 1, pageSize: 25, total: 77 })).toEqual({ start: 1, end: 25 });
    expect(watchedPlanetsPanelRange({ page: 4, pageSize: 25, total: 77 })).toEqual({ start: 76, end: 77 });
  });

  test("wires Galaxy and Overview through the same watchable row and refresh path", () => {
    expect(galaxySource).toContain("WatchablePlanetRow");
    expect(overviewSource).toContain("WatchablePlanetRow");
    expect(appSource).toContain("backendData!.watchedPlanets(account, { page, pageSize: 25 })");
    expect(appSource).toContain("onRefreshWatchedPlanets={() => void refreshWatchedPlanets(watchedPlanetsPage)}");
    expect(appSource).toContain("nextWatchedPlanetsPageAfterToggle");
    expect(appSource).toContain("backendData!.setPlanetWatched(provider, account, planetId, watched)");
    expect(overviewSource).toContain("onWatchedPlanetsPageChange");
    expect(overviewSource).toContain("onRefresh");
    expect(overviewSource).toContain("Retry");
    expect(overviewSource).toContain("watchedPlanetsPanelRange");
  });

  test("keeps Galaxy identity and secondary actions visually quiet", () => {
    expect(galaxySource).toContain("!isOwnedByAccount && planet.occupiedBy?.planetId");
    expect(galaxySource).not.toContain("Inspect moon");
    expect(watchableRowSource).toContain('planet.alliance ? "self-start sm:block" : "self-stretch items-center justify-end sm:flex"');
    expect(watchableRowSource).toContain("grid-cols-[2rem_minmax(0,1fr)_auto] sm:grid-cols-[2.25rem_minmax(0,1fr)_8rem_auto]");
    expect(watchableRowSource).toContain('"col-start-3 row-start-1 self-center justify-end sm:col-start-4"');
    expect(watchableRowSource).toContain("mobileIdentityInMeta && index === 0");
    expect(galaxySource).toContain("mobileIdentityInMeta");
    expect(watchableRowSource).toContain("items-center whitespace-nowrap");
    expect(watchableRowSource).toContain("showIdentity && !compact");
    expect(watchableRowSource).not.toContain("hover:underline");
  });
});

describe("overview planet sections", () => {
  test("orders production blocks before My planets and Watched planets", () => {
    const queueIndex = overviewSource.indexOf("{/* Contract production queues */}");
    const myPlanetsIndex = overviewSource.indexOf("<MyPlanetsPanel");
    const watchedPlanetsIndex = overviewSource.indexOf("<WatchedPlanetsPanel");

    expect(queueIndex).toBeGreaterThan(-1);
    expect(myPlanetsIndex).toBeGreaterThan(queueIndex);
    expect(watchedPlanetsIndex).toBeGreaterThan(myPlanetsIndex);
  });

  test("wires My planets actions through the existing galaxy mission flow", () => {
    expect(appSource).toContain("overviewMyPlanetActionsFor");
    expect(appSource).toContain("galaxyActionsForSlot");
    expect(appSource).toContain('page === "overview"');
    expect(appSource).toContain("handleOverviewMyPlanetAction");
    expect(appSource).toContain("originPlanet: selectedManagedPlanet");
    expect(appSource).toContain("const missionOriginPlanet = pending.originPlanet ?? selectedManagedPlanet");
    expect(appSource).toContain("myPlanets={overviewMyPlanetActionGroups}");
    expect(appSource).toContain("selectedPlanetId={activePlanetId}");
    expect(appSource).toContain("onMyPlanetAction={handleOverviewMyPlanetAction}");
    expect(overviewSource).toContain("<MyPlanetActionButtons");
    expect(overviewSource).toContain("onAction={(action) => onAction?.(action, planet)}");
    expect(overviewSource).toContain("showIdentity={false}");
    expect(overviewSource.match(/showMoonIndicator={false}/g)?.length).toBe(2);
    expect(overviewSource).toContain("current={isSelected}");
    expect(overviewSource).not.toContain("{myPlanets.length} owned");
    expect(watchableRowSource).toContain("canWatch || actionSlot");
    expect(watchableRowSource).toContain("{actionSlot}");
    expect(watchableRowSource).toContain('compact ? "pt-0" : "pt-2"');
  });

  test("keeps four-action planet headers inline at normal mobile widths and wraps only when genuinely narrow", () => {
    expect(overviewSource).toContain("mobileActionsInline");
    expect(watchableRowSource).toContain("grid-cols-[minmax(0,1fr)_auto] max-[359px]:grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(watchableRowSource).toContain(
      "col-start-2 row-start-1 self-center justify-end max-[359px]:col-span-full max-[359px]:col-start-1 max-[359px]:row-start-auto sm:col-span-1 sm:col-start-2 sm:row-start-1",
    );
    expect(overviewSource.match(/h-11 w-11/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(overviewSource).toContain("flex flex-wrap justify-end gap-1.5");
  });

  test("keeps a one-action planet and its moon actions in compact inline rows", () => {
    expect(watchableRowSource).toContain('data-watchable-moon-row="full-width"');
    expect(watchableRowSource).toContain("col-span-full min-w-0");
    expect(overviewSource).toContain("moonActionSlot={moonActions && moonActions.length > 0");
    expect(overviewSource).toContain("<OverviewMoonActionButtons");
  });

  test("protects long planet names and HOME badges from inline action overlap", () => {
    expect(watchableRowSource).toContain("flex-nowrap sm:flex-wrap");
    expect(watchableRowSource).toContain("min-w-0 max-w-full items-center");
    expect(watchableRowSource).toContain("min-w-0 truncate text-sm font-semibold");
    expect(watchableRowSource).toContain('mobileActionsInline ? "shrink-0 sm:shrink" : ""');
  });

  test("preserves permission filtering and accessible labels while actions move inline", () => {
    expect(overviewSource).toContain("const enabledActions = actions.filter((action) => action.enabled)");
    expect(overviewSource).toContain("{enabledActions.map((action) =>");
    expect(overviewSource).toContain("aria-label={action.label}");
    expect(overviewSource).toContain("title={action.label}");
    expect(overviewSource).toContain('aria-label="Supply this planet"');
  });

  test("lets nested moon rows span the full watchable row width", () => {
    expect(watchableRowSource).toContain('data-watchable-moon-row="full-width"');
    expect(watchableRowSource).toContain("col-span-full min-w-0");
    expect(watchableRowSource).not.toContain("<PlanetMoonSubsection\\n            action={moonActionSlot}");
  });

  test("labels owned planets by custom name, then coordinates", () => {
    expect(managedPlanetOverviewDisplayName(managedPlanet({ name: "  Foundry  " }))).toBe("Foundry");
    expect(managedPlanetOverviewDisplayName(managedPlanet({ name: "   ", coordinates: "2:44:9" }))).toBe("Planet 2:44:9");
  });
});

function managedPlanet(overrides: Partial<ManagedPlanetResponse> = {}): ManagedPlanetResponse {
  return {
    planetId: "7",
    owner: "0x1111111111111111111111111111111111111111",
    name: null,
    galaxy: 1,
    system: 2,
    position: 3,
    fields: 180,
    temperature: 12,
    metalMultiplierBps: 10000,
    crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000,
    lastSettledAt: "0",
    resources: { metal: "0", crystal: "0", deuterium: "0" },
    coordinates: "1:2:3",
    isHomePlanet: false,
    fieldsUsed: 12,
    fieldsCapacity: 180,
    keyLevels: {
      metalMine: 1,
      crystalMine: 1,
      deuteriumSynthesizer: 1,
      solarPlant: 1,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
    moon: null,
    ...overrides,
  };
}
