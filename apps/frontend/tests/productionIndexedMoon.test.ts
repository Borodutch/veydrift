import { expect, test } from "bun:test";
import { SettlementIndexer } from "../../backend/src/indexer";
import { unitDurationSeconds } from "../../backend/src/readModels";
import type { SettledPlanetEvent } from "../../backend/src/evm";
import { encodeProductionBatchCall } from "../src/walletFlow";
import { productionPlanContext } from "../src/productionBuildPlanContext";
import { evaluateProductionPlan, maxAddableProduction } from "../src/productionBuildPlan";

const player = "0x2222222222222222222222222222222222222222" as const;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const words = (...values: bigint[]) => `0x${values.map(word).join("")}`;
const planet = {
  eventName: "PlanetStarted", transactionHash: "0xabc", blockNumber: "123", planetId: "7", owner: player,
  name: null, galaxy: 2, system: 44, position: 9, fields: 211, temperature: -8,
  metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000,
  lastSettledAt: "1770000000", resources: { metal: "5000", crystal: "5000", deuterium: "5000" },
} satisfies SettledPlanetEvent;

test("indexed moon defense and ship durations reach add and confirm with canonical lunar Shipyard", () => {
  const indexer = new SettlementIndexer({
    async listDebrisFieldEvents() { return []; },
    async listMoonChanceReportEvents() { return []; },
    async listSettledPlanetEvents() { return []; },
  }, 100n);
  indexer.applyEvent(planet);
  const apply = (block: string, hash: string, topics: string[], data: string) => indexer.applyLog({
    blockNumber: block, transactionHash: hash, logIndex: "0x0", topics, data,
  });
  apply("0x87", "0xmoon", ["0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4", `0x${player.slice(2).padStart(64, "0")}`, `0x${word(7n)}`], words(2n, 44n, 9n, 12n, 8777n));
  apply("0x88", "0xshipyard", ["0x59b630c46c04307254808aac61ea2de2a7e6fbf5ed6eb0ebee81c917b575ed3a", `0x${word(7n)}`, `0x${word(3n)}`], words(9n));
  apply("0x89", "0xfunded", ["0xb20fd9e652e1b740544f362fb3047c43a7bf0d6c7fbf0f5cab5f1f939aac6917", `0x${word(7n)}`], words(100000n, 100000n, 100000n, 1770000300n));
  apply("0x8a", "0xcombustion", ["0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f", `0x${player.slice(2).padStart(64, "0")}`, `0x${word(3n)}`], words(2n));
  const indexed = indexer.moonState(player, "7");
  expect(indexed.defenses.find(row => row.id === 0)?.durationSeconds).toBe(288);
  const context = productionPlanContext("moon", { moon: indexed, shipyard: null, defense: null, infrastructure: null });
  expect({ available: context.available, resources: context.resources, level: context.shipyardLevel, item: context.defenses[0] }).toMatchObject({ available: true, resources: { metal: "100000", crystal: "100000" }, level: 9, item: { status: "ready", missing: [], durationSeconds: 288 } });
  expect(maxAddableProduction(context, [], "defense", 0)).toBeGreaterThan(0);
  const rows = [{ kind: "defense" as const, id: 0, quantity: 3 }, { kind: "ship" as const, id: 0, quantity: 1 }];
  const plan = evaluateProductionPlan(rows, context);
  expect(plan.reason).toBeUndefined();
  expect(plan.lines).toHaveLength(2);
  expect(encodeProductionBatchCall("moon", "7", rows)).toMatch(/^0x[0-9a-f]+$/);
});

test("each repeated/mixed row and independent lane tail match contract quantity rounding", () => {
  const shipyardLevel = 12;
  const naniteLevel = 0;
  const rocket = { metal: "2000", crystal: "0", deuterium: "0" };
  const cargo = { metal: "2000", crystal: "2000", deuterium: "0" };
  const context = productionPlanContext("planet", {
    moon: null,
    shipyard: { shipyardLevel, naniteLevel, technologyLevels: { "3": 2 }, ships: [{ id: 0, cost: cargo, durationSeconds: unitDurationSeconds(shipyardLevel, naniteLevel, { metal: 2000, crystal: 2000, deuterium: 0 }, 1) }] } as any,
    defense: { shipyardLevel, naniteLevel, defenses: [{ id: 0, cost: rocket, durationSeconds: unitDurationSeconds(shipyardLevel, naniteLevel, { metal: 2000, crystal: 0, deuterium: 0 }, 1) }] } as any,
    infrastructure: { resourcesAsOfNow: { metal: "1000000", crystal: "1000000", deuterium: "1000000" } } as any,
  });
  context.shipQueue = { label: "Ship", readyAt: "1700000040", backlog: [{ label: "Ship", readyAt: "1700000100" }] };
  context.defenseQueue = { label: "Defense", readyAt: "1700000060", backlog: [{ label: "Defense", readyAt: "1700000200" }] };
  const rows = [
    { kind: "defense" as const, id: 0, quantity: 3 },
    { kind: "ship" as const, id: 0, quantity: 2 },
    { kind: "defense" as const, id: 0, quantity: 1 },
    { kind: "ship" as const, id: 0, quantity: 3 },
  ];
  const plan = evaluateProductionPlan(rows, context, 1_700_000_000_000);
  expect(plan.reason).toBeUndefined();
  const expected = rows.map(({ kind, quantity }) => unitDurationSeconds(shipyardLevel, naniteLevel,
    kind === "ship" ? { metal: 2000, crystal: 2000, deuterium: 0 } : { metal: 2000, crystal: 0, deuterium: 0 }, quantity));
  expect(expected[0]).toBe(665); // ceil(2000 × 3 × 3600 / (2500 × 13)), not 3 × 222.
  expect(plan.lines.map(line => line.durationSeconds)).toEqual(expected);
  expect(plan.durationSeconds).toBe(Math.max(200 + expected[0]! + expected[2]!, 100 + expected[1]! + expected[3]!));
  context.defenseShipyardLevel = 9;
  context.defenseNaniteLevel = 2;
  const independent = evaluateProductionPlan(rows, context, 1_700_000_000_000);
  expect(independent.lines.map(line => line.durationSeconds)).toEqual(rows.map((row, index) => row.kind === "ship"
    ? expected[index] : unitDurationSeconds(9, 2, { metal: 2000, crystal: 0, deuterium: 0 }, row.quantity)));
});

test("batch rounding matches Solidity ceil-div at nanite levels and large quantities", () => {
  for (const [shipyardLevel, naniteLevel, quantity] of [[0, 0, 1], [12, 0, 3], [9, 2, 777], [25, 5, 100000]] as const) {
    const cost = { metal: 2000, crystal: 500, deuterium: 300 };
    const denominator = 2500n * BigInt(shipyardLevel + 1) * (2n ** BigInt(naniteLevel));
    const numerator = 2500n * BigInt(quantity) * 3600n;
    const contract = Number((numerator + denominator - 1n) / denominator || 1n);
    const backend = unitDurationSeconds(shipyardLevel, naniteLevel, cost, quantity);
    expect(backend).toBe(contract);
    const context = productionPlanContext("planet", {
      moon: null, shipyard: { shipyardLevel, naniteLevel, ships: [], technologyLevels: {} } as any,
      defense: { shipyardLevel, naniteLevel, defenses: [{ id: 0, cost: { metal: "2000", crystal: "500", deuterium: "300" }, durationSeconds: unitDurationSeconds(shipyardLevel, naniteLevel, cost, 1) }] } as any,
      infrastructure: { resourcesAsOfNow: { metal: "1000000000", crystal: "1000000000", deuterium: "1000000000" } } as any,
    });
    expect(evaluateProductionPlan([{ kind: "defense", id: 0, quantity }], context).lines[0]?.durationSeconds).toBe(contract);
  }
});
