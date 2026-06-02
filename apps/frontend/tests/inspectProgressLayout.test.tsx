import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { InspectCatalogTile, SingleItemQueueProgress } from "../src/components/InspectProgressLayout";

describe("shared inspect/progress layout primitives", () => {
  test("renders a selectable catalog tile with shared selected and locked semantics", () => {
    const tile = InspectCatalogTile({
      asset: "/assets/game/style-pass/generated/research/energy-technology-mid.webp",
      currentText: "Level 0",
      isDimmed: true,
      isSelected: true,
      label: "Energy Technology",
      onClick: () => undefined,
      statusText: "Locked",
      statusTone: "warning",
    });
    const text = visibleText(tile);

    expect(tile.type).toBe("button");
    expect(tile.props["aria-pressed"]).toBe(true);
    expect(text).toContain("Energy Technology");
    expect(text).toContain("Level 0");
    expect(text).toContain("Locked");
  });

  test("renders single-item progress with consistent timer and progress math", () => {
    const panel = SingleItemQueueProgress({
      isPrimaryItem: true,
      label: "Research Lab Level 2 is upgrading.",
      now: 1_700_000_060_000,
      queue: {
        readyAt: 1_700_000_120_000,
        startedAt: 1_700_000_000_000,
      },
      title: {
        active: "Construction in progress",
        context: "Active construction",
      },
    });
    const text = visibleText(panel);

    expect(text).toContain("Construction in progress");
    expect(text).toContain("Research Lab Level 2 is upgrading");
    expect(text).toContain("50 %");
    expect(text).toContain("Time remaining");
    expect(text).toContain("1m");
    expect(text).toContain("Ready at");
  });
});

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  return textParts(vnode.props?.children);
}
