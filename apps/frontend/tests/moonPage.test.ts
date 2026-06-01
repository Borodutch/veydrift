import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { MoonPage } from "../src/components/MoonPage";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../src/moonActions";

describe("Moon page helpers", () => {
  test("accepts only positive integer moon ids", () => {
    expect(isPositiveIntegerInput("9")).toBe(true);
    expect(isPositiveIntegerInput(" 9 ")).toBe(true);
    expect(isPositiveIntegerInput("")).toBe(false);
    expect(isPositiveIntegerInput("0")).toBe(false);
    expect(isPositiveIntegerInput("2.5")).toBe(false);
    expect(isPositiveIntegerInput("44abc")).toBe(false);
  });

  test("omits empty jump cargo instead of building an all-zero ship manifest", () => {
    expect(parseMoonJumpShips("", "")).toBeUndefined();
    expect(parseMoonJumpShips("0", "0")).toBeUndefined();
    expect(parseMoonJumpShips("2", "")).toEqual({ smallCargo: 2, largeCargo: 0 });
    expect(parseMoonJumpShips("", "1")).toEqual({ smallCargo: 0, largeCargo: 1 });
    expect(parseMoonJumpShips("1.5", "abc")).toBeNull();
    expect(parseMoonJumpShips("2", "abc")).toBeNull();
  });

  test("keeps loaded moon systems visible during a background refresh", () => {
    const page = MoonPage({
      loading: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: {
          exists: true,
          planetId: "7",
          owner: "0x1111111111111111111111111111111111111111",
          fields: 3,
          diameterKm: 8774,
          createdAt: "1770000000",
          jumpGateReadyAt: "0",
        },
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 1,
          cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        }],
        queue: null,
      },
      onRefresh: () => undefined,
    });
    const text = visibleText(page);
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(text).toContain("Refreshing moon state");
    expect(systemsPanel?.props?.moon?.fields).toBe(3);
    expect(systemsPanel?.props?.moonState?.buildings?.[0]?.label).toBe("Lunar Base");
    expect(text).not.toContain("No moon in orbit");
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
  if (typeof vnode.type === "function") {
    if (vnode.type.name === "MoonSystemsPanel") {
      return [];
    }
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return textParts(vnode.type(vnode.props));
  }
  return textParts(vnode.props?.children as ComponentChildren);
}

function componentNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(componentNodes);
  }

  const vnode = node as VNode;
  return [vnode, ...componentNodes(vnode.props?.children as ComponentChildren)];
}
