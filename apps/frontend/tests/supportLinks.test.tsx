import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { ComingSoonApp } from "../src/ComingSoonApp";
import { SettlementSupportLink } from "../src/FirstPlanetSettlementApp";
import { TopBar } from "../src/components/TopBar";
import { TELEGRAM_SUPPORT_URL } from "../src/supportLinks";

describe("Telegram support links", () => {
  test("landing CTA points to the Telegram support invite", () => {
    const link = linksIn(ComingSoonApp()).find((item) => item.props?.href === TELEGRAM_SUPPORT_URL);

    expect(link?.props?.target).toBe("_blank");
    expect(link?.props?.rel).toBe("noopener noreferrer");
  });

  test("settlement app chrome includes the Telegram support invite", () => {
    const link = linksIn(SettlementSupportLink()).find((item) => item.props?.["aria-label"] === "Telegram support");

    expect(link?.props?.href).toBe(TELEGRAM_SUPPORT_URL);
    expect(link?.props?.target).toBe("_blank");
    expect(link?.props?.rel).toBe("noopener noreferrer");
  });

  test("playable top bar includes the Telegram support invite", () => {
    const link = linksIn(renderTopBar()).find((item) => item.props?.["aria-label"] === "Telegram support");

    expect(link?.props?.href).toBe(TELEGRAM_SUPPORT_URL);
    expect(link?.props?.target).toBe("_blank");
    expect(link?.props?.rel).toBe("noopener noreferrer");
  });
});

function renderTopBar(): ComponentChildren {
  return TopBar({
    caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    isWalletConnected: true,
    rates: { metal: 77, crystal: 29, deuterium: 14 },
    resources: { metal: 56, crystal: 243, deuterium: 31 },
    resourceStatus: "ready",
  });
}

function linksIn(node: ComponentChildren): VNode[] {
  return elementNodes(node).filter((item) => item.type === "a");
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
    return elementNodes(vnode.type(vnode.props));
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
