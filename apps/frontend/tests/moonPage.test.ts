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

  test("renders manual Burning Chicken token entry", () => {
    const page = MoonPage({
      burningChicken: {
        configured: true,
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

    expect(text).toContain("Chicken ID");
    expect(text).toContain("Burn for Moon");
    expect(text).toContain("verifies this wallet owns the chicken");
    expect(text).toContain("During testnet, each account can receive only 2 Chicken moons.");
    expect(text).toContain("0 / 2 testnet Chicken moons used.");
    expect(text).not.toContain("No eligible Burning Chickens");
  });

  test("renders Burning Chicken config unavailable state", () => {
    const page = MoonPage({
      burningChicken: {
        configured: false,
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

    expect(visibleText(page)).toContain("Burning Chicken burn config is not available yet.");
  });

  test("keeps Burning Chicken ownership errors visible", () => {
    const page = MoonPage({
      action: { status: "error", label: "Chicken #164 was not found on Base mainnet." },
      burningChicken: {
        configured: true,
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

    expect(visibleText(page)).toContain("Chicken #164 was not found on Base mainnet.");
  });

  test("disables chicken burns at the two-moon limit", () => {
    const page = MoonPage({
      burningChicken: {
        configured: true,
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
    expect(visibleText(page)).toContain("2 / 2 testnet Chicken moons used.");
    expect(visibleText(page)).toContain("this wallet already has 2 of 2 testnet Chicken moons");
    expect(visibleText(page)).toContain("Burn for Moon");
  });

  test("previews moon structures before a moon is granted", () => {
    const page = MoonPage({
      moonState: {
        wallet: "0x1111111111111111111111111111111111111111",
        homePlanetId: "7",
        moon: null,
        buildings: [{
          id: 0,
          key: "lunarBase",
          label: "Lunar Base",
          level: 0,
          cost: { metal: "20000", crystal: "40000", deuterium: "20000" },
        }, {
          id: 2,
          key: "jumpGate",
          label: "Jump Gate",
          level: 0,
          cost: { metal: "2000000", crystal: "4000000", deuterium: "2000000" },
        }],
        queue: null,
      },
    });
    const text = visibleText(page);

    expect(text).toContain("No moon in orbit");
    expect(text).toContain("Moon structures");
    expect(text).toContain("Lunar Base");
    expect(text).toContain("Adds moon fields so more lunar structures can be built.");
    expect(text).toContain("Jump Gate");
    expect(text).toContain("Moves fleets between owned moons when the gate is ready.");
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
