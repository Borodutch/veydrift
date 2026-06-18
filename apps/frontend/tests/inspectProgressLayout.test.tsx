import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  InspectCatalogTile,
  InspectPageHeader,
  InspectTwoColumnLayout,
  SingleItemQueueProgress,
  singleItemQueueProgressHeaderClassName,
  singleItemQueueProgressLabelClassName,
  singleItemQueueProgressPercentClassName,
} from "../src/components/InspectProgressLayout";

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

  test("can mute only the catalog tile title while preserving the rest of the tile", () => {
    const tile = InspectCatalogTile({
      asset: "/assets/game/style-pass/generated/research/energy-technology-mid.webp",
      currentText: "Level 0",
      isDimmed: false,
      isSelected: false,
      label: "Energy Technology",
      labelTone: "muted",
      onClick: () => undefined,
      statusText: "Locked",
      statusTone: "warning",
    });
    const title = elementNodes(tile)
      .find((node) => node.type === "span" && visibleText(node) === "Energy Technology");

    expect(title?.props.className).toContain("text-slate-500");
    expect(visibleText(tile)).toContain("Level 0");
    expect(visibleText(tile)).toContain("Locked");
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

  test("keeps single-item queue headers stable for long active item names", () => {
    expect(singleItemQueueProgressHeaderClassName).toContain("grid");
    expect(singleItemQueueProgressHeaderClassName).toContain("minmax(0,1fr)");
    expect(singleItemQueueProgressLabelClassName).toContain("break-words");
    expect(singleItemQueueProgressLabelClassName).not.toContain("truncate");
    expect(singleItemQueueProgressPercentClassName).toContain("w-fit");
    expect(singleItemQueueProgressPercentClassName).not.toContain("shrink-0");
  });

  test("renders shared page header and two-column inspect layout wrappers", () => {
    const header = InspectPageHeader({
      actions: <button type="button">Refresh</button>,
      title: "Research",
    });
    const layout = InspectTwoColumnLayout({
      catalog: <span>Catalog tiles</span>,
      catalogClassName: "grid gap-4",
      detail: <span>Detail panel</span>,
    });

    expect(visibleText(header)).toContain("Research");
    expect(visibleText(header)).not.toContain("Select an item to inspect live state");
    expect(visibleText(header)).toContain("Refresh");
    expect(visibleText(layout)).toContain("Catalog tiles");
    expect(visibleText(layout)).toContain("Detail panel");
    expect((layout.props.children as VNode[])[0]!.props.className).toContain("grid gap-4");
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

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  return [vnode, ...elementNodes(vnode.props?.children)];
}
