import { describe, expect, test } from "bun:test";
import { buildingContractIds, createInitialPlayableState, researchCatalog } from "../src/playableMvp";
import { buildingLevelInfoRows } from "../src/buildingDetails";
import { buildingLevelInfoTable } from "../src/components/InfrastructurePage";
import { moonStructureLevelInfoRows, moonStructureLevelInfoTable } from "../src/components/MoonPage";
import { buildBatchSupplyPlan, type BatchSupplySource } from "../src/batchSupplyPlanner";
import { levelSupplyCost, levelSupplyPreview, levelSupplyNeedsReview, readLevelSupplyPreview, type LevelSupplyRequest } from "../src/levelSupply";
import type { ChainInfrastructureState, ChainMoonState, ChainResearchState } from "../src/walletFlow";

const request: LevelSupplyRequest = { kind: "building", key: "roboticsFactory", label: "Robotics Factory", level: 9 };
const resources = { metal: "2400", crystal: "720", deuterium: "1200" };
const requirement = { metal: "102400", crystal: "30720", deuterium: "51200" };
const state = { ...createInitialPlayableState(), buildings: { ...createInitialPlayableState().buildings, roboticsFactory: 8 } };
const snapshot = { wallet: "wallet", homePlanetId: "1", planetId: "7", resources: { metal: "0", crystal: "0", deuterium: "0" }, resourcesAsOfNow: resources,
  buildings: [{ id: buildingContractIds.roboticsFactory, level: 8, cost: requirement }], queue: { active: true }, infrastructureAvailable: false,
} as unknown as ChainInfrastructureState;
const source: BatchSupplySource = { planetId: "1", label: "Origin", coordinates: { galaxy: 1, system: 1, position: 1 }, resources: { metal: 1000000, crystal: 1000000, deuterium: 1000000 }, ships: { largeCargo: 100, recycler: 100, lightFighter: 100 }, driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 } };
const target = { galaxy: 1, system: 1, position: 2 };

describe("upgrade Supply handoff", () => {
  test("Robotics 8 rows hand off only future incremental requirements to the real planner", () => {
    let selected = 0;
    const table = buildingLevelInfoTable(8, buildingLevelInfoRows(state.buildings, "roboticsFactory"), level => { selected = level; });
    expect(table.rows.filter(row => row.level <= 8).every(row => !row.onSupply)).toBe(true);
    table.rows.find(row => row.level === 9)!.onSupply!();
    expect(selected).toBe(9);
    const preview = levelSupplyPreview({ ...request, level: selected }, snapshot, "7");
    expect(preview.requirement).toEqual({ metal: 102400, crystal: 30720, deuterium: 51200 });
    expect(preview.missing).toEqual({ metal: 100000, crystal: 30000, deuterium: 50000 });
    const plan = buildBatchSupplyPlan({ targetCoordinates: target, requested: preview.missing, selectedPlanetIds: new Set(["1"]), sources: [source] });
    expect(plan.delivered).toEqual(preview.missing);
    expect(plan.orders[0]!.cargo).toEqual(preview.missing);
    expect(plan.orders[0]!.ships.recycler).toBe(0);
    expect(plan.orders[0]!.ships.lightFighter).toBe(0);
    table.rows.find(row => row.level === 10)!.onSupply!();
    expect(levelSupplyPreview({ ...request, level: selected }, snapshot, "7").requirement).toEqual({ metal: 204800, crystal: 61440, deuterium: 102400 });
  });

  test("fresh destination reads pin ID/body and reject mismatches, stale and missing balances", async () => {
    const calls: unknown[] = [];
    const queries = Object.fromEntries(["moon", "research", "infrastructure"].map(kind => [kind, (wallet: string, id: string, options: unknown) => {
      calls.push({ kind, wallet, id, options }); return { read: async () => snapshot };
    }])) as unknown as Parameters<typeof readLevelSupplyPreview>[0];
    const preview = await readLevelSupplyPreview(queries, "wallet", "7", request);
    expect(calls).toEqual([{ kind: "infrastructure", wallet: "wallet", id: "7", options: { fresh: true } }]);
    expect(preview.missing.metal).toBe(100000);
    expect(() => levelSupplyPreview(request, snapshot, "8")).toThrow("does not match");
    expect(() => levelSupplyPreview(request, { ...snapshot, stale: true }, "7")).toThrow("updating");
    expect(() => levelSupplyPreview(request, { ...snapshot, resources: requirement, resourcesAsOfNow: null }, "7")).toThrow("unavailable");
    expect(() => levelSupplyPreview(request, { ...snapshot, buildings: [{ ...snapshot.buildings[0]!, level: 9 }] }, "7")).toThrow("completed");
  });

  test("refresh recomputes spent and fully funded balances without local double counting", () => {
    const initial = levelSupplyPreview(request, snapshot, "7");
    const spent = levelSupplyPreview(request, { ...snapshot, resourcesAsOfNow: { ...resources, metal: "0" } }, "7");
    expect(spent.missing.metal).toBe(102400);
    expect(levelSupplyNeedsReview(initial, spent)).toBe(true);
    const full = levelSupplyPreview(request, { ...snapshot, resourcesAsOfNow: requirement }, "7");
    expect(full.missing).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(levelSupplyNeedsReview(initial, full)).toBe(true);
    expect(buildBatchSupplyPlan({ targetCoordinates: target, requested: full.missing, selectedPlanetIds: new Set(["1"]), sources: [source] }).orders).toEqual([]);
    const production = levelSupplyPreview(request, { ...snapshot, resourcesAsOfNow: { ...resources, metal: "2401" } }, "7");
    expect(production.missing.metal).toBe(99999);
    expect(levelSupplyNeedsReview(initial, production)).toBe(false); // reviewed cargo is explicit, never silently increased
  });

  test("research planning ignores queue/prerequisites and energy remains non-shippable", () => {
    const research = { wallet: "wallet", homePlanetId: "1", planetId: "7", resourcesAsOfNow: resources, resources: null, researchAvailable: false, researchLabLevel: 0, queue: { active: true }, technologies: [{ id: researchCatalog.find(r => r.key === "energy")!.id, level: 8, cost: { metal: "0", crystal: "204800", deuterium: "102400" } }] } as unknown as ChainResearchState;
    const preview = levelSupplyPreview({ kind: "research", key: "energy", label: "Energy Technology", level: 9 }, research, "7");
    expect(preview.requirement).toEqual({ metal: 0, crystal: 204800, deuterium: 102400 });
    const graviton = { ...research, technologies: [{ id: researchCatalog.find(r => r.key === "graviton")!.id, level: 0, cost: { metal: "0", crystal: "0", deuterium: "0" } }] };
    expect(levelSupplyPreview({ kind: "research", key: "graviton", label: "Graviton", level: 1 }, graviton, "7")).toMatchObject({ energyOnly: true, missing: { metal: 0, crystal: 0, deuterium: 0 } });
  });

  test("moon and binary structures retain their own destination cost and future-only actions", () => {
    const moon = { wallet: "wallet", homePlanetId: "1", parentPlanetId: "7", moon: { exists: true, planetId: "7" }, resourcesAsOfNow: resources, buildings: [{ id: 1, key: "roboticsFactory", label: "Robotics Factory", level: 8, cost: requirement }] } as unknown as ChainMoonState;
    expect(levelSupplyPreview({ ...request, kind: "moon" }, moon, "7").missing).toEqual({ metal: 100000, crystal: 30000, deuterium: 50000 });
    const building = { id: 2, key: "jumpGate" as const, label: "Jump Gate", level: 0, cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" } };
    const rows = moonStructureLevelInfoRows(building, moon.moon!, moon);
    expect(rows).toHaveLength(1);
    let selected = 0;
    moonStructureLevelInfoTable("jumpGate", 0, rows, level => { selected = level; }).rows[0]!.onSupply!();
    expect(selected).toBe(1);
    expect(moonStructureLevelInfoTable("jumpGate", 1, rows, () => {}).rows[0]!.onSupply).toBeUndefined();
    expect(levelSupplyCost({ kind: "building", key: "interdimensionalRiftStabilizer", label: "Rift Stabilizer", level: 1 })).toEqual({ metal: 8000n, crystal: 8000n, deuterium: 4000n });
    expect(() => levelSupplyCost({ kind: "building", key: "interdimensionalRiftStabilizer", label: "Rift Stabilizer", level: 2 })).toThrow("only be built once");
  });

  test("very large canonical requirements use bigint and fail closed at planner precision limit", () => {
    const huge = { ...request, level: 60 };
    expect(levelSupplyCost(huge).metal).toBe(400n * 2n ** 59n);
    expect(() => levelSupplyPreview(huge, snapshot, "7")).toThrow("too large");
    expect(() => levelSupplyCost({ ...request, level: NaN })).toThrow("range");
    expect(() => levelSupplyPreview(request, { ...snapshot, resourcesAsOfNow: { ...resources, metal: "-1" } }, "7")).toThrow("unavailable");
  });
});
