import { describe, expect, test } from "bun:test";
import {
  isCollectedResourcesStateVisible,
  isFinishedBuildingStateVisible,
  isFinishedResearchStateVisible,
  isStartedDefenseProductionVisible,
  isStartedResearchStateVisible,
  waitForCollectedResourcesState,
  waitForFinishedResearchState,
  waitForStartedResearchState,
  waitForStartedDefenseProductionState,
  waitForHydratedWalletPlanet,
  waitForFinishedBuildingState,
  waitForRenamedWalletPlanet,
  type CollectedResourcesSnapshot,
  type FinishedResearchSnapshot,
  type StartedDefenseProductionSnapshot,
  type StartedResearchSnapshot,
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

  test("polls until started defense production is visible on Defense and Overview state", async () => {
    expect(isStartedDefenseProductionVisible(staleDefenseProductionSnapshot(), {
      itemId: 0,
      planetId: "7",
      quantity: 2,
    })).toBe(false);

    const snapshots = [
      staleDefenseProductionSnapshot(),
      startedDefenseProductionSnapshot(),
    ];
    const loads: StartedDefenseProductionSnapshot[] = [];

    const result = await waitForStartedDefenseProductionState(
      async () => {
        const snapshot = snapshots.shift() ?? startedDefenseProductionSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 0, planetId: "7", quantity: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.defense.queue?.itemId).toBe(0);
    expect(result.defense.queue?.quantity).toBe(2);
    expect(result.queues.defense?.itemId).toBe(0);
    expect(result.queues.defense?.quantity).toBe(2);
  });

  test("polls until started research is visible on Research and Overview state", async () => {
    expect(isStartedResearchStateVisible(staleStartedResearchSnapshot(), {
      itemId: 4,
      targetLevel: 2,
    })).toBe(false);

    const snapshots = [
      staleStartedResearchSnapshot(),
      startedResearchSnapshot(),
    ];
    const loads: StartedResearchSnapshot[] = [];

    const result = await waitForStartedResearchState(
      async () => {
        const snapshot = snapshots.shift() ?? startedResearchSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 4, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.research.queue?.itemId).toBe(4);
    expect(result.research.queue?.targetLevel).toBe(2);
    expect(result.queues.research?.itemId).toBe(4);
    expect(result.queues.research?.targetLevel).toBe(2);
  });

  test("polls until finished research is visible on Research and Overview state", async () => {
    expect(isFinishedResearchStateVisible(staleFinishedResearchSnapshot(), {
      itemId: 4,
      targetLevel: 2,
    })).toBe(false);

    const snapshots = [
      staleFinishedResearchSnapshot(),
      finishedResearchSnapshot(),
    ];
    const loads: FinishedResearchSnapshot[] = [];

    const result = await waitForFinishedResearchState(
      async () => {
        const snapshot = snapshots.shift() ?? finishedResearchSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 4, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.research.queue).toBeNull();
    expect(result.queues.research).toBeNull();
    expect(result.research.technologyLevels["4"]).toBe(2);
  });

  test("does not accept stale indexed collect resources while infrastructure has newer resources", () => {
    expect(isCollectedResourcesStateVisible(staleCollectedResourcesSnapshot(), {
      planetId: "7",
      previousLastSettledAt: "1770000000",
    })).toBe(false);
  });

  test("polls until indexed collect resources match the infrastructure refresh", async () => {
    const snapshots = [
      staleCollectedResourcesSnapshot(),
      collectedResourcesSnapshot(),
    ];
    const loads: CollectedResourcesSnapshot[] = [];

    const result = await waitForCollectedResourcesState(
      async () => {
        const snapshot = snapshots.shift() ?? collectedResourcesSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { planetId: "7", previousLastSettledAt: "1770000000" },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.settlement.planet?.lastSettledAt).toBe("1770000600");
    expect(result.infrastructure.resources).not.toBeNull();
    expect(result.settlement.planet?.resources).toEqual(result.infrastructure.resources ?? undefined);
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

  test("polls past hydrated but stale planet names after rename confirmation", async () => {
    const snapshots = [
      hydratedWalletPlanetSyncSnapshot(),
      renamedWalletPlanetSyncSnapshot("New Eos"),
    ];
    const loads: WalletPlanetSyncSnapshot[] = [];

    const result = await waitForRenamedWalletPlanet(
      async () => {
        const snapshot = snapshots.shift() ?? renamedWalletPlanetSyncSnapshot("New Eos");
        loads.push(snapshot);
        return snapshot;
      },
      { planetId: "7", name: "New Eos" },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.selectedPlanet.name).toBe("New Eos");
  });

  test("reports a retryable status when a confirmed rename stays stale", async () => {
    await expect(waitForRenamedWalletPlanet(
      async () => hydratedWalletPlanetSyncSnapshot(),
      { planetId: "7", name: "New Eos" },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("did not show \"New Eos\"");
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

function staleDefenseProductionSnapshot(): StartedDefenseProductionSnapshot {
  return {
    defense: {
      wallet,
      homePlanetId: "7",
      productionAvailable: true,
      resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
      shipyardLevel: 1,
      missileSiloLevel: 0,
      technologyLevels: {},
      defenses: [
        { id: 0, count: 0, cost: { metal: "2000", crystal: "0", deuterium: "0" } },
      ],
      queue: null,
    },
    queues: {
      wallet,
      homePlanetId: "7",
      building: null,
      defense: null,
      ship: null,
      research: null,
    },
  };
}

function startedDefenseProductionSnapshot(): StartedDefenseProductionSnapshot {
  const defenseQueue = {
    active: true,
    kind: "defense" as const,
    itemId: 0,
    quantity: 2,
    readyAt: "1770000060",
    cost: { metal: "4000", crystal: "0", deuterium: "0" },
  };

  return {
    defense: {
      ...staleDefenseProductionSnapshot().defense,
      queue: defenseQueue,
    },
    queues: {
      ...staleDefenseProductionSnapshot().queues,
      defense: defenseQueue,
    },
  };
}

function staleStartedResearchSnapshot(): StartedResearchSnapshot {
  return {
    research: baseResearchState(),
    queues: emptyQueues(),
  };
}

function startedResearchSnapshot(): StartedResearchSnapshot {
  const researchQueue = {
    active: true,
    kind: "research" as const,
    itemId: 4,
    targetLevel: 2,
    readyAt: "1770000060",
    startedAt: "1770000000",
    cost: { metal: "800", crystal: "400", deuterium: "200" },
  };

  return {
    research: {
      ...baseResearchState(),
      queue: researchQueue,
    },
    queues: {
      ...emptyQueues(),
      research: researchQueue,
    },
  };
}

function staleFinishedResearchSnapshot(): FinishedResearchSnapshot {
  return startedResearchSnapshot();
}

function finishedResearchSnapshot(): FinishedResearchSnapshot {
  return {
    research: {
      ...baseResearchState(),
      technologyLevels: { "4": 2 },
      technologies: [
        { id: 4, level: 2, cost: { metal: "1600", crystal: "800", deuterium: "400" } },
      ],
      queue: null,
    },
    queues: emptyQueues(),
  };
}

function baseResearchState() {
  return {
    wallet,
    homePlanetId: "7",
    researchAvailable: true,
    resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
    researchLabLevel: 1,
    researchNetworkLabLevels: [],
    technologyLevels: { "4": 1 },
    technologies: [
      { id: 4, level: 1, cost: { metal: "800", crystal: "400", deuterium: "200" } },
    ],
    queue: null,
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

function staleCollectedResourcesSnapshot(): CollectedResourcesSnapshot {
  return {
    settlement: settlementSnapshot(),
    infrastructure: {
      wallet,
      homePlanetId: "7",
      infrastructureAvailable: true,
      resources: { metal: "5060", crystal: "4930", deuterium: "4800" },
      productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
      energyBalance: null,
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      buildings: [
        { id: 0, level: 1, cost: { metal: "120", crystal: "30", deuterium: "0" } },
      ],
      queue: null,
    },
  };
}

function collectedResourcesSnapshot(): CollectedResourcesSnapshot {
  return {
    ...staleCollectedResourcesSnapshot(),
    settlement: {
      ...settlementSnapshot(),
      planet: {
        ...settlementSnapshot().planet,
        lastSettledAt: "1770000600",
        resources: { metal: "5060", crystal: "4930", deuterium: "4800" },
      },
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

function renamedWalletPlanetSyncSnapshot(name: string): WalletPlanetSyncSnapshot {
  const snapshot = hydratedWalletPlanetSyncSnapshot();
  const renamedPlanet = {
    ...snapshot.planetsResponse.planets[0]!,
    name,
  };
  return {
    ...snapshot,
    settlement: {
      ...snapshot.settlement,
      planet: {
        ...snapshot.settlement.planet!,
        name,
      },
    },
    planetsResponse: {
      ...snapshot.planetsResponse,
      planets: [renamedPlanet],
    },
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
    joinableAttacks: [],
  };
}
