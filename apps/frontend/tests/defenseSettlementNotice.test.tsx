import { expect, test } from "bun:test";
import { toChildArray, type ComponentChildren, type VNode } from "preact";
import { DefenseSettlementNotice } from "../src/components/DefenseSettlementNotice";
import { assertDefenseSettlementReady } from "../src/defenseSettlement";
import { defenseProductionItems } from "../src/components/DefensePage";
import type { ChainDefenseState, QueueStateResponse } from "../src/walletFlow";

const queue: QueueStateResponse = {
  active: true, kind: "defense", itemId: 0, quantity: 23, readyAt: "1700001000",
  cost: { metal: "46000", crystal: "0", deuterium: "0" },
  asOfNow: { complete: true, secondsRemaining: 0, completedQuantity: 100, remainingQuantity: 0 },
};
const state: ChainDefenseState = {
  wallet: "0xabc", homePlanetId: "7", resources: null, shipyardLevel: 1, naniteLevel: 0, missileSiloLevel: 0, technologyLevels: {},
  defenses: [{ id: 0, count: 78, cost: queue.cost }], queue: null, unsettledQueue: queue,
};
function nodes(node: ComponentChildren): VNode<any>[] {
  return toChildArray(node).flatMap(child => typeof child === "object" && child !== null
    ? [child as VNode<any>, ...nodes((child as VNode<any>).props.children)] : []);
}
function text(node: ComponentChildren): string {
  return toChildArray(node).map(child => typeof child === "object" && child !== null ? text((child as VNode<any>).props.children) : String(child)).join(" ");
}

test("hard-refresh fixture preserves 78 deployed + 23 unsettled and only sends on click", () => {
  let calls = 0;
  for (const snapshot of [state, JSON.parse(JSON.stringify(state)) as ChainDefenseState]) {
    const notice = DefenseSettlementNotice({ queue: snapshot.unsettledQueue, onFinish: () => { calls++; } });
    expect(text(notice)).toContain("23");
    expect(text(notice)).toContain("Confirm in your wallet");
    const items = defenseProductionItems({ defenseState: snapshot, quantities: {}, actionPending: false, canTransact: true, productionAvailable: true, resources: { metal: 0, crystal: 0, deuterium: 0 } });
    expect(items.find(item => item.id === 0)).toMatchObject({ countValue: 78, queued: 0 });
    expect(calls).toBe(0);
  }
  const button = nodes(DefenseSettlementNotice({ queue, onFinish: () => { calls++; } })).find(node => node.type === "button")!;
  expect(button.props.disabled).toBe(false);
  button.props.onClick();
  expect(calls).toBe(1);
});

test("read-only Overview notice and absent/unknown/not-due queues never offer a send", () => {
  expect(nodes(DefenseSettlementNotice({ queue })).some(node => node.type === "button")).toBe(false);
  const { asOfNow: _progress, ...unknown } = queue;
  for (const candidate of [null, undefined, unknown, { ...queue, asOfNow: { complete: false, secondsRemaining: 230, remainingQuantity: 23 } }]) {
    expect(DefenseSettlementNotice({ queue: candidate, onFinish: () => { throw new Error("automatic send"); } })).toBeNull();
  }
});

test("pending/unknown and unavailable controls are disabled without a click handler", () => {
  for (const options of [{ disabled: true }, { transactionUnavailableReason: "Reconnect your wallet" }]) {
    const notice = DefenseSettlementNotice({ queue, onFinish: () => {}, ...options });
    const button = nodes(notice).find(node => node.type === "button")!;
    expect(button.props.disabled).toBe(true);
    expect(button.props.onClick).toBeUndefined();
    if ("transactionUnavailableReason" in options) expect(text(notice)).toContain(options.transactionUnavailableReason);
  }
});

test("fresh-state guard rejects wrong owner/planet, unavailable, settled and unknown queues", () => {
  expect(() => assertDefenseSettlementReady(state, "0xABC", "7")).not.toThrow();
  for (const fresh of [
    { ...state, wallet: "0xdef" }, { ...state, homePlanetId: "8" },
    { ...state, productionAvailable: false }, { ...state, unsettledQueue: null },
    { ...state, unsettledQueue: { ...queue, asOfNow: { complete: false, secondsRemaining: 230, remainingQuantity: 23 } } },
  ]) expect(() => assertDefenseSettlementReady(fresh, state.wallet, "7")).toThrow();
  const { unsettledQueue: _queue, ...legacy } = state;
  expect(() => assertDefenseSettlementReady(legacy, state.wallet, "7")).toThrow();
});
