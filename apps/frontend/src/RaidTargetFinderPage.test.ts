import { afterEach, describe, expect, test } from "bun:test";
import { applyMobileSortSelection } from "./components/RaidTargetFinderPage";
import {
  RAID_TARGET_FINDER_STORAGE_KEY,
  DEFAULT_RAID_TARGET_FILTERS,
  DEFAULT_RAID_TARGET_SORT,
  hasActiveAlliance,
  persistRaidTargetSettings,
  readPersistedRaidTargetSettings,
} from "./raidTargetFinder";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function installWindowStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    },
  });
  return values;
}

describe("RaidTargetFinderPage persistence", () => {
  test("applies the mobile Raid-tab sort selection from the input event", () => {
    const selected: string[] = [];
    applyMobileSortSelection("loot", "distance", (key) => selected.push(key));
    applyMobileSortSelection("loot", "loot", (key) => selected.push(key));
    expect(selected).toEqual(["loot"]);
  });

  test("persists and restores Raid Finder filter settings from localStorage", () => {
    const storage = installWindowStorage();

    persistRaidTargetSettings({
      filters: {
        hideProtected: false,
        hideSameAlliance: false,
        hideDefended: true,
        hideActiveFleet: true,
        minLoot: 2500,
        maxDistance: 150,
      },
      sort: { key: "distance", direction: "asc" },
    });

    expect(storage.has(RAID_TARGET_FINDER_STORAGE_KEY)).toBe(true);
    expect(readPersistedRaidTargetSettings()).toEqual({
      filters: {
        hideProtected: false,
        hideSameAlliance: false,
        hideDefended: true,
        hideActiveFleet: true,
        minLoot: 2500,
        maxDistance: 150,
      },
      sort: { key: "distance", direction: "asc" },
    });
  });

  test("falls back to defaults when saved settings are corrupt", () => {
    const storage = installWindowStorage();
    storage.set(RAID_TARGET_FINDER_STORAGE_KEY, "{bad json");

    expect(readPersistedRaidTargetSettings()).toEqual({
      filters: DEFAULT_RAID_TARGET_FILTERS,
      sort: DEFAULT_RAID_TARGET_SORT,
    });
  });

  test("keeps legacy filter-only settings and defaults missing sort", () => {
    const storage = installWindowStorage();
    storage.set(RAID_TARGET_FINDER_STORAGE_KEY, JSON.stringify({
      filters: {
        hideProtected: false,
        hideSameAlliance: true,
        hideDefended: false,
        hideActiveFleet: false,
        minLoot: 900,
        maxDistance: null,
      },
    }));

    expect(readPersistedRaidTargetSettings()).toEqual({
      filters: {
        hideProtected: false,
        hideSameAlliance: true,
        hideDefended: false,
        hideActiveFleet: false,
        minLoot: 900,
        maxDistance: null,
      },
      sort: DEFAULT_RAID_TARGET_SORT,
    });
  });

  test("falls back to default sort when saved sort settings are corrupt", () => {
    const storage = installWindowStorage();
    storage.set(RAID_TARGET_FINDER_STORAGE_KEY, JSON.stringify({
      filters: DEFAULT_RAID_TARGET_FILTERS,
      sort: { key: "unknown", direction: "sideways" },
    }));

    expect(readPersistedRaidTargetSettings()).toEqual({
      filters: DEFAULT_RAID_TARGET_FILTERS,
      sort: DEFAULT_RAID_TARGET_SORT,
    });
  });

  test("uses active alliance membership to decide Hide alliance visibility", () => {
    expect(hasActiveAlliance("0")).toBe(false);
    expect(hasActiveAlliance(null)).toBe(false);
    expect(hasActiveAlliance("12")).toBe(true);
  });
});
