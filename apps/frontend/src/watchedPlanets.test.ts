import { describe, expect, test } from "bun:test";
import { planetsFromSystemResponse } from "./data/mockUniverse";
import { shouldRenderWatchedPlanetsPanel } from "./components/OverviewPage";
import { nextWatchedPlanetsPageAfterToggle, watchedPlanetsPanelRange } from "./watchedPlanetsView";

const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
const galaxySource = await Bun.file(new URL("./components/GalaxyView.tsx", import.meta.url)).text();
const overviewSource = await Bun.file(new URL("./components/OverviewPage.tsx", import.meta.url)).text();

describe("watched planets UI", () => {
  test("keeps the Overview watched-planets panel hidden when there are no watched planets", () => {
    expect(shouldRenderWatchedPlanetsPanel({
      error: undefined,
      isWalletConnected: true,
      loading: false,
      planetCount: 0,
    })).toBe(false);
    expect(shouldRenderWatchedPlanetsPanel({
      error: undefined,
      isWalletConnected: true,
      loading: false,
      planetCount: 1,
    })).toBe(true);
    expect(shouldRenderWatchedPlanetsPanel({
      error: "Watched planets API failed",
      isWalletConnected: true,
      loading: false,
      planetCount: 0,
    })).toBe(true);
  });

  test("maps backend watched planet payloads through the same planet parser Galaxy uses", () => {
    const [planet] = planetsFromSystemResponse({
      galaxy: 0,
      system: 0,
      planets: [{
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
      }],
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
    expect(nextWatchedPlanetsPageAfterToggle({
      currentPage: 3,
      currentPagePlanetCount: 1,
      wasWatched: true,
    })).toBe(2);
    expect(nextWatchedPlanetsPageAfterToggle({
      currentPage: 3,
      currentPagePlanetCount: 2,
      wasWatched: true,
    })).toBe(3);
    expect(nextWatchedPlanetsPageAfterToggle({
      currentPage: 3,
      currentPagePlanetCount: 1,
      wasWatched: false,
    })).toBe(3);
    expect(nextWatchedPlanetsPageAfterToggle({
      currentPage: 1,
      currentPagePlanetCount: 1,
      wasWatched: true,
    })).toBe(1);
  });

  test("derives stable Overview pagination ranges", () => {
    expect(watchedPlanetsPanelRange({ page: 1, pageSize: 25, total: 0 })).toEqual({ start: 0, end: 0 });
    expect(watchedPlanetsPanelRange({ page: 1, pageSize: 25, total: 77 })).toEqual({ start: 1, end: 25 });
    expect(watchedPlanetsPanelRange({ page: 4, pageSize: 25, total: 77 })).toEqual({ start: 76, end: 77 });
  });

  test("wires Galaxy and Overview through the same watchable row and refresh path", () => {
    expect(galaxySource).toContain("WatchablePlanetRow");
    expect(overviewSource).toContain("WatchablePlanetRow");
    expect(appSource).toContain("fetchWatchedPlanets(apiBaseUrl, account, { page, pageSize: 25 })");
    expect(appSource).toContain("onRefreshWatchedPlanets={() => void refreshWatchedPlanets(watchedPlanetsPage)}");
    expect(appSource).toContain("nextWatchedPlanetsPageAfterToggle");
    expect(appSource).toContain("watchPlanet(apiBaseUrl, provider, account, planetId)");
    expect(appSource).toContain("unwatchPlanet(apiBaseUrl, provider, account, planetId)");
    expect(overviewSource).toContain("onWatchedPlanetsPageChange");
    expect(overviewSource).toContain("onRefresh");
    expect(overviewSource).toContain("Retry");
    expect(overviewSource).toContain("watchedPlanetsPanelRange");
  });
});
