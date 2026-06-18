import { describe, expect, test } from "bun:test";
import {
  emptyPlanetSectionState,
  hasPlanetSectionData,
  planetSectionForPlanet,
  planetSectionStoreFromInitialState,
  setPlanetSectionData,
  setPlanetSectionStatus,
  setPlanetSectionValue,
} from "./planetSectionStore";
import type { ChainDefenseState, ChainInfrastructureState, FleetMissionVisibilityResponse, WalletSettlementResponse } from "./walletFlow";

const infrastructure = { homePlanetId: "planet-1", buildings: [] } as unknown as ChainInfrastructureState;
const defense = { homePlanetId: "planet-1", defenses: [] } as unknown as ChainDefenseState;
const settlement = {
  homePlanetId: "planet-1",
  planet: { planetId: "planet-1", resources: { metal: "100", crystal: "50", deuterium: "25" } },
} as unknown as WalletSettlementResponse;
const fleetVisibility = {
  incoming: [],
  outgoing: [{ missionId: "mission-1", originPlanetId: "planet-1" }],
  returning: [],
} as unknown as FleetMissionVisibilityResponse;

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

  test("stores resource and mission sections independently per planet", () => {
    const withResources = setPlanetSectionValue({}, "planet-1", "settlementState", settlement);
    const withMissions = setPlanetSectionValue(withResources, "planet-2", "fleetVisibilityState", fleetVisibility);

    expect(planetSectionForPlanet(withMissions, "planet-1").settlementState).toBe(settlement);
    expect(planetSectionForPlanet(withMissions, "planet-1").fleetVisibilityState).toBeUndefined();
    expect(planetSectionForPlanet(withMissions, "planet-2").fleetVisibilityState).toBe(fleetVisibility);
    expect(planetSectionForPlanet(withMissions, "planet-2").settlementState).toBeUndefined();
  });

  test("tracks refresh status next to section data", () => {
    const store = setPlanetSectionData({}, "planet-1", "fleetVisibilityState", fleetVisibility, {
      loading: false,
      lastSuccessfulRefreshAt: 1234,
    });
    const loading = setPlanetSectionStatus(store, "planet-1", "fleetVisibilityState", {
      loading: true,
      error: undefined,
    });
    const section = planetSectionForPlanet(loading, "planet-1");

    expect(section.fleetVisibilityState).toBe(fleetVisibility);
    expect(section.sectionStatus.fleetVisibilityState).toEqual({
      loading: true,
      lastSuccessfulRefreshAt: 1234,
    });
  });
});
