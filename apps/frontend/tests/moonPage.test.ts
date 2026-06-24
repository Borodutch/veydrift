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

  test("keeps loaded Burning Chickens visible during a background refresh", () => {
    const page = MoonPage({
      burningChicken: {
        chickens: [{ tokenId: "42", level: 7 }],
        configured: true,
        loading: true,
        maxMoonsPerPlayer: 2,
        moonCount: 0,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });
    const text = visibleText(page);

    expect(text).toContain("Refreshing Burning Chickens");
    expect(text).toContain("Chicken # 42");
    expect(text).toContain("Level 7");
    expect(text).toContain("Burn for Moon");
    expect(text).not.toContain("No eligible Burning Chickens");
  });

  test("renders a useful Burning Chicken empty state", () => {
    const page = MoonPage({
      burningChicken: {
        chickens: [],
        configured: true,
        loading: false,
        maxMoonsPerPlayer: 2,
        moonCount: 0,
      },
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });

    expect(visibleText(page)).toContain("No eligible Burning Chickens were found in this wallet on Base mainnet.");
  });

  test("does not render manual Chicken token entry on lookup errors", () => {
    const page = MoonPage({
      burningChicken: {
        chickens: [],
        configured: true,
        error: "Burning Chicken wallet lookup is temporarily unavailable.",
        loading: false,
        maxMoonsPerPlayer: 2,
        moonCount: 0,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });
    const text = visibleText(page);

    expect(text).toContain("Burning Chicken wallet lookup is temporarily unavailable.");
    expect(text).not.toContain("Chicken token ID");
    expect(text).not.toContain("Burn Token");
    expect(text).not.toContain("execution reverted");
  });

  test("disables chicken burns at the two-moon limit", () => {
    const page = MoonPage({
      burningChicken: {
        chickens: [{ tokenId: "9", level: 2 }],
        configured: true,
        loading: false,
        maxMoonsPerPlayer: 2,
        moonCount: 2,
      },
      canBurnChicken: true,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [],
        queue: null,
      },
      selectedCoordinates: { galaxy: 1, system: 44, position: 8 },
    });
    expect(visibleText(page)).toContain("Moon limit reached");
    expect(visibleText(page)).toContain("Burn for Moon");
  });

  test("passes transaction sync copy into loaded moon systems while actions are gated", () => {
    const page = MoonPage({
      canTransact: false,
      loading: false,
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
      transactionUnavailableReason: "Ship production: syncing indexed state...",
    });
    const systemsPanel = componentNodes(page).find((node) => typeof node.type === "function" && node.type.name === "MoonSystemsPanel");

    expect(systemsPanel?.props?.canTransact).toBe(false);
    expect(systemsPanel?.props?.transactionUnavailableReason).toBe("Ship production: syncing indexed state...");
  });

  test("renders indexed-not-ready Moon state without the telemetry loader", () => {
    const page = MoonPage({
      loading: false,
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: null,
        moonAvailable: false,
        unavailableReason: "Moon indexed state is still warming. Refresh shortly.",
        indexedNotReady: true,
        moon: null,
        buildings: [],
        queue: null,
      },
      onRefresh: () => undefined,
    });
    const text = visibleText(page);

    expect(text).toContain("Moon state is indexing");
    expect(text).toContain("Moon indexed state is still warming. Refresh shortly.");
    expect(text).not.toContain("Reading lunar telemetry");
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
