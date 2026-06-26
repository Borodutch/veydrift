import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { DebrisTargetRow, RaidTargetFilterControls, RaidTargetRow, combatLabel, defenseLabel } from "../src/components/RaidTargetFinderPage";
import { DEFAULT_RAID_TARGET_FILTERS, type DebrisFinderTarget, type RaidTarget } from "../src/raidTargetFinder";

describe("RaidTargetFinderPage", () => {
  test("renders the Hide active fleet filter control", () => {
    const controls = RaidTargetFilterControls({
      filters: DEFAULT_RAID_TARGET_FILTERS,
      onChange: () => undefined,
      showAllianceFilter: true,
      totals: { total: 10, visible: 6, protected: 1, sameAlliance: 1 },
    });

    expect(visibleText(controls)).toContain("Hide active fleet");
  });

  test("combat and defense hover labels include per-unit breakdowns", () => {
    const target = raidTarget({
      combatPower: 6_000,
      combatShipUnits: [{ id: 1, count: 1, power: 4_000 }],
      defensePower: 2_000,
      defenseUnits: [{ id: 0, count: 1, power: 2_000 }],
    });

    expect(combatLabel(target)).toBe("Combat 6,000 — Ships: Light Fighter x1 (4K); Defenses: Rocket Launcher x1 (2K)");
    expect(defenseLabel(target)).toBe("Defense power 2,000 — Defenses: Rocket Launcher x1 (2K)");
  });

  test("row exposes enabled and disabled attack actions without dropping Inspect", () => {
    const selected: string[] = [];
    const row = RaidTargetRow({
      attackAction: { label: "Attack" },
      missionSubtext: { lines: [], overflow: 0 },
      now: 1_770_000_000_000,
      onAttackTarget: (target) => selected.push(target.planetId),
      onSelectPlanet: () => undefined,
      target: raidTarget({ planetId: "9" }),
    });
    const attack = buttonWithText(row, "Attack");
    const inspect = buttonWithText(row, "Inspect");

    expect(attack).toBeTruthy();
    expect(attack?.props?.disabled).toBe(false);
    attack?.props?.onClick?.();
    expect(selected).toEqual(["9"]);
    expect(inspect).toBeTruthy();

    const disabled = RaidTargetRow({
      attackAction: { label: "Attack", disabledReason: "Attack blocked by score protection" },
      missionSubtext: { lines: [], overflow: 0 },
      now: 1_770_000_000_000,
      onAttackTarget: (target) => selected.push(target.planetId),
      target: raidTarget({ planetId: "10" }),
    });
    const disabledAttack = buttonWithText(disabled, "Attack");
    expect(disabledAttack?.props?.disabled).toBe(true);
    expect(disabledAttack?.props?.title).toBe("Attack blocked by score protection");
  });

  test("row top-level cells match the desktop header order before actions", () => {
    const row = RaidTargetRow({
      attackAction: { label: "Attack" },
      missionSubtext: { lines: [], overflow: 0 },
      now: 1_770_000_000_000,
      onAttackTarget: () => undefined,
      onSelectPlanet: () => undefined,
      target: raidTarget({ combatPower: 6_000, defensePower: 2_000, distance: 100, loot: 1_000 }),
    });
    const cells = directElementChildren(row);

    expect(cells).toHaveLength(6);
    expect(cells[1]?.props?.title).toBe("Distance from your active planet");
    expect(cells[2]?.props?.title).toContain("LOOT M");
    expect(cells[3]?.props?.title).toContain("Combat 6,000");
    expect(cells[4]?.props?.title).toContain("Defense power 2,000");
    expect(visibleText(cells[5])).toContain("Attack");
    expect(visibleText(cells[5])).toContain("Inspect");
  });

  test("debris row exposes harvest blockers and keeps Inspect", () => {
    const selected: string[] = [];
    const row = DebrisTargetRow({
      action: { label: "Harvest", disabledReason: "Requires a recycler on your active planet." },
      now: 1_770_000_000_000,
      onHarvest: (target) => selected.push(target.planetId),
      onSelectPlanet: () => undefined,
      target: debrisTarget(),
    });
    const harvest = buttonWithText(row, "Harvest");
    const inspect = buttonWithText(row, "Inspect");

    expect(harvest).toBeTruthy();
    expect(harvest?.props?.disabled).toBe(true);
    expect(harvest?.props?.title).toBe("Requires a recycler on your active planet.");
    expect(inspect).toBeTruthy();

    const enabled = DebrisTargetRow({
      action: { label: "Harvest" },
      now: 1_770_000_000_000,
      onHarvest: (target) => selected.push(target.planetId),
      target: debrisTarget({ planetId: "10" }),
    });
    const enabledHarvest = buttonWithText(enabled, "Harvest");
    enabledHarvest?.props?.onClick?.();
    expect(selected).toEqual(["10"]);
  });
});

function raidTarget(overrides: Partial<RaidTarget> = {}): RaidTarget {
  return {
    planetId: "1",
    name: "Nal Hutta",
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    owner: "0xabc",
    ownerDisplayName: "Commander",
    alliance: null,
    hasMoon: false,
    distance: 100,
    loot: 1_000,
    grossLoot: 2_000,
    raidableResources: { metal: "500", crystal: "300", deuterium: "200" },
    combatPower: 0,
    shipPower: 0,
    shipCount: 0,
    shipUnits: [],
    combatShipUnits: [],
    defensePower: 0,
    defenseCount: 0,
    defenseUnits: [],
    protection: { isProtected: false, isSameAlliance: false, blockedReason: "none", blockedReasonLabel: null, defenderInactive: false },
    inbound: { count: 0, nextArrivalAtMs: null },
    ...overrides,
  };
}

function debrisTarget(overrides: Partial<DebrisFinderTarget> = {}): DebrisFinderTarget {
  return {
    planetId: "9",
    name: "Scrap Yard",
    coordinates: { galaxy: 1, system: 2, position: 3 },
    archetype: "temperate-ocean",
    owner: "0xabc",
    hasMoon: false,
    metal: 40_000,
    crystal: 10_000,
    total: 50_000,
    distance: 100,
    etaSeconds: 300,
    fuelCost: 25,
    recyclersNeeded: 3,
    recyclerCapacity: 60_000,
    harvestDisabledReason: null,
    ...overrides,
  };
}

function visibleText(node: ComponentChildren): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    const Component = vnode.type as ((props: Record<string, unknown>) => ComponentChildren) & { displayName?: string };
    if (Component.name === "Icon" || Component.displayName === "Icon") return "";
    return visibleText(Component(vnode.props ?? {}));
  }
  return visibleText(vnode.props?.children);
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(elementNodes);
  const vnode = node as VNode;
  const children = elementNodes(vnode.props?.children);
  return [vnode, ...children];
}

function directElementChildren(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.filter((item): item is VNode => typeof item === "object" && item !== null);
  const vnode = node as VNode;
  const children = vnode.props?.children as ComponentChildren;
  if (!Array.isArray(children)) return directElementChildren(children);
  return children.filter((item): item is VNode => typeof item === "object" && item !== null);
}

function buttonWithText(node: ComponentChildren, text: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "button" && visibleText(item).includes(text));
}
