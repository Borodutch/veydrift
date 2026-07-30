import { describe, expect, test } from "bun:test";
import {
  movePlanetPickerIdToIndex,
  planetPickerOrderStorageKey,
  readPlanetPickerOrder,
  reconcilePlanetPickerOrder,
  reorderPlanetPickerIds,
  shouldStartPlanetPickerDrag,
  writePlanetPickerOrder,
} from "./planetPickerOrder";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

describe("persistent planet picker order", () => {
  test("keeps the backend order until a saved custom order exists", () => {
    expect(reconcilePlanetPickerOrder(["1", "2", "3"], undefined)).toEqual(["1", "2", "3"]);
  });

  test("moves whole planet ids before or after a drop target", () => {
    expect(reorderPlanetPickerIds(["1", "2", "3"], "1", "3", "after")).toEqual(["2", "3", "1"]);
    expect(reorderPlanetPickerIds(["1", "2", "3"], "3", "1", "before")).toEqual(["3", "1", "2"]);
  });

  test("supports bounded keyboard moves", () => {
    expect(movePlanetPickerIdToIndex(["1", "2", "3"], "2", 0)).toEqual(["2", "1", "3"]);
    expect(movePlanetPickerIdToIndex(["1", "2", "3"], "2", 99)).toEqual(["1", "3", "2"]);
    expect(movePlanetPickerIdToIndex(["1", "2", "3"], "1", -1)).toEqual(["1", "2", "3"]);
  });

  test("persists and reloads an order for the same wallet", () => {
    const storage = memoryStorage();
    writePlanetPickerOrder(storage, "0xAbC", ["3", "1", "2"]);

    expect(readPlanetPickerOrder(storage, "0xabc")).toEqual(["3", "1", "2"]);
    expect(storage.values.has(planetPickerOrderStorageKey("0xABC"))).toBe(true);
  });

  test("isolates saved orders by connected wallet", () => {
    const storage = memoryStorage();
    writePlanetPickerOrder(storage, "0xaaa", ["2", "1"]);
    writePlanetPickerOrder(storage, "0xbbb", ["1", "2"]);

    expect(readPlanetPickerOrder(storage, "0xAAA")).toEqual(["2", "1"]);
    expect(readPlanetPickerOrder(storage, "0xBBB")).toEqual(["1", "2"]);
  });

  test("appends new planets and removes inaccessible planets", () => {
    expect(reconcilePlanetPickerOrder(["2", "3", "4"], ["3", "1", "2"])).toEqual(["3", "2", "4"]);
  });

  test("falls back safely for corrupt, duplicate, or stale saved data", () => {
    const storage = memoryStorage();
    storage.setItem(planetPickerOrderStorageKey("0xabc"), "{broken");
    expect(readPlanetPickerOrder(storage, "0xabc")).toBeUndefined();

    storage.setItem(planetPickerOrderStorageKey("0xabc"), JSON.stringify({
      version: 1,
      planetIds: ["2", "2"],
    }));
    expect(readPlanetPickerOrder(storage, "0xabc")).toBeUndefined();
    expect(reconcilePlanetPickerOrder(["1", "2"], readPlanetPickerOrder(storage, "0xabc"))).toEqual(["1", "2"]);
  });

  test("requires deliberate pointer movement before a drag starts", () => {
    expect(shouldStartPlanetPickerDrag(3, 4)).toBe(false);
    expect(shouldStartPlanetPickerDrag(6, 0)).toBe(true);
    expect(shouldStartPlanetPickerDrag(0, 8)).toBe(true);
  });
});
