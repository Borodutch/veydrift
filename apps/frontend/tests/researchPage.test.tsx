import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  ResearchLoadErrorPanel,
  shouldHideResearchValues,
} from "../src/components/ResearchPage";

describe("Research page load-error display", () => {
  test("hides live research values after backend load errors", () => {
    expect(shouldHideResearchValues({
      error: "Research request failed with 503",
      loading: false,
      researchState: null,
      useLocalStateFallback: false,
    })).toBe(true);
  });

  test("keeps disconnected local research fallback explicit", () => {
    expect(shouldHideResearchValues({
      error: undefined,
      loading: false,
      researchState: null,
      useLocalStateFallback: true,
    })).toBe(false);
  });

  test("renders load errors without zeroed research values", () => {
    const panel = ResearchLoadErrorPanel({
      loading: false,
      reason: "Research request failed with 503",
    });
    const text = visibleText(panel);

    expect(text).toContain("Research state could not be loaded");
    expect(text).toContain("Research request failed with 503");
    expect(text).toContain("Levels, costs, resources, queue state, and requirement-derived values are unavailable");
    expect(text).not.toMatch(/\bLevel 0\b|Research Level 1|Research Lab 1 is required|No resource cost/);
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
