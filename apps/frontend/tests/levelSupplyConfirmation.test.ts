import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { defaultVeydriftChainForLocation } from "../src/walletFlow";
import { batchSupplySourceForPlanet, prepareBatchSupplyConfirmation, launchBatchSupplyTransaction, replanBatchSupplyForConfirmation, batchSupplyPlanMatchesOrders } from "../src/PlayableMvpApp";
import { buildBatchSupplyPlan } from "../src/batchSupplyPlanner";
import { levelSupplyPreview, readLevelSupplyPreview, type LevelSupplyRequest } from "../src/levelSupply";
import { buildingContractIds, researchCatalog } from "../src/playableMvp";
import type { BackendDataStore } from "../src/backendDataStore";
import type { ChainInfrastructureState, ChainMoonState, ChainResearchState, ManagedPlanetResponse } from "../src/walletFlow";

const zero = { metal: "0", crystal: "0", deuterium: "0" };
const cost = { metal: "102400", crystal: "30720", deuterium: "51200" };
const target = { planetId: "7", name: "Pinned", coordinates: "1:1:2", galaxy: 1, system: 1, position: 2 } as ManagedPlanetResponse;
const request: LevelSupplyRequest = { kind: "building", key: "roboticsFactory", label: "Robotics Factory", level: 9 };
const infrastructure = { wallet: "wallet", homePlanetId: "1", planetId: "7", resources: zero, buildings: [{ id: buildingContractIds.roboticsFactory, level: 8, cost }], queue: null } as unknown as ChainInfrastructureState;
const moon = { ...infrastructure, moon: { exists: true, planetId: "7" }, buildings: [{ id: 1, key: "roboticsFactory", level: 8, cost }] } as unknown as ChainMoonState;
const origin = { ...target, planetId: "1", position: 1, resources: { metal: "1000000", crystal: "1000000", deuterium: "1000000" }, ships: [{ id: 4, count: 100 }], technologyLevels: {} };
const parent = { ...origin, planetId: "7", position: 2 };
function harness(initial: ChainInfrastructureState | ChainMoonState | ChainResearchState = infrastructure) {
  let destination = initial;
  let parentDeuterium = "1000000";
  const calls: unknown[] = [];
  const queries = Object.fromEntries(["infrastructure", "research", "moon", "supplySources", "shipyard"].map(kind => [kind, (wallet: string, id: string, options: unknown) => ({ read: async () => {
    calls.push({ kind, wallet, id, options });
    return kind === "supplySources" ? { sources: [origin], fleetSlots: { limit: 10, active: 0 } }
      : kind === "shipyard" ? { ...parent, resources: { ...parent.resources, deuterium: parentDeuterium } } : destination;
  } })])) as unknown as BackendDataStore["queries"];
  return { queries, calls, setDestination: (next: typeof destination) => { destination = next; }, setParentFuel: (value: string) => { parentDeuterium = value; } };
}

const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";
function mockWallet() {
  const sent: Array<{ data: string }> = [];
  const provider = { request: async <T>(call: { method: string; params?: unknown[] }): Promise<T> => {
    if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
    if (call.method === "eth_call") return "0x" as T;
    if (call.method === "eth_estimateGas") return "0xf4240" as T;
    if (call.method !== "eth_sendTransaction") throw new Error(call.method);
    sent.push((call.params as Array<{ data: string }>)[0]!);
    return "0xfixture" as T;
  } };
  return { sent, provider };
}

for (const kind of ["building", "research", "moon"] as const) {
  test(kind + " selected paid queue is funded, while later levels and unrelated queues remain preparable", async () => {
    const id = kind === "research" ? researchCatalog.find(r => r.key === "energy")!.id : kind === "moon" ? 1 : buildingContractIds.roboticsFactory;
    const selected = { ...request, kind, ...(kind === "research" ? { key: "energy" } : {}) };
    const base = kind === "moon" ? moon : kind === "research" ? { ...infrastructure, technologies: [{ id, level: 8, cost }] } as unknown as ChainResearchState : infrastructure;
    const queue = { active: true, itemId: id, targetLevel: 9, kind, readyAt: "9999999999", cost };
    expect(levelSupplyPreview(selected, { ...base, queue }, "7")).toMatchObject({ inProgress: true, missing: { metal: 0, crystal: 0, deuterium: 0 } });
    expect(levelSupplyPreview({ ...selected, level: 10 }, { ...base, queue }, "7").inProgress).toBe(false);
    expect(levelSupplyPreview(selected, { ...base, queue: { ...queue, itemId: 99 } }, "7").missing.metal).toBe(102400);
    const h = harness(base);
    const initial = await readLevelSupplyPreview(h.queries, "wallet", "7", selected);
    const orders = buildBatchSupplyPlan({ targetCoordinates: target, targetIsMoon: kind === "moon", requested: initial.missing, selectedPlanetIds: new Set(["1"]), sources: [batchSupplySourceForPlanet(origin, origin)] }).orders;
    h.setDestination({ ...base, queue });
    let refreshed: unknown;
    await expect(prepareBatchSupplyConfirmation({ queries: h.queries, account: "wallet", target, orders, shipTypesBySource: {}, targetIsMoon: kind === "moon", levelSupply: selected, levelPreview: initial, isCurrent: () => true, onPreview: () => {}, onShortfall: value => { refreshed = value; } })).rejects.toThrow("review the updated plan");
    expect(refreshed).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
  });
}

describe("production Supply confirmation and launch handlers", () => {
  test("increased goal cannot be bypassed by retrying with the newly published preview", async () => {
    const h = harness({ ...infrastructure, resources: { ...zero, metal: "100" } });
    let preview = await readLevelSupplyPreview(h.queries, "wallet", "7", request);
    const orders = buildBatchSupplyPlan({ targetCoordinates: target, requested: preview.missing, selectedPlanetIds: new Set(["1"]), sources: [batchSupplySourceForPlanet(origin, origin)] }).orders;
    h.setDestination(infrastructure);
    for (let retry = 0; retry < 2; retry++) {
      await expect(prepareBatchSupplyConfirmation({ queries: h.queries, account: "wallet", target, orders, shipTypesBySource: {}, levelSupply: request, levelPreview: preview, isCurrent: () => true,
        onPreview: value => { preview = value; }, onShortfall: () => {},
      })).rejects.toThrow("review the updated plan");
    }
    expect(preview.missing.metal - orders.reduce((sum, order) => sum + order.cargo.metal, 0)).toBe(100);
  });
  test("open read, fresh confirmation and calldata stay pinned after selected route changes", async () => {
    const h = harness();
    let selectedPlanet = target;
    const captured = selectedPlanet;
    const preview = await readLevelSupplyPreview(h.queries, "wallet", captured.planetId, request);
    const orders = buildBatchSupplyPlan({ targetCoordinates: captured, requested: preview.missing, selectedPlanetIds: new Set(["1"]), sources: [batchSupplySourceForPlanet(origin, origin)] }).orders;
    selectedPlanet = { ...target, planetId: "99" };
    const wallet = mockWallet();
    await prepareBatchSupplyConfirmation({ queries: h.queries, account: "wallet", target: captured, orders, shipTypesBySource: {}, levelSupply: request, levelPreview: preview, isCurrent: () => true, onPreview: () => {}, onShortfall: () => {} });
    expect(wallet.sent).toHaveLength(0);
    expect(h.calls).toHaveLength(3);
    expect(h.calls.every((call: any) => call.id === "7" && call.options.fresh === true)).toBe(true);
    await launchBatchSupplyTransaction(wallet.provider, account, contract, captured, orders, false);
    expect(wallet.sent).toHaveLength(1);
    const data = wallet.sent[0]!.data;
    expect(data.slice(0, 10)).toBe("0x9c26e0be");
    const words = decodeAbiParameters(parseAbiParameters("uint256[22]"), ("0x" + data.slice(10)) as Hex)[0];
    expect(words.slice(0, 4)).toEqual([7n, 64n, 1n, 1n]);
    expect(words.slice(18)).toEqual([102400n, 30720n, 51200n, 100n]);
    expect(selectedPlanet.planetId).toBe("99");
  });

  test("queue start, stale reads and obsolete selection stop production confirmation before launch", async () => {
    const h = harness();
    const preview = await readLevelSupplyPreview(h.queries, "wallet", "7", request);
    const orders = buildBatchSupplyPlan({ targetCoordinates: target, requested: preview.missing, selectedPlanetIds: new Set(["1"]), sources: [batchSupplySourceForPlanet(origin, origin)] }).orders;
    let refreshed: unknown;
    const args = { queries: h.queries, account: "wallet", target, orders, shipTypesBySource: {}, levelSupply: request, levelPreview: preview, isCurrent: () => true, onPreview: () => {}, onShortfall: (value: unknown) => { refreshed = value; } };
    h.setDestination({ ...infrastructure, queue: { active: true, itemId: buildingContractIds.roboticsFactory, targetLevel: 9, kind: "building", readyAt: "9999999999", cost } });
    await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("review the updated plan");
    expect(refreshed).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    h.setDestination({ ...infrastructure, resources: cost });
    await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("review the updated plan");
    expect(refreshed).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    h.setDestination({ ...infrastructure, stale: true });
    await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("updating");
    h.setDestination(infrastructure);
    await expect(prepareBatchSupplyConfirmation({ ...args, isCurrent: () => false })).rejects.toThrow("selection changed");
    h.setDestination({ ...infrastructure, resources: { ...zero, metal: "100" } });
    const lower = await readLevelSupplyPreview(h.queries, "wallet", "7", request);
    h.setDestination(infrastructure);
    await expect(prepareBatchSupplyConfirmation({ ...args, levelPreview: lower })).rejects.toThrow("review the updated plan");
  });

  for (const withUpgrade of [false, true]) test(`parent-to-moon fuel, capacity, Max, confirmation and body calldata agree ${withUpgrade ? "with upgrade" : "without upgrade"}`, async () => {
    const src = batchSupplySourceForPlanet(parent, { ...parent, ships: [{ id: 4, count: 1 }] });
    const plan = (deuterium: number, metal = 25000) => buildBatchSupplyPlan({ targetCoordinates: target, targetIsMoon: true, requested: { metal }, selectedPlanetIds: new Set(["7"]), sources: [{ ...src, resources: { metal: 100000, crystal: 0, deuterium } }] });
    expect(plan(0).orders).toEqual([]);
    const preview = plan(1);
    expect(preview.orders[0]).toMatchObject({ cargo: { metal: 24999, crystal: 0, deuterium: 0 }, fuelCost: 1, travelSeconds: 38 });
    expect(plan(1, Number.MAX_SAFE_INTEGER).delivered.metal).toBe(24999);
    const replanned = replanBatchSupplyForConfirmation({ target, targetIsMoon: true, sources: [src], orders: preview.orders, maxOrders: 1, shipTypesBySource: {} });
    expect(batchSupplyPlanMatchesOrders(preview.orders, replanned.orders)).toBe(true);
    const h = harness({ ...moon, resources: { metal: "77401", crystal: "30720", deuterium: "51200" } });
    const selected = withUpgrade ? { ...request, kind: "moon" as const } : undefined;
    const levelPreview = selected ? await readLevelSupplyPreview(h.queries, "wallet", "7", selected) : undefined;
    const args = { queries: h.queries, account: "wallet", target, orders: preview.orders, shipTypesBySource: {}, targetIsMoon: true, levelSupply: selected, levelPreview, isCurrent: () => true, onPreview: () => {}, onShortfall: () => {} };
    await prepareBatchSupplyConfirmation(args);
    if (!withUpgrade) expect(h.calls).toEqual([
      { kind: "supplySources", wallet: "wallet", id: "7", options: { fresh: true } },
      { kind: "shipyard", wallet: "wallet", id: "7", options: { fresh: true } },
    ]); // The parent is absent from supplySources, and no upgrade/moon read is needed.
    const wallet = mockWallet();
    expect(wallet.sent).toHaveLength(0);
    await launchBatchSupplyTransaction(wallet.provider, account, contract, target, preview.orders, true);
    expect(wallet.sent).toHaveLength(1);
    const data = wallet.sent[0]!.data;
    expect(data.slice(0, 10)).toBe("0x0d0a9b08");
    const words = decodeAbiParameters(parseAbiParameters("uint256[23]"), ("0x" + data.slice(10)) as Hex)[0];
    expect(words.slice(0, 3)).toEqual([7n, 7n, 0n]);
    expect(words[7]).toBe(1n); // one Large Cargo
    expect(words.slice(17)).toEqual([24999n, 0n, 0n, 100n, 0n, 1n]); // planet -> moon
    expect(h.calls.every((call: any) => call.id === "7" && call.options.fresh === true)).toBe(true);
    // The same parent-to-moon preview and fresh resource checks also support Deploy.
    await prepareBatchSupplyConfirmation({ ...args, mission: "deploy" });
    const deploying = mockWallet();
    await launchBatchSupplyTransaction(deploying.provider, account, contract, target, preview.orders, true, "deploy");
    const deployWords = decodeAbiParameters(parseAbiParameters("uint256[23]"), ("0x" + deploying.sent[0]!.data.slice(10)) as Hex)[0];
    expect(deployWords.slice(0, 3)).toEqual([7n, 7n, 1n]);
    expect(deployWords.slice(17)).toEqual([24999n, 0n, 0n, 100n, 0n, 1n]);
    const multiple = [preview.orders[0]!, { ...preview.orders[0]!, originPlanetId: "1" }];
    const readsBefore = h.calls.length;
    await expect(prepareBatchSupplyConfirmation({ ...args, orders: multiple })).rejects.toThrow("Moon Supply requires exactly one source");
    expect(h.calls).toHaveLength(readsBefore);
    const blockedWallet = mockWallet();
    expect(() => launchBatchSupplyTransaction(blockedWallet.provider, account, contract, target, multiple, true)).toThrow("Moon Supply requires exactly one source");
    expect(blockedWallet.sent).toHaveLength(0);
    h.setParentFuel("0");
    await expect(prepareBatchSupplyConfirmation({ ...args, mission: "deploy" })).rejects.toThrow("inventory changed");
    await expect(prepareBatchSupplyConfirmation(args)).rejects.toThrow("inventory changed");
  });
});
