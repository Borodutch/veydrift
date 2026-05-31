import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { TopBar } from "../src/components/TopBar";

describe("TopBar", () => {
  test("keeps mobile resources and collect action in a compact row", () => {
    const topBar = renderTopBar();
    const resourceRow = elementNodes(topBar).find(
      (node) =>
        typeof node.props?.className === "string" &&
        node.props.className.includes("grid-cols-[repeat(3,minmax(0,1fr))_minmax(4.5rem,1.25fr)_1.75rem_1.75rem]")
    );
    const collectButton = buttonWithLabel(topBar, "Collect accrued resources: Metal +10 / Crystal +5");
    const supportLink = linkWithLabel(topBar, "Telegram support");

    expect(resourceRow?.props?.className).toContain("sm:flex-wrap");
    expect(resourceRow?.props?.className).toContain("gap-0.5");
    expect(resourceRow?.props?.className).toContain("_1.75rem_1.75rem]");
    expect(collectButton?.props?.className).toContain("h-7 w-7");
    expect(collectButton?.props?.className).toContain("col-start-6");
    expect(collectButton?.props?.className).toContain("sm:w-auto");
    expect(collectButton?.props?.title).toBe("Collect accrued resources: Metal +10 / Crystal +5");
    expect(supportLink?.props?.className).toContain("h-7 w-7");
    expect(supportLink?.props?.className).toContain("sm:hidden");
  });

  test("renders abbreviated mobile resource labels and full desktop labels", () => {
    const topBar = renderTopBar();
    const text = visibleText(topBar);

    expect(text).toContain("M");
    expect(text).toContain("C");
    expect(text).toContain("D");
    expect(text).toContain("E");
    expect(text).toContain("Metal");
    expect(text).toContain("Crystal");
    expect(text).toContain("Deuterium");
    expect(text).toContain("Energy");
    expect(text).toContain("Collect");
  });

  test("shows compact nonzero collectable deltas next to mobile resources", () => {
    const topBar = renderTopBar();
    const text = visibleText(topBar).replace(/\s+/g, "");

    expect(text).toContain("(+10)");
    expect(text).toContain("(+5)");
    expect(text).not.toContain("(+0)");
  });
});

function renderTopBar(): ComponentChildren {
  return TopBar({
    canCollectResources: true,
    caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    energy: { produced: 100, required: 125, scaleBps: 8_000 },
    isWalletConnected: true,
    onCollectResources: () => undefined,
    rates: { metal: 77, crystal: 29, deuterium: 14 },
    resourceDeltas: { metal: 10, crystal: 5, deuterium: 0 },
    resources: { metal: 56, crystal: 243, deuterium: 31 },
    resourceStatus: "ready",
    showCollectResources: true,
  });
}

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
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return textParts(vnode.type(vnode.props));
  }
  return textParts(vnode.props?.children as ComponentChildren);
}

function buttonWithLabel(node: ComponentChildren, label: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "button" && item.props?.["aria-label"] === label);
}

function linkWithLabel(node: ComponentChildren, label: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "a" && item.props?.["aria-label"] === label);
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return elementNodes(vnode.type(vnode.props));
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
