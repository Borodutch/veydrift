import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  DebrisTargetRow,
  RaidFinderPagination,
  RaidTargetFilterControls,
  RaidTargetRow,
  defenseLabel,
  raidFinderPagination,
} from "../src/components/RaidTargetFinderPage";
import { DEFAULT_RAID_TARGET_FILTERS, type DebrisFinderTarget, type RaidTarget } from "../src/raidTargetFinder";

describe("RaidTargetFinderPage", () => {
  test("paginates every result mode at 25 rows and clamps stale pages", () => {
    expect(raidFinderPagination(62, 1)).toMatchObject({
      firstEntry: 1,
      lastEntry: 25,
      page: 1,
      totalPages: 3,
    });
    expect(raidFinderPagination(62, 3)).toMatchObject({
      firstEntry: 51,
      lastEntry: 62,
      page: 3,
      totalPages: 3,
    });
    expect(raidFinderPagination(4, 99)).toMatchObject({
      firstEntry: 1,
      lastEntry: 4,
      page: 1,
      totalPages: 1,
    });
  });

  test("renders compact previous and next pagination controls", () => {
    const selected: string[] = [];
    const pagination = RaidFinderPagination({
      onNext: () => selected.push("next"),
      onPrevious: () => selected.push("previous"),
      pagination: raidFinderPagination(62, 2),
    });

    const paginationText = visibleText(pagination).replace(/\s+/g, " ").trim();
    expect(paginationText).toContain("Page 2 of 3");
    expect(paginationText).toContain("26 - 50 of 62");
    buttonWithTitle(pagination, "Previous page")?.props?.onClick?.();
    buttonWithTitle(pagination, "Next page")?.props?.onClick?.();
    expect(selected).toEqual(["previous", "next"]);
  });

  test("renders the Hide active fleet filter control", () => {
    const controls = RaidTargetFilterControls({
      filters: DEFAULT_RAID_TARGET_FILTERS,
      onChange: () => undefined,
      showAllianceFilter: true,
      totals: { total: 10, visible: 6, protected: 1, sameAlliance: 1 },
    });

    expect(visibleText(controls)).toContain("Hide active fleet");
  });

  test("defense hover label combines defending combat ships and static defenses", () => {
    const target = raidTarget({
      combatPower: 6_000,
      combatShipUnits: [{ id: 1, count: 1, power: 4_000 }],
      defensePower: 2_000,
      defenseUnits: [{ id: 0, count: 1, power: 2_000 }],
    });

    expect(defenseLabel(target)).toBe("Defense 6,000 — Ships: Light Fighter x1 (4K); Defenses: Rocket Launcher x1 (2K)");
  });

  test("row exposes enabled and disabled attack actions while the planet label opens details", () => {
    const selected: string[] = [];
    const row = RaidTargetRow({
      attackAction: { label: "Attack" },
      onAttackTarget: (target) => selected.push(target.planetId),
      onSelectPlanet: () => undefined,
      target: raidTarget({ planetId: "9" }),
    });
    const attack = buttonWithTitle(row, "Attack");
    const openPlanet = buttonWithTitle(row, "Open [1:2:3]");

    expect(attack).toBeTruthy();
    expect(attack?.props?.disabled).toBe(false);
    attack?.props?.onClick?.();
    expect(selected).toEqual(["9"]);
    expect(openPlanet).toBeTruthy();
    expect(buttonWithTitle(row, "Inspect planet")).toBeUndefined();

    const disabled = RaidTargetRow({
      attackAction: { label: "Attack", disabledReason: "Attack blocked by score protection" },
      onAttackTarget: (target) => selected.push(target.planetId),
      target: raidTarget({
        planetId: "10",
        protection: {
          isProtected: true,
          isSameAlliance: false,
          blockedReason: "score_protection",
          blockedReasonLabel: "Attack blocked by score protection",
          scoreComparison: { attackerScore: "25437", defenderScore: "7340" },
          defenderInactive: false,
        },
      }),
    });
    const disabledAttack = buttonWithTitle(disabled, "Attack: Attack blocked by score protection");
    const protectedBadge = elementWithExactText(disabled, "Protected");
    expect(disabledAttack?.props?.disabled).toBe(true);
    expect(disabledAttack?.props?.title).toBe("Attack: Attack blocked by score protection");
    expect(protectedBadge?.props?.title).toBe("Attack blocked by score protection");
    expect(visibleText(disabled)).not.toContain("Attack blocked by score protection");
    expect(visibleText(disabled)).not.toContain("Score 25,437 vs 7,340");
    expect(visibleText(disabled)).not.toContain("Score ");
    expect(visibleText(disabled)).not.toContain("Protection score");
  });

  test("row top-level cells expose one combined Defense column before actions", () => {
    const row = RaidTargetRow({
      attackAction: { label: "Attack" },
      onAttackTarget: () => undefined,
      onSelectPlanet: () => undefined,
      target: raidTarget({ combatPower: 6_000, defensePower: 2_000, distance: 100, loot: 1_000 }),
    });
    const cells = directElementChildren(row);

    expect(cells).toHaveLength(5);
    expect(cells[1]?.props?.title).toBe("Distance from your active planet");
    expect(cells[2]?.props?.title).toContain("LOOT M");
    expect(cells[3]?.props?.title).toContain("Defense 6,000");
    expect(visibleText(cells[3])).toBe("6K");
    expect(buttonWithTitle(cells[4], "Attack")).toBeTruthy();
    expect(buttonWithTitle(cells[4], "Inspect planet")).toBeUndefined();
  });

  test("does not repeat coordinates when a target has no custom planet name", () => {
    const row = RaidTargetRow({
      onSelectPlanet: () => undefined,
      target: raidTarget({ name: null }),
    });

    expect(visibleText(row).match(/\[1:2:3\]/g)).toHaveLength(1);
  });

  test("omits moon and fleet-activity presentation from raid rows", () => {
    const row = RaidTargetRow({
      target: raidTarget({
        hasMoon: true,
        moonResources: { metal: "100", crystal: "200", deuterium: "300" },
        inbound: { count: 2, nextArrivalAtMs: 1_770_000_060_000 },
      }),
    });

    expect(visibleText(row)).not.toContain("Moon");
    expect(visibleText(row)).not.toContain("Inbound");
  });

  test("debris row exposes harvest blockers while the planet label opens details", () => {
    const selected: string[] = [];
    const row = DebrisTargetRow({
      action: { label: "Harvest", disabledReason: "Requires a recycler on your active planet." },
      now: 1_770_000_000_000,
      onHarvest: (target) => selected.push(target.planetId),
      onSelectPlanet: () => undefined,
      target: debrisTarget(),
    });
    const harvest = buttonWithTitle(row, "Harvest: Requires a recycler on your active planet.");
    const openPlanet = buttonWithTitle(row, "Open [1:2:3]");

    expect(harvest).toBeTruthy();
    expect(harvest?.props?.disabled).toBe(true);
    expect(harvest?.props?.title).toBe("Harvest: Requires a recycler on your active planet.");
    expect(openPlanet).toBeTruthy();
    expect(buttonWithTitle(row, "Inspect planet")).toBeUndefined();

    const enabled = DebrisTargetRow({
      action: { label: "Harvest" },
      now: 1_770_000_000_000,
      onHarvest: (target) => selected.push(target.planetId),
      target: debrisTarget({ planetId: "10" }),
    });
    const enabledHarvest = buttonWithTitle(enabled, "Harvest");
    enabledHarvest?.props?.onClick?.();
    expect(selected).toEqual(["10"]);
  });

  test("debris row can hide Harvest when an own field is ineligible", () => {
    const row = DebrisTargetRow({
      action: null,
      now: 1_770_000_000_000,
      onHarvest: () => undefined,
      onSelectPlanet: () => undefined,
      target: debrisTarget(),
    });

    expect(buttonWithTitle(row, "Harvest")).toBeUndefined();
    expect(buttonWithTitle(row, "Open [1:2:3]")).toBeTruthy();
    expect(buttonWithTitle(row, "Inspect planet")).toBeUndefined();
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
    moonResources: null,
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
    stationedDefenderForecastTimeline: [],
    stationedDefenderTimelineComplete: true,
    protection: { isProtected: false, isSameAlliance: false, blockedReason: "none", blockedReasonLabel: null, scoreComparison: null, defenderInactive: false },
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

function buttonWithTitle(node: ComponentChildren, title: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "button" && item.props?.title === title);
}

function elementWithExactText(node: ComponentChildren, text: string): VNode | undefined {
  return elementNodes(node).find((item) => visibleText(item).trim() === text);
}
