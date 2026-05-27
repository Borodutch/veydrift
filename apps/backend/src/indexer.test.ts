import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { Address, DebrisFieldEvent, MoonChanceReportEvent, SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222" as Address;
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
        indexedPlanets: 1
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
});
