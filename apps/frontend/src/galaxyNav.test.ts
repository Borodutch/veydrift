import { describe, expect, test } from "bun:test";
import { resolveInitialGalaxyNav } from "./galaxyNav";

describe("resolveInitialGalaxyNav", () => {
  test("leaves nav unchanged while home coordinates are unavailable", () => {
    expect(
      resolveInitialGalaxyNav({ homeCoords: undefined, alreadyInitialized: false })
    ).toBeNull();
  });

  test("initializes to the home system the first time home coordinates arrive", () => {
    expect(
      resolveInitialGalaxyNav({
        homeCoords: { galaxy: 2, system: 47 },
        alreadyInitialized: false,
      })
    ).toEqual({ galaxy: 2, system: 47 });
  });

  test("does not reset nav once initialized, even when home coordinates change", () => {
    // Simulates a background poll: onChainSettlement refreshes, producing a
    // new/changed homeCoords after the user has navigated elsewhere. The view
    // must stay where the user put it (VEY-358).
    expect(
      resolveInitialGalaxyNav({
        homeCoords: { galaxy: 9, system: 1 },
        alreadyInitialized: true,
      })
    ).toBeNull();
  });

  test("ignores reference churn for unchanged home coordinates after init", () => {
    expect(
      resolveInitialGalaxyNav({
        homeCoords: { galaxy: 2, system: 47 },
        alreadyInitialized: true,
      })
    ).toBeNull();
  });
});
