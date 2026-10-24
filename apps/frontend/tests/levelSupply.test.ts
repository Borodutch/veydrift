import { describe, expect, test } from "bun:test";
import { buildingContractIds, createInitialPlayableState, researchCatalog } from "../src/playableMvp";
import { buildingLevelInfoRows } from "../src/buildingDetails";
import { buildingLevelInfoTable } from "../src/components/InfrastructurePage";
import { moonStructureLevelInfoRows, moonStructureLevelInfoTable } from "../src/components/MoonPage";
import { buildBatchSupplyPlan, type BatchSupplySource } from "../src/batchSupplyPlanner";
import { cumulativeLevelSupplyCost, levelSupplyCost, levelSupplyPreview, levelSupplyNeedsReview, readLevelSupplyPreview, type LevelSupplyRequest } from "../src/levelSupply";
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
    // Level 10 from level 8 funds levels 9 (live cost) + 10 in one shipment.
    const cumulative = levelSupplyPreview({ ...request, level: selected }, snapshot, "7");
    expect(cumulative.requirement).toEqual({ metal: 102400 + 204800, crystal: 30720 + 61440, deuterium: 51200 + 102400 });
    expect(cumulative.fromLevel).toBe(9);
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

describe("cumulative level Supply", () => {
  const crystalMine: LevelSupplyRequest = { kind: "building", key: "crystalMine", label: "Crystal Mine", level: 11 };
  const level9Cost = { metal: "2061", crystal: "1030", deuterium: "0" };
  const empty = { metal: "0", crystal: "0", deuterium: "0" };
  const mineSnapshot = (queue: unknown = null, mineResources = empty) => ({
    wallet: "wallet", homePlanetId: "1", planetId: "7", resourcesAsOfNow: mineResources,
    buildings: [{ id: buildingContractIds.crystalMine, level: 8, cost: level9Cost }], queue, infrastructureAvailable: true,
  } as unknown as ChainInfrastructureState);

  test("a single level sums to that level's own cost", () => {
    expect(cumulativeLevelSupplyCost(crystalMine, 11)).toEqual(levelSupplyCost(crystalMine));
    expect(levelSupplyPreview({ ...crystalMine, level: 9 }, mineSnapshot(), "7")).toMatchObject({ fromLevel: 9, requirement: { metal: 2061, crystal: 1030, deuterium: 0 } });
  });

  test("several levels sum every level from current+1 through N and match the popup rows", () => {
    // Ticket example: Crystal Mine 8 → Supply on level 11 = levels 9 + 10 + 11.
    expect(cumulativeLevelSupplyCost(crystalMine, 9)).toEqual({ metal: 2061n + 3298n + 5277n, crystal: 1030n + 1649n + 2638n, deuterium: 0n });
    const preview = levelSupplyPreview(crystalMine, mineSnapshot(null, { metal: "636", crystal: "17", deuterium: "5" }), "7");
    expect(preview.fromLevel).toBe(9);
    expect(preview.requirement).toEqual({ metal: 10636, crystal: 5317, deuterium: 0 });
    expect(preview.missing).toEqual({ metal: 10000, crystal: 5300, deuterium: 0 });
    const state = createInitialPlayableState();
    state.buildings.crystalMine = 8;
    const rows = buildingLevelInfoRows(state.buildings, "crystalMine").filter(row => row.level >= 9 && row.level <= 11);
    expect(rows.reduce((sum, row) => ({ metal: sum.metal + row.cost.metal, crystal: sum.crystal + row.cost.crystal, deuterium: sum.deuterium + row.cost.deuterium }), { metal: 0, crystal: 0, deuterium: 0 })).toEqual(preview.requirement);
  });

  test("popup row costs equal the Supply catalogue for every building at every level", () => {
    const state = createInitialPlayableState();
    for (const key of Object.keys(buildingContractIds) as Array<keyof typeof buildingContractIds>) {
      if (key === "interdimensionalRiftStabilizer") continue;
      for (const row of buildingLevelInfoRows(state.buildings, key)) {
        const exact = levelSupplyCost({ kind: "building", key, label: key, level: row.level });
        expect({ key, level: row.level, cost: row.cost }).toEqual({ key, level: row.level, cost: { metal: Number(exact.metal), crystal: Number(exact.crystal), deuterium: Number(exact.deuterium) } });
      }
    }
  });

  test("a queued level is the starting point and is never supplied again", () => {
    const queued = mineSnapshot({ active: true, kind: "building", itemId: buildingContractIds.crystalMine, targetLevel: 9, action: "upgrade" });
    const preview = levelSupplyPreview(crystalMine, queued, "7");
    expect(preview).toMatchObject({ fromLevel: 10, inProgress: false, requirement: { metal: 3298 + 5277, crystal: 1649 + 2638, deuterium: 0 } });
    expect(levelSupplyPreview({ ...crystalMine, level: 9 }, queued, "7")).toMatchObject({ inProgress: true, missing: { metal: 0, crystal: 0, deuterium: 0 } });
    // Another building's queue or a demolition does not move the starting point.
    for (const queue of [{ active: true, itemId: buildingContractIds.metalMine, targetLevel: 9 }, { active: true, itemId: buildingContractIds.crystalMine, targetLevel: 7, action: "demolish" }, { active: false, itemId: buildingContractIds.crystalMine, targetLevel: 9 }]) {
      expect(levelSupplyPreview(crystalMine, mineSnapshot(queue), "7")).toMatchObject({ fromLevel: 9, inProgress: false, requirement: { metal: 10636, crystal: 5317, deuterium: 0 } });
    }
  });

  test("the live chain cost replaces only the first unpaid level, never a queued one", () => {
    const live = { metal: "2100", crystal: "1000", deuterium: "0" };
    const withLive = (queue: unknown) => ({ ...mineSnapshot(queue), buildings: [{ id: buildingContractIds.crystalMine, level: 8, cost: live }] } as unknown as ChainInfrastructureState);
    expect(levelSupplyPreview(crystalMine, withLive(null), "7").requirement).toEqual({ metal: 2100 + 3298 + 5277, crystal: 1000 + 1649 + 2638, deuterium: 0 });
    const queued = { active: true, itemId: buildingContractIds.crystalMine, targetLevel: 9, action: "upgrade" };
    expect(levelSupplyPreview(crystalMine, withLive(queued), "7").requirement).toEqual({ metal: 3298 + 5277, crystal: 1649 + 2638, deuterium: 0 });
  });

  test("moon and research queues also move the starting point", () => {
    const moonRobotics: LevelSupplyRequest = { kind: "moon", key: "roboticsFactory", label: "Robotics Factory", level: 4 };
    const moon = (queue: unknown) => ({ wallet: "wallet", homePlanetId: "1", parentPlanetId: "7", moon: { exists: true, planetId: "7" }, resourcesAsOfNow: empty, queue,
      buildings: [{ id: 1, key: "roboticsFactory", label: "Robotics Factory", level: 2, cost: { metal: "1600", crystal: "480", deuterium: "800" } }] } as unknown as ChainMoonState);
    expect(levelSupplyPreview(moonRobotics, moon(null), "7")).toMatchObject({ fromLevel: 3, requirement: { metal: 1600 + 3200, crystal: 480 + 960, deuterium: 800 + 1600 } });
    expect(levelSupplyPreview(moonRobotics, moon({ active: true, kind: "moonBuilding", itemId: 1, targetLevel: 3 }), "7")).toMatchObject({ fromLevel: 4, requirement: { metal: 3200, crystal: 960, deuterium: 1600 } });
    const energyId = researchCatalog.find(r => r.key === "energy")!.id;
    const energy: LevelSupplyRequest = { kind: "research", key: "energy", label: "Energy Technology", level: 6 };
    const research = (queue: unknown) => ({ wallet: "wallet", homePlanetId: "1", planetId: "7", resourcesAsOfNow: empty, resources: null, researchAvailable: true, researchLabLevel: 1, queue,
      technologies: [{ id: energyId, level: 4, cost: { metal: "0", crystal: "12800", deuterium: "6400" } }] } as unknown as ChainResearchState);
    expect(levelSupplyPreview(energy, research(null), "7")).toMatchObject({ fromLevel: 5, requirement: { metal: 0, crystal: 12800 + 25600, deuterium: 6400 + 12800 } });
    expect(levelSupplyPreview(energy, research({ active: true, kind: "research", itemId: energyId, targetLevel: 5 }), "7")).toMatchObject({ fromLevel: 6, requirement: { metal: 0, crystal: 25600, deuterium: 12800 } });
  });

  test("resource types with zero cost stay zero across the whole range", () => {
    expect(cumulativeLevelSupplyCost({ kind: "research", key: "energy", label: "Energy Technology", level: 5 }, 2)).toMatchObject({ metal: 0n });
    expect(cumulativeLevelSupplyCost({ kind: "research", key: "graviton", label: "Graviton", level: 1 }, 1)).toEqual({ metal: 0n, crystal: 0n, deuterium: 0n });
    expect(cumulativeLevelSupplyCost(crystalMine, 1).deuterium).toBe(0n);
    expect(() => cumulativeLevelSupplyCost(crystalMine, 12)).toThrow("range");
    expect(() => cumulativeLevelSupplyCost(crystalMine, 0)).toThrow("range");
  });
});
