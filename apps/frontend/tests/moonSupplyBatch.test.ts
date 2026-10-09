import { expect, test } from "bun:test";
import { toFunctionSelector } from "viem";
import { buildBatchSupplyPlan, maximumBatchSupplyResource, suggestBatchSupplySourceIds, type BatchSupplySource } from "../src/batchSupplyPlanner";
import { launchBatchSupplyTransaction, prepareBatchSupplyConfirmation } from "../src/PlayableMvpApp";
import { batchSupplyMissionLimitError, batchSupplySourceLimitReason } from "../src/components/BatchSupplyModal";
import { moonSupplyBatchMatches } from "../src/moonSupplyBatch";
import { defaultVeydriftChainForLocation, encodeLaunchBodyDeployBatchCall, encodeLaunchBodyTransportBatchCall, encodeLaunchTransportBatchCall, type Eip1193Provider, type ManagedPlanetResponse } from "../src/walletFlow";
import type { BackendDataStore } from "../src/backendDataStore";
const account = "0x1111111111111111111111111111111111111111", contract = "0x2222222222222222222222222222222222222222";
const target = { planetId: "1", galaxy: 1, system: 1, position: 1 } as ManagedPlanetResponse;
const versionSelector = toFunctionSelector("moonSupplyBatchVersion()");
const one = "0x" + "0".repeat(63) + "1";
function sources(count: number): BatchSupplySource[] { return Array.from({ length: count }, (_, i) => ({ planetId: String(i + 1), label: "Source " + i, coordinates: { galaxy: 1, system: 1 + Math.floor(i / 15), position: i % 15 + 1 }, ships: { largeCargo: 1 }, resources: { metal: 1000, crystal: 0, deuterium: 10000 }, driveLevels: {} })); }
function plan(count: number, mission: "transport" | "deploy" = "transport") { const src = sources(count); return buildBatchSupplyPlan({ sources: src, targetCoordinates: target, targetIsMoon: true, selectedPlanetIds: new Set(src.map(s => s.planetId)), requested: { metal: count * 1000 }, mission }); }
function wallet(options: { version?: string; revert?: boolean; gas?: string; changedChain?: boolean } = {}) {
  const calls: Array<{ method: string; params?: unknown[] }> = []; let chainReads = 0;
  const provider: Eip1193Provider = { request: async <T>(call: { method: string; params?: unknown[] }) => {
    calls.push(call);
    if (call.method === "eth_chainId") return (options.changedChain && ++chainReads > 1 ? "0x1" : defaultVeydriftChainForLocation().chainIdHex) as T;
    if (call.method === "eth_call") {
      if ((call.params?.[0] as { data: string }).data === versionSelector) return (options.version ?? one) as T;
      if (options.revert) throw { code: 3, data: "0xdfa1a408", message: "execution reverted" };
      return "0x" as T;
    }
    if (call.method === "eth_estimateGas") return (options.gas ?? "0xf4240") as T;
    if (call.method === "eth_sendTransaction") return "0xfixture" as T;
    throw new Error(call.method);
  } };
  return { provider, calls, sends: () => calls.filter(c => c.method === "eth_sendTransaction") };
}
for (const mission of ["transport", "deploy"] as const) for (const count of [2, 15]) test(mission + " atomic moon Supply " + count + " origins including parent", async () => {
  const draft = plan(count, mission); expect(draft.orders).toHaveLength(count); expect(draft.missing.metal).toBe(0);
  expect(draft.orders[0]!.originPlanetId).toBe(target.planetId);
  const params = { targetPlanetId: target.planetId, orders: draft.orders.map(o => ({ ...o, speedPercent: 100 })) };
  const encode = mission === "deploy" ? encodeLaunchBodyDeployBatchCall : encodeLaunchBodyTransportBatchCall;
  const data = encode(params);
  expect(data.slice(10)).toBe(encodeLaunchTransportBatchCall(params).slice(10));
  expect(data.slice(0, 10)).toBe(toFunctionSelector("launchBody" + (mission === "deploy" ? "Deploy" : "Transport") + "Batch(uint256,(uint256,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16)[])"));
  const w = wallet(); await launchBatchSupplyTransaction(w.provider, account, contract, target, draft.orders, true, mission);
  expect(w.sends()).toHaveLength(1);
  expect(w.calls.filter(c => c.method === "eth_call").map(c => (c.params?.[0] as { data: string }).data)).toEqual([versionSelector, data]);
  expect((w.sends()[0]!.params?.[0] as { data: string }).data).toBe(data);
  expect(w.calls.filter(c => c.method === "eth_estimateGas")).toHaveLength(1);
});
for (const version of ["0x", "0x1", "0x" + "0".repeat(64), "0x" + "0".repeat(63) + "2"]) test("missing/unknown version " + version + " cannot send or simulate absent batch", async () => {
  const w = wallet({ version }); await expect(launchBatchSupplyTransaction(w.provider, account, contract, target, plan(2).orders, true)).rejects.toThrow("not available");
  expect(w.sends()).toHaveLength(0); expect(w.calls.filter(c => c.method === "eth_call")).toHaveLength(1);
});
for (const options of [{ revert: true }, { gas: "0x1000001" }, { changedChain: true }]) test("exact moon batch admission rejects " + JSON.stringify(options), async () => {
  const w = wallet(options); await expect(launchBatchSupplyTransaction(w.provider, account, contract, target, plan(2).orders, true)).rejects.toThrow(); expect(w.sends()).toHaveLength(0);
});
test("zero, sixteen, duplicate and same-planet plans cannot launch; parent-to-moon remains distinct", () => {
  const w = wallet(), order = plan(2).orders[0]!;
  for (const orders of [[], Array.from({ length: 16 }, (_, i) => ({ ...order, originPlanetId: String(i + 1) })), [order, order]]) expect(() => launchBatchSupplyTransaction(w.provider, account, contract, target, orders, true)).toThrow();
  expect(() => launchBatchSupplyTransaction(w.provider, account, contract, target, [order], false)).toThrow("target planet");
  expect(plan(16)).toMatchObject({ sourceLimitReached: true }); expect(plan(16).orders).toHaveLength(15); expect(w.sends()).toHaveLength(0);
});
test("moon suggestion, Max, slot bound and mission switch preserve complete selected manifests", () => {
  const src = sources(15), options = { sources: src, targetCoordinates: target, targetIsMoon: true, selectedPlanetIds: new Set(src.map(s => s.planetId)), requested: { metal: 15000 }, maxOrders: 15 };
  expect(suggestBatchSupplySourceIds(options).size).toBe(15);
  expect(maximumBatchSupplyResource(options, "metal")).toBe(15000);
  expect(buildBatchSupplyPlan({ ...options, mission: "deploy" }).orders).toEqual(buildBatchSupplyPlan(options).orders);
  expect(buildBatchSupplyPlan({ ...options, maxOrders: 2 }).sourceLimitReached).toBe(true);
  expect(suggestBatchSupplySourceIds({ ...options, maxOrders: 2 }).size).toBe(2);
  expect(batchSupplyMissionLimitError(15, "deploy", true, true)).toBeUndefined();
  expect(batchSupplyMissionLimitError(16, "deploy", true, true)).toContain("15");
  expect(batchSupplySourceLimitReason({checked:false,maxSources:20,selectedSourceCount:15})).toContain("15");
  expect(batchSupplyMissionLimitError(2, "deploy", true, false)).toContain("not available");
  for (const value of [null, {}, {version:null}, {version:"1"}, {version:2}]) expect(moonSupplyBatchMatches(value)).toBe(false);
  expect(moonSupplyBatchMatches({version:1})).toBe(true);
});
test("fresh multi-moon confirmation reads parent separately and rejects stale selection/inventory with no send", async () => {
  const src = sources(2), orders = plan(2).orders;
  const state = (s: BatchSupplySource) => ({ ...target, ...s.coordinates, planetId: s.planetId, resources: Object.fromEntries(Object.entries(s.resources).map(([k,v]) => [k,String(v)])), ships: [{ id: 4, count: 1 }] });
  let stale = false, snapshotStale = false;
  const queries = { supplySources: () => ({ read: async () => ({ sources: [state(src[1]!)], stale: snapshotStale, fleetSlots: {limit:15,active:0} }) }), shipyard: () => ({ read: async () => ({ ...state(src[0]!), ...(stale ? { ships: [] } : {}) }) }) } as unknown as BackendDataStore["queries"];
  const args = { queries, account, target, orders, targetIsMoon: true, shipTypesBySource: {}, levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview: () => {}, onShortfall: () => {} };
  await prepareBatchSupplyConfirmation(args);
  await expect(prepareBatchSupplyConfirmation({ ...args, isCurrent: () => false })).rejects.toThrow("selection changed");
  snapshotStale = true; await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("inventory changed");
  snapshotStale = false; stale = true; await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("inventory changed");
});
