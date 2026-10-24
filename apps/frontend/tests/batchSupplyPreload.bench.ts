// Run from apps/frontend: bun tests/batchSupplyPreload.bench.ts
// In-process real indexed HTTP handler, not a live-network latency benchmark.
import { SettlementIndexer } from "../../backend/src/indexer";
import { createRequestHandler } from "../../backend/src/server";
import type { SettledPlanetEvent } from "../../backend/src/evm";
import { BackendDataStore } from "../src/backendDataStore";

const owner = "0x2222222222222222222222222222222222222222";
for (const count of [9, 32]) {
  const indexer = new SettlementIndexer({ async listSettledPlanetEvents() { return []; }, async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; } }, 1n, { runStartupBackfill: false });
  for (let i = 0; i <= count; i++) indexer.applyEvent({ planetId: String(i + 1), name: "Source " + i, owner, galaxy: 1, system: 1 + Math.floor(i / 15), position: 1 + i % 15, fields: 100, temperature: 0, resources: {metal:"1121802",crystal:"848981",deuterium:"53067"}, lastSettledAt: String(Math.floor(Date.now()/1000)), blockNumber: "1", transactionHash: "0xplanet" + i, eventName: "PlanetStarted", metalMultiplierBps:10000, crystalMultiplierBps:10000, deuteriumMultiplierBps:10000 } as SettledPlanetEvent);
  const handler = createRequestHandler({indexer, role:"reader", enableResponseCache:true});
  const oldFetch = globalThis.fetch;
  let requests = 0, bytes = 0;
  globalThis.fetch = (async input => { requests++; const response = await handler(new Request(String(input))); bytes += (await response.clone().arrayBuffer()).byteLength; return response; }) as typeof fetch;
  const store = new BackendDataStore("http://localhost");
  store.setContext(owner,"1","8453");
  try {
    const times: number[] = [];
    for (let i=0; i<4; i++) { const start=performance.now(); await store.queries.supplySources(owner,"1",{fresh:true}).read(); times.push(performance.now()-start); }
    const baselineRequests = requests, baselineBytes = bytes;
    const start = performance.now();
    const query=store.queries.supplySources(owner,"1");
    if (!store.isFresh(query.key)) await query.read();
    const readyMs=performance.now()-start;
    console.log(JSON.stringify({sources:count,baselineColdMs:times[0],baselineWarmMs:times.slice(1),bytesPerResponse:baselineBytes/baselineRequests,baselineOpenRequests:1,preloadRequests:1,readyOpenMs:readyMs,readyOpenRequests:requests-baselineRequests,readyOpenBytes:bytes-baselineBytes,maxClickRequests:0}));
  } finally {store.dispose();globalThis.fetch=oldFetch;}
}
