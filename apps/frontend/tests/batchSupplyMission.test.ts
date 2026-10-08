import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { buildBatchSupplyPlan, type BatchSupplySource } from "../src/batchSupplyPlanner";
import { replanBatchSupplyForConfirmation, prepareBatchSupplyConfirmation, launchBatchSupplyTransaction } from "../src/PlayableMvpApp";
import { batchSupplyMissionLimitError } from "../src/components/BatchSupplyModal";
import { defaultVeydriftChainForLocation, type ManagedPlanetResponse } from "../src/walletFlow";
import { fleetMissionFuelCost, fleetMissionDistance } from "../src/fleetMissionRules";
import type { BackendDataStore } from "../src/backendDataStore";

const target = { planetId: "7", galaxy: 1, system: 1, position: 2 } as ManagedPlanetResponse;
const source: BatchSupplySource = {
  planetId: "1", label: "Origin", coordinates: { galaxy: 1, system: 1, position: 1 },
  resources: { metal: 100000, crystal: 0, deuterium: 1000 },
  ships: { largeCargo: 1 }, driveLevels: {},
};
const args = { targetCoordinates: target, requested: { metal: 25000 }, selectedPlanetIds: new Set(["1"]), sources: [source] };
function wallet() {
  const sent: Array<{ data: string }> = [];
  return { sent, provider: { request: async <T>(call: { method: string; params?: unknown[] }): Promise<T> => {
    if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
    if (call.method === "eth_call") return "0x" as T;
    if (call.method === "eth_estimateGas") return "0xf4240" as T;
    if (call.method !== "eth_sendTransaction") throw new Error(call.method);
    sent.push((call.params as Array<{ data: string }>)[0]!);
    return "0xfixture" as T;
  } } };
}
const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";

describe("Supply mission selection", () => {
  test("defaults to returning Transport; Deploy keeps canonical fuel, capacity and arrival time", () => {
    const transport = buildBatchSupplyPlan(args);
    const deploy = buildBatchSupplyPlan({ ...args, mission: "deploy" });
    expect(transport).toMatchObject({ mission: "transport", shipsReturn: true });
    expect(deploy).toMatchObject({ mission: "deploy", shipsReturn: false });
    expect(deploy.orders).toEqual(transport.orders);
    const fuel = fleetMissionFuelCost({ largeCargo: 1 }, fleetMissionDistance(source.coordinates, target));
    expect(deploy.orders[0]).toMatchObject({ fuelCost: fuel, cargo: { metal: 25000 - fuel } });
    expect(buildBatchSupplyPlan({ ...args, mission: "deploy", sources: [{ ...source, resources: { ...source.resources, deuterium: fuel - 1 } }] }).orders).toEqual([]);
    const refreshed = replanBatchSupplyForConfirmation({ mission: "deploy", orders: deploy.orders, sources: [source], target, maxOrders: 1, shipTypesBySource: {} });
    expect(refreshed).toMatchObject({ mission: "deploy", shipsReturn: false, orders: deploy.orders });
    expect(replanBatchSupplyForConfirmation({ orders: transport.orders, sources: [source], target, maxOrders: 1, shipTypesBySource: {} }).shipsReturn).toBe(true);
  });

  for (const targetIsMoon of [false, true]) {
    test("Deploy confirmation and canonical calldata agree for " + (targetIsMoon ? "moon" : "planet"), async () => {
      const plan = buildBatchSupplyPlan({ ...args, mission: "deploy", targetIsMoon });
      const snapshot = { sources: [{ ...target, ...source.coordinates, planetId: "1", resources: { metal: "100000", crystal: "0", deuterium: "1000" }, ships: [{ id: 4, count: 1 }] }], fleetSlots: { limit: 10, active: 0 } };
      const queries = {
        supplySources: () => ({ read: async () => snapshot }),
        shipyard: () => ({ read: async () => ({ resources: { metal: "0", crystal: "0", deuterium: "0" }, ships: [] }) }),
      } as unknown as BackendDataStore["queries"];
      // Generic Supply needs no upgrade preview, for either destination body.
      await prepareBatchSupplyConfirmation({ queries, account, target, targetIsMoon, orders: plan.orders, shipTypesBySource: {}, mission: "deploy", levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview: () => {}, onShortfall: () => {} });
      const mock = wallet();
      await launchBatchSupplyTransaction(mock.provider, account, contract, target, plan.orders, targetIsMoon, "deploy");
      expect(mock.sent).toHaveLength(1);
      const data = mock.sent[0]!.data;
      const words = decodeAbiParameters(parseAbiParameters(targetIsMoon ? "uint256[23]" : "uint256[22]"), ("0x" + data.slice(10)) as Hex)[0];
      expect(words.slice(0, 3)).toEqual([1n, 7n, 1n]); // Deploy, not Transport
      expect(words[7]).toBe(1n);
      expect(words.slice(17, 21)).toEqual([BigInt(plan.orders[0]!.cargo.metal), 0n, 0n, 100n]);
      if (targetIsMoon) {
        expect(data.slice(0, 10)).toBe("0x0d0a9b08");
        expect(words.slice(21)).toEqual([0n, 1n]);
      } else expect(data.slice(0, 10)).toBe("0x60eac16f");
    });
  }

  test("batches planet Deploy atomically but rejects multi-source moon launches", async () => {
    const order = buildBatchSupplyPlan(args).orders[0]!;
    const orders = [order, { ...order, originPlanetId: "2" }];
    expect(batchSupplyMissionLimitError(2, "deploy")).toBeUndefined();
    expect(batchSupplyMissionLimitError(2, "deploy", true)).toContain("exactly one source");
    expect(batchSupplyMissionLimitError(1, "deploy")).toBeUndefined();
    expect(batchSupplyMissionLimitError(2)).toBeUndefined();
    const mock = wallet();
    expect(() => launchBatchSupplyTransaction(mock.provider, account, contract, target, orders, true, "deploy")).toThrow("exactly one source");
    await expect(prepareBatchSupplyConfirmation({ queries: {} as BackendDataStore["queries"], account, target, orders, shipTypesBySource: {}, mission: "deploy", targetIsMoon: true, levelSupply: undefined, levelPreview: undefined, isCurrent: () => true, onPreview: () => {}, onShortfall: () => {} })).rejects.toThrow("exactly one source");
    expect(mock.sent).toHaveLength(0);
    await launchBatchSupplyTransaction(mock.provider, account, contract, target, orders, undefined);
    expect(mock.sent[0]!.data.slice(0, 10)).toBe("0x9c26e0be");
  });
});
