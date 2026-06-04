import { describe, expect, test } from "bun:test";
import {
  isTransientGameStateReadFailure,
  isFinishedBuildingStateVisible,
  isFinishedResearchStateVisible,
  isAllianceApplicationCleared,
  isStartedDefenseProductionVisible,
  isStartedShipProductionVisible,
  isStartedResearchStateVisible,
  waitForFinishedResearchState,
  waitForStartedResearchState,
  waitForStartedDefenseProductionState,
  waitForStartedShipProductionState,
  waitForHydratedWalletPlanet,
  waitForFinishedBuildingState,
  waitForAllianceApplicationCleared,
  waitForRenamedWalletPlanet,
  type FinishedResearchSnapshot,
  type StartedDefenseProductionSnapshot,
  type StartedShipProductionSnapshot,
  type StartedResearchSnapshot,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingSnapshot,
} from "./postTransactionRefresh";
import type { ChainAllianceState } from "./walletFlow";

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

  test("polls past stale alliance applications after dismiss confirmation", async () => {
    const snapshots = [
      allianceStateWithApplication(),
      allianceStateWithApplication({ allianceJoinRequests: [] }),
    ];
    const loads: ChainAllianceState[] = [];

    const result = await waitForAllianceApplicationCleared(
      async () => {
        const snapshot = snapshots.shift() ?? allianceStateWithApplication({ allianceJoinRequests: [] });
        loads.push(snapshot);
        return snapshot;
      },
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
      },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(isAllianceApplicationCleared(result, {
      allianceId: "7",
      requester: "0x3333333333333333333333333333333333333333",
    })).toBe(true);
  });

  test("explains alliance application sync timeout after confirmation", async () => {
    await expect(waitForAllianceApplicationCleared(
      async () => allianceStateWithApplication(),
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
      },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("Alliance application transaction confirmed, but the pending application is still syncing in the game API.");
  });

  test("recovers from a transient post-finish game-state read failure", async () => {
    let attempts = 0;

    const result = await waitForFinishedBuildingState(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Failed to fetch");
        }
        return finishedSolarPlantSnapshot();
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(attempts).toBe(2);
    expect(result.infrastructure.queue).toBeNull();
    expect(result.infrastructure.buildings.find((building) => building.id === 3)?.level).toBe(2);
  });

  test("reports transient backend recovery instead of wallet/network blame when post-finish reads stay down", async () => {
    await expect(waitForFinishedBuildingState(
      async () => {
        throw new Error("Infrastructure API is temporarily unavailable (503: RPC HTTP 503).");
      },
      { itemId: 3, targetLevel: 2 },
      { attempts: 2, intervalMs: 1, delay: async () => undefined },
    )).rejects.toThrow("temporarily unavailable");
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

  test("accepts started defense production when the expected item is in the backlog", () => {
    expect(isStartedDefenseProductionVisible(startedDefenseBacklogProductionSnapshot(), {
      itemId: 1,
      planetId: "7",
      quantity: 1,
    })).toBe(true);
  });

  test("polls until started ship production is visible on Shipyard and Overview state", async () => {
    expect(isStartedShipProductionVisible(staleShipProductionSnapshot(), {
      itemId: 0,
      planetId: "7",
      quantity: 3,
    })).toBe(false);

    const snapshots = [
      staleShipProductionSnapshot(),
      startedShipProductionSnapshot(),
    ];
    const loads: StartedShipProductionSnapshot[] = [];

    const result = await waitForStartedShipProductionState(
      async () => {
        const snapshot = snapshots.shift() ?? startedShipProductionSnapshot();
        loads.push(snapshot);
        return snapshot;
      },
      { itemId: 0, planetId: "7", quantity: 3 },
      { attempts: 3, intervalMs: 1, delay: async () => undefined },
    );

    expect(loads).toHaveLength(2);
    expect(result.shipyard.queue?.itemId).toBe(0);
    expect(result.shipyard.queue?.quantity).toBe(3);
    expect(result.queues.ship?.itemId).toBe(0);
    expect(result.queues.ship?.quantity).toBe(3);
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

  test("classifies browser/backend transport failures as transient game-state read failures", () => {
    expect(isTransientGameStateReadFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientGameStateReadFailure(new Error("Infrastructure API failed: 503"))).toBe(true);
    expect(isTransientGameStateReadFailure(new Error("Internal JSON-RPC error."))).toBe(false);
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

function startedDefenseBacklogProductionSnapshot(): StartedDefenseProductionSnapshot {
  const activeDefenseQueue = {
    active: true,
    kind: "defense" as const,
    itemId: 0,
    quantity: 2,
    readyAt: "1770000060",
    cost: { metal: "4000", crystal: "0", deuterium: "0" },
    backlog: [
      {
        active: true,
        kind: "defense" as const,
        itemId: 1,
        quantity: 1,
        readyAt: "1770000120",
        cost: { metal: "1500", crystal: "500", deuterium: "0" },
      },
    ],
  };

  return {
    defense: {
      ...staleDefenseProductionSnapshot().defense,
      queue: activeDefenseQueue,
    },
    queues: {
      ...staleDefenseProductionSnapshot().queues,
      defense: activeDefenseQueue,
    },
  };
}

function staleShipProductionSnapshot(): StartedShipProductionSnapshot {
  return {
    shipyard: {
      wallet,
      homePlanetId: "7",
      planetId: "7",
      productionAvailable: true,
      resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 1,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [
        { id: 0, count: 0, cost: { metal: "2000", crystal: "2000", deuterium: "0" } },
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

function startedShipProductionSnapshot(): StartedShipProductionSnapshot {
  const shipQueue = {
    active: true,
    kind: "ship" as const,
    itemId: 0,
    quantity: 3,
    readyAt: "1770000060",
    cost: { metal: "6000", crystal: "6000", deuterium: "0" },
  };

  return {
    shipyard: {
      ...staleShipProductionSnapshot().shipyard,
      queue: shipQueue,
    },
    queues: {
      ...staleShipProductionSnapshot().queues,
      ship: shipQueue,
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

function allianceStateWithApplication(overrides: Partial<ChainAllianceState> = {}): ChainAllianceState {
  return {
    wallet,
    allianceAvailable: true,
    membership: {
      allianceId: "7",
      role: "officer",
      joinedAt: "1770000000",
    },
    profile: {
      active: true,
      createdAt: "1770000000",
      description: "Union",
      memberCount: 2,
      name: "Veydrift Union",
      owner: wallet,
      tag: "VDFT",
    },
    directory: [],
    pendingInvites: [],
    pendingJoinRequests: [],
    allianceJoinRequests: [
      {
        allianceId: "7",
        requester: "0x3333333333333333333333333333333333333333",
        requestedAt: "1770000010",
      },
    ],
    members: [
      {
        address: wallet,
        role: "officer",
        joinedAt: "1770000000",
      },
    ],
    ...overrides,
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
