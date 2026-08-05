import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";

import { ActivityRow, activityDetail, PlayerActivitySkeleton } from "../src/components/PlayerActivityDialog";
import { formatUserTimestamp } from "../src/timestampFormat";
import type { PlayerActivityItem } from "../src/walletFlow";

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
