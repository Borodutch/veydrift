import { describe, expect, test } from "bun:test";
import {
  backendResourceSnapshot,
  canonicalPlanetResourceSnapshotFor,
  promoteCanonicalPlanetResources,
  resourceStateWithCanonicalPlanetResources,
  riftStateWithCanonicalPlanetResources,
  walletPlanetsWithCanonicalPlanetResources,
  walletSettlementWithCanonicalPlanetResources,
  type CanonicalPlanetResourceStore,
} from "./planetResourceStore";
import type { ManagedPlanetResponse, WalletSettlementResponse } from "./walletFlow";

const wallet = "0x2222222222222222222222222222222222222222";

describe("canonical planet resource store", () => {
  test("is wallet-scoped and keeps independent per-planet snapshots across navigation", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x10", "100", "500"));
    store = promote(store, snapshot("8", "0x11", "101", "800"));
    store = promote(store, snapshot("7", "0x20", "200", "120"), true);

    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("120");
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "8")?.resourcesAsOfNow.metal).toBe("800");
    expect(canonicalPlanetResourceSnapshotFor(store, "0x3333333333333333333333333333333333333333", "7")).toBeUndefined();
  });

  test("rejects older poll and navigation snapshots after confirmed fleet cargo indexing", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x10", "100", "500"));
    store = promote(store, snapshot("7", "0x20", "200", "120"), true);
    const confirmedStore = store;

    store = promote(store, snapshot("7", "0x10", "100", "500"));

    expect(store).toBe(confirmedStore);
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("120");
  });

  test("accepts a same-version lower balance from an authoritative detail refresh", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "120"));

    store = promote(store, snapshot("7", "0x20", "200", "119"));
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("119");

    store = promote(store, snapshot("7", "0x20", "200", "121"));
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("121");
  });

  test("does not let a lower-priority roster response overwrite a tied detail snapshot", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "120", "0x0", 30));
    store = promote(store, snapshot("7", "0x20", "200", "500", "0x0", 10));

    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("120");
  });

  test("accepts a same-priority fresh detail response that omits optional index metadata", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "120", "0x1", 30));
    const sparseDetail = backendResourceSnapshot(
      {
        wallet,
        planetId: "7",
        resources: { metal: "119", crystal: "119", deuterium: "119" },
        resourcesAsOfNow: { metal: "119", crystal: "119", deuterium: "119" },
      },
      { sourcePriority: 30 },
    );

    store = promoteCanonicalPlanetResources(store, sparseDetail);
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("119");
  });

  test("rejects a late older detail response from a different endpoint", () => {
    let store: CanonicalPlanetResourceStore = {};
    const olderRequest = backendResourceSnapshot(
      {
        wallet,
        planetId: "7",
        resources: { metal: "500", crystal: "500", deuterium: "500" },
        resourcesAsOfNow: { metal: "500", crystal: "500", deuterium: "500" },
      },
      { requestGeneration: 1, sourcePriority: 30 },
    );
    const newerRequest = backendResourceSnapshot(
      {
        wallet,
        planetId: "7",
        resources: { metal: "119", crystal: "119", deuterium: "119" },
        resourcesAsOfNow: { metal: "119", crystal: "119", deuterium: "119" },
      },
      { requestGeneration: 2, sourcePriority: 30 },
    );

    store = promoteCanonicalPlanetResources(store, newerRequest);
    store = promoteCanonicalPlanetResources(store, olderRequest);

    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("119");
  });

  test("refuses an ambiguously identified home-planet response for another selected planet", () => {
    const ambiguous = backendResourceSnapshot(
      {
        wallet,
        homePlanetId: "7",
        resources: { metal: "500", crystal: "500", deuterium: "500" },
        resourcesAsOfNow: { metal: "500", crystal: "500", deuterium: "500" },
      },
      { planetId: "8" },
    );

    expect(ambiguous).toBeUndefined();
  });

  test("orders multiple resource changes in the same block by backend log index", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "500", "0x1"));
    const current = store;

    store = promote(store, snapshot("7", "0x20", "200", "900", "0x0"), true);
    expect(store).toBe(current);

    store = promote(store, snapshot("7", "0x20", "200", "120", "0x2"));
    expect(canonicalPlanetResourceSnapshotFor(store, wallet, "7")?.resourcesAsOfNow.metal).toBe("120");
  });

  test("overlays the canonical snapshot onto top-bar settlement and navigation roster projections", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "120"), true);
    const staleSettlement = settlement("7", "100", "500");
    const staleRoster = [planet("7", "100", "500"), planet("8", "101", "800")];

    expect(walletSettlementWithCanonicalPlanetResources(staleSettlement, store, wallet)?.planet?.resourcesAsOfNow?.metal).toBe("120");
    expect(walletPlanetsWithCanonicalPlanetResources(staleRoster, store, wallet).map((item) => item.resourcesAsOfNow?.metal)).toEqual(["120", "800"]);
  });

  test("converges page, top-bar, roster, and Rift projections after indexed transfer and return credits", () => {
    let store: CanonicalPlanetResourceStore = {};
    store = promote(store, snapshot("7", "0x20", "200", "120"), true);
    store = promote(store, snapshot("8", "0x21", "201", "950"), true);
    store = promote(store, snapshot("7", "0x22", "202", "420"), true);

    const origin = canonicalPlanetResourceSnapshotFor(store, wallet, "7");
    const destination = canonicalPlanetResourceSnapshotFor(store, wallet, "8");
    const stalePage = {
      homePlanetId: "7",
      planetId: "7",
      resources: { metal: "500", crystal: "500", deuterium: "500" },
      resourcesAsOfNow: { metal: "500", crystal: "500", deuterium: "500" },
    };
    const staleRift = {
      wallet,
      homePlanetId: "7",
      riftAvailable: true,
      unlocked: true,
      withdrawalDelaySeconds: "0",
      requirements: [],
      resources: [riftResource("metal", 0), riftResource("crystal", 1), riftResource("deuterium", 2)],
      pendingWithdrawals: [],
    };

    expect(resourceStateWithCanonicalPlanetResources(stalePage, origin).resourcesAsOfNow.metal).toBe("420");
    expect(riftStateWithCanonicalPlanetResources(staleRift, origin)?.resources.map((item) => item.inGameBalance)).toEqual(["420", "420", "420"]);
    expect(walletSettlementWithCanonicalPlanetResources(settlement("7", "100", "500"), store, wallet)?.planet?.resourcesAsOfNow?.metal).toBe("420");
    expect(walletPlanetsWithCanonicalPlanetResources([planet("7", "100", "500"), planet("8", "101", "800")], store, wallet).map((item) => item.resourcesAsOfNow?.metal)).toEqual(["420", "950"]);
    expect(destination?.resourcesAsOfNow.metal).toBe("950");
  });
});

function riftResource(key: "metal" | "crystal" | "deuterium", resourceId: number) {
  return {
    key,
    label: key,
    resourceId,
    tokenAddress: null,
    walletBalance: null,
    allowance: null,
    inGameBalance: "500",
    lockedBalance: "0",
  };
}

function promote(store: CanonicalPlanetResourceStore, next: ReturnType<typeof snapshot>, confirmedTransaction = false): CanonicalPlanetResourceStore {
  return promoteCanonicalPlanetResources(store, next, { confirmedTransaction });
}

function snapshot(planetId: string, blockNumber: string, lastSettledAt: string, metal: string, logIndex = "0x0", sourcePriority?: number) {
  return backendResourceSnapshot(
    {
      wallet,
      planetId,
      planetLastSettledAt: lastSettledAt,
      resources: { metal, crystal: metal, deuterium: metal },
      resourcesAsOfNow: { metal, crystal: metal, deuterium: metal },
      resourceSnapshot: {
        planetId,
        transactionHash: `0xtx${blockNumber}`,
        blockNumber,
        logIndex,
        lastSettledAt,
        resources: { metal, crystal: metal, deuterium: metal },
      },
    },
    { sourcePriority },
  )!;
}

function settlement(planetId: string, lastSettledAt: string, metal: string): WalletSettlementResponse {
  return {
    wallet,
    hasFirstPlanet: true,
    homePlanetId: planetId,
    planet: planet(planetId, lastSettledAt, metal),
  };
}

function planet(planetId: string, lastSettledAt: string, metal: string): ManagedPlanetResponse {
  return {
    planetId,
    owner: wallet,
    name: null,
    galaxy: 1,
    system: 2,
    position: Number(planetId),
    fields: 200,
    temperature: 20,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt,
    resources: { metal, crystal: metal, deuterium: metal },
    resourcesAsOfNow: { metal, crystal: metal, deuterium: metal },
    coordinates: `1:2:${planetId}`,
    isHomePlanet: planetId === "7",
    fieldsUsed: 0,
    fieldsCapacity: 200,
    keyLevels: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: { building: null, defense: null, ship: null },
    moon: null,
  };
}
