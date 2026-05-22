import { describe, expect, test } from "bun:test";
import {
  isFinishedBuildingStateVisible,
  waitForHydratedWalletPlanet,
  waitForFinishedBuildingState,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingSnapshot,
} from "./postTransactionRefresh";

const wallet = "0x2222222222222222222222222222222222222222";

describe("post-transaction refresh reconciliation", () => {
  test("does not accept a stale finished-building snapshot with an active queue", () => {
    expect(isFinishedBuildingStateVisible(staleSolarPlantSnapshot(), {
      itemId: 3,
      targetLevel: 2,
    })).toBe(false);
  });

  test("accepts the finished snapshot once queue clears and the target level is visible", () => {
    expect(isFinishedBuildingStateVisible(finishedSolarPlantSnapshot(), {
      itemId: 3,
      targetLevel: 2,
    })).toBe(true);
  });

  test("polls past a stale first response after finishing Solar Plant", async () => {
    const snapshots = [
      staleSolarPlantSnapshot(),
      finishedSolarPlantSnapshot(),
    ];
    const loads: FinishedBuildingSnapshot[] = [];

    const result = await waitForFinishedBuildingState(
      async () => {
        const snapshot = snapshots.shift() ?? finishedSolarPlantSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.infrastructure.queue).toBeNull();
    expect(result.queues.building).toBeNull();
    expect(result.infrastructure.buildings.find((building) => building.id === 3)?.level).toBe(2);
    expect(result.infrastructure.productionPerHour).toEqual({
      metal: "60",
      crystal: "30",
      deuterium: "0",
    });
  });

  test("does not report success when every post-finish snapshot is still stale", async () => {
    await expect(waitForFinishedBuildingState(
      async () => staleSolarPlantSnapshot(),
      { itemId: 3, targetLevel: 2 },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("completed building queue is still syncing");
  });

  test("polls until a confirmed settlement has hydrated planet resources", async () => {
    const snapshots = [
      unhydratedWalletPlanetSnapshot(),
      hydratedWalletPlanetSyncSnapshot(),
    ];
    const loads: WalletPlanetSyncSnapshot[] = [];

    const result = await waitForHydratedWalletPlanet(
      async () => {
        const snapshot = snapshots.shift() ?? hydratedWalletPlanetSyncSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      undefined,
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.selectedPlanet.planetId).toBe("7");
    expect(result.selectedPlanet.resources.metal).toBe("5000");
  });

  test("recovers when the first post-settlement API fetch fails", async () => {
    let attempts = 0;

    const result = await waitForHydratedWalletPlanet(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Failed to fetch");
        }
        return hydratedWalletPlanetSyncSnapshot();
      },
      "7",
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(attempts).toBe(2);
    expect(result.selectedPlanet.planetId).toBe("7");
  });

  test("reports a specific retryable status when hydration times out", async () => {
    await expect(waitForHydratedWalletPlanet(
      async () => unhydratedWalletPlanetSnapshot(),
      "7",
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("game API did not hydrate a complete planet");
  });
});

function staleSolarPlantSnapshot(): FinishedBuildingSnapshot {
  return {
    settlement: settlementSnapshot(),
    queues: {
      wallet,
      homePlanetId: "7",
      building: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
      defense: null,
      ship: null,
      research: null,
    },
    infrastructure: {
      wallet,
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
      productionPerHour: { metal: "30", crystal: "15", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 1, cost: { metal: "150", crystal: "60", deuterium: "0" } },
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 2,
        readyAt: "1770000060",
        cost: { metal: "150", crystal: "60", deuterium: "0" },
      },
    },
  };
}

function finishedSolarPlantSnapshot(): FinishedBuildingSnapshot {
  return {
    settlement: settlementSnapshot(),
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
    infrastructure: {
      wallet,
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
      productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
        { id: 3, level: 2, cost: { metal: "300", crystal: "120", deuterium: "0" } },
      ],
      queue: null,
    },
  };
}

function settlementSnapshot() {
  return {
    wallet,
    hasFirstPlanet: true,
    homePlanetId: "7",
    planet: {
      planetId: "7",
      owner: wallet,
      name: null,
      galaxy: 2,
      system: 44,
      position: 9,
      fields: 211,
      temperature: -8,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      lastSettledAt: "1770000000",
      resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
    },
  };
}

function unhydratedWalletPlanetSnapshot(): WalletPlanetSyncSnapshot {
  return {
    settlement: {
      ...settlementSnapshot(),
      planet: null,
    },
    planetsResponse: {
      wallet,
      homePlanetId: "7",
      planets: [],
    },
    queues: emptyQueues(),
    fleetVisibility: emptyFleetVisibility(),
  };
}

function hydratedWalletPlanetSyncSnapshot(): WalletPlanetSyncSnapshot {
  const settlement = settlementSnapshot();
  const planet = settlement.planet;
  if (!planet) throw new Error("test settlement missing planet");

  return {
    settlement,
    planetsResponse: {
      wallet,
      homePlanetId: "7",
      planets: [
        {
          ...planet,
          coordinates: "2:44:9",
          fieldsUsed: 2,
          fieldsCapacity: 211,
          isHomePlanet: true,
          keyLevels: {
            metalMine: 1,
            crystalMine: 1,
            deuteriumSynthesizer: 0,
            solarPlant: 1,
            roboticsFactory: 0,
            shipyard: 0,
            researchLab: 0,
            terraformer: 0,
          },
          moon: null,
          queues: {
            building: null,
            defense: null,
            ship: null,
          },
        },
      ],
    },
    queues: emptyQueues(),
    fleetVisibility: emptyFleetVisibility(),
  };
}

function emptyQueues() {
  return {
    wallet,
    homePlanetId: "7",
    building: null,
    defense: null,
    ship: null,
    research: null,
  };
}

function emptyFleetVisibility() {
  return {
    wallet,
    homePlanetId: "7",
    incoming: [],
    outgoing: [],
    returning: [],
  };
}
