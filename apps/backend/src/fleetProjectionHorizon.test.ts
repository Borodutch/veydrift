import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";
import { fleetMissionLaunchedTopic, moonCreatedTopic, type SettledPlanetEvent } from "./evm";

const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";

const owner = "0x2222222222222222222222222222222222222222" as const;
const hash = "0x" + "a".repeat(64);
const topic = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
const words = (...ns: bigint[]) => "0x" + ns.map(n => topic(n).slice(2)).join("");
afterEach(() => setSystemTime());

function fixture(moon = false, returning = false, deploy = false) {
  const db = new Database(":memory:");
  const indexer = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { database: db, runStartupBackfill: false });
  const planet = { planetId: "7", name: null, owner, galaxy: 2, system: 44, position: 9, fields: 100, temperature: 0, resources: { metal: "100", crystal: "0", deuterium: "0" }, lastSettledAt: "1000", blockNumber: "1", transactionHash: "0xp", eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000 } as SettledPlanetEvent;
  indexer.applyEvent(planet);
  if (moon) {
    indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(800n), transactionHash: "0xmoon", logIndex: "0x0", topics: [moonCreatedTopic, "0x" + owner.slice(2).padStart(64, "0"), topic(7n)], data: words(2n, 44n, 9n, 12n, 8777n) });
    db.query("INSERT OR REPLACE INTO contract_moon_resources VALUES ('7','100','0','0','1000','0xmoon','2','0')").run();
  }
  indexer.applyLog({ blockNumber: "0x3", blockTimestamp: topic(900n), transactionHash: "0xlaunch", logIndex: "0x0", topics: [fleetMissionLaunchedTopic, topic(1n), "0x" + owner.slice(2).padStart(64, "0"), topic(deploy ? 1n : 0n)], data: words(7n, 7n, 1010n, 1020n, 0n) });
  (indexer as any).upsertCanonicalFleetMission({ missionId: "1", statusId: returning ? 2 : 1, missionTypeId: deploy ? 1 : 0, status: returning ? "Returning" : "Outbound", missionType: deploy ? "Deploy" : "Transport", owner, originPlanetId: "7", targetPlanetId: "7", departureAt: "900", arrivalAt: "1010", returnAt: "1020", fuelCost: "0", cargo: { metal: "80", crystal: "0", deuterium: "0" }, randomnessRequestId: null, originIsMoon: moon, targetIsMoon: moon, ships: { smallCargo: "9" } });
  const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true });
  const get = async (path: string) => {
    const response = await handler(new Request("http://localhost" + path));
    return { status: response.status, body: await response.json() as any };
  };
  const wallet = (route: string) => get("/wallet/" + owner + "/" + route + "?planetId=7");
  const anchor = (at: number) => expect(indexer.recordResourceProjectionWatermark(String(at), String(at), hash)).toBe(true);
  return { db, indexer, get, wallet, anchor };
}

for (const moon of [false, true]) for (const kind of ["transport", "return", "deploy"] as const) {
  test(
    `${kind} on ${moon ? "moon" : "planet"} shares indexed horizon across HTTP, lifecycle, slots and activity`,
    async () => {
      setSystemTime(new Date(1030000));
      const { indexer, wallet, get, anchor } = fixture(moon, kind === "return", kind === "deploy");
      const versions = () => [indexer.responseCacheVersion(), indexer.walletResponseCacheVersion(owner), indexer.universeSystemSummaryVersion(2, 44)];
      let previousVersions: string[] | undefined;
      for (const at of [1009, 1010, 1011, 1019, 1020, 1021]) {
        anchor(at);
        if (previousVersions) versions().forEach((version, i) => expect(version).not.toBe(previousVersions![i]));
        previousVersions = versions();
        const arrived = kind !== "return" && at >= 1010;
        const terminal = kind === "deploy" ? arrived : at >= 1020;
        const credited = arrived || (kind === "return" && terminal);
        const status = terminal ? kind === "deploy" ? "Resolved" : "Returned" : arrived || kind === "return" ? "Returning" : "Outbound";
        const before = versions();
        // Reader clock drift must neither add nor retract indexed effects.
        for (const wall of [1030, 900, 5000]) {
          setSystemTime(new Date(wall * 1000));
          expect(indexer.fleetMission("1")?.status).toBe(status);
          expect((await get("/mission/1")).body.mission.status).toBe(status);
          expect(indexer.fleetSlots(owner).active).toBe(terminal ? 0 : 1);
          const state = await wallet(moon ? "moon" : "shipyard");
          expect(state.status).toBe(200);
          expect(state.body.ships.find((s: any) => s.id === 0).count).toBe(terminal ? 9 : 0);
          expect(state.body.launchableShips.find((s: any) => s.id === 0).count).toBe(terminal ? 9 : 0);
          expect(state.body.resourcesAsOfNow.metal).toBe(credited ? "180" : "100");
          if (!moon) {
            expect((await wallet("infrastructure")).body.resourcesAsOfNow.metal).toBe(credited ? "180" : "100");
            expect((await wallet("rift")).body.resources.find((r: any) => r.key === "metal").inGameBalance).toBe(credited ? "180" : "100");
          }
          // This route really is cached; re-read its warm response before moving the watermark.
          const system = await get("/universe/galaxies/2/systems/44?detail=full");
          expect(system.status).toBe(200);
          const publicPlanet = system.body.planets.find((p: any) => p.occupiedBy?.planetId === "7");
          const publicState = moon ? publicPlanet.publicMoonState : publicPlanet.publicState;
          expect(publicState.resources.metal).toBe(credited ? "180" : "100");
          expect(publicState.fleet.find((s: any) => s.id === 0).count).toBe(terminal ? 9 : 0);
          expect(await get("/universe/galaxies/2/systems/44?detail=full")).toEqual(system);
          const activity = indexer.playerActivity(owner, { page: 1, pageSize: 20, through: 6000 }).items.filter(i => i.reconciliation === "projected" && i.category === "mission");
          expect((await wallet("activity")).body.items.filter((i: any) => i.reconciliation === "projected" && i.category === "mission")).toEqual(activity);
          expect(activity.map(i => i.kind).sort()).toEqual([...(arrived ? ["mission-completed"] : []), ...(terminal && kind !== "deploy" ? ["mission-returned"] : [])].sort());
          expect(versions()).toEqual(before);
        }
      }
    }
  );
}

test.each([false, true])("missing or invalid fleet watermark fails closed, including warm effects (moon=%s)", async moon => {
  setSystemTime(new Date(1030000));
  const { indexer, db, wallet, anchor } = fixture(moon, true);
  const checkFrozen = async () => {
    expect(indexer.fleetMission("1")?.status).toBe("Returning");
    expect(indexer.fleetSlots(owner).active).toBe(1);
    expect(indexer.currentFleetResourceCredits("7", moon, 9999).metal).toBe("0");
    const state = await wallet(moon ? "moon" : "shipyard");
    if (state.status === 200) {
      expect(state.body.ships[0].count).toBe(0);
      expect([null, "100"]).toContain(state.body.resourcesAsOfNow?.metal ?? null);
    } else expect(state.status).toBe(503);
    expect(indexer.playerActivity(owner, { page: 1, pageSize: 20, through: 9999 }).items.filter(i => i.reconciliation === "projected" && i.category === "mission")).toEqual([]);
  };
  await checkFrozen();
  anchor(1020);
  expect(indexer.fleetMission("1")?.status).toBe("Returned");
  const warmVersion = indexer.responseCacheVersion();
  (indexer as any).setMetadata("transportStaleReason", "test outage");
  expect(indexer.responseCacheVersion()).not.toBe(warmVersion);
  await checkFrozen();
  db.query("DELETE FROM indexer_metadata WHERE key = 'transportStaleReason'").run();
  expect(indexer.fleetMission("1")?.status).toBe("Returned");
  // Revision mismatch and malformed metadata cannot resurrect warm credits.
  for (const [key, value] of [["resourceProjectionRevision", "-1"], ["resourceProjectionTimestamp", "broken"]]) {
    (indexer as any).setMetadata(key, value);
    await checkFrozen();
    anchor(1020);
    expect(indexer.fleetMission("1")?.status).toBe("Returned");
  }
  indexer.invalidateResourceProjectionWatermark("removedLog");
  await checkFrozen();
});

for (const moon of [false, true]) test("warm public resource routes follow watermark and invalidation (moon=" + moon + ")", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, anchor, get } = fixture(moon, true);
  (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
  const rankings = [
    "/highscores?category=total&live=1&pageSize=10",
    "/highscores?category=total&pageSize=10",
    "/highscores?category=total&live=1&page=1&pageSize=250",
    "/highscores?category=total&pageSize=10&currentWallet=" + owner
  ];
  const systems = ["/universe/galaxies/2/systems/44?detail=full", "/universe/systems?galaxy=2&center=44&radius=0&detail=full"];
  for (const stage of [1019, 1020, null]) {
    if (stage !== null) anchor(stage);
    else (indexer as any).setMetadata("transportStaleReason", "test outage");
    const metal = stage === null ? null : stage === 1020 ? "180" : "100";
    for (const route of rankings) for (let warm = 0; warm < 2; warm++) {
      const response = await get(route);
      expect(response.status).toBe(200);
      const planet = response.body.rankings.total.find((row: any) => row.wallet === owner).planets[0];
      expect((moon ? planet.moon.resourcesAsOfNow?.metal : planet.tactical.currentResources?.metal) ?? null).toBe(metal);
    }
    for (const route of systems) for (let warm = 0; warm < 2; warm++) {
      const response = await get(route);
      expect(response.status).toBe(200);
      const system = response.body.systems?.[0] ?? response.body;
      const planet = system.planets.find((row: any) => row.occupiedBy?.planetId === "7");
      expect((moon ? planet.publicMoonState : planet.publicState).resources?.metal ?? null).toBe(metal);
    }
  }
});

test("shared public cache keys never reuse fleet credits across watermark changes", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, anchor } = fixture(false, true);
  (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
  const stored = new Map<string, any>();
  const cache = {
    get(key: string) { return stored.get(key) ?? null; },
    set(key: string, value: any) { stored.set(key, value); },
    tryAcquireRefresh() { return "test-owner"; },
    releaseRefresh() {},
    async waitForFresh() { return null; }
  } as any;
  const paths = ["/highscores?live=1&pageSize=250", "/universe/systems?galaxy=2&center=44&radius=0&detail=full", "/raid-finder/debris", "/raid-finder/rifters"];
  let previousKeys = new Set<string>();
  for (const at of [1019, 1020, null]) {
    if (at !== null) anchor(at); else (indexer as any).setMetadata("transportStaleReason", "test outage");
    // A new reader instance has no local cache, forcing real shared-cache lookup.
    const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, sharedResponseCache: cache, prewarmResponseCache: false });
    for (const path of paths) {
      const response = await handler(new Request("http://localhost" + path));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, no-store");
    }
    const newKeys = new Set([...stored.keys()].filter(key => !previousKeys.has(key)));
    expect(newKeys.size).toBe(paths.length);
    for (const key of newKeys) expect(key).toContain("fleet=" + at);
    previousKeys = new Set(stored.keys());
  }
});

// Keep each independent review reproduction isolated: no preceding route warms or
// refreshes the default rankings cache on behalf of the request under test.
for (const moon of [false, true]) for (const invalidation of [false, true]) {
  test("default rankings invalidates warm fleet credits (moon=" + moon + ", invalidation=" + invalidation + ")", async () => {
    setSystemTime(new Date(1030000));
    const { indexer, get, anchor } = fixture(moon, true);
    (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
    anchor(invalidation ? 1020 : 1019);
    const path = "/highscores?live=1";
    const metal = (response: any) => {
      expect(response.status).toBe(200);
      const planet = response.body.rankings.total.find((row: any) => row.wallet === owner).planets[0];
      return (moon ? planet.moon.resourcesAsOfNow?.metal : planet.tactical.currentResources?.metal) ?? null;
    };
    expect(metal(await get(path))).toBe(invalidation ? "180" : "100");
    expect(metal(await get(path))).toBe(invalidation ? "180" : "100");
    if (invalidation) (indexer as any).setMetadata("transportStaleReason", "test outage");
    else anchor(1020);
    const expected = invalidation ? null : "180";
    expect(metal(await get(path))).toBe(expected);
    expect(metal(await get(path + "&fresh=1"))).toBe(expected);
  });
}

for (const moon of [false, true]) test("slow-clock HTTP activity keeps fleet horizon separate from queue and history windows (moon=" + moon + ")", async () => {
  setSystemTime(new Date(1009000));
  const { indexer, get, anchor } = fixture(moon);
  indexer.applyLog({
    blockNumber: "0x4", blockTimestamp: topic(1000n), transactionHash: "0xqueue", logIndex: "0x0",
    topics: [buildingStartedTopic, topic(7n), topic(0n)], data: words(1n, 1015n, 0n, 0n, 0n)
  });
  anchor(1020);
  const path = "/wallet/" + owner + "/activity";
  const projectedKinds = (items: any[]) => items.filter(item => item.reconciliation === "projected").map(item => item.kind).sort();
  const current = await get(path);
  expect(current.status).toBe(200);
  expect(current.body.through).toBe("1020");
  expect(projectedKinds(current.body.items)).toEqual(["mission-completed", "mission-returned"]);
  expect(projectedKinds((await get(path)).body.items)).toEqual(projectedKinds(current.body.items));
  expect(projectedKinds((await get(path + "?since=1010")).body.items)).toEqual(["mission-returned"]);
  expect(projectedKinds((await get(path + "?since=1020")).body.items)).toEqual([]);
  expect(projectedKinds((await get(path + "?includeProjected=false")).body.items)).toEqual([]);
  // through is an indexer history API option; the HTTP route has no through parameter.
  for (const [through, expected] of [
    [1009, []], [1010, ["mission-completed"]], [1011, ["mission-completed"]],
    [1019, ["building-completed", "mission-completed"]],
    [1020, ["building-completed", "mission-completed", "mission-returned"]],
    [1021, ["building-completed", "mission-completed", "mission-returned"]]
  ] as const) {
    const history = indexer.playerActivity(owner, { page: 1, pageSize: 20, through });
    expect(history.through).toBe(String(through));
    expect(projectedKinds(history.items)).toEqual([...expected]);
  }
  setSystemTime(new Date(1015000));
  expect(projectedKinds((await get(path)).body.items)).toEqual(["building-completed", "mission-completed", "mission-returned"]);
  // Invalidating a previously warm fleet horizon must retract fleet-only projections.
  indexer.invalidateResourceProjectionWatermark("removedLog");
  expect(projectedKinds((await get(path)).body.items)).toEqual(["building-completed"]);
  // A new anchor alone cannot clear the pending reorg repair.
  anchor(1020);
  expect(projectedKinds((await get(path)).body.items)).toEqual(["building-completed"]);
});

// Review 465f: delivery effects belong to the mission sender's activity, not
// necessarily to an owned destination. Reuse real launched planet/moon fixtures.
for (const moon of [false, true]) for (const crossOwner of [false, true]) test(
  "proven transport delivery keeps launch and sender activity consistent (moon=" + moon + ", crossOwner=" + crossOwner + ")",
  async () => {
    setSystemTime(new Date(1011000));
    const { indexer, db, anchor, get, wallet } = fixture(moon);
    const recipient = "0x3333333333333333333333333333333333333333" as const;
    const destinationOwner = crossOwner ? recipient : owner;
    indexer.applyEvent({ ...indexer.planet("7")!, planetId: "8", owner: destinationOwner, position: 10, transactionHash: "0xother" });
    if (moon) {
      indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(800n), transactionHash: "0xothermoon", logIndex: "0x0", topics: [moonCreatedTopic, "0x" + destinationOwner.slice(2).padStart(64, "0"), topic(8n)], data: words(2n, 44n, 10n, 12n, 8777n) });
      db.query("INSERT OR REPLACE INTO contract_moon_resources VALUES ('8','100','0','0','1000','0xothermoon','2','0')").run();
    }
    // Keep mission identity / launch provenance and change only its destination.
    (indexer as any).upsertCanonicalFleetMission({ missionId: "1", statusId: 1, missionTypeId: 0, status: "Outbound", missionType: "Transport", owner, originPlanetId: "7", targetPlanetId: "8", departureAt: "900", arrivalAt: "1010", returnAt: "1020", fuelCost: "0", cargo: { metal: "80", crystal: "0", deuterium: "0" }, randomnessRequestId: null, originIsMoon: moon, targetIsMoon: moon, ships: { smallCargo: "9" } });
    db.query("INSERT INTO contract_technology_levels (owner, technology_id, level) VALUES (?,4,5)").run(owner);
    const projectedIds = (items: any[]) => items.filter(item => item.reconciliation === "projected" && item.category === "mission").map(item => item.id).sort();
    for (const at of [1009, 1010, 1011, 1019, 1020, 1021]) {
      anchor(at);
      for (const wall of [1009, 1011, 1019, 1030]) {
        setSystemTime(new Date(wall * 1000));
        const arrived = at >= 1010, returned = at >= 1020;
        expect(indexer.fleetMission("1")?.status).toBe(returned ? "Returned" : arrived ? "Returning" : "Outbound");
        expect(indexer.fleetSlots(owner)).toEqual({ active: returned ? 0 : 1, limit: 6 });
        expect(indexer.currentFleetResourceCredits("8", moon).metal).toBe(arrived ? "80" : "0");
        // Unproven due arrivals/returns still block; a proven delivery never does.
        const blocked = !returned && wall >= (arrived ? 1020 : 1010);
        expect(indexer.pendingFleetSlotSettlementMissionsForWallet(owner).map(mission => mission.missionId)).toEqual(blocked ? ["1"] : []);
        const state = await wallet("shipyard");
        expect(state.status).toBe(200);
        // Proven arrival alone remains launchable; an unmined second leg cannot
        // supply launch inventory in the contract's one-visit lazy sweep.
        expect(state.body.fleetLaunchAvailable).toBe(!blocked && !returned);
        const expected = [...(arrived ? ["mission:1:arrival"] : []), ...(returned ? ["mission:1:return"] : [])];
        const activity = await wallet("activity");
        expect(activity.status).toBe(200);
        expect(projectedIds(activity.body.items)).toEqual(expected);
        expect(projectedIds(indexer.playerActivity(owner, { page: 1, pageSize: 20, through: 1009 }).items)).toEqual([]);
        expect(projectedIds((await get("/wallet/" + recipient + "/activity")).body.items)).toEqual([]);
        expect(projectedIds((await get("/wallet/" + owner + "/activity?includeProjected=false")).body.items)).toEqual([]);
        expect(projectedIds((await get("/wallet/" + owner + "/activity?since=1010")).body.items)).toEqual(returned ? ["mission:1:return"] : []);
      }
    }
    // Warm terminal effects must not hide genuine unresolved work after invalidation.
    (indexer as any).setMetadata("transportStaleReason", "test outage");
    setSystemTime(new Date(1030000));
    expect(indexer.pendingFleetSlotSettlementMissionsForWallet(owner).map(mission => mission.missionId)).toEqual(["1"]);
    expect(projectedIds((await wallet("activity")).body.items)).toEqual([]);
  }
);

for (const moon of [false, true]) test("unresolved earlier combat still blocks delivery and fleet launch (moon=" + moon + ")", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, anchor, wallet } = fixture(moon);
  (indexer as any).upsertCanonicalFleetMission({ missionId: "2", statusId: 1, missionTypeId: 2, status: "Outbound", missionType: "Attack", owner, originPlanetId: "7", targetPlanetId: "7", departureAt: "900", arrivalAt: "1005", returnAt: "1025", fuelCost: "0", cargo: { metal: "0", crystal: "0", deuterium: "0" }, randomnessRequestId: null, originIsMoon: moon, targetIsMoon: moon, ships: { smallCargo: "1" } });
  anchor(1030);
  expect(indexer.fleetMission("1")?.status).toBe("Outbound");
  expect(indexer.pendingFleetSlotSettlementMissionsForWallet(owner).map(mission => mission.missionId)).toEqual(["2", "1"]);
  expect(indexer.currentFleetResourceCredits("7", moon).metal).toBe("0");
  expect((await wallet("shipyard")).body.fleetLaunchAvailable).toBe(false);
  expect((await wallet("activity")).body.items.filter((item: any) => item.reconciliation === "projected" && item.category === "mission")).toEqual([]);
});

// #65: a scalar refresh is not composition proof, even on a peaceful return.
test("cached inventory retracts unproven six-cargo return across all current surfaces", async () => {
  setSystemTime(new Date(1030000));
  const { db, indexer, wallet, get, anchor } = fixture(false, true);
  const row = db.query("SELECT event_json FROM contract_fleet_missions WHERE mission_id = '1'").get() as { event_json: string };
  const snapshot = JSON.parse(row.event_json);
  snapshot.ships = { largeCargo: "6" };
  (indexer as any).upsertCanonicalFleetMission(snapshot);
  anchor(1020);
  const count = async () => {
    const shipyard = (await wallet("shipyard")).body;
    const detail = (await get("/universe/galaxies/2/systems/44?detail=full")).body.planets.find((p: any) => p.occupiedBy?.planetId === "7").publicState;
    expect(detail.fleet.find((s: any) => s.id === 4).count).toBe(shipyard.launchableShips.find((s: any) => s.id === 4).count);
    return shipyard.ships.find((s: any) => s.id === 4).count;
  };
  expect(await count()).toBe(6);
  expect(await count()).toBe(6);
  const { ships: _ships, ...scalar } = snapshot;
  (indexer as any).upsertCanonicalFleetMission(scalar);
  // Canonical updates normally invalidate the persisted state version. Use that
  // production mutation boundary rather than a fresh-query cache bypass.
  (indexer as any).touch();
  (indexer as any).touchMissionReadModel();
  anchor(1020);
  expect(await count()).toBe(0);
  expect(indexer.fleetSlots(owner).active).toBe(1);
});

test("Supply preserves unavailable current resources rather than reviving a raw balance", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, wallet, anchor } = fixture();
  const source = indexer.planet("7")!;
  indexer.applyEvent({ ...source, planetId: "8", position: 10, transactionHash: "0xsource8" });
  anchor(1020);
  indexer.hasPendingPlanetResources = id => id === "8";
  for (let warm = 0; warm < 2; warm++) {
    const supply = await wallet("supply-sources");
    expect(supply.status).toBe(200);
    expect(supply.body.sources.find((s: any) => s.planetId === "8").resources).toBeNull();
    const shipyard = await getSource();
    expect(shipyard.resourcesAsOfNow).toBeNull();
  }
  async function getSource() {
    const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false });
    return (await handler(new Request("http://localhost/wallet/" + owner + "/shipyard?planetId=8"))).json() as Promise<any>;
  }
});

test.each([false, true])("two-leg projected Transport return cannot promise first-source launch inventory (moon=%s)", async moon => {
  setSystemTime(new Date(1030000));
  const { indexer, wallet, anchor } = fixture(moon);
  anchor(1020);
  const state = (await wallet(moon ? "moon" : "shipyard")).body;
  expect(state.ships[0].count).toBe(9);
  expect(state.launchableShips[0].count).toBe(9);
  expect(state.fleetSlots.active).toBe(0);
  expect(state.fleetLaunchAvailable).toBe(false);
  expect((await wallet("supply-sources")).body.fleetLaunchAvailable).toBe(false);
});

test("batch slot guard retains pre-sweep count without changing effective slots", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, wallet, anchor } = fixture(false, true);
  anchor(1020);
  expect(indexer.fleetSlots(owner)).toEqual({ active: 0, limit: 1 });
  expect(indexer.batchFleetSlots(owner)).toEqual({ active: 1, limit: 1 });
  const supply = (await wallet("supply-sources")).body;
  expect(supply.fleetSlots).toEqual({ active: 0, limit: 1 });
  expect(supply.batchFleetSlots).toEqual({ active: 1, limit: 1 });
});
for (const moon of [false, true]) test("unknown body balances retain canonical history and unit intel (moon=" + moon + ")", async () => {
  setSystemTime(new Date(1030000));
  const { indexer, db, get, wallet, anchor } = fixture(moon, true);
  const table = moon ? "contract_moon_ship_counts" : "contract_ship_counts";
  db.query("INSERT INTO " + table + " (planet_id, ship_id, count) VALUES ('7', 0, 3)").run();
  (indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
  anchor(1019);
  const assertUnknown = async () => {
    const publicResponse = await get("/universe/galaxies/2/systems/44?detail=full");
    expect(publicResponse.status).toBe(200);
    const publicPlanet = publicResponse.body.planets.find((p: any) => p.occupiedBy?.planetId === "7");
    const publicState = moon ? publicPlanet.publicMoonState : publicPlanet.publicState;
    expect(publicState.resources).toBeNull();
    expect(publicState.fleet.find((s: any) => s.id === 0).count).toBe(3);
    const ranking = await get("/highscores?live=1&pageSize=10");
    expect(ranking.status).toBe(200);
    const planet = ranking.body.rankings.total.find((row: any) => row.wallet === owner).planets[0];
    if (moon) expect(planet.moon.resourcesAsOfNow).toBeNull();
    else {
      expect(planet.tactical.currentResources).toBeNull();
      expect(planet.tactical.raidableResources).toBeNull();
      expect(planet.tactical.raidableResourceTotal).toBeNull();
      expect(planet.tactical.grossResourceTotal).toBeNull();
      expect(planet.tactical.ships.count).toBe(3);
    }
    const detail = await get("/mission/1");
    expect(detail.status).toBe(200);
    expect(detail.body.targetCombatIntel.combatShips.count).toBe(3);
  };
  const warm = await get("/universe/galaxies/2/systems/44?detail=full");
  const warmPlanet = warm.body.planets.find((p: any) => p.occupiedBy?.planetId === "7");
  expect((moon ? warmPlanet.publicMoonState : warmPlanet.publicState).resources.metal).toBe("100");
  await get("/highscores?live=1&pageSize=10");
  (indexer as any).setMetadata("transportStaleReason", "test outage");
  await assertUnknown();
  await assertUnknown();
  // Current uncertainty never rewrites the last canonical resource snapshot.
  expect(moon ? indexer.moonResources("7").metal : indexer.planet("7")!.resources.metal).toBe("100");
  db.query("DELETE FROM indexer_metadata WHERE key = 'transportStaleReason'").run();
  if (moon) {
    db.query("DELETE FROM contract_moon_resources WHERE planet_id = '7'").run();
  } else {
    // Identity exists but its first resource snapshot is not indexed yet.
    const pending = { ...indexer.planet("7")!, lastSettledAt: "0", resources: { metal: "0", crystal: "0", deuterium: "0" } };
    db.query("UPDATE contract_planets SET event_json = ? WHERE planet_id = '7'").run(JSON.stringify(pending));
    db.query("DELETE FROM contract_planet_resources WHERE planet_id = '7'").run();
    expect(indexer.hasPendingPlanetResources("7")).toBe(true);
  }
  // Model the writer committing the body change before publishing its safe anchor.
  (indexer as any).advanceIndexedRevision();
  (indexer as any).touch();
  expect(indexer.recordResourceProjectionWatermark("1020", "1019", hash)).toBe(true);
  expect(indexer.resourceProjectionContext().safeToProject).toBe(true);
  await assertUnknown();
  const overview = await wallet("overview");
  expect(overview.status).toBe(200);
  const owned = overview.body.planetsResponse.planets.find((p: any) => p.planetId === "7");
  expect(moon ? owned.moon.resourcesAsOfNow : owned.resourcesAsOfNow).toBeNull();
  if (!moon) {
    expect(overview.body.settlement.planet.resourcesAsOfNow).toBeNull();
    expect(owned.tactical.currentResources).toBeNull();
    expect(owned.tactical.ships.count).toBe(3);
  }
});
