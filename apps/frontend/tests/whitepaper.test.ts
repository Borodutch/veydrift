import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { SettlementSupportLinks } from "../src/FirstPlanetSettlementApp";
import { TopBar } from "../src/components/TopBar";
import { WHITEPAPER_URL } from "../src/supportLinks";

const expectedHash = "29072d391b6bf66bf72c13ebb48f4ababb859856caaf2f6d7592529d4f6c2719";
const landingSource = await Bun.file(new URL("../src/ComingSoonApp.tsx", import.meta.url)).text();
const whitepaper = Bun.file(new URL("../public/whitepaper.pdf", import.meta.url));

describe("public whitepaper", () => {
  test("publishes the approved PDF bytes at the stable same-origin route", async () => {
    const hash = createHash("sha256")
      .update(Buffer.from(await whitepaper.arrayBuffer()))
      .digest("hex");

    expect(WHITEPAPER_URL).toBe("/whitepaper.pdf");
    expect(hash).toBe(expectedHash);
  });

  test("keeps the action on the marketing landing surface", () => {
    expect(landingSource).toContain("href={WHITEPAPER_URL}");
    expect(landingSource).toContain("Whitepaper");
    expect(landingSource).toContain('target="_blank"');
    expect(landingSource).toContain('rel="noopener noreferrer"');
  });

  test("renders the action on pre-settlement and playable production surfaces", () => {
    const settlementLink = whitepaperLinks(SettlementSupportLinks());
    const topBarLinks = whitepaperLinks(renderTopBar());

    expect(settlementLink).toHaveLength(1);
    expect(topBarLinks).toHaveLength(2);
    for (const link of [...settlementLink, ...topBarLinks]) {
      expect(link.props?.href).toBe(WHITEPAPER_URL);
      expect(link.props?.target).toBe("_blank");
      expect(link.props?.rel).toBe("noopener noreferrer");
    }
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

function whitepaperLinks(node: ComponentChildren): VNode[] {
  return elementNodes(node).filter(
    (item) => item.type === "a" && item.props?.["aria-label"] === "Veydrift whitepaper"
  );
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
    return [];
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
