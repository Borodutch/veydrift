import { activeProductionQueue } from "../src/productionQueueFallback";
import { productionPlanContext } from "../src/productionBuildPlanContext";
import { expect, test } from "bun:test";
import { defenseProductionItems } from "../src/components/DefensePage";
import { defenseCatalog } from "../src/playableMvp";
import { prepareMissionBattleForecast } from "../src/components/MissionBattleForecastPanel";
import { BackendDataStore } from "../src/backendDataStore";
import type { ChainDefenseState, MissionDetailResponse, QueueStateResponse } from "../src/walletFlow";
const cost = { metal: "1", crystal: "1", deuterium: "1" };
const queue = (id: number, quantity: number): QueueStateResponse => ({ active: true, kind: "defense", itemId: id, quantity, readyAt: "9999999999", cost });
const state = (counts: Record<string, number>, remaining: QueueStateResponse | null = null): ChainDefenseState => ({ wallet: "0xabc", homePlanetId: "7", resources: cost, shipyardLevel: 12, naniteLevel: 1, missileSiloLevel: 2, technologyLevels: {}, defenses: defenseCatalog.map(d => ({ id: d.id, count: counts[d.key] ?? 0, cost })), queue: remaining, unsettledQueue: queue(0, 999) });
function items(s: ChainDefenseState) { return defenseProductionItems({ actionPending: false, canTransact: true, defenseState: s, productionAvailable: true, quantities: {}, queue: s.queue, resources: { metal: 999999, crystal: 999999, deuterium: 999999 } }); }
test("current deployed inventory is never re-credited from canonical unsettled batches", () => {
 for (const s of [state({ rocketLauncher: 101 }), state({ rocketLauncher: 78 }, queue(0, 23)), state({ rocketLauncher: 4 })]) {
  const row = items(s).find(d => d.key === "rocketLauncher")!;
  expect(row.countValue).toBe(s.defenses[0]!.count);
  expect(row.queued).toBe(s.queue?.quantity ?? 0);
  expect(row).not.toHaveProperty("pendingSettlement");
 }
});
test("effective dome and missile counts reserve capacity exactly once", () => {
 const dome = items(state({ smallShieldDome: 1 })).find(d => d.key === "smallShieldDome")!;
 expect(dome.maxQuantity).toBe(0);
 const missileId = defenseCatalog.find(d => d.key === "antiBallisticMissile")!.id;
 const rows = items(state({ antiBallisticMissile: 4, interplanetaryMissile: 3 }, queue(missileId, 2)));
 expect(rows.find(d => d.key === "antiBallisticMissile")!.maxQuantity).toBe(8);
 expect(rows.find(d => d.key === "interplanetaryMissile")!.maxQuantity).toBe(4);
});
test("forecast reasons are fail-closed and cannot expose unknown service diagnostics", () => {
 const now = 1790000000000;
 for (const reason of ["Public battle state is delayed or reconciling until indexing catches up", "Stationed-defense storage order", "arbitrary diagnostic SQL stack"]) {
  const detail = { mission: { status: "Outbound", missionType: "Attack" }, battleForecast: { asOf: String(now / 1000), arrivalAt: String(now / 1000 + 60), unavailableReason: reason, participants: [], stationedDefenders: [] } } as unknown as MissionDetailResponse;
  const result = prepareMissionBattleForecast(detail, now);
  expect(result?.status).toBe("complete");
  if (result?.status === "complete") { expect(result.forecast.kind).toBe("uncertain"); expect(result.forecast.detail).toBe("Battle intel is incomplete. The outcome cannot be estimated yet; check back shortly."); }
 }
});
test("readiness HTTP failures have a stable safe error even with an unknown diagnostic", async () => {
 const original = globalThis.fetch;
 globalThis.fetch = (async () => Response.json({ reasons: ["SQL internal reveal map unknown"] }, { status: 503 })) as typeof fetch;
 try { await expect(new BackendDataStore("https://api.test").randomnessReadiness()).rejects.toThrow("Attacks are temporarily unavailable. Please try again shortly."); }
 finally { globalThis.fetch = original; }
});

test("batch plan uses the same effective inventory and remaining queue as catalog limits", () => {
 const defense = state({ antiBallisticMissile: 4 }, queue(8, 2));
 const context = productionPlanContext("planet", { defense, shipyard: null, infrastructure: null, moon: null });
 expect(context.defenseCounts).toEqual(defense.defenses);
 expect(context.capacityQueue).toEqual(defense.queue);
 expect(context.capacityQueue).not.toEqual(defense.unsettledQueue);
});

test("effective missile count pairs with authoritative empty or partial queue, never stale overview", () => {
 const missileId = defenseCatalog.find(d => d.key === "interplanetaryMissile")!.id;
 for (const remaining of [null, queue(missileId, 1)]) {
  const s = { ...state({ interplanetaryMissile: 17 }, remaining), missileSiloLevel: 4 };
  const selected = activeProductionQueue(s.queue, queue(missileId, 2), "defense");
  const row = defenseProductionItems({ actionPending: false, canTransact: true, defenseState: s, productionAvailable: true, quantities: { interplanetaryMissile: 2 }, queue: selected, resources: { metal: 9999999, crystal: 9999999, deuterium: 9999999 } }).find(d => d.key === "interplanetaryMissile")!;
  expect(row.maxQuantity).toBe(remaining ? 2 : 3);
  expect(row.queued).toBe(remaining ? 1 : 0);
  expect(productionPlanContext("planet", { defense: s, shipyard: null, infrastructure: null, moon: null }).capacityQueue).toEqual(remaining);
 }
});
