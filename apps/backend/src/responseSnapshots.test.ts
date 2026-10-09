import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";
import { SharedResponseCache } from "./sharedResponseCache";
import { fleetMissionLaunchedTopic, fleetMissionBodiesTopic, moonCreatedTopic, moonDestructionFinalizedTopic, type SettledPlanetEvent } from "./evm";

const owner = "0x2222222222222222222222222222222222222222" as const;
const topic = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
const words = (...ns: bigint[]) => "0x" + ns.map(n => topic(n).slice(2)).join("");
const addressTopic = "0x" + owner.slice(2).padStart(64, "0");
const reader = { async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } };
const shipTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const moonShipTopic = "0xbd55c2b529f64f3a888d38432d6c54b03515f3de3f0114255cb36620f5df1257";
const battleTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";

function seed(indexer: SettlementIndexer, moon = false) {
  indexer.applyEvent({ planetId: "7", name: null, owner, galaxy: 2, system: 44, position: 9, fields: 100, temperature: 0,
    resources: { metal: "100", crystal: "0", deuterium: "0" }, lastSettledAt: "1000", blockNumber: "1",
    transactionHash: "0xp", eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000,
    deuteriumMultiplierBps: 10000 } as SettledPlanetEvent);
  const log = (block: number, topics: string[], data: string) => indexer.applyLog({ blockNumber: topic(BigInt(block)),
    blockTimestamp: topic(BigInt(900 + block)), transactionHash: "0xseed" + block, logIndex: "0x0", topics, data });
  log(2, [shipTopic, topic(7n), topic(1n)], words(12n));
  if (moon) {
    log(3, [moonCreatedTopic, addressTopic, topic(7n)], words(2n, 44n, 9n, 12n, 8777n));
    log(4, [moonShipTopic, topic(7n), topic(3n)], words(5n));
  }
  log(5, [fleetMissionLaunchedTopic, topic(1n), addressTopic, topic(3n)], words(7n, 7n, 1010n, 1020n, 0n));
  if (moon) log(6, [fleetMissionBodiesTopic, topic(1n)], words(0n, 1n));
  log(10, ["0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d", topic(1n)],
    words(6n, ...Array.from({ length: 13 }, () => 0n)));
  log(7, [battleTopic, topic(1n), addressTopic, topic(7n)], words(1n, 2n, 12345n, 0n, 0n, 0n));
  if (moon) log(8, [moonShipTopic, topic(7n), topic(3n)], words(2n));
  indexer.materializeBattleReportReadModelsForWorker(["1"], "ingest");
  return log;
}

const get = async (handler: ReturnType<typeof createRequestHandler>, path: string) => {
  const response = await handler(new Request("http://localhost" + path));
  expect(response.status).toBe(200);
  return await response.json() as any;
};

test("reported moon defender state uses current moon units, preserving historical battle and manifest after destruction", async () => {
  const indexer = new SettlementIndexer(reader, 1n);
  const log = seed(indexer, true);
  const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, sharedResponseCache: null });
  const before = await get(handler, "/mission/1");
  expect(before.mission.ships.smallCargo).toBe("6");
  expect(before.mission.targetIsMoon).toBe(true);
  expect(before.battleReport.targetIsMoon).toBe(true);
  expect(before.battleReport.defenderSnapshot.fleet).toEqual([{ id: 3, count: 5 }]);
  expect(before.defenderPlanetState).toEqual({ fleet: [{ id: 3, count: 2 }], defenses: [], stationedDefenders: [] });
  expect(indexer.displayedUnitCounts("7", "ship")).toContainEqual({ id: 1, count: 12 });
  log(9, [moonDestructionFinalizedTopic, topic(1n), topic(1n), topic(7n)], words(1n, 0n, 123n));
  const after = await get(handler, "/mission/1");
  expect(after.defenderPlanetState).toBeNull();
  expect(after.battleReport.defenderSnapshot).toEqual(before.battleReport.defenderSnapshot);
  expect(after.mission.ships).toEqual(before.mission.ships);
});

function walFixture() {
  const dir = mkdtempSync(join(tmpdir(), "response-snapshot-"));
  const path = join(dir, "index.sqlite");
  const writer = new SettlementIndexer(reader, 1n, { databasePath: path });
  seed(writer);
  const indexer = new SettlementIndexer(reader, 1n, { databasePath: path, readOnly: true });
  const db = new Database(path);
  const commit = () => db.transaction(() => {
    db.query("UPDATE contract_ship_counts SET count = 3 WHERE planet_id = '7' AND ship_id = 1").run();
    db.query("UPDATE contract_fleet_missions SET status_id = 4 WHERE mission_id = '1'").run();
    db.query("UPDATE indexer_metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'indexedStateVersion'").run();
  })();
  return { dir, indexer, db, commit };
}

test("mission detail holds one WAL snapshot across mission, report and current defender reads", async () => {
  const { dir, indexer, db, commit } = walFixture();
  try {
    const original = indexer.battleReport.bind(indexer);
    let interleaved = false;
    indexer.battleReport = (...args) => {
      const report = original(...args);
      if (!interleaved) { interleaved = true; commit(); }
      return report;
    };
    const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, sharedResponseCache: null });
    const before = await get(handler, "/mission/1");
    expect(interleaved).toBe(true);
    expect(before.mission.status).not.toBe("Returned");
    expect(before.defenderPlanetState.fleet).toEqual([{ id: 1, count: 12 }]);
    const after = await get(handler, "/mission/1");
    expect(after.mission.status).toBe("Returned");
    expect(after.defenderPlanetState.fleet).toEqual([{ id: 1, count: 3 }]);
    expect(after.mission.ships).toEqual(before.mission.ships);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const path of ["/universe/galaxies/2/systems/44?detail=full", "/universe/systems?galaxy=2&center=44&radius=1&detail=full"]) {
  for (const enableResponseCache of [false, true]) test(
    "full system WAL snapshot includes version and all inventories: " + path + " cache=" + enableResponseCache, async () => {
      const { dir, indexer, db, commit } = walFixture();
      const cachePath = join(dir, "http.sqlite");
      const sharedResponseCache = new SharedResponseCache(cachePath);
      try {
        const oldVersion = indexer.responseCacheVersion();
        const original = indexer.settledPlanetsInSystem.bind(indexer);
        let interleaved = false;
        indexer.settledPlanetsInSystem = (...args) => {
          const planets = original(...args);
          if (!interleaved && planets.length) { interleaved = true; commit(); }
          return planets;
        };
        const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache, sharedResponseCache });
        const units = (body: any) => (body.systems ?? [body]).flatMap((s: any) => s.planets)
          .find((p: any) => p.occupiedBy?.planetId === "7").publicState.fleet;
        const before = await get(handler, path);
        expect(interleaved).toBe(true);
        expect(units(before)).toContainEqual({ id: 1, count: 12 });
        expect(indexer.responseCacheVersion()).not.toBe(oldVersion);
        if (enableResponseCache) {
          const cacheDb = new Database(cachePath, { readonly: true });
          const rows = cacheDb.query("SELECT cache_key, body FROM response_cache").all() as Array<{ cache_key: string; body: Uint8Array }>;
          expect(rows).toHaveLength(1);
          expect(rows[0]!.cache_key).toContain(oldVersion);
          expect(units(JSON.parse(new TextDecoder().decode(rows[0]!.body)))).toContainEqual({ id: 1, count: 12 });
          cacheDb.close();
        }
        const after = await get(handler, path);
        expect(units(after)).toContainEqual({ id: 1, count: 3 });
        expect(await get(handler, path)).toEqual(after);
        const peer = createRequestHandler({ indexer, role: "reader", enableResponseCache, sharedResponseCache });
        expect(await get(peer, path)).toEqual(after);
      } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
    }
  );
}

test("system HTTP refresh reselects the version after waiting for cache ownership", async () => {
  const { dir, indexer, db, commit } = walFixture();
  const cachePath = join(dir, "http.sqlite");
  const sharedResponseCache = new SharedResponseCache(cachePath);
  try {
    const oldVersion = indexer.responseCacheVersion();
    const acquire = sharedResponseCache.tryAcquireRefresh.bind(sharedResponseCache);
    let interleaved = false;
    sharedResponseCache.tryAcquireRefresh = (...args) => {
      if (!interleaved) { interleaved = true; commit(); }
      return acquire(...args);
    };
    const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, sharedResponseCache });
    const body = await get(handler, "/universe/galaxies/2/systems/44?detail=full");
    expect(body.planets.find((p: any) => p.occupiedBy?.planetId === "7").publicState.fleet)
      .toContainEqual({ id: 1, count: 3 });
    const cacheDb = new Database(cachePath, { readonly: true });
    const rows = cacheDb.query("SELECT cache_key FROM response_cache").all() as Array<{ cache_key: string }>;
    expect(rows).toHaveLength(1);
    expect(indexer.responseCacheVersion()).not.toBe(oldVersion);
    expect(rows[0]!.cache_key.endsWith(indexer.responseCacheVersion())).toBe(true);
    cacheDb.close();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const query of ["?live=1&pageSize=10", "?pageSize=10", "?live=1&pageSize=10&currentWallet=" + owner]) {
  test("rankings reselect cache version after shared ownership " + query, async () => {
    const { dir, indexer, db, commit } = walFixture();
    const cachePath = join(dir, "rank-http.sqlite");
    const sharedResponseCache = new SharedResponseCache(cachePath);
    try {
      db.query("INSERT OR REPLACE INTO indexer_metadata (key,value) VALUES ('lastReconciledAt',?)").run(new Date().toISOString());
      const oldVersion = indexer.responseCacheVersion();
      const acquire = sharedResponseCache.tryAcquireRefresh.bind(sharedResponseCache);
      let changed = false;
      sharedResponseCache.tryAcquireRefresh = (...args) => {
        if (!changed) { changed = true; commit(); }
        return acquire(...args);
      };
      const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false, sharedResponseCache });
      const body = await get(handler, "/highscores" + query);
      expect(body.rankings.total.find((r: any) => r.wallet === owner).planets[0].tactical.ships.count).toBe(3);
      const cacheDb = new Database(cachePath, { readonly: true });
      const rows = cacheDb.query("SELECT cache_key FROM response_cache").all() as Array<{ cache_key: string }>;
      expect(rows).toHaveLength(1);
      expect(indexer.responseCacheVersion()).not.toBe(oldVersion);
      expect(rows[0]!.cache_key).toContain("indexer=" + indexer.responseCacheVersion());
      cacheDb.close();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test("rankings retain one WAL view across leaderboard and ship-bearing rows", async () => {
  const { dir, indexer, db, commit } = walFixture();
  try {
    db.query("INSERT OR REPLACE INTO indexer_metadata (key,value) VALUES ('lastReconciledAt',?)").run(new Date().toISOString());
    const original = indexer.highscoreLeaderboard.bind(indexer);
    let changed = false;
    indexer.highscoreLeaderboard = () => {
      const leaderboard = original();
      if (!changed) { changed = true; commit(); }
      return leaderboard;
    };
    const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false, sharedResponseCache: null });
    const count = (body: any) => body.rankings.total.find((r: any) => r.wallet === owner).planets[0].tactical.ships.count;
    expect(count(await get(handler, "/highscores?live=1&pageSize=10"))).toBe(12);
    expect(count(await get(handler, "/highscores?live=1&pageSize=10"))).toBe(3);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
