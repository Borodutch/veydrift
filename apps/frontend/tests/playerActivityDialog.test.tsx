import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";

import {
  ActivityCategoryFilters,
  ActivityRow,
  activityCategoryCounts,
  activityCategoryFilterReducer,
  activityDetail,
  filterPlayerActivityItems,
  PlayerActivitySkeleton,
} from "../src/components/PlayerActivityDialog";
import { formatUserTimestamp } from "../src/timestampFormat";
import type { PlayerActivityCategory, PlayerActivityItem } from "../src/walletFlow";

const explorerUrl = "https://basescan.org";

function activity(overrides: Partial<PlayerActivityItem> = {}): PlayerActivityItem {
  return {
    id: "activity:1",
    wallet: "0x1111111111111111111111111111111111111111",
    category: "production",
    kind: "ship-completed",
    direction: "personal",
    title: "Small Cargo completed",
    detail: "6 built",
    occurredAt: "1770000000",
    transactionAt: "1770000000",
    transactionHash: "0xreconciliation",
    relatedTransactionHash: "0xqueue",
    blockNumber: "123",
    logIndex: 1,
    reconciliation: "indexed",
    metadata: {},
    ...overrides,
  };
}

function nodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  const vnode = node as VNode;
  return [vnode, ...nodes(vnode.props?.children as ComponentChildren)];
}

describe("player activity rows", () => {
  test("uses a dedicated skeleton region for activity loading", () => {
    const history = PlayerActivitySkeleton() as VNode;

    expect(history.props?.label).toBe("Loading activity");
  });

  test("can preserve a populated page height while pagination loads", () => {
    const history = PlayerActivitySkeleton({ rowCount: 25 }) as VNode;

    expect(history.props?.children).toHaveLength(25);
  });

  test("links only reconciled activity to its reconciliation transaction", () => {
    const reconciled = ActivityRow({ explorerUrl, item: activity() });
    const projected = ActivityRow({
      explorerUrl,
      item: activity({
        transactionHash: null,
        reconciliation: "projected",
      }),
    });

    expect(nodes(reconciled).find((node) => node.type === "a")?.props?.href)
      .toBe("https://basescan.org/tx/0xreconciliation");
    expect(nodes(projected).some((node) => node.type === "a")).toBe(false);
    expect(nodes(projected).some((node) => node.props?.children === "Awaiting reconciliation")).toBe(false);
  });

  test("renders queue ready times as localized dates instead of raw chain timestamps", () => {
    const item = activity({
      kind: "building-started",
      detail: "New Toronto · 6:9:7 · Level 20; ready 1785986329",
      metadata: { readyAt: "1785986329" },
    });

    expect(activityDetail(item)).toBe(
      `New Toronto · 6:9:7 · Level 20; ready ${formatUserTimestamp("1785986329")}`
    );
    expect(activityDetail(item)).not.toContain("1785986329");
  });
});

describe("away activity category filters", () => {
  test("keeps full-period totals while filtering matching events in their original order", () => {
    const items = [
      activity({ id: "combat:new", category: "combat", occurredAt: "1770000030" }),
      activity({ id: "infrastructure", category: "infrastructure", occurredAt: "1770000020" }),
      activity({ id: "combat:old", category: "combat", occurredAt: "1770000010" }),
    ];
    const counts = activityCategoryCounts(items, { combat: 22, infrastructure: 1, research: 0 });
    const filtered = filterPlayerActivityItems(items, "combat");

    expect(counts).toEqual([
      { category: "combat", count: 22 },
      { category: "infrastructure", count: 1 },
    ]);
    expect(filtered.map(({ id }) => id)).toEqual(["combat:new", "combat:old"]);
    expect(filterPlayerActivityItems(items, null).map(({ id }) => id)).toEqual([
      "combat:new",
      "infrastructure",
      "combat:old",
    ]);
    expect(filtered[0]).toBe(items[0]);
    expect(filtered[0]?.transactionHash).toBe("0xreconciliation");
  });

  test("derives reusable category counts from loaded events when the summary is absent", () => {
    const counts = activityCategoryCounts([
      activity({ category: "mission" }),
      activity({ category: "production", id: "production:2" }),
      activity({ category: "mission", id: "mission:2" }),
    ], {});

    expect(counts).toEqual([
      { category: "mission", count: 2 },
      { category: "production", count: 1 },
    ]);
  });

  test("renders All and non-zero categories as touch-sized semantic pressed buttons", () => {
    const selected: Array<PlayerActivityCategory | null> = [];
    const filters = ActivityCategoryFilters({
      counts: [
        { category: "combat", count: 22 },
        { category: "infrastructure", count: 1 },
      ],
      onSelect: (category) => selected.push(category),
      selectedCategory: "combat",
    });
    const buttons = nodes(filters).filter((node) => node.type === "button");

    expect(filters.props?.role).toBe("group");
    expect(filters.props?.["aria-label"]).toBe("Filter activity by category");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.props?.children?.join?.(""))).toEqual(["All 23", "Combat 22", "Infrastructure 1"]);
    expect(buttons.map((button) => button.props?.["aria-pressed"])).toEqual([false, true, false]);
    expect(buttons.every((button) => button.props?.className.includes("min-h-11"))).toBe(true);

    buttons[2]?.props?.onClick();
    buttons[0]?.props?.onClick();
    expect(selected).toEqual(["infrastructure", null]);
  });

  test("supports selected-pill deselection, All reset, and a clean reopened dialog state", () => {
    const selected = activityCategoryFilterReducer(null, { category: "combat", type: "toggle" });
    expect(selected).toBe("combat");
    expect(activityCategoryFilterReducer(selected, { category: "combat", type: "toggle" })).toBeNull();
    expect(activityCategoryFilterReducer("infrastructure", { type: "reset" })).toBeNull();
    expect(activityCategoryFilterReducer(null, { type: "reset" })).toBeNull();
  });
});
