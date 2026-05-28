import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { canonicalContractTables } from "./contractStateSchema";
import type { Address, DebrisFieldEvent, InfrastructureState, MoonChanceReportEvent, PlayerQueues, SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222" as Address;
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const planet: SettledPlanetEvent = {
  eventName: "PlanetStarted",
  transactionHash: "0xabc",
  blockNumber: "123",
  planetId: "7",
  owner: player,
  name: null,
  galaxy: 2,
  system: 44,
  position: 9,
  fields: 211,
  temperature: -8,
  metalMultiplierBps: 9788,
  crystalMultiplierBps: 10233,
  deuteriumMultiplierBps: 10584,
  lastSettledAt: "1770000000",
  resources: {
    metal: "5000",
    crystal: "4900",
    deuterium: "4800"
  }
};

const debris: DebrisFieldEvent = {
  eventName: "DebrisFieldUpdated",
  transactionHash: "0xdef",
  blockNumber: "124",
  planetId: planet.planetId,
  resources: {
    metal: "27000",
    crystal: "9000"
  }
};

const updatedDebris: DebrisFieldEvent = {
  ...debris,
  transactionHash: "0xdef2",
  blockNumber: "126",
  resources: {
    metal: "31000",
    crystal: "12000"
  }
};

const clearedDebris: DebrisFieldEvent = {
  ...debris,
  transactionHash: "0xdef3",
  blockNumber: "127",
  resources: {
    metal: "0",
    crystal: "0"
  }
};

const moonChance: MoonChanceReportEvent = {
  eventName: "MoonChanceRequested",
  transactionHash: "0xghi",
  blockNumber: "125",
  battleId: "42",
  targetPlanetId: planet.planetId,
  outcomeId: "5",
  defender: player,
  metalDebris: "90000",
  crystalDebris: "10000",
  chanceBps: 100
};

describe("SettlementIndexer", () => {
  test("persists indexed contract state for read-side reuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return [debris]; },
        async listMoonChanceReportEvents() { return [moonChance]; },
        async listSettledPlanetEvents() { return [planet]; }
      }, 100n, { databasePath });

      await expect(first.rebuild()).resolves.toMatchObject({
        indexedDebrisFields: 1,
        indexedMoonChanceReports: 1,
        indexedPlanets: 1,
        lastReconciliationError: null,
        lastReconciledBlock: "125"
      });

      const second = new SettlementIndexer({
        async listDebrisFieldEvents() { throw new Error("chain should not be read"); },
        async listMoonChanceReportEvents() { throw new Error("chain should not be read"); },
        async listSettledPlanetEvents() { throw new Error("chain should not be read"); }
      }, 100n, { databasePath });

      expect(second.snapshot()).toMatchObject({
        indexedDebrisFields: 1,
        indexedMoonChanceReports: 1,
        indexedPlanets: 1
      });
      expect(second.walletSettlement(player)).toMatchObject({
        wallet: player,
        hasFirstPlanet: true,
        homePlanetId: planet.planetId,
        planet: {
          planetId: planet.planetId,
          owner: player
        }
      });
      expect(second.debrisFieldsInSystem(2, 44)).toEqual([
        expect.objectContaining({
          planetId: planet.planetId,
          position: 9,
          resources: debris.resources
        })
      ]);
      expect(second.moonChanceReportsInSystem(2, 44)).toEqual([
        expect.objectContaining({
          battleId: "42",
          position: 9,
          targetPlanetId: planet.planetId
        })
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("creates canonical mirror tables and preserves existing indexed state", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      indexer.applyEvent(planet);
      indexer.applyDebrisEvent(debris);
      indexer.applyMoonChanceEvent(moonChance);

      indexer.applyLog({
        blockNumber: "0x81",
        transactionHash: "0xbuild",
        logIndex: "0x0",
        topics: [
          buildingStartedTopic,
          topic(7n),
          topic(5n)
        ],
        data: abiWords(1n, 1770000900n, 400n, 120n, 60n)
      });
      indexer.applyLog({
        blockNumber: "0x82",
        transactionHash: "0xbuilddone",
        logIndex: "0x0",
        topics: [
          buildingCompletedTopic,
          topic(7n),
          topic(5n)
        ],
        data: abiWords(1n)
      });

      const db = new Database(databasePath, { readonly: true });
      try {
        const schemaNames = new Set(
          (db.query("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all() as Array<{ name: string }>)
            .map((row) => row.name)
        );
        for (const table of canonicalContractTables) {
          expect(schemaNames.has(table)).toBe(true);
        }

        expect(db.query("SELECT owner, galaxy, system_number, position FROM contract_planets WHERE planet_id = ?").get(planet.planetId)).toEqual({
          owner: player.toLowerCase(),
          galaxy: planet.galaxy,
          system_number: planet.system,
          position: planet.position
        });
        expect(db.query("SELECT metal, crystal, deuterium FROM contract_planet_resources WHERE planet_id = ?").get(planet.planetId)).toEqual({
          metal: "4600",
          crystal: "4780",
          deuterium: "4740"
        });
        expect(db.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get(planet.planetId, 5)).toEqual({
          level: 1
        });
        expect(db.query("SELECT metal, crystal FROM contract_debris_fields WHERE planet_id = ?").get(planet.planetId)).toEqual({
          metal: debris.resources.metal,
          crystal: debris.resources.crystal
        });
        expect(db.query("SELECT battle_id, outcome_id FROM contract_moon_chance_reports WHERE report_key = ?").get("outcome:5")).toEqual({
          battle_id: moonChance.battleId,
          outcome_id: moonChance.outcomeId
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("applies duplicate webhook logs only once", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const log = {
      blockNumber: "0x7c",
      transactionHash: "0xabc",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        `0x${player.slice(2).padStart(64, "0")}`,
        `0x${(7n).toString(16).padStart(64, "0")}`
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    };

    expect(indexer.applyLog(log)).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "124"
      }
    });
    expect(indexer.applyLog(log)).toMatchObject({
      applied: false,
      duplicate: true,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1
      }
    });
  });

  test("applies collect resource settlement logs to indexed wallet state", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x80",
      transactionHash: "0xcollect",
      logIndex: "0x0",
      topics: [
        planetSettledTopic,
        `0x${(7n).toString(16).padStart(64, "0")}`
      ],
      data: abiWords(6000n, 5900n, 5800n, 1770000600n)
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "128"
      }
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      planetId: planet.planetId,
      transactionHash: "0xcollect",
      blockNumber: "128",
      lastSettledAt: "1770000600",
      resources: {
        metal: "6000",
        crystal: "5900",
        deuterium: "5800"
      }
    });
  });

  test("indexes active production queues and completed building levels", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [
        buildingStartedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n, 1770000900n, 400n, 120n, 60n)
    })).toMatchObject({
      applied: true,
      duplicate: false
    });

    expect(indexer.playerQueues(player, planet.planetId).building).toMatchObject({
      active: true,
      kind: "building",
      itemId: 5,
      targetLevel: 1,
      readyAt: "1770000900",
      cost: {
        metal: "400",
        crystal: "120",
        deuterium: "60"
      }
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "4600",
      crystal: "4780",
      deuterium: "4740"
    });

    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xbuilddone",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n)
    });

    expect(indexer.playerQueues(player, planet.planetId).building).toBeNull();
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)).toMatchObject({
      id: 5,
      level: 1
    });
    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      keyLevels: {
        shipyard: 1
      },
      queues: {
        building: null
      }
    });
  });

  test("indexes ship and research queues plus completed counts and levels", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xship",
      logIndex: "0x0",
      topics: [
        shipQueuedTopic,
        topic(7n),
        topic(3n)
      ],
      data: abiWords(2n, 1770001000n, 2000n, 1000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xresearch",
      logIndex: "0x0",
      topics: [
        researchQueuedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(2n, 1770001100n, 800n, 400n, 200n)
    });

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      ship: {
        kind: "ship",
        itemId: 3,
        quantity: 2,
        readyAt: "1770001000"
      },
      research: {
        kind: "research",
        itemId: 4,
        targetLevel: 2,
        readyAt: "1770001100"
      }
    });

    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(3n)
      ],
      data: abiWords(2n, 7n)
    });
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xresearchdone",
      logIndex: "0x0",
      topics: [
        researchCompletedTopic,
        addressTopic(player),
        topic(4n)
      ],
      data: abiWords(2n)
    });

    expect(indexer.playerQueues(player, planet.planetId).ship).toBeNull();
    expect(indexer.playerQueues(player, planet.planetId).research).toBeNull();
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 3)).toMatchObject({
      id: 3,
      count: 7
    });
    expect(indexer.technologyLevels(player)).toMatchObject({
      "4": 2
    });
  });

  test("rebuild applies repeated debris updates in chain order", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return [debris, updatedDebris, clearedDebris, updatedDebris]; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    }, 100n);

    await expect(indexer.rebuild()).resolves.toMatchObject({
      indexedDebrisFields: 1,
      indexedPlanets: 1
    });
    expect(indexer.debrisFieldsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        planetId: planet.planetId,
        resources: updatedDebris.resources
      })
    ]);
  });

  test("rebuild stores current planet resources instead of settlement-log zero placeholders", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      transactionHash: "0x",
      blockNumber: "0",
      lastSettledAt: "1770000500",
      resources: {
        metal: "9100",
        crystal: "8200",
        deuterium: "7300"
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() {
        return [{
          ...planet,
          lastSettledAt: "0",
          resources: {
            metal: "0",
            crystal: "0",
            deuterium: "0"
          }
        }];
      }
    }, 100n);

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: planet.transactionHash,
      blockNumber: planet.blockNumber,
      lastSettledAt: currentPlanet.lastSettledAt,
      resources: currentPlanet.resources
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });

  test("rebuild reconciles stale levels and queues from canonical on-chain snapshots", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: currentPlanet.resources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "8900", crystal: "7800", deuterium: "6700" },
      technologyLevels: {},
      buildings: [
        { id: 0, level: 4, cost: { metal: "960", crystal: "240", deuterium: "0" } },
        { id: 3, level: 2, cost: { metal: "150", crystal: "60", deuterium: "0" } }
      ],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 3,
        readyAt: "1770000900",
        startedAt: "1770000300",
        cost: { metal: "150", crystal: "60", deuterium: "0" }
      }
    };
    const liveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: liveInfrastructure.queue,
      defense: null,
      ship: null,
      research: {
        active: true,
        kind: "research",
        itemId: 4,
        targetLevel: 2,
        readyAt: "1770001200",
        cost: { metal: "800", crystal: "400", deuterium: "200" }
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; },
      async getPlayerQueues() { return liveQueues; },
      async getResearchState() {
        return {
          wallet: player,
          homePlanetId: planet.planetId,
          researchAvailable: true,
          resources: currentPlanet.resources,
          researchLabLevel: 1,
          researchNetworkLabLevels: [],
          technologyLevels: { "4": 2 },
          technologies: [
            { id: 4, level: 2, cost: { metal: "1600", crystal: "800", deuterium: "400" } }
          ],
          queue: liveQueues.research
        };
      }
    }, 100n);
    indexer.applyEvent({
      ...planet,
      resources: { metal: "1", crystal: "1", deuterium: "1" }
    });
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xstale",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual(currentPlanet.resources);
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 0)).toMatchObject({
      id: 0,
      level: 4
    });
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 2
    });
    expect(indexer.playerQueues(player, planet.planetId).building).toMatchObject({
      kind: "building",
      itemId: 3,
      targetLevel: 3,
      readyAt: "1770000900"
    });
    expect(indexer.playerQueues(player, planet.planetId).research).toMatchObject({
      kind: "research",
      itemId: 4,
      targetLevel: 2,
      readyAt: "1770001200"
    });
    expect(indexer.technologyLevels(player)).toMatchObject({
      "4": 2
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });

  test("records reconciliation failures for health/debug visibility", async () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { throw new Error("RPC HTTP 429"); }
    }, 100n);

    await expect(indexer.rebuild()).rejects.toThrow("RPC HTTP 429");
    expect(indexer.snapshot()).toMatchObject({
      indexedPlanets: 0,
      lastReconciliationError: "RPC HTTP 429",
      reconciliationInProgress: false
    });
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function topic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressTopic(address: Address): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}
