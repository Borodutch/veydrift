import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { publicMoonActions } from "../src/components/PublicMoonDetail";
import { MoonActionStrip } from "../src/components/MoonPage";
import { planetsFromSystemResponse } from "../src/data/mockUniverse";
import type { GalaxyAction } from "../src/galaxyActions";
import type { ChainShipyardState } from "../src/walletFlow";

const account = "0x1111111111111111111111111111111111111111";
const coords = { galaxy: 2, system: 44, position: 9 };
const [planet] = planetsFromSystemResponse({ galaxy: 2, system: 44, planets: [{
  ...coords, key: "2:44:9", fields: 211, temperature: -8, hasMoon: true,
  metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000,
  occupiedBy: { owner: "0x2222222222222222222222222222222222222222", planetId: "9" },
}] });
const shipyardState: ChainShipyardState = {
  wallet: account, homePlanetId: "7", productionAvailable: true, resources: null,
  shipyardLevel: 1, naniteLevel: 0, technologyLevels: {}, queue: null,
  ships: [{ id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
};
const base = {
  account, coords, planet: planet!, shipyardState, homePlanetId: "7",
  homeCoords: { galaxy: 2, system: 44, position: 1 }, defenseState: null,
  actionState: { status: "idle" as const }, attackProtectionUnavailable: false,
  attackProtection: { allowed: true, blockedReason: "none" as const, blockedReasonLabel: null, targetPlanetId: "9" },
  onAction: (_action: GalaxyAction) => {},
};
function nodes(node: ComponentChildren): VNode<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const vnode = node as VNode<Record<string, any>>;
  return [vnode, ...nodes(vnode.props.children)];
}
function text(node: ComponentChildren): string {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!node) return "";
  if (typeof node !== "object") return String(node);
  return text((node as VNode).props.children);
}
function attack(overrides: Partial<Parameters<typeof publicMoonActions>[0]> = {}) {
  return publicMoonActions({ ...base, ...overrides }).find(action => action.kind === "attack")!;
}

describe("public moon Attack discoverability", () => {
  test("eligible attack remains actionable and preserves the moon destination", () => {
    const launches: unknown[] = [];
    const action = attack({ onAction: (...args) => launches.push(args) });
    const tree = MoonActionStrip({ actions: [action], showUnavailable: true });
    const button = nodes(tree).find(node => node.type === "button")!;
    expect(button.props.disabled).toBe(false);
    expect(text(tree)).toContain("Attack");
    button.props.onClick();
    expect(launches).toEqual([[expect.objectContaining({ kind: "attack", defaultTargetIsMoon: true }), planet, coords]]);
  });

  test.each([
    ["loading protection", { attackProtection: null, attackProtectionUnavailable: true, attackProtectionLoading: true }, "Checking attack protection"],
    ["failed protection", { attackProtection: null, attackProtectionUnavailable: true }, "Refresh before attacking"],
    ["disconnected", { account: undefined }, "Connect a wallet"],
    ["no origin", { homePlanetId: undefined }, "No home planet"],
    ["inventory loading", { shipyardState: null }, "Shipyard state is still loading"],
    ["no ships", { shipyardState: { ...shipyardState, ships: [] } }, "Requires at least one movable ship"],
    ["launch restricted", { shipyardState: { ...shipyardState, fleetLaunchAvailable: false } }, "Fleet slot state"],
    ["no callback", { onAction: undefined }, "Mission actions unavailable"],
    ["wallet unavailable", { transactionUnavailableReason: "Reconnect your wallet." }, "Reconnect your wallet"],
    ["own moon", { planet: { ...planet!, occupiedBy: { owner: account, planetId: "9" } } }, "You cannot attack your own moon"],
    ["busy", { actionState: { status: "pending", label: "Preparing mission…" } }, "Preparing mission"],
    ...(["same_alliance", "score_protection", "bashing_limit"] as const).map(blockedReason => [blockedReason, {
      attackProtection: { ...base.attackProtection, allowed: false, blockedReason, blockedReasonLabel: "Restricted target." },
    }, "Restricted target"]),
  ] as Array<[string, Partial<Parameters<typeof publicMoonActions>[0]>, string]>)("%s keeps Attack disabled with a visible explanation", (_name, overrides, reason) => {
    const action = attack(overrides);
    expect(action.onClick).toBeUndefined();
    const tree = MoonActionStrip({ actions: [action], showUnavailable: true });
    const button = nodes(tree).find(node => node.type === "button")!;
    expect(button.props.disabled).toBe(true);
    expect(button.props.onClick).toBeUndefined();
    expect(button.props["aria-label"]).toContain(reason);
    expect(text(tree)).toContain(reason);
    expect(nodes(tree).find(node => node.type === "p")).toBeDefined();
  });

  test("compact strips retain existing filtering and cannot invoke disabled callbacks", () => {
    const action = { ...attack(), disabledReason: "Restricted target." };
    expect(MoonActionStrip({ actions: [action] })).toBeNull();
    const tree = MoonActionStrip({ actions: [action], showUnavailable: true });
    expect(nodes(tree).find(node => node.type === "button")?.props.onClick).toBeUndefined();
  });

  test.each(["same_alliance", "score_protection", "bashing_limit"] as const)("matching %s denial remains visible before and after origin loads", blockedReason => {
    const attackProtection = { ...base.attackProtection, allowed: false, blockedReason, blockedReasonLabel: "Restricted target." };
    for (const origin of [null, shipyardState]) {
      const action = attack({ attackProtection, shipyardState: origin });
      expect(action.disabledReason).toBe("Restricted target.");
      expect(action.onClick).toBeUndefined();
    }
  });

  test("allowed protection does not bypass pending origin or other launch guards", () => {
    expect(attack({ shipyardState: null }).disabledReason).toContain("Shipyard state is still loading");
    expect(attack().onClick).toBeDefined();
    expect(attack({ shipyardState: { ...shipyardState, ships: [] } }).onClick).toBeUndefined();
    expect(attack({ shipyardState: { ...shipyardState, fleetLaunchAvailable: false } }).onClick).toBeUndefined();
  });

  test.each([
    { attackProtectionUnavailable: true },
    { attackProtection: { ...base.attackProtection, targetPlanetId: "999", allowed: false, blockedReason: "score_protection" as const, blockedReasonLabel: "Wrong target denial." } },
  ])("unavailable or mismatched denial never explains or enables the current target", overrides => {
    for (const origin of [null, shipyardState]) {
      const action = attack({
        attackProtection: { ...base.attackProtection, allowed: false, blockedReason: "score_protection", blockedReasonLabel: "Stale denial." },
        ...overrides, shipyardState: origin,
      });
      expect(action.disabledReason).toContain("Refresh before attacking");
      expect(action.onClick).toBeUndefined();
    }
  });
});
