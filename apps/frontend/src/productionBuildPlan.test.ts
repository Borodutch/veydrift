import { describe, expect, test } from "bun:test";
import { evaluateProductionPlan, maxAddableProduction, productionDraftAfterReceipt, productionDraftKey, removeSubmittedSnapshot, type ProductionPlanContext } from "./productionBuildPlan";
import { encodeProductionBatchCall } from "./walletFlow";
import { defenseCatalog, shipyardCatalog } from "./playableMvp";
import type { ProductionCatalogItem } from "./components/ProductionCatalog";

const ship = shipyardCatalog[0]!;
const defense = defenseCatalog[0]!;
const item = (source: typeof ship | typeof defense, cost: string): ProductionCatalogItem => ({
  ...source, groupLabel: source.group, countLabel: "Owned", countValue: 0, status: "ready",
  cost: { metal: Number(cost), crystal: 0, deuterium: 0 },
  unitCostRaw: { metal: cost, crystal: "0", deuterium: "0" },
  unitCost: { metal: Number(cost), crystal: 0, deuterium: 0 },
  durationSeconds: 120, requirements: [], missing: [], quantity: 1, disabled: false,
  actionLabel: "Build", detailNote: "",
});
const context = (balance = "90071992547409999", body: "planet" | "moon" = "planet"): ProductionPlanContext => ({
  body, resources: { metal: balance, crystal: "0", deuterium: "0" },
  ships: [item(ship, "50000000000000000")], defenses: [item(defense, "50000000000000000")],
  defenseCounts: [], missileSiloLevel: 0, shipyardLevel: 0, naniteLevel: 0, available: true,
});

describe("production build plan", () => {
  test("two individually affordable kinds collectively exceed a BigInt body budget", () => {
    const ctx = context();
    const rows = [{ kind: "ship" as const, id: ship.id, quantity: 1 }, { kind: "defense" as const, id: defense.id, quantity: 1 }];
    expect(evaluateProductionPlan(rows.slice(0, 1), ctx).reason).toBeUndefined();
    expect(evaluateProductionPlan(rows.slice(1), ctx).reason).toBeUndefined();
    expect(evaluateProductionPlan(rows, ctx).reason).toMatch(/Insufficient resources/);
    expect(maxAddableProduction(ctx, rows.slice(0, 1), "defense", defense.id)).toBe(0);
  });
  test("repeated types, quantity, remove and per-body isolation", () => {
    const one = { kind: "ship" as const, id: ship.id, quantity: 1 };
    const ctx = context("150000000000000000");
    expect(evaluateProductionPlan([one, one, one], ctx).cost.metal).toBe(150000000000000000n);
    expect(maxAddableProduction(ctx, [one, one], "ship", ship.id)).toBe(1);
    expect(removeSubmittedSnapshot([one, one, one], [one, one])).toEqual([one]);
    expect(productionDraftKey("0xAbC", "0x2105", "7", "moon")).not.toBe(productionDraftKey("0xAbC", "0x2105", "7", "planet"));
    expect(evaluateProductionPlan([one], context("100", "moon")).reason).toMatch(/Insufficient resources/);
  });
  test("ETA includes the already-paid queue tail without charging it again", () => {
    const ctx = context("100000000000000000");
    ctx.shipQueue = { label: "Cargo", readyAt: "1700000060", backlog: [{ label: "Cargo", readyAt: "1700000120" }] };
    ctx.ships = [item(ship, "100")];
    const plan = evaluateProductionPlan([{ kind: "ship", id: ship.id, quantity: 1 }], ctx, 1_700_000_000_000);
    expect(plan.durationSeconds).toBe(264);
    expect(plan.cost.metal).toBe(100n);
  });
  test.each(["ship", "defense"] as const)("%s-only ETA excludes the opposite long queue", kind => {
    const ctx = context("100000000000000000");
    ctx.ships = [item(ship, "100")];
    ctx.defenses = [item(defense, "100")];
    const oppositeQueue = { label: "Already paid", readyAt: "1700010000" };
    if (kind === "ship") ctx.defenseQueue = oppositeQueue;
    else ctx.shipQueue = oppositeQueue;
    const plan = evaluateProductionPlan([{ kind, id: kind === "ship" ? ship.id : defense.id, quantity: 1 }], ctx, 1_700_000_000_000);
    expect(plan.durationSeconds).toBe(144);
    expect(plan.cost.metal).toBe(100n);
  });
  test("pending and rejected transactions retain every draft row until confirmed receipt", () => {
    const row = { kind: "ship" as const, id: ship.id, quantity: 1 };
    const rows = [row, { kind: "defense" as const, id: defense.id, quantity: 1 }];
    for (const phase of ["pending", "confirming", "unknown", "error"] as const) {
      expect(productionDraftAfterReceipt(rows, [row], phase)).toEqual(rows);
    }
    expect(productionDraftAfterReceipt(rows, [row], "confirmed")).toEqual([rows[1]!]);
    // Unknown outcomes permit editing: a newly added identical row is not the sent snapshot.
    const replacement = { ...row };
    expect(productionDraftAfterReceipt([replacement], [row], "confirmed")).toEqual([replacement]);
  });
  test("defense capacity counts queued and draft domes and missile slots", () => {
    const dome = defenseCatalog.find(entry => entry.key === "smallShieldDome")!;
    const anti = defenseCatalog.find(entry => entry.key === "antiBallisticMissile")!;
    const ctx = context("1000000000000000000");
    ctx.defenses = [item(dome, "10"), item(anti, "10")];
    ctx.capacityQueue = { active: false, kind: "defense", itemId: dome.id, readyAt: null, cost: { metal: "0", crystal: "0", deuterium: "0" },
      backlog: [{ active: true, kind: "defense", itemId: dome.id, quantity: 1, readyAt: null, cost: { metal: "0", crystal: "0", deuterium: "0" } }] };
    expect(maxAddableProduction(ctx, [], "defense", dome.id)).toBe(0);
    expect(maxAddableProduction(ctx, [], "defense", anti.id)).toBe(0);
    ctx.missileSiloLevel = 1;
    expect(maxAddableProduction(ctx, [], "defense", anti.id)).toBe(10);
    expect(maxAddableProduction(ctx, [{ kind: "defense", id: anti.id, quantity: 7 }], "defense", anti.id)).toBe(3);
  });
  test.each(["planet", "moon"] as const)("%s accepts 15 rows, counts shared lanes and rejects row 16", body => {
    const ctx = context("1000000000000000000", body);
    ctx.ships = [item(ship, "1")];
    ctx.defenses = [item(defense, "1")];
    const rows = Array.from({ length: 15 }, (_, index) => ({ kind: index % 2 ? "defense" as const : "ship" as const, id: index % 2 ? defense.id : ship.id, quantity: 1 }));
    expect(evaluateProductionPlan(rows, ctx).reason).toBeUndefined();
    expect(encodeProductionBatchCall(body, "7", rows)).toMatch(/^0x[0-9a-f]+$/);
    expect(maxAddableProduction(ctx, rows, "ship", ship.id)).toBe(0);
    expect(evaluateProductionPlan([...rows, rows[0]!], ctx).reason).toMatch(/Maximum 15 orders/);
    expect(() => encodeProductionBatchCall(body, "7", [...rows, rows[0]!])).toThrow("Invalid build plan");
    expect(maxAddableProduction(ctx, rows.slice(1), "ship", ship.id)).toBeGreaterThan(0);
    ctx.shipBacklogLength = 9;
    expect(evaluateProductionPlan(rows, ctx).reason).toMatch(/backlog is full/);
    expect(maxAddableProduction(ctx, rows.slice(1), "ship", ship.id)).toBe(0);
    ctx.shipBacklogLength = 8;
    expect(evaluateProductionPlan(rows, ctx).reason).toBeUndefined();
  });
  test("malformed, non-buildable moon units and empty plan cannot encode", () => {
    const ctx = context();
    expect(evaluateProductionPlan([{ kind: "ship", id: ship.id, quantity: 0 }], ctx).reason).toBe("Invalid production order");
    expect(evaluateProductionPlan([{ kind: "ship", id: ship.id, quantity: 0xffffffff + 1 }], ctx).reason).toBe("Invalid production order");
    expect(() => encodeProductionBatchCall("planet", "7", [])).toThrow();
    expect(() => encodeProductionBatchCall("moon", "7", [{ kind: "ship", id: ship.id, quantity: 0 }])).toThrow();
    expect(encodeProductionBatchCall("planet", "7", [{ kind: "ship", id: ship.id, quantity: 1 }])).toMatch(/^0x[0-9a-f]+$/);
  });
});
