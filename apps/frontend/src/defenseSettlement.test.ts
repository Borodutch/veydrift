import { expect, test } from "bun:test";
import { pendingDefenseSettlement } from "./defenseSettlement";
import type { QueueStateResponse } from "./walletFlow";

const batch = (itemId: number, quantity: number, remainingQuantity: number): QueueStateResponse => ({
  active: true, kind: "defense", itemId, quantity, readyAt: "1700001000",
  cost: { metal: "46000", crystal: "0", deuterium: "0" },
  productionTiming: { originalQuantity: 100, startedAt: "1700000000", unitWorkSeconds: "10", rate: "1" },
  asOfNow: { complete: remainingQuantity === 0, secondsRemaining: remainingQuantity * 10, completedQuantity: 100 - remainingQuantity, remainingQuantity },
});

test("1+100 purchase with 77 credited shows only the matured canonical remainder", () => {
  expect([...pendingDefenseSettlement(batch(0, 23, 23))]).toEqual([]);
  expect([...pendingDefenseSettlement(batch(0, 23, 20))]).toEqual([[0, 3]]);
  expect([...pendingDefenseSettlement(batch(0, 23, 0))]).toEqual([[0, 23]]);
  expect([...pendingDefenseSettlement(null)]).toEqual([]);
  expect([...pendingDefenseSettlement(undefined)]).toEqual([]);
});

test("aggregate due linked batches by defense type, without inactive or still-building units", () => {
  const queue = { ...batch(0, 23, 0), backlog: [batch(1, 5, 2), batch(0, 4, 0), batch(2, 5, 5), { ...batch(0, 9, 0), active: false }] };
  expect([...pendingDefenseSettlement(queue)]).toEqual([[0, 27], [1, 3]]);
  expect([...pendingDefenseSettlement(JSON.parse(JSON.stringify(queue)))]).toEqual([[0, 27], [1, 3]]);
});

test("legacy timing only and inconsistent progress cannot invent credits", () => {
  const { asOfNow: _progress, ...legacy } = batch(0, 23, 0);
  expect([...pendingDefenseSettlement(legacy)]).toEqual([]);
  expect([...pendingDefenseSettlement(batch(0, 23, 100))]).toEqual([]);
  expect([...pendingDefenseSettlement(batch(0, 23, -10))]).toEqual([[0, 23]]);
});
