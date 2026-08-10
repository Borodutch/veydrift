import { describe, expect, test } from "bun:test";
import {
  defenseSnapshotPlanetId,
  emptyPlanetSectionState,
  hasPlanetSectionData,
  indexedDefensePlanetId,
  indexedInfrastructurePlanetId,
  infrastructureSnapshotPlanetId,
  planetSectionAccessForPlanet,
  planetSectionForPlanet,
  planetSectionStoreFromInitialState,
  setPlanetSectionData,
  setPlanetSectionStatus,
  setPlanetSectionValue,
} from "./planetSectionStore";
import type {
  ChainDefenseState,
  ChainInfrastructureState,
  ChainShipyardState,
  WalletSettlementResponse,
} from "./walletFlow";

const infrastructure = { homePlanetId: "planet-1", buildings: [] } as unknown as ChainInfrastructureState;
const defense = { homePlanetId: "planet-1", defenses: [] } as unknown as ChainDefenseState;
const shipyard = (count: number) => ({
  homePlanetId: "planet-1",
  planetId: "planet-1",
  ships: [{ id: 0, count }],
} as unknown as ChainShipyardState);
const settlement = {
  homePlanetId: "planet-1",
  planet: { planetId: "planet-1", resources: { metal: "100", crystal: "50", deuterium: "25" } },
} as unknown as WalletSettlementResponse;

describe("planetSectionStore", () => {
  test("keys an early Infrastructure snapshot by its indexed planet identity", () => {
    const earlyInfrastructure = {
      ...infrastructure,
      homePlanetId: "planet-83",
      planetId: "planet-83",
      wallet: "0xAaAa",
    } as ChainInfrastructureState;
    const planetId = infrastructureSnapshotPlanetId(earlyInfrastructure, undefined);
    const store = setPlanetSectionValue({}, planetId, "infrastructureChainState", earlyInfrastructure);

    expect(planetId).toBe("planet-83");
    expect(indexedInfrastructurePlanetId(store, "0xaaaa")).toBe("planet-83");
    expect(indexedInfrastructurePlanetId(store, "0xbbbb")).toBeUndefined();
  });

  test("keys an early Defense snapshot by its indexed home planet identity", () => {
    const earlyDefense = {
      ...defense,
      homePlanetId: "planet-84",
      wallet: "0xCcCc",
    } as ChainDefenseState;
    const planetId = defenseSnapshotPlanetId(earlyDefense, undefined);
    const store = setPlanetSectionValue({}, planetId, "defenseState", earlyDefense);

    expect(planetId).toBe("planet-84");
    expect(indexedDefensePlanetId(store, "0xcccc")).toBe("planet-84");
    expect(indexedDefensePlanetId(store, "0xdddd")).toBeUndefined();
  });

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

  test("stores only planet-scoped read models independently per planet", () => {
    const withResources = setPlanetSectionValue({}, "planet-1", "settlementState", settlement);
    const withShipyard = setPlanetSectionValue(withResources, "planet-2", "shipyardState", shipyard(4));

    expect(planetSectionForPlanet(withShipyard, "planet-1").settlementState).toBe(settlement);
    expect(planetSectionForPlanet(withShipyard, "planet-1").shipyardState).toBeNull();
    expect(planetSectionForPlanet(withShipyard, "planet-2").shipyardState?.ships[0]?.count).toBe(4);
    expect(planetSectionForPlanet(withShipyard, "planet-2").settlementState).toBeUndefined();
  });

  test("tracks refresh status next to section data", () => {
    const store = setPlanetSectionData({}, "planet-1", "shipyardState", shipyard(2), {
      loading: false,
      lastSuccessfulRefreshAt: 1234,
    });
    const loading = setPlanetSectionStatus(store, "planet-1", "shipyardState", {
      loading: true,
      error: undefined,
    });
    const section = planetSectionForPlanet(loading, "planet-1");

    expect(section.shipyardState?.ships[0]?.count).toBe(2);
    expect(section.sectionStatus.shipyardState).toEqual({
      loading: true,
      lastSuccessfulRefreshAt: 1234,
    });

    const failed = setPlanetSectionStatus(loading, "planet-1", "shipyardState", {
      loading: false,
      error: "backend restarting",
    });
    const failedSection = planetSectionForPlanet(failed, "planet-1");
    expect(failedSection.shipyardState?.ships[0]?.count).toBe(2);
    expect(failedSection.sectionStatus.shipyardState).toEqual({
      loading: false,
      error: "backend restarting",
      lastSuccessfulRefreshAt: 1234,
    });
  });

  test("exposes section data, refresh status, and refresh functions through one access object", async () => {
    let store = setPlanetSectionData({}, "planet-1", "shipyardState", shipyard(3), {
      loading: false,
      lastSuccessfulRefreshAt: 1000,
    });
    const refresh = async () => {
      store = setPlanetSectionStatus(store, "planet-1", "shipyardState", { loading: true, error: undefined });
      store = setPlanetSectionData(store, "planet-1", "shipyardState", shipyard(7), {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: 2000,
      });
    };

    const missionCreationConsumer = planetSectionAccessForPlanet(store, "planet-1", {
      shipyardState: refresh,
    }).read("shipyardState");
    expect(missionCreationConsumer.data?.ships[0]?.count).toBe(3);
    expect(missionCreationConsumer.status).toEqual({ loading: false, lastSuccessfulRefreshAt: 1000 });

    await missionCreationConsumer.refresh?.();

    const galaxyConsumer = planetSectionAccessForPlanet(store, "planet-1", {
      shipyardState: refresh,
    }).read("shipyardState");
    expect(galaxyConsumer.data?.ships[0]?.count).toBe(7);
    expect(galaxyConsumer.status).toEqual({
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: 2000,
    });
  });

  test("keeps ship refresh propagation scoped to the selected planet", async () => {
    let store = setPlanetSectionData({}, "planet-1", "shipyardState", shipyard(2), { loading: false });
    store = setPlanetSectionData(store, "planet-2", "shipyardState", {
      ...shipyard(11),
      homePlanetId: "planet-2",
      planetId: "planet-2",
    } as ChainShipyardState, { loading: false });
    const refreshPlanetOneShips = () => {
      store = setPlanetSectionData(store, "planet-1", "shipyardState", shipyard(5), {
        loading: false,
        lastSuccessfulRefreshAt: 3000,
      });
    };

    await planetSectionAccessForPlanet(store, "planet-1", {
      shipyardState: refreshPlanetOneShips,
    }).refresh("shipyardState");

    expect(planetSectionAccessForPlanet(store, "planet-1").read("shipyardState").data?.ships[0]?.count).toBe(5);
    expect(planetSectionAccessForPlanet(store, "planet-2").read("shipyardState").data?.ships[0]?.count).toBe(11);
  });
});
