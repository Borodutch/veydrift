import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { canonicalContractTables } from "./contractStateSchema";
import type { Address, DebrisFieldEvent, InfrastructureState, MoonChanceReportEvent, PlayerQueues, ResearchState, SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222" as Address;
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const planetRenamedTopic = "0x2b772c1fa271aad466ce009b6b5824b2ad6ccd942d21efc686513ffa8eb166cd";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const moonCreatedTopic = "0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4";
const moonBuildingStartedTopic = "0x6b41aeb096e643752dad879b8f3875d8657186226c3cf8b6e7a38c27292f215a";
const moonBuildingCompletedTopic = "0x59b630c46c04307254808aac61ea2de2a7e6fbf5ed6eb0ebee81c917b575ed3a";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const marketResourceWithdrawalRequestedTopic = "0xc4694dfe978480c576eacc57b2b09e69c8b8f50c49739ca4c4515295be589eab";
const marketResourceWithdrawalFinishedTopic = "0x2b254e656a481b3978a707e6846146a1d7a3144e414cb803bbc7adc97d7587ee";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceInviteCreatedTopic = "0x2ebeddd3f0119f5464f0f6acb95cbc1477a11e19b059f3234bbb0a671cf2b4bd";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
const allianceRoleUpdatedTopic = "0xe4ba1cf47cfd4ff05de8585bf5cb06e7b0856932c0d81ef64a3458e26877f30d";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
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

  test("repairs materialized building levels from stored completion logs on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x2869251",
        transactionHash: "0x7ff7ffb3a61c90be59598960d8bfd95ecc455cfba667e206499e9c0f1c2eede4",
        logIndex: "0x46",
        topics: [
          buildingCompletedTopic,
          topic(1n),
          topic(10n)
        ],
        data: abiWords(1n)
      });

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("UPDATE indexed_building_levels SET level = 0 WHERE planet_id = ? AND building_id = ?").run("1", 10);
        staleDb.query("UPDATE contract_building_levels SET level = 0 WHERE planet_id = ? AND building_id = ?").run("1", 10);
        expect(staleDb.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get("1", 10)).toEqual({
          level: 0
        });
      } finally {
        staleDb.close();
      }

      const repaired = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      expect(repaired.infrastructureRows("1").find((building) => building.id === 10)?.level).toBe(1);
      const repairedDb = new Database(databasePath, { readonly: true });
      try {
        expect(repairedDb.query("SELECT level FROM contract_building_levels WHERE planet_id = ? AND building_id = ?").get("1", 10)).toEqual({
          level: 1
        });
      } finally {
        repairedDb.close();
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("replays active production queue starts from stored event logs on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-indexer-"));
    const databasePath = join(dir, "contract-state.sqlite");
    try {
      const first = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });
      first.applyEvent(planet);
      first.applyLog({
        blockNumber: "0x290",
        transactionHash: "0xreplay-building",
        logIndex: "0x0",
        topics: [buildingStartedTopic, topic(7n), topic(6n)],
        data: abiWords(2n, 1770002000n, 100n, 50n, 0n)
      });
      first.applyLog({
        blockNumber: "0x291",
        transactionHash: "0xreplay-research",
        logIndex: "0x0",
        topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
        data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
      });
      first.applyLog({
        blockNumber: "0x292",
        transactionHash: "0xreplay-ship",
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 1770002200n, 60n, 30n, 0n)
      });
      first.applyLog({
        blockNumber: "0x293",
        transactionHash: "0xreplay-defense",
        logIndex: "0x0",
        topics: [defenseQueuedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 1770002300n, 40n, 20n, 0n)
      });
      const resourcesAfterStarts = first.walletSettlement(player).planet?.resources;

      const staleDb = new Database(databasePath);
      try {
        staleDb.query("DELETE FROM indexed_planet_queues").run();
        staleDb.query("DELETE FROM contract_production_queues").run();
      } finally {
        staleDb.close();
      }

      const replayed = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { databasePath });

      expect(replayed.playerQueues(player, planet.planetId)).toMatchObject({
        building: { kind: "building", itemId: 6, targetLevel: 2, readyAt: "1770002000" },
        research: { kind: "research", itemId: 4, targetLevel: 2, readyAt: "1770002100" },
        ship: { kind: "ship", itemId: 2, quantity: 3, readyAt: "1770002200" },
        defense: { kind: "defense", itemId: 1, quantity: 5, readyAt: "1770002300" }
      });
      expect(replayed.walletSettlement(player).planet?.resources).toEqual(resourcesAfterStarts);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("settles accrued resources before subtracting indexed queued spends", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xmine",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xsolar",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(1n)
    });

    indexer.applyLog({
      blockNumber: "0x83",
      blockTimestamp: "0x69801c90",
      transactionHash: "0xbuild",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(5n)],
      data: abiWords(1n, 1770004000n, 400n, 120n, 60n)
    });

    const updated = indexer.walletSettlement(player).planet;
    expect(updated?.lastSettledAt).toBe("1770003600");
    expect(Number(updated?.resources.metal)).toBeGreaterThan(4600);
    expect(Number(updated?.resources.metal)).toBeLessThan(5000);
    expect(Number(updated?.resources.crystal)).toBe(4780);
  });

  test("applies combat ship count changes to indexed ship rows", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x83",
      transactionHash: "0xshipdone",
      logIndex: "0x0",
      topics: [
        shipCompletedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(5n, 5n)
    });

    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(5);
    expect(indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xcombat",
      logIndex: "0x0",
      topics: [
        planetShipCountChangedTopic,
        topic(7n),
        topic(9n)
      ],
      data: abiWords(2n)
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 2
      }
    });
    expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 9)?.count).toBe(2);
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

  test("keeps zero-resource settlement logs stale until canonical resources arrive", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    expect(indexer.applyLog({
      blockNumber: "0x7c",
      transactionHash: "0xstarted",
      logIndex: "0x0",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        safeToServeIndexedState: false,
        staleReason: "planet_resources_pending:7"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      lastSettledAt: "0",
      resources: {
        metal: "0",
        crystal: "0",
        deuterium: "0"
      }
    });

    expect(indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xsettled",
      logIndex: "0x1",
      topics: [
        planetSettledTopic,
        topic(7n)
      ],
      data: abiWords(5000n, 4900n, 4800n, 1770000000n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        staleReason: "never_reconciled"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: "0xsettled",
      blockNumber: "125",
      lastSettledAt: "1770000000",
      resources: planet.resources
    });
  });

  test("preserves resource logs that arrive before settlement identity logs", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    expect(indexer.applyLog({
      blockNumber: "0x7d",
      transactionHash: "0xsettled",
      logIndex: "0x0",
      topics: [
        planetSettledTopic,
        topic(7n)
      ],
      data: abiWords(5000n, 4900n, 4800n, 1770000000n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 0,
        indexedState: "stale",
        staleReason: "planet_identity_pending:7"
      }
    });

    expect(indexer.applyLog({
      blockNumber: "0x7e",
      transactionHash: "0xstarted",
      logIndex: "0x1",
      topics: [
        planetStartedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    })).toMatchObject({
      applied: true,
      snapshot: {
        indexedPlanets: 1,
        indexedState: "stale",
        staleReason: "never_reconciled"
      }
    });
    expect(indexer.walletSettlement(player).planet).toMatchObject({
      transactionHash: "0xsettled",
      blockNumber: "125",
      lastSettledAt: "1770000000",
      resources: planet.resources
    });
  });

  test("applies planet rename logs to every indexed planet read model", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    expect(indexer.applyLog({
      blockNumber: "0x81",
      transactionHash: "0xrename",
      logIndex: "0x0",
      topics: [
        planetRenamedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiString("New Eos")
    })).toMatchObject({
      applied: true,
      duplicate: false,
      snapshot: {
        indexedEventLogs: 1,
        indexedPlanets: 1,
        latestIndexedBlock: "129"
      }
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      planetId: planet.planetId,
      name: "New Eos"
    });
    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      planetId: planet.planetId,
      name: "New Eos"
    });
    expect(indexer.planet(planet.planetId)).toMatchObject({
      name: "New Eos"
    });
    expect(indexer.settledPlanetsInSystem(planet.galaxy, planet.system)[0]).toMatchObject({
      name: "New Eos"
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

  test("keeps indexed building completion levels monotonic when older logs arrive late", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xbuilddone2",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x82",
      transactionHash: "0xbuilddone1",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(5n)
      ],
      data: abiWords(1n)
    });

    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)).toMatchObject({
      id: 5,
      level: 2
    });
    expect(indexer.walletPlanets(player).planets[0]?.keyLevels.shipyard).toBe(2);
  });

  test("reports used fields as completed building levels only", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x84",
      transactionHash: "0xmetal2",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(0n)],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x85",
      transactionHash: "0xterraformer1",
      logIndex: "0x0",
      topics: [buildingCompletedTopic, topic(7n), topic(12n)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x86",
      transactionHash: "0xdefense5",
      logIndex: "0x0",
      topics: [defenseCompletedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 5n)
    });
    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xship7",
      logIndex: "0x0",
      topics: [shipCompletedTopic, topic(7n), topic(3n)],
      data: abiWords(7n, 7n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xresearch4",
      logIndex: "0x0",
      topics: [researchCompletedTopic, addressTopic(player), topic(4n)],
      data: abiWords(4n)
    });

    expect(indexer.walletPlanets(player).planets[0]).toMatchObject({
      fieldsUsed: 3,
      fieldsCapacity: planet.fields,
      keyLevels: {
        metalMine: 2,
        terraformer: 1
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
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "2200",
      crystal: "3500",
      deuterium: "4600"
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

  test("indexes moon creation and moon building queues", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0x87",
      transactionHash: "0xmoon",
      logIndex: "0x0",
      topics: [
        moonCreatedTopic,
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 12n, 8777n)
    });
    indexer.applyLog({
      blockNumber: "0x88",
      transactionHash: "0xmoonbuild",
      logIndex: "0x0",
      topics: [
        moonBuildingStartedTopic,
        topic(7n),
        topic(2n)
      ],
      data: abiWords(1n, 1770001200n, 2_000_000n, 4_000_000n, 2_000_000n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      moon: {
        exists: true,
        planetId: planet.planetId,
        owner: player,
        fields: 12,
        diameterKm: 8777
      },
      queue: {
        kind: "moon-building",
        itemId: 2,
        targetLevel: 1,
        readyAt: "1770001200"
      }
    });

    indexer.applyLog({
      blockNumber: "0x89",
      transactionHash: "0xmoonbuilddone",
      logIndex: "0x0",
      topics: [
        moonBuildingCompletedTopic,
        topic(7n),
        topic(2n)
      ],
      data: abiWords(1n)
    });

    expect(indexer.moonState(player, planet.planetId)).toMatchObject({
      queue: null,
      buildings: expect.arrayContaining([
        expect.objectContaining({ id: 2, level: 1 })
      ])
    });
  });

  test("persists every production queue kind from indexed contract events", () => {
    const db = new Database(":memory:");
    try {
      const indexer = new SettlementIndexer({
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return []; }
      }, 100n, { database: db });
      indexer.applyEvent(planet);

      indexer.applyLog({
        blockNumber: "0x90",
        transactionHash: "0xqueue-building",
        logIndex: "0x0",
        topics: [buildingStartedTopic, topic(7n), topic(4n)],
        data: abiWords(2n, 1770002000n, 1200n, 400n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x91",
        transactionHash: "0xqueue-defense",
        logIndex: "0x0",
        topics: [defenseQueuedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 1770002100n, 1000n, 300n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x92",
        transactionHash: "0xqueue-ship",
        logIndex: "0x0",
        topics: [shipQueuedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 1770002200n, 6000n, 3000n, 0n)
      });
      indexer.applyLog({
        blockNumber: "0x93",
        transactionHash: "0xqueue-research",
        logIndex: "0x0",
        topics: [researchQueuedTopic, addressTopic(player), topic(5n)],
        data: abiWords(1n, 1770002300n, 800n, 200n, 100n)
      });
      indexer.applyLog({
        blockNumber: "0x94",
        transactionHash: "0xqueue-moon",
        logIndex: "0x0",
        topics: [moonBuildingStartedTopic, topic(7n), topic(2n)],
        data: abiWords(1n, 1770002400n, 2_000_000n, 4_000_000n, 2_000_000n)
      });

      expect(db.query(`
        SELECT queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity, ready_at, metal_cost, crystal_cost, deuterium_cost
        FROM contract_production_queues
        ORDER BY queue_key ASC
      `).all()).toEqual([
        {
          queue_key: "building:7",
          queue_kind: "building",
          planet_id: "7",
          owner: null,
          item_id: 4,
          target_level: 2,
          quantity: null,
          ready_at: "1770002000",
          metal_cost: "1200",
          crystal_cost: "400",
          deuterium_cost: "0"
        },
        {
          queue_key: "defense:7",
          queue_kind: "defense",
          planet_id: "7",
          owner: null,
          item_id: 1,
          target_level: null,
          quantity: 5,
          ready_at: "1770002100",
          metal_cost: "1000",
          crystal_cost: "300",
          deuterium_cost: "0"
        },
        {
          queue_key: "moon-building:7",
          queue_kind: "moon-building",
          planet_id: "7",
          owner: null,
          item_id: 2,
          target_level: 1,
          quantity: null,
          ready_at: "1770002400",
          metal_cost: "2000000",
          crystal_cost: "4000000",
          deuterium_cost: "2000000"
        },
        {
          queue_key: `research:${player}`,
          queue_kind: "research",
          planet_id: null,
          owner: player,
          item_id: 5,
          target_level: 1,
          quantity: null,
          ready_at: "1770002300",
          metal_cost: "800",
          crystal_cost: "200",
          deuterium_cost: "100"
        },
        {
          queue_key: "ship:7",
          queue_kind: "ship",
          planet_id: "7",
          owner: null,
          item_id: 2,
          target_level: null,
          quantity: 3,
          ready_at: "1770002200",
          metal_cost: "6000",
          crystal_cost: "3000",
          deuterium_cost: "0"
        }
      ]);
      expect(db.query(`
        SELECT planet_id, moon_building_id, target_level, ready_at, metal_cost, crystal_cost, deuterium_cost
        FROM contract_moon_building_queues
      `).get()).toEqual({
        planet_id: "7",
        moon_building_id: 2,
        target_level: 1,
        ready_at: "1770002400",
        metal_cost: "2000000",
        crystal_cost: "4000000",
        deuterium_cost: "2000000"
      });
      expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
        building: { kind: "building", itemId: 4, targetLevel: 2 },
        defense: { kind: "defense", itemId: 1, quantity: 5 },
        ship: { kind: "ship", itemId: 2, quantity: 3 },
        research: { kind: "research", itemId: 5, targetLevel: 1 }
      });
      expect(indexer.moonState(player, planet.planetId).queue).toMatchObject({
        kind: "moon-building",
        itemId: 2,
        targetLevel: 1
      });

      indexer.applyLog({
        blockNumber: "0x95",
        transactionHash: "0xcomplete-building",
        logIndex: "0x0",
        topics: [buildingCompletedTopic, topic(7n), topic(4n)],
        data: abiWords(2n)
      });
      indexer.applyLog({
        blockNumber: "0x96",
        transactionHash: "0xcomplete-defense",
        logIndex: "0x0",
        topics: [defenseCompletedTopic, topic(7n), topic(1n)],
        data: abiWords(5n, 9n)
      });
      indexer.applyLog({
        blockNumber: "0x97",
        transactionHash: "0xcomplete-ship",
        logIndex: "0x0",
        topics: [shipCompletedTopic, topic(7n), topic(2n)],
        data: abiWords(3n, 8n)
      });
      indexer.applyLog({
        blockNumber: "0x98",
        transactionHash: "0xcomplete-research",
        logIndex: "0x0",
        topics: [researchCompletedTopic, addressTopic(player), topic(5n)],
        data: abiWords(1n)
      });
      indexer.applyLog({
        blockNumber: "0x99",
        transactionHash: "0xcomplete-moon",
        logIndex: "0x0",
        topics: [moonBuildingCompletedTopic, topic(7n), topic(2n)],
        data: abiWords(1n)
      });

      expect(db.query("SELECT COUNT(*) AS count FROM contract_production_queues").get()).toEqual({ count: 0 });
      expect(db.query("SELECT COUNT(*) AS count FROM contract_moon_building_queues").get()).toEqual({ count: 0 });
      expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 4)).toMatchObject({ level: 2 });
      expect(indexer.defenseRows(planet.planetId).find((defense) => defense.id === 1)).toMatchObject({ count: 9 });
      expect(indexer.shipRows(planet.planetId).find((ship) => ship.id === 2)).toMatchObject({ count: 8 });
      expect(indexer.technologyLevels(player)).toMatchObject({ "5": 1 });
      expect(indexer.moonState(player, planet.planetId).buildings).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 2, level: 1 })
      ]));
    } finally {
      db.close();
    }
  });

  test("appends different defense queue events to the indexed backlog", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-light-laser",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(2n, 1770001000n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-rocket-backlog",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(3n, 1770001600n, 200n, 0n, 0n)
    });

    expect(indexer.playerQueues(player, planet.planetId).defense).toMatchObject({
      kind: "defense",
      itemId: 1,
      quantity: 2,
      readyAt: "1770001000",
      cost: { metal: "100", crystal: "50", deuterium: "0" },
      backlog: [
        {
          kind: "defense",
          itemId: 0,
          quantity: 3,
          readyAt: "1770001600",
          cost: { metal: "200", crystal: "0", deuterium: "0" }
        }
      ]
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "4700",
      crystal: "4850",
      deuterium: "4800"
    });
  });

  test("appends different ship queue events to the indexed backlog", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);

    indexer.applyLog({
      blockNumber: "0xa0",
      transactionHash: "0xqueue-small-cargo",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(2n, 1770001000n, 4000n, 4000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa1",
      transactionHash: "0xqueue-light-fighter-backlog",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(3n, 1770001600n, 9000n, 3000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0xa2",
      transactionHash: "0xqueue-small-cargo-more",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(4n, 1770002000n, 0n, 0n, 0n)
    });

    expect(indexer.playerQueues(player, planet.planetId).ship).toMatchObject({
      kind: "ship",
      itemId: 0,
      quantity: 4,
      readyAt: "1770002000",
      cost: { metal: "0", crystal: "0", deuterium: "0" },
      backlog: [
        {
          kind: "ship",
          itemId: 1,
          quantity: 3,
          readyAt: "1770001600",
          cost: { metal: "9000", crystal: "3000", deuterium: "0" }
        }
      ]
    });
    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "0",
      crystal: "0",
      deuterium: "4800"
    });
  });

  test("indexes rift deposits and withdrawal lifecycle", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x8a",
      transactionHash: "0xriftbuild",
      logIndex: "0x0",
      topics: [
        buildingCompletedTopic,
        topic(7n),
        topic(15n)
      ],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x8b",
      transactionHash: "0xdeposit",
      logIndex: "0x0",
      topics: [
        marketResourceDepositedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(1000n)
    });
    indexer.applyLog({
      blockNumber: "0x8c",
      transactionHash: "0xwithdraw",
      logIndex: "0x0",
      topics: [
        marketResourceWithdrawalRequestedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(250n, 1770500000n)
    });

    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      unlocked: true,
      resources: expect.arrayContaining([
        expect.objectContaining({
          key: "metal",
          inGameBalance: "750",
          lockedBalance: "250"
        })
      ]),
      pendingWithdrawals: [
        expect.objectContaining({
          amount: "250",
          resource: "metal",
          unlocksAt: "1770500000"
        })
      ]
    });

    indexer.applyLog({
      blockNumber: "0x8d",
      transactionHash: "0xfinishwithdraw",
      logIndex: "0x0",
      topics: [
        marketResourceWithdrawalFinishedTopic,
        addressTopic(player),
        topic(7n),
        topic(0n)
      ],
      data: abiWords(250n)
    });

    expect(indexer.riftState(player, planet.planetId)).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          key: "metal",
          inGameBalance: "750",
          lockedBalance: "0"
        })
      ]),
      pendingWithdrawals: []
    });
  });

  test("indexes alliance membership, profile, invites, and join requests from event logs", () => {
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const applicant = "0x4444444444444444444444444444444444444444" as Address;
    const invitee = "0x5555555555555555555555555555555555555555" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x90",
      blockTimestamp: "0x69801c80",
      transactionHash: "0xalliance-create",
      logIndex: "0x0",
      topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
      data: abiStrings("VEY", "Veydrift Command")
    });
    indexer.applyLog({
      blockNumber: "0x91",
      blockTimestamp: "0x69801c81",
      transactionHash: "0xalliance-owner",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
      data: abiWords(3n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xalliance-profile",
      logIndex: "0x0",
      topics: [allianceProfileUpdatedTopic, topic(1n)],
      data: abiStrings("VEY", "Veydrift Command", "Indexed alliance")
    });
    indexer.applyLog({
      blockNumber: "0x93",
      blockTimestamp: "0x69801c83",
      transactionHash: "0xalliance-officer",
      logIndex: "0x0",
      topics: [allianceJoinedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(1n)
    });
    indexer.applyLog({
      blockNumber: "0x94",
      transactionHash: "0xalliance-role",
      logIndex: "0x0",
      topics: [allianceRoleUpdatedTopic, topic(1n), addressTopic(officer)],
      data: abiWords(2n)
    });
    indexer.applyLog({
      blockNumber: "0x95",
      blockTimestamp: "0x69801c85",
      transactionHash: "0xalliance-invite",
      logIndex: "0x0",
      topics: [allianceInviteCreatedTopic, topic(1n), addressTopic(officer), addressTopic(invitee)],
      data: "0x"
    });
    indexer.applyLog({
      blockNumber: "0x96",
      transactionHash: "0xalliance-request",
      logIndex: "0x0",
      topics: [allianceJoinRequestedTopic, topic(1n), addressTopic(applicant)],
      data: abiWords(1770003000n)
    });

    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        description: "Indexed alliance",
        owner: player,
        memberCount: 2
      },
      members: [
        { address: player, role: "owner", joinedAt: String(0x69801c81) },
        { address: officer, role: "officer", joinedAt: String(0x69801c83) }
      ],
      allianceJoinRequests: [
        { allianceId: "1", requester: applicant, requestedAt: "1770003000" }
      ]
    });
    expect(indexer.allianceState(invitee).pendingInvites).toEqual([
      { allianceId: "1", inviter: officer, inviterDisplayName: null, invitedAt: String(0x69801c85) }
    ]);
    expect(indexer.allianceState(applicant).pendingJoinRequests).toEqual([
      { allianceId: "1", requester: applicant, requesterDisplayName: null, requestedAt: "1770003000" }
    ]);
    expect(indexer.allianceIntelForPlayers([player, applicant])).toEqual(new Map([
      [player, { allianceId: "1", tag: "VEY", name: "Veydrift Command" }]
    ]));
  });

  test("rebuild backfills alliance event logs into the indexed read model", async () => {
    const officer = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; },
      async listAllianceLogs() {
        return [
          {
            blockNumber: "0x90",
            blockTimestamp: "0x69801c80",
            transactionHash: "0xalliance-create",
            logIndex: "0x0",
            topics: [allianceCreatedTopic, topic(1n), addressTopic(player)],
            data: abiStrings("VEY", "Veydrift Command")
          },
          {
            blockNumber: "0x91",
            blockTimestamp: "0x69801c81",
            transactionHash: "0xalliance-owner",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(1n), addressTopic(player)],
            data: abiWords(3n)
          },
          {
            blockNumber: "0x92",
            transactionHash: "0xalliance-profile",
            logIndex: "0x0",
            topics: [allianceProfileUpdatedTopic, topic(1n)],
            data: abiStrings("VEY", "Veydrift Command", "Indexed alliance")
          },
          {
            blockNumber: "0x93",
            blockTimestamp: "0x69801c83",
            transactionHash: "0xalliance-officer",
            logIndex: "0x0",
            topics: [allianceJoinedTopic, topic(1n), addressTopic(officer)],
            data: abiWords(2n)
          }
        ];
      }
    }, 100n);

    await indexer.rebuild();

    expect(indexer.snapshot()).toMatchObject({
      indexedEventLogs: 4,
      safeToServeIndexedState: true,
      staleReason: null
    });
    expect(indexer.allianceState(player)).toMatchObject({
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner", joinedAt: String(0x69801c81) },
      profile: {
        tag: "VEY",
        name: "Veydrift Command",
        description: "Indexed alliance",
        owner: player,
        memberCount: 2
      },
      members: [
        { address: player, role: "owner", joinedAt: String(0x69801c81) },
        { address: officer, role: "officer", joinedAt: String(0x69801c83) }
      ]
    });
  });

  test("indexes attacker and defender fleet mission visibility from mission event logs", () => {
    const attacker = "0x3333333333333333333333333333333333333333" as Address;
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);
    const attackerPlanet: SettledPlanetEvent = {
      ...planet,
      planetId: "99",
      owner: attacker,
      name: "Spearhead",
      galaxy: 3,
      system: 12,
      position: 4
    };
    indexer.applyEvent(planet);
    indexer.applyEvent(attackerPlanet);
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x0",
      topics: [
        fleetMissionLaunchedTopic,
        topic(44n),
        addressTopic(attacker),
        topic(3n)
      ],
      data: abiWords(99n, 7n, 1770001200n, 1770002400n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x1",
      topics: [
        fleetMissionCargoTopic,
        topic(44n)
      ],
      data: abiWords(100n, 50n, 0n, 20n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xfleet",
      logIndex: "0x2",
      topics: [
        fleetMissionShipsTopic,
        topic(44n)
      ],
      data: abiWords(1n, 2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x0",
      topics: [
        fleetMissionLaunchedTopic,
        topic(45n),
        addressTopic(player),
        topic(3n)
      ],
      data: abiWords(7n, 99n, 1770001300n, 1770002500n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x1",
      topics: [
        fleetMissionCargoTopic,
        topic(45n)
      ],
      data: abiWords(0n, 0n, 0n, 30n)
    });
    indexer.applyLog({
      blockNumber: "0x91",
      transactionHash: "0xfleet2",
      logIndex: "0x2",
      topics: [
        fleetMissionShipsTopic,
        topic(45n)
      ],
      data: abiWords(0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x92",
      transactionHash: "0xfleetreturn",
      logIndex: "0x0",
      topics: [
        fleetMissionReturnExposedTopic,
        topic(45n),
        addressTopic(player),
        topic(2n)
      ],
      data: abiWords(7n, 99n, 1770002500n, 100n, 25n, 0n)
    });

    const defenderVisibility = indexer.fleetMissionVisibility(player);
    expect(defenderVisibility.outgoing).toEqual([]);
    expect(defenderVisibility.returning.map((mission) => mission.missionId)).toEqual(["45"]);
    expect(defenderVisibility.incoming[0]).toMatchObject({
      missionId: "44",
      missionType: "Attack",
      owner: attacker,
      originPlanetId: "99",
      targetPlanetId: "7",
      originPlanet: {
        planetId: "99",
        owner: attacker,
        name: "Spearhead",
        galaxy: 3,
        system: 12,
        position: 4,
        coordinates: "3:12:4"
      },
      targetPlanet: {
        planetId: "7",
        owner: player,
        name: null,
        galaxy: 2,
        system: 44,
        position: 9,
        coordinates: "2:44:9"
      },
      ships: {
        smallCargo: "1",
        lightFighter: "2"
      }
    });

    const attackerVisibility = indexer.fleetMissionVisibility(attacker);
    expect(attackerVisibility.outgoing.map((mission) => mission.missionId)).toEqual(["44"]);
    expect(attackerVisibility.incoming).toEqual([]);
    expect(attackerVisibility.returning).toEqual([]);
  });

  test("removed duplicate log marks reorg health instead of being ignored", () => {
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
        addressTopic(player),
        topic(7n)
      ],
      data: abiWords(2n, 44n, 9n, 211n, 1n)
    };

    indexer.applyLog(log);
    expect(indexer.applyLog({ ...log, removed: true })).toMatchObject({
      applied: false,
      duplicate: false,
      removed: true,
      snapshot: {
        indexedEventLogs: 2
      }
    });
    expect(indexer.snapshot().reorgDetectedAt).toBeTruthy();
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

  test("keeps first-settlement resources when resource log arrives before planet metadata", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return []; }
    }, 100n);

    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xsettle",
      logIndex: "0x0",
      topics: [planetSettledTopic, topic(7n)],
      data: abiWords(5000n, 4900n, 4800n, 1770000123n)
    });
    indexer.applyLog({
      blockNumber: "0x90",
      transactionHash: "0xsettle",
      logIndex: "0x1",
      topics: [planetStartedTopic, addressTopic(player), topic(7n)],
      data: abiWords(2n, 44n, 9n, 211n, signedWord(-8n))
    });

    expect(indexer.walletSettlement(player).planet).toMatchObject({
      blockNumber: "144",
      lastSettledAt: "1770000123",
      planetId: "7",
      resources: {
        metal: "5000",
        crystal: "4900",
        deuterium: "4800"
      },
      transactionHash: "0xsettle"
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedPlanets: 1
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
      defense: {
        active: true,
        kind: "defense",
        itemId: 1,
        quantity: 2,
        readyAt: "1770001000",
        startedAt: "1770000400",
        cost: { metal: "3000", crystal: "1000", deuterium: "0" },
        backlog: [
          {
            active: true,
            kind: "defense",
            itemId: 0,
            quantity: 3,
            readyAt: "1770001600",
            cost: { metal: "6000", crystal: "0", deuterium: "0" }
          }
        ]
      },
      ship: null,
      research: {
        active: true,
        kind: "research",
        itemId: 4,
        targetLevel: 2,
        readyAt: "1770001200",
        startedAt: "1770000600",
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
    expect(indexer.playerQueues(player, planet.planetId).defense).toMatchObject({
      kind: "defense",
      itemId: 1,
      quantity: 2,
      readyAt: "1770001000",
      backlog: [
        {
          kind: "defense",
          itemId: 0,
          quantity: 3,
          readyAt: "1770001600"
        }
      ]
    });
    expect(indexer.playerQueues(player, planet.planetId).research).toMatchObject({
      kind: "research",
      itemId: 4,
      targetLevel: 2,
      readyAt: "1770001200",
      startedAt: "1770000600"
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

  test("keeps a previously reconciled index serveable while background reconciliation runs", async () => {
    let releaseRebuild = () => {};
    const reader = {
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; }
    };
    const indexer = new SettlementIndexer(reader, 100n);

    await indexer.rebuild();
    reader.listSettledPlanetEvents = async () => {
      await new Promise<void>((resolve) => {
        releaseRebuild = resolve;
      });
      return [planet];
    };

    const rebuilding = indexer.rebuild();

    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      reconciliationInProgress: true,
      safeToServeIndexedState: true,
      staleReason: "reconciliation_in_progress"
    });

    releaseRebuild();
    await rebuilding;
  });

  for (const reason of ["planet_resources_pending:127", "planet_identity_pending:124"]) {
    test(`keeps a previously reconciled index serveable while resolving ${reason}`, async () => {
      let releaseRebuild = () => {};
      const reader = {
        async listDebrisFieldEvents() { return []; },
        async listMoonChanceReportEvents() { return []; },
        async listSettledPlanetEvents() { return [planet]; }
      };
      const indexer = new SettlementIndexer(reader, 100n);

      await indexer.rebuild();
      reader.listSettledPlanetEvents = async () => {
        await new Promise<void>((resolve) => {
          releaseRebuild = resolve;
        });
        return [planet];
      };

      const rebuilding = indexer.reconcile(reason);

      expect(indexer.snapshot()).toMatchObject({
        indexedState: "healthy",
        pendingReconciliationReason: reason,
        reconciliationInProgress: true,
        safeToServeIndexedState: true,
        staleReason: "reconciliation_in_progress"
      });

      releaseRebuild();
      await rebuilding;
    });
  }

  test("rebuild preserves newer uncompleted event-derived production queues and subtracts queued spend costs", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const emptyLiveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: null,
      defense: null,
      ship: null,
      research: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getPlayerQueues() { return emptyLiveQueues; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x390",
      transactionHash: "0xrebuild-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(6n)],
      data: abiWords(2n, 1770002000n, 100n, 50n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x391",
      transactionHash: "0xrebuild-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
    });
    indexer.applyLog({
      blockNumber: "0x392",
      transactionHash: "0xrebuild-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(2n)],
      data: abiWords(3n, 1770002200n, 60n, 30n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x393",
      transactionHash: "0xrebuild-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(5n, 1770002300n, 40n, 20n, 0n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual({
      metal: "9620",
      crystal: "8660",
      deuterium: "7680"
    });
    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: { kind: "building", itemId: 6, targetLevel: 2, readyAt: "1770002000" },
      research: { kind: "research", itemId: 4, targetLevel: 2, readyAt: "1770002100" },
      ship: { kind: "ship", itemId: 2, quantity: 3, readyAt: "1770002200" },
      defense: { kind: "defense", itemId: 1, quantity: 5, readyAt: "1770002300" }
    });
  });

  test("rebuild uses live canonical resources without subtracting active queue costs again", async () => {
    const previewResources = {
      metal: "1888",
      crystal: "579",
      deuterium: "2261"
    };
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "14831",
        crystal: "6519",
        deuterium: "2263"
      }
    };
    const liveInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: previewResources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "888", crystal: "0", deuterium: "1261" },
      technologyLevels: {},
      buildings: [],
      queue: {
        active: true,
        kind: "building",
        itemId: 3,
        targetLevel: 12,
        readyAt: "1770002000",
        cost: { metal: "6487", crystal: "2594", deuterium: "0" }
      }
    };
    const liveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: liveInfrastructure.queue,
      defense: {
        active: true,
        kind: "defense",
        itemId: 0,
        quantity: 1,
        readyAt: "1770002100",
        cost: { metal: "2000", crystal: "0", deuterium: "0" }
      },
      ship: {
        active: true,
        kind: "ship",
        itemId: 1,
        quantity: 1,
        readyAt: "1770002200",
        cost: { metal: "3000", crystal: "1000", deuterium: "0" }
      },
      research: {
        active: true,
        kind: "research",
        itemId: 9,
        targetLevel: 1,
        readyAt: "1770002300",
        cost: { metal: "2000", crystal: "4000", deuterium: "600" }
      }
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; },
      async getPlayerQueues() { return liveQueues; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x390",
      transactionHash: "0xrebuild-building",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(12n, 1770002000n, 6487n, 2594n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x391",
      transactionHash: "0xrebuild-defense",
      logIndex: "0x0",
      topics: [defenseQueuedTopic, topic(7n), topic(0n)],
      data: abiWords(1n, 1770002100n, 2000n, 0n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x392",
      transactionHash: "0xrebuild-ship",
      logIndex: "0x0",
      topics: [shipQueuedTopic, topic(7n), topic(1n)],
      data: abiWords(1n, 1770002200n, 3000n, 1000n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x393",
      transactionHash: "0xrebuild-research",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(9n)],
      data: abiWords(1n, 1770002300n, 2000n, 4000n, 600n)
    });

    await indexer.rebuild();

    expect(indexer.walletSettlement(player).planet?.resources).toEqual(previewResources);
    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: { kind: "building", itemId: 3, targetLevel: 12 },
      defense: { kind: "defense", itemId: 0, quantity: 1 },
      ship: { kind: "ship", itemId: 1, quantity: 1 },
      research: { kind: "research", itemId: 9, targetLevel: 1 }
    });
  });

  test("rebuild drops event-derived queues that canonical levels prove completed", async () => {
    const currentPlanet: SettledPlanetEvent = {
      ...planet,
      resources: {
        metal: "9900",
        crystal: "8800",
        deuterium: "7700"
      }
    };
    const completedInfrastructure: InfrastructureState = {
      wallet: player,
      homePlanetId: planet.planetId,
      infrastructureAvailable: true,
      resources: currentPlanet.resources,
      productionPerHour: { metal: "30", crystal: "15", deuterium: "8" },
      energyBalance: { produced: "20", required: "10", scaleBps: "10000" },
      storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
      protectedResources: { metal: "1000", crystal: "1000", deuterium: "1000" },
      raidableResources: { metal: "8900", crystal: "7800", deuterium: "6700" },
      technologyLevels: { "4": 2 },
      buildings: [
        { id: 3, level: 5, cost: { metal: "569", crystal: "227", deuterium: "0" } },
        { id: 6, level: 1, cost: { metal: "800", crystal: "400", deuterium: "200" } }
      ],
      queue: null
    };
    const completedResearch: ResearchState = {
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
      queue: null
    };
    const emptyLiveQueues: PlayerQueues = {
      wallet: player,
      homePlanetId: planet.planetId,
      building: null,
      defense: null,
      ship: null,
      research: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return completedInfrastructure; },
      async getPlayerQueues() { return emptyLiveQueues; },
      async getResearchState() { return completedResearch; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x3a0",
      transactionHash: "0xcompleted-building-without-log",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(5n, 1770002000n, 379n, 151n, 0n)
    });
    indexer.applyLog({
      blockNumber: "0x3a1",
      transactionHash: "0xcompleted-research-without-log",
      logIndex: "0x0",
      topics: [researchQueuedTopic, addressTopic(player), topic(4n)],
      data: abiWords(2n, 1770002100n, 80n, 40n, 20n)
    });

    await indexer.rebuild();

    expect(indexer.playerQueues(player, planet.planetId)).toMatchObject({
      building: null,
      research: null
    });
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 5
    });
    expect(indexer.technologyLevels(player)).toMatchObject({ "4": 2 });
  });

  test("rebuild does not resurrect event-derived building queues that canonical infrastructure verified empty", async () => {
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
        { id: 0, level: 5, cost: { metal: "960", crystal: "240", deuterium: "0" } },
        { id: 3, level: 6, cost: { metal: "150", crystal: "60", deuterium: "0" } }
      ],
      queue: null
    };
    const indexer = new SettlementIndexer({
      async listCurrentPlanets() { return [currentPlanet]; },
      async listDebrisFieldEvents() { return []; },
      async listMoonChanceReportEvents() { return []; },
      async listSettledPlanetEvents() { return [planet]; },
      async getInfrastructureState() { return liveInfrastructure; }
    }, 100n);
    indexer.applyEvent(planet);
    indexer.applyLog({
      blockNumber: "0x3a0",
      transactionHash: "0xstale-solar",
      logIndex: "0x0",
      topics: [buildingStartedTopic, topic(7n), topic(3n)],
      data: abiWords(6n, 1770002000n, 100n, 50n, 0n)
    });

    await indexer.rebuild();

    expect(indexer.playerQueues(player, planet.planetId).building).toBeNull();
    expect(indexer.infrastructureRows(planet.planetId).find((building) => building.id === 3)).toMatchObject({
      id: 3,
      level: 6
    });
    expect(indexer.snapshot()).toMatchObject({
      indexedState: "healthy",
      safeToServeIndexedState: true,
      staleReason: null
    });
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function signedWord(value: bigint): bigint {
  return value >= 0n ? value : (1n << 256n) + value;
}

function abiString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const data = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${[
    (32n).toString(16).padStart(64, "0"),
    BigInt(bytes.length).toString(16).padStart(64, "0"),
    data.padEnd(Math.ceil(data.length / 64) * 64, "0")
  ].join("")}`;
}

function abiStrings(...values: string[]): string {
  const tails = values.map((value) => {
    const bytes = new TextEncoder().encode(value);
    const data = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${BigInt(bytes.length).toString(16).padStart(64, "0")}${data.padEnd(Math.ceil(data.length / 64) * 64, "0")}`;
  });
  let offset = 32n * BigInt(values.length);
  const heads = tails.map((tail) => {
    const head = offset.toString(16).padStart(64, "0");
    offset += BigInt(tail.length / 2);
    return head;
  });
  return `0x${[...heads, ...tails].join("")}`;
}

function topic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressTopic(address: Address): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}
