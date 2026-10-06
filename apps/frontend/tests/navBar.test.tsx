import { describe, expect, test } from "bun:test";
import { ChevronDown } from "lucide-preact";
import type { ComponentChildren, VNode } from "preact";
import {
  CommanderAccountSummary,
  MobileTab,
  NavItem,
  commanderIdentityLabel,
  commanderJoinCta,
  shouldShowCommanderJoinCta,
} from "../src/components/NavBar";
import { shortAddress, type PlayerProfile } from "../src/walletFlow";

const wallet = "0x1111111111111111111111111111111111111111";

describe("NavBar section navigation", () => {
  test.each([
    ["desktop", NavItem],
    ["mobile", MobileTab],
  ] as const)("renders the %s section control as a progressively enhanced link", (_layout, Component) => {
    let navigations = 0;
    const assignedUrls: string[] = [];
    const location = {
      href: "https://veydrift.test/defenses",
      assign(url: string) {
        assignedUrls.push(url);
        this.href = url;
      },
    };
    const link = Component({
      active: false,
      href: "/infrastructure",
      icon: ChevronDown,
      label: "Infrastructure",
      onClick: () => {
        navigations += 1;
        location.href = "https://veydrift.test/infrastructure";
      },
    });
    const event = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      currentTarget: {
        href: "https://veydrift.test/infrastructure",
        ownerDocument: { defaultView: { location } },
      },
      metaKey: false,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
      shiftKey: false,
    };

    expect(link.type).toBe("a");
    expect(link.props.href).toBe("/infrastructure");
    (link.props.onClick as (event: typeof event) => void)(event);
    expect(navigations).toBe(1);
    expect(event.preventDefaultCalls).toBe(1);
    expect(assignedUrls).toEqual([]);
  });

  test.each([
    ["desktop", NavItem, "/galaxy", "Galaxy"],
    ["mobile", MobileTab, "/raid-finder", "Raid Finder"],
  ] as const)("explicitly navigates the %s canonical URL when a hydrated SPA handler leaves the route unchanged", (_layout, Component, href, label) => {
    const assignedUrls: string[] = [];
    const location = {
      href: "https://veydrift.test/defenses",
      assign(url: string) {
        assignedUrls.push(url);
        this.href = url;
      },
    };
    const link = Component({
      active: false,
      href,
      icon: ChevronDown,
      label,
      onClick: () => undefined,
    });
    const event = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      currentTarget: {
        href: `https://veydrift.test${href}`,
        ownerDocument: { defaultView: { location } },
      },
      metaKey: false,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
      shiftKey: false,
    };

    (link.props.onClick as (event: typeof event) => void)(event);
    expect(location.href).toBe(`https://veydrift.test${href}`);
    expect(assignedUrls).toEqual([`https://veydrift.test${href}`]);
    expect(event.preventDefaultCalls).toBe(1);
  });

  test("commits the canonical fallback before surfacing an SPA navigation error", () => {
    const assignedUrls: string[] = [];
    const location = {
      href: "https://veydrift.test/defenses",
      assign(url: string) {
        assignedUrls.push(url);
        this.href = url;
      },
    };
    const link = NavItem({
      active: false,
      href: "/raid-finder",
      icon: ChevronDown,
      label: "Raid Finder",
      onClick: () => { throw new Error("navigation handler failed"); },
    });
    const event = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      currentTarget: {
        href: "https://veydrift.test/raid-finder",
        ownerDocument: { defaultView: { location } },
      },
      metaKey: false,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
      shiftKey: false,
    };

    expect(() => (link.props.onClick as (event: typeof event) => void)(event)).toThrow("navigation handler failed");
    expect(location.href).toBe("https://veydrift.test/raid-finder");
    expect(assignedUrls).toEqual(["https://veydrift.test/raid-finder"]);
    expect(event.preventDefaultCalls).toBe(1);
  });

  test.each([
    ["desktop", NavItem, "/raid-finder", "Raid Finder"],
    ["mobile", MobileTab, "/shipyard", "Shipyard"],
  ] as const)("commits %s navigation on pointer release before a click is available", (_layout, Component, href, label) => {
    let navigations = 0;
    const assignedUrls: string[] = [];
    const location = {
      href: "https://veydrift.test/galaxy",
      assign(url: string) {
        assignedUrls.push(url);
        this.href = url;
      },
    };
    const link = Component({
      active: false,
      href,
      icon: ChevronDown,
      label,
      onClick: () => {
        navigations += 1;
        location.href = `https://veydrift.test${href}`;
      },
    });
    const currentTarget = {
      href: `https://veydrift.test${href}`,
      ownerDocument: { defaultView: { location } },
    };
    const pointerEvent = {
      altKey: false,
      button: 0,
      clientX: 120,
      clientY: 80,
      ctrlKey: false,
      currentTarget,
      isPrimary: true,
      metaKey: false,
      pointerId: 7,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
      shiftKey: false,
    };

    (link.props.onPointerDown as (event: typeof pointerEvent) => void)(pointerEvent);
    (link.props.onPointerUp as (event: typeof pointerEvent) => void)(pointerEvent);
    expect(navigations).toBe(1);
    expect(location.href).toBe(`https://veydrift.test${href}`);
    expect(assignedUrls).toEqual([]);
    expect(pointerEvent.preventDefaultCalls).toBe(1);

    // The following click must not activate whatever replaced this link after
    // the pointer-release navigation (notably a first Raid Finder target on
    // Android). The original link consumes it when it remains mounted.
    const trailingClick = {
      ...pointerEvent,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
    };
    (link.props.onClick as (event: typeof trailingClick) => void)(trailingClick);
    expect(navigations).toBe(1);
    expect(trailingClick.preventDefaultCalls).toBe(1);
  });

  test.each([
    ["desktop", NavItem, "/raid-finder", "Raid Finder"],
    ["mobile", MobileTab, "/shipyard", "Shipyard"],
  ] as const)("ignores an unmatched %s pointer release over a section link", (_layout, Component, href, label) => {
    let navigations = 0;
    const location = { href: "https://veydrift.test/galaxy" };
    const link = Component({
      active: false,
      href,
      icon: ChevronDown,
      label,
      onClick: () => { navigations += 1; },
    });
    const pointerEvent = {
      altKey: false,
      button: 0,
      clientX: 120,
      clientY: 80,
      ctrlKey: false,
      currentTarget: {
        href: `https://veydrift.test${href}`,
        ownerDocument: { defaultView: { location } },
      },
      isPrimary: true,
      metaKey: false,
      pointerId: 7,
      shiftKey: false,
    };

    (link.props.onPointerUp as (event: typeof pointerEvent) => void)(pointerEvent);
    expect(navigations).toBe(0);
    expect(location.href).toBe("https://veydrift.test/galaxy");
  });

  test.each(["moved", "canceled"] as const)("rejects a %s pointer activation and its follow-up click", (mode) => {
    let navigations = 0;
    const location = { href: "https://veydrift.test/galaxy" };
    const currentTarget = {
      href: "https://veydrift.test/shipyard",
      ownerDocument: { defaultView: { location } },
    };
    const link = NavItem({
      active: false,
      href: "/shipyard",
      icon: ChevronDown,
      label: "Shipyard",
      onClick: () => { navigations += 1; },
    });
    const pointerEvent = {
      altKey: false,
      button: 0,
      clientX: 120,
      clientY: 80,
      ctrlKey: false,
      currentTarget,
      isPrimary: true,
      metaKey: false,
      pointerId: 7,
      shiftKey: false,
    };

    (link.props.onPointerDown as (event: typeof pointerEvent) => void)(pointerEvent);
    if (mode === "moved") {
      const movedEvent = { ...pointerEvent, clientX: 160 };
      (link.props.onPointerMove as (event: typeof movedEvent) => void)(movedEvent);
      (link.props.onPointerUp as (event: typeof movedEvent) => void)(movedEvent);
      const clickEvent = {
        ...movedEvent,
        preventDefaultCalls: 0,
        preventDefault() { this.preventDefaultCalls += 1; },
      };
      (link.props.onClick as (event: typeof clickEvent) => void)(clickEvent);
      expect(clickEvent.preventDefaultCalls).toBe(1);
    } else {
      (link.props.onPointerCancel as (event: typeof pointerEvent) => void)(pointerEvent);
      (link.props.onPointerUp as (event: typeof pointerEvent) => void)(pointerEvent);
    }

    expect(navigations).toBe(0);
    expect(location.href).toBe("https://veydrift.test/galaxy");
  });

  test("preserves modified-click browser behavior without invoking SPA navigation", () => {
    let navigations = 0;
    const assignedUrls: string[] = [];
    const location = {
      href: "https://veydrift.test/shipyard",
      assign(url: string) {
        assignedUrls.push(url);
        this.href = url;
      },
    };
    const link = NavItem({
      active: false,
      href: "/infrastructure",
      icon: ChevronDown,
      label: "Infrastructure",
      onClick: () => { navigations += 1; },
    });
    const event = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      currentTarget: {
        href: "https://veydrift.test/infrastructure",
        ownerDocument: { defaultView: { location } },
      },
      metaKey: true,
      preventDefaultCalls: 0,
      preventDefault() { this.preventDefaultCalls += 1; },
      shiftKey: false,
    };

    (link.props.onClick as (event: typeof event) => void)(event);
    expect(navigations).toBe(0);
    expect(assignedUrls).toEqual([]);
    expect(event.preventDefaultCalls).toBe(0);
  });
});

function playerProfile(displayName: string | null): PlayerProfile {
  return {
    wallet,
    displayName,
    description: null,
    fallbackName: shortAddress(wallet),
    updatedAt: null,
  };
}

function renderCommanderSummary(
  overrides: Partial<Parameters<typeof CommanderAccountSummary>[0]> = {},
): ComponentChildren {
  return CommanderAccountSummary({
    account: wallet,
    className: "summary",
    coordinates: "8:490:11",
    copiedField: undefined,
    onCopy: () => undefined,
    onEdit: () => undefined,
    playerCopyValue: wallet,
    playerLabel: commanderIdentityLabel(overrides.playerProfile, wallet),
    playerPanelOpen: false,
    playerProfileBusy: false,
    playerStatusTone: "text-slate-300",
    ...overrides,
  });
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elementNodes);

  const vnode = node as VNode;
  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}

function visibleText(node: ComponentChildren): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");

  return visibleText((node as VNode).props?.children as ComponentChildren);
}

function copyValue(node: ComponentChildren, key: string): string | undefined {
  return elementNodes(node).find((item) => item.props?.copyKey === key)?.props?.value;
}

describe("NavBar public commander panel", () => {
  test("shows a join CTA only for public viewers with a connect action", () => {
    expect(shouldShowCommanderJoinCta(undefined, () => undefined)).toBe(true);
    expect(shouldShowCommanderJoinCta("0x1111111111111111111111111111111111111111", () => undefined)).toBe(false);
    expect(shouldShowCommanderJoinCta(undefined, undefined)).toBe(false);
  });

  test("uses the requested public commander copy", () => {
    expect(commanderJoinCta).toEqual({
      action: "Connect wallet",
      label: "Join Veydrift",
    });
  });

  test("shows the configured name with home, wallet and the edit action", () => {
    const profile = playerProfile("Nova");
    const summary = renderCommanderSummary({ playerLabel: commanderIdentityLabel(profile, wallet) });
    const text = visibleText(summary);

    expect(copyValue(summary, "commander")).toBe("Nova");
    expect(copyValue(summary, "home")).toBe("8:490:11");
    expect(copyValue(summary, "wallet")).toBe(shortAddress(wallet));
    expect(text).toContain("Home");
    expect(text).toContain("Wallet");
    expect(elementNodes(summary).find((item) => item.props?.["aria-label"] === "Edit player profile")).toBeDefined();
  });

  test("falls back to the shortened wallet when no name is configured", () => {
    const label = commanderIdentityLabel(playerProfile(null), wallet);
    const summary = renderCommanderSummary({ playerLabel: label });

    expect(label).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).not.toBe("Unnamed player");
  });

  test("opens the activity dialog from the commander card", () => {
    let opened = 0;
    const summary = renderCommanderSummary({ onOpenActivity: () => { opened += 1; } });
    const activityButton = elementNodes(summary).find((item) =>
      item.type === "button" && visibleText(item.props?.children as ComponentChildren).includes("Activity")
    );
    expect(activityButton?.props?.["aria-haspopup"]).toBe("dialog");
    (activityButton?.props?.onClick as () => void)();
    expect(opened).toBe(1);
    expect(visibleText(renderCommanderSummary())).not.toContain("Activity");
  });
});
