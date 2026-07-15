import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { PlanetSelectorResearchProgress } from "../src/PlayableMvpApp";

describe("right-sidebar planet selector research progress", () => {
  test("shows only the full active technology name above its progress bar", () => {
    const now = 1_700_000_000_000;
    const progress = PlanetSelectorResearchProgress({
      now,
      queue: {
        active: true,
        asOfNow: { complete: false, secondsRemaining: 60 },
        cost: { crystal: "400000", deuterium: "160000", metal: "240000" },
        itemId: 13,
        kind: "research",
        readyAt: String(now / 1_000 + 60),
        startedAt: String(now / 1_000 - 60),
        targetLevel: 9,
      },
    });
    const name = findByDataAttribute(progress, "data-planet-selector-research-name");
    const status = findByDataAttribute(progress, "data-planet-selector-research-status");

    expect(visibleText(name)).toBe("Intergalactic Research Network");
    expect(name?.props.className).toContain("break-words");
    expect(name?.props.className).toContain("[overflow-wrap:anywhere]");
    expect(name?.props.className).not.toContain("truncate");
    expect(status).toBeUndefined();
    expect(visibleText(progress)).toBe("Intergalactic Research Network");
    expect(progress?.props.title).toBe("Intergalactic Research Network");
    expect(progress?.props["aria-label"]).toBe(
      "Selector research progress. Intergalactic Research Network",
    );
    expect(visibleText(progress)).not.toBe("Research");
    expect(visibleText(progress)).not.toMatch(/\bLevel 9\b|\b1m\b/);
  });

  test("does not render a research row for an inactive queue", () => {
    expect(PlanetSelectorResearchProgress({ now: 1_700_000_000_000, queue: null })).toBeNull();
  });
});

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textParts);
  return textParts((node as VNode).props?.children);
}

function findByDataAttribute(node: ComponentChildren, attribute: string): VNode | undefined {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByDataAttribute(child, attribute);
      if (match) return match;
    }
    return undefined;
  }

  const vnode = node as VNode;
  if (vnode.props?.[attribute] === "true") return vnode;
  return findByDataAttribute(vnode.props?.children, attribute);
}
