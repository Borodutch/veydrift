import { expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { planetsFromSystemResponse, type ApiSystemResponse } from "./data/mockUniverse";
import { publicPlanetDataRows, publicPlanetStatusRows } from "./components/PlanetDetail";
import { formatMoonChanceLabel } from "./components/GalaxyView";

test("moon terminal events refresh a subscribed full system and Planet status without focus or a user action", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const listeners = new Map<string, (event: MessageEvent) => void>();
  class EventSourceStub {
    onerror: (() => void) | null = null;
    addEventListener(name: string, listener: (event: MessageEvent) => void) { listeners.set(name, listener); }
    close() {}
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { EventSource: EventSourceStub } });
  let status: "pending" | "not_created" | "created" = "pending";
  let reads = 0;
  const response = (): ApiSystemResponse => ({ galaxy: 6, system: 3, planets: [{
    key: "6:3:1", galaxy: 6, system: 3, position: 1, fields: 211, temperature: 30,
    metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000,
    occupiedBy: { planetId: "179", owner: "0x2222222222222222222222222222222222222222" },
    debrisField: { metal: "90000", crystal: "10000" }, hasMoon: status === "created",
    moonChance: { battleId: "86875", targetPlanetId: "179", outcomeId: "8", status, chanceBps: 2000,
      ...(status === "created" ? { moonDiameterKm: 8777 } : {}) }
  }] });
  globalThis.fetch = (async () => { reads++; return Response.json(response()); }) as unknown as typeof fetch;
  const store = new BackendDataStore("https://moon-status.test");
  const query = store.queries.system<ApiSystemResponse>(6, 3, { detail: "full" });
  const unsubscribe = store.subscribeKey(query.key, () => {});
  const release = store.connectChainEvents("0xnon-owner", { debounceMs: 0 });
  try {
    await store.system(6, 3, { detail: "full" });
    const planet = () => planetsFromSystemResponse(store.snapshot<ApiSystemResponse>(query.key)!.data!)[0]!;
    expect(publicPlanetStatusRows(planet())).toContainEqual(expect.objectContaining({ value: "Moon chance 20% pending" }));
    for (const terminal of ["not_created", "created"] as const) {
      const before = reads;
      status = terminal;
      listeners.get("chain-event")!({ data: JSON.stringify({ kind: "chain-event", blockNumber: "100", transactionHash: "0xfinalized" }) } as MessageEvent);
      for (let attempt = 0; attempt < 50 && planet().moonChance?.status !== terminal; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      expect(reads).toBe(before + 1);
      expect(planet().moonChance?.status).toBe(terminal);
      const label = terminal === "created" ? "Moon: Moon" : "Moon chance missed";
      expect(publicPlanetDataRows(planet())).toContainEqual(expect.objectContaining({ value: label }));
      expect(publicPlanetDataRows(planet()).some(row => row.value.includes("pending"))).toBe(false);
      expect(formatMoonChanceLabel(planet().moonChance)).toBe(terminal === "created" ? "Moon created 8,777 km" : "Moon chance 20% missed");
      expect(planet().debrisField).toMatchObject({ metal: 90000, crystal: 10000 });
      expect(planet().hasMoon).toBe(terminal === "created");
    }
  } finally {
    release(); unsubscribe(); store.dispose(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
