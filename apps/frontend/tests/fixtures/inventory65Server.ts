// Local, in-memory HTTP stack for mounted invalidation proof. No RPC or wallet.
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "../../../backend/src/indexer";
import { createRequestHandler } from "../../../backend/src/server";
import { moonCreatedTopic, type SettledPlanetEvent } from "../../../backend/src/evm";
const owner = "0x2222222222222222222222222222222222222222";
const resources = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const topic = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
const db = new Database(":memory:");
const indexer = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { database: db, runStartupBackfill: false });
for (const id of [1, 99]) {
  indexer.applyEvent({ planetId: String(id), name: "Origin " + id, owner, galaxy: 1, system: 1, position: id === 99 ? 1 : 2, fields: 100, temperature: 0, resources, lastSettledAt: "1000", blockNumber: "1", transactionHash: "0xplanet" + id, eventName: "PlanetStarted", metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000 } as SettledPlanetEvent);
  indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xships" + id, logIndex: "0x0", topics: ["0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf", topic(BigInt(id)), topic(4n)], data: topic(6n) });
}
indexer.applyLog({ blockNumber: "0x2", blockTimestamp: topic(1000n), transactionHash: "0xmoon", logIndex: "0x0", topics: [moonCreatedTopic, "0x" + owner.slice(2).padStart(64, "0"), topic(99n)], data: "0x" + [1n, 1n, 1n, 12n, 8777n].map(n => topic(n).slice(2)).join("") });
db.query("INSERT INTO contract_moon_resources VALUES ('99','1000000','1000000','1000000','1000','0xmoon','2','0')").run();
db.query("INSERT INTO contract_moon_ship_counts VALUES ('99',4,6)").run();
(indexer as any).setMetadata("lastReconciledAt", new Date().toISOString());
indexer.recordResourceProjectionWatermark("3", "1000", "0x" + "a".repeat(64));
const handler = createRequestHandler({ indexer, role: "reader", enableResponseCache: true, prewarmResponseCache: false });
Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[2]), async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/__fixture/")) {
    if (path === "/__fixture/invalidate") indexer.invalidateResourceProjectionWatermark("removedLog");
    if (path === "/__fixture/recover") {
      const reason = indexer.snapshot().pendingReconciliationReason;
      if (reason) indexer.clearPendingReconciliationReason(reason);
      indexer.recordResourceProjectionWatermark("3", "1000", "0x" + "b".repeat(64));
    }
    return Response.json({ projection: indexer.resourceProjectionContext(), ships: indexer.shipRows("99").find(s => s.id === 4)?.count }, { headers: { "access-control-allow-origin": "*" } });
  }
  return handler(request);
} });
