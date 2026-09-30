import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { buildBatchSupplyPlan, defaultSupplyShipTypes, type BatchSupplySource, type SupplyShipKey } from "../src/batchSupplyPlanner";
import { batchSupplyPlanMatchesOrders, replanBatchSupplyForConfirmation } from "../src/PlayableMvpApp";
import { fleetMissionAvailableCargoCapacity, fleetMissionDistance, fleetMissionFuelCost, fleetMissionTravelSeconds } from "../src/fleetMissionRules";
import { defaultVeydriftChainForLocation, sendLaunchTransportBatchTransaction } from "../src/walletFlow";

const target = { galaxy: 1, system: 100, position: 8 };
const source: BatchSupplySource = {
  planetId: "1", label: "Origin", coordinates: { ...target, position: 7 },
  resources: { metal: 100_000, crystal: 0, deuterium: 10_000 },
  ships: { smallCargo: 1, largeCargo: 1, recycler: 4, colonyShip: 1 },
  driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 },
};
function plan(allowedShipTypes: readonly SupplyShipKey[] = defaultSupplyShipTypes, sources = [source], metal = 80_000) {
  return buildBatchSupplyPlan({ targetCoordinates: target, requested: { metal }, selectedPlanetIds: new Set(sources.map(s => s.planetId)), sources, shipTypesBySource: Object.fromEntries(sources.map(source => [source.planetId, allowedShipTypes])) });
}

describe("Supply draft type eligibility", () => {
  test("defaults exclude recyclers, preserves other cargo defaults, opts out and re-adds without mutating inventory", () => {
    const original = structuredClone(source);
    const defaults = buildBatchSupplyPlan({ targetCoordinates: target, requested: { metal: 80_000 }, selectedPlanetIds: new Set(["1"]), sources: [source] });
    expect(defaults.orders[0]!.ships).toMatchObject({ recycler: 0, smallCargo: 1, largeCargo: 1, colonyShip: 1 });
    expect(defaults.missing.metal).toBeGreaterThan(0);
    const included = plan([...defaultSupplyShipTypes, "recycler"]);
    expect(included.missing.metal).toBe(0);
    expect(included.orders[0]!.ships.recycler).toBeGreaterThan(0);
    expect(plan().orders).toEqual(defaults.orders);
    expect(plan([...defaultSupplyShipTypes, "recycler"]).orders).toEqual(included.orders);
    expect(source).toEqual(original);
  });

  test("recycler-only origins and an empty selection never fall back to excluded types", () => {
    const recyclerOnly = { ...source, ships: { recycler: 4 } };
    expect(plan(undefined, [recyclerOnly], 500).orders).toEqual([]);
    expect(plan(["recycler"], [recyclerOnly], 500).orders[0]!.ships.recycler).toBe(1);
    expect(plan([], [source], 500).orders).toEqual([]);
    expect(plan([], [source], 500).missing.metal).toBe(500);
    const fuelStarved = { ...source, resources: { ...source.resources, deuterium: 0 } };
    expect(plan(["smallCargo"], [fuelStarved], 500).orders).toEqual([]);
  });

  test("applies selection to every origin, recalculating Max capacity, fuel and ETA with canonical rules", () => {
    const sources = [source, { ...source, planetId: "2", coordinates: { ...target, system: 103 } }];
    const small = plan(["smallCargo"], sources, Number.MAX_SAFE_INTEGER);
    const recyclers = plan(["recycler"], sources, Number.MAX_SAFE_INTEGER);
    expect(small.orders).toHaveLength(2);
    expect(recyclers.delivered.metal).toBeGreaterThan(small.delivered.metal);
    expect(recyclers.fuelCost).not.toBe(small.fuelCost);
    expect(recyclers.orders[0]!.travelSeconds).not.toBe(small.orders[0]!.travelSeconds);
    for (const order of small.orders) {
      const origin = sources.find(s => s.planetId === order.originPlanetId)!;
      const distance = fleetMissionDistance(origin.coordinates, target);
      expect(order.ships).toMatchObject({ smallCargo: 1, recycler: 0, largeCargo: 0, colonyShip: 0 });
      expect(order.cargo.metal).toBe(fleetMissionAvailableCargoCapacity(order.ships, distance, origin.driveLevels));
      expect(order.fuelCost).toBe(fleetMissionFuelCost(order.ships, distance, origin.driveLevels));
      expect(order.travelSeconds).toBe(fleetMissionTravelSeconds(distance, order.ships, origin.driveLevels));
      expect(order.cargo.deuterium + order.fuelCost).toBeLessThanOrEqual(origin.resources.deuterium);
    }
  });

  test("retains explicit allowed but unused types during fresh confirmation and never restores excluded fallback fleets", () => {
    const allowedShipTypes: SupplyShipKey[] = ["smallCargo", "recycler"];
    const preview = plan(allowedShipTypes, [source], 500);
    expect(preview.orders[0]!.ships.recycler).toBe(0);
    const refresh = (sources: BatchSupplySource[], types = allowedShipTypes) => replanBatchSupplyForConfirmation({ orders: preview.orders, sources, target, maxOrders: 1, shipTypesBySource: { "1": types } });
    expect(refresh([source]).orders).toEqual(preview.orders);
    expect(refresh([{ ...source, ships: { ...source.ships, largeCargo: 100 } }]).orders).toEqual(preview.orders);
    const noSmall = { ...source, ships: { recycler: 4, largeCargo: 100 } };
    const changed = refresh([noSmall]);
    expect(changed.orders[0]!.ships.recycler).toBe(1);
    expect(changed.orders[0]!.ships.largeCargo).toBe(0);
    expect(batchSupplyPlanMatchesOrders(preview.orders, changed.orders)).toBe(false);
    expect(refresh([noSmall], ["smallCargo"]).orders).toEqual([]);
    expect(refresh([source], []).orders).toEqual([]);
    expect(refresh([{ ...source, resources: { ...source.resources, metal: 100 } }]).missing.metal).toBe(400);
  });

  test("submits exactly the preview loadout after a matching fresh preflight (mock provider only)", async () => {
    const allowedShipTypes: SupplyShipKey[] = ["recycler"];
    const preview = plan(allowedShipTypes, [source], 500);
    const refreshed = replanBatchSupplyForConfirmation({ orders: preview.orders, shipTypesBySource: { "1": allowedShipTypes }, sources: [source], target, maxOrders: 1 });
    expect(batchSupplyPlanMatchesOrders(preview.orders, refreshed.orders)).toBe(true);
    const calls: Array<{ method: string; params?: unknown }> = [];
    await sendLaunchTransportBatchTransaction({ request: async <T>(call: { method: string; params?: unknown[] }) => {
      if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
      if (call.method === "eth_call") return "0x" as T;
      if (call.method !== "eth_sendTransaction") throw new Error(call.method);
      calls.push(call); return "0xfixture" as T;
    } }, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", {
      targetPlanetId: "9", orders: preview.orders.map(order => ({ originPlanetId: order.originPlanetId, ships: order.ships, cargo: order.cargo, speedPercent: 100 })),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("eth_sendTransaction");
    const data = (calls[0]!.params as Array<{ data: string }>)[0]!.data;
    expect(data.slice(0, 10)).toBe("0x9c26e0be");
    // Static ABI words: target, offset, length, origin, 14 ships, 3 resources, speed.
    const words = decodeAbiParameters(parseAbiParameters("uint256[22]"), ("0x" + data.slice(10)) as `0x${string}`)[0];
    expect(words.slice(0, 4)).toEqual([9n, 64n, 1n, 1n]);
    expect(words.slice(4, 18)).toEqual([0n, 0n, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    expect(words.slice(18)).toEqual([500n, 0n, 0n, 100n]);
  });
  test("distinct source choices survive deselection, stock refresh and exact confirmation calldata", async () => {
    const sources = [source, { ...source, planetId: "2", ships: { smallCargo: 3, recycler: 2 }, coordinates: { ...target, position: 6 } }];
    const shipTypesBySource = { "1": ["recycler"], "2": ["smallCargo"] } as const;
    const makePlan = (ids = ["1", "2"], inventory = sources) => buildBatchSupplyPlan({
      targetCoordinates: target, requested: { metal: Number.MAX_SAFE_INTEGER },
      selectedPlanetIds: new Set(ids), sources: inventory, shipTypesBySource,
    });
    const preview = makePlan();
    expect(preview.orders).toHaveLength(2);
    expect(preview.orders[0]!.ships).toMatchObject({ recycler: 4, smallCargo: 0, largeCargo: 0, colonyShip: 0 });
    expect(preview.orders[1]!.ships).toMatchObject({ recycler: 0, smallCargo: 3, largeCargo: 0, colonyShip: 0 });
    expect(makePlan(["2"]).orders).toEqual([preview.orders[1]!]);
    expect(makePlan().orders).toEqual(preview.orders);
    const refreshed = replanBatchSupplyForConfirmation({ orders: preview.orders, sources, target, maxOrders: 2, shipTypesBySource });
    expect(batchSupplyPlanMatchesOrders(preview.orders, refreshed.orders)).toBe(true);
    const changed = [{ ...source, ships: { ...source.ships, recycler: 1 } }, sources[1]!];
    const changedPlan = replanBatchSupplyForConfirmation({ orders: preview.orders, sources: changed, target, maxOrders: 2, shipTypesBySource });
    expect(batchSupplyPlanMatchesOrders(preview.orders, changedPlan.orders)).toBe(false);
    expect(changedPlan.orders[0]!.ships.largeCargo).toBe(0);
    expect(changedPlan.orders[1]).toEqual(preview.orders[1]);
    expect(changedPlan.missing.metal).toBeGreaterThan(0);
    const defaults = buildBatchSupplyPlan({ targetCoordinates: target, requested: { metal: Number.MAX_SAFE_INTEGER }, selectedPlanetIds: new Set(["1", "2"]), sources });
    expect(defaults.orders.every(order => order.ships.recycler === 0)).toBe(true);
    const onlyFirstOff = buildBatchSupplyPlan({ targetCoordinates: target, requested: { metal: 500 }, selectedPlanetIds: new Set(["1", "2"]), sources, shipTypesBySource: { "1": [] } });
    expect(onlyFirstOff.orders.map(order => order.originPlanetId)).toEqual(["2"]);
    let data = "";
    await sendLaunchTransportBatchTransaction({ request: async <T>(call: { method: string; params?: unknown[] }) => {
      if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
      if (call.method === "eth_call") return "0x" as T;
      if (call.method !== "eth_sendTransaction") throw new Error(call.method);
      data = (call.params as Array<{ data: string }>)[0]!.data;
      return "0xfixture" as T;
    } }, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", {
      targetPlanetId: "9", orders: refreshed.orders.map(order => ({ originPlanetId: order.originPlanetId, ships: order.ships, cargo: order.cargo, speedPercent: 100 })),
    });
    const words = decodeAbiParameters(parseAbiParameters("uint256[41]"), ("0x" + data.slice(10)) as `0x${string}`)[0];
    expect(words.slice(0, 3)).toEqual([9n, 64n, 2n]);
    for (const [index, order] of refreshed.orders.entries()) {
      const offset = 3 + index * 19;
      expect(words[offset]).toBe(BigInt(order.originPlanetId));
      expect(words.slice(offset + 1, offset + 15)).toEqual(index === 0
        ? [0n, 0n, 4n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
        : [3n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
      expect(words.slice(offset + 15, offset + 19)).toEqual([BigInt(order.cargo.metal), 0n, 0n, 100n]);
    }
  });

});
