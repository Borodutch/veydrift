import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";

import { ActivityRow, PlayerActivitySkeleton } from "../src/components/PlayerActivityDialog";
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
  test("uses dedicated skeleton regions for history and away loading", () => {
    const history = PlayerActivitySkeleton({ mode: "history" }) as VNode;
    const away = PlayerActivitySkeleton({ mode: "away" }) as VNode;

    expect(history.props?.label).toBe("Loading activity");
    expect(away.props?.label).toBe("Loading away activity");
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
});
