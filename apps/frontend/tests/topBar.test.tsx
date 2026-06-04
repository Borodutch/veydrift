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
    expect(collectButton?.props?.className).toContain("lg:w-auto");
    expect(collectButton?.props?.title).toBe("Collect accrued resources: Metal +10 / Crystal +5");
    expect(supportLink?.props?.className).toContain("h-7 w-7");
    expect(supportLink?.props?.className).toContain("sm:hidden");
  });

  test("keeps desktop actions icon-only until wide layouts have room for labels", () => {
    const topBar = renderTopBar();
    const collectButton = buttonWithLabel(topBar, "Collect accrued resources: Metal +10 / Crystal +5");
    const desktopSupportLink = linksWithLabel(topBar, "Telegram support").find((link) =>
      typeof link.props?.className === "string" && link.props.className.includes("sm:inline-flex")
    );

    expect(collectButton?.props?.className).toContain("w-7");
    expect(collectButton?.props?.className).toContain("lg:w-auto");
    expect(collectButton?.props?.className).not.toContain("sm:w-auto");
    expect(visibleText(collectButton)).toContain("Collect");
    expect(desktopSupportLink?.props?.className).toContain("w-7");
    expect(desktopSupportLink?.props?.className).toContain("lg:w-auto");
    expect(desktopSupportLink?.props?.className).toContain("lg:px-2");
    expect(visibleText(desktopSupportLink)).toContain("Telegram");
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

  test("renders an energy explanation info control", () => {
    const topBar = renderTopBar();
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Energy powers mines")
    );
    const energyDetails = elementNodes(topBar).find((item) => item.type === "details");
    const panelText = visibleText(energyDetails);

    expect(energyInfo?.props?.title).toBe("Energy explanation");
    expect(energyInfo?.props?.["aria-label"]).toContain("100 produced / 125 consumed");
    expect(energyInfo?.props?.["aria-label"]).toContain("Shortage 25");
    expect(energyInfo?.props?.["aria-label"]).toContain("Production in total: 100");
    expect(energyInfo?.props?.["aria-label"]).toContain("Fusion Generator: 20 from 11 DEUT/h");
    expect(energyInfo?.props?.["aria-label"]).toContain("Solar Satellites: 40 from 2 satellites (20 E/Sat)");
    expect(energyInfo?.props?.["aria-label"]).toContain("Mine output is reduced to 80%");
    expect(panelText).toContain("Solar Plant and Solar Satellites produce it");
    expect(panelText).toContain("Produced 100");
    expect(panelText).toContain("Consumed 125");
    expect(panelText).toContain("Balance -25");
    expect(panelText).toContain("Production in total 100");
    expect(panelText).toContain("Solar Plant 40");
    expect(panelText).toContain("Fusion Generator 20 from 11 DEUT/h");
    expect(panelText.replace(/\(\s+/g, "(")).toContain("Solar Satellites 40 from 2 satellites (20 E/Sat)");
    expect(panelText).not.toContain("By Solar Plant");
    expect(panelText).not.toContain("By Fusion Generator");
    expect(panelText).not.toContain("By Solar Satellites");
    expect(panelText).toContain("Insufficient energy reduces mine output to 80%");
  });

  test("shows compact nonzero collectable deltas next to mobile resources", () => {
    const topBar = renderTopBar();
    const text = visibleText(topBar).replace(/\s+/g, "");

    expect(text).toContain("(+10)");
    expect(text).toContain("(+5)");
    expect(text).not.toContain("(+0)");
  });

  test("keeps loaded resources visible during background loading and error states", () => {
    expect(visibleText(renderTopBar({ resourceStatus: "loading" }))).toContain("Metal");
    expect(visibleText(renderTopBar({ resourceStatus: "loading" }))).not.toContain("Resources loading");
    expect(visibleText(renderTopBar({ resourceStatus: "error" }))).toContain("Metal");
    expect(visibleText(renderTopBar({ resourceStatus: "error" }))).not.toContain("Resources unavailable");
  });

  test("surfaces resource collection wallet errors in the top bar", () => {
    const label = "Resource collection failed: Unlock or reconnect your wallet, then retry.";
    const topBar = renderTopBar({
      collectResourcesActionLabel: label,
      collectResourcesActionStatus: "error",
    });
    const feedback = elementNodes(topBar).find((item) => item.type === "p" && item.props?.children === label);

    expect(visibleText(topBar)).toContain(label);
    expect(feedback?.props?.role).toBe("alert");
    expect(feedback?.props?.className).toContain("text-rose-200");
  });

  test("explains normal powered energy without low-energy impact copy", () => {
    const topBar = renderTopBar({
      energy: { produced: 160, required: 120, scaleBps: 10_000 },
    });
    const energyDetails = elementNodes(topBar).find((item) => item.type === "details");
    const panelText = visibleText(energyDetails);

    expect(panelText).toContain("Balance 40");
    expect(panelText).toContain("Mine output is fully powered.");
    expect(panelText).not.toContain("Insufficient energy");
  });
});

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}): ComponentChildren {
  return TopBar({
    canCollectResources: true,
    caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    energy: {
      produced: 100,
      required: 125,
      scaleBps: 8_000,
      sources: {
        solarPlant: 40,
        fusionReactor: 20,
        fusionReactorDeuteriumConsumed: 11,
        solarSatellites: 40,
        solarSatelliteCount: 2,
        solarSatelliteEnergy: 20,
      },
    },
    isWalletConnected: true,
    onCollectResources: () => undefined,
    rates: { metal: 77, crystal: 29, deuterium: 14 },
    resourceDeltas: { metal: 10, crystal: 5, deuterium: 0 },
    resources: { metal: 56, crystal: 243, deuterium: 31 },
    resourceStatus: "ready",
    showCollectResources: true,
    ...overrides,
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

function linksWithLabel(node: ComponentChildren, label: string): VNode[] {
  return elementNodes(node).filter((item) => item.type === "a" && item.props?.["aria-label"] === label);
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
