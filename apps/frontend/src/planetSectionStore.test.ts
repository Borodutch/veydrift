import { describe, expect, test } from "bun:test";
import {
  emptyPlanetSectionState,
  hasPlanetSectionData,
  planetSectionForPlanet,
  planetSectionStoreFromInitialState,
  setPlanetSectionValue,
} from "./planetSectionStore";
import type { ChainDefenseState, ChainInfrastructureState } from "./walletFlow";

const infrastructure = { homePlanetId: "planet-1", buildings: [] } as unknown as ChainInfrastructureState;
const defense = { homePlanetId: "planet-1", defenses: [] } as unknown as ChainDefenseState;

describe("planetSectionStore", () => {
  test("hydrates initial singleton section state under the active planet id", () => {
    const store = planetSectionStoreFromInitialState("planet-1", {
      infrastructureChainState: infrastructure,
      defenseState: defense,
    });

    expect(store["planet-1"]?.infrastructureChainState).toBe(infrastructure);
    expect(store["planet-1"]?.defenseState).toBe(defense);
  });

  test("returns an empty section for unknown planets without mutating the store", () => {
    const store = planetSectionStoreFromInitialState("planet-1", { infrastructureChainState: infrastructure });
    expect(planetSectionForPlanet(store, "planet-2")).toEqual(emptyPlanetSectionState);
    expect(Object.keys(store)).toEqual(["planet-1"]);
  });

  test("updates only the requested planet section slice", () => {
    const first = setPlanetSectionValue({}, "planet-1", "infrastructureChainState", infrastructure);
    const second = setPlanetSectionValue(first, "planet-2", "defenseState", defense);

    expect(second["planet-1"]?.infrastructureChainState).toBe(infrastructure);
    expect(second["planet-1"]?.defenseState).toBeNull();
    expect(second["planet-2"]?.defenseState).toBe(defense);
  });

  test("supports updater functions for existing section slices", () => {
    const store = setPlanetSectionValue({}, "planet-1", "infrastructureChainState", infrastructure);
    const next = { ...infrastructure, stale: true } as ChainInfrastructureState;
    const updated = setPlanetSectionValue(store, "planet-1", "infrastructureChainState", (current) => {
      expect(current).toBe(infrastructure);
      return next;
    });

    expect(updated["planet-1"]?.infrastructureChainState).toBe(next);
  });

  test("reports whether a planet has any cached section data", () => {
    expect(hasPlanetSectionData(emptyPlanetSectionState)).toBe(false);
    const section = planetSectionForPlanet(
      setPlanetSectionValue({}, "planet-1", "defenseState", defense),
      "planet-1",
    );
    expect(hasPlanetSectionData(section)).toBe(true);
    expect(hasPlanetSectionData(section, "defenseState")).toBe(true);
    expect(hasPlanetSectionData(section, "shipyardState")).toBe(false);
  });
});
