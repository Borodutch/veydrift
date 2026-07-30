import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { TopBar } from "../src/components/TopBar";

describe("TopBar", () => {
  test("gives mobile resources a full-width row separate from the icon row", () => {
    const topBar = renderTopBar();
    const nodes = elementNodes(topBar);
    // Both mobile rows flatten into the single desktop flex line via sm:contents.
    const mobileRows = nodes.filter(
      (node) => typeof node.props?.className === "string" && node.props.className.includes("sm:contents")
    );
    const resourcePips = nodes.filter(
      (node) => node.type === "details"
        && typeof node.props?.className === "string"
        && node.props.className.includes("sm:flex-none")
    );
    const supportLink = linkWithLabel(topBar, "Telegram support");

    expect(mobileRows).toHaveLength(2);
    expect(buttonsWithText(topBar, "Collect")).toHaveLength(0);
    // Pips share the resources row evenly; no icon columns squeeze them anymore.
    for (const pip of resourcePips) {
      expect(pip.props.className).toContain("flex-1");
    }
    expect(supportLink?.props?.className).toContain("flex-1");
    expect(supportLink?.props?.className).toContain("sm:hidden");
  });

  test("keeps desktop actions icon-only until wide layouts have room for labels", () => {
    const topBar = renderTopBar();
    const desktopSupportLink = linksWithLabel(topBar, "Telegram support").find((link) =>
      typeof link.props?.className === "string" && link.props.className.includes("sm:inline-flex")
    );

    expect(buttonsWithText(topBar, "Collect")).toHaveLength(0);
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
    expect(text).not.toContain("Collect");
  });

  test("renders an energy explanation info control", () => {
    const topBar = renderTopBar();
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Energy powers mines")
    );
    const energyDetails = energyDetailsNode(topBar);
    const panelText = visibleText(energyDetails);

    expect(energyInfo?.props?.title).toBe("Resources explanation");
    expect(energyInfo?.props?.["aria-label"]).toContain("Context: Selected player planet.");
    expect(energyInfo?.props?.["aria-label"]).toContain("100 produced / 125 consumed");
    expect(energyInfo?.props?.["aria-label"]).toContain("Shortage 25");
    expect(energyInfo?.props?.["aria-label"]).toContain("Production in total: 100");
    expect(energyInfo?.props?.["aria-label"]).toContain("Fusion Generator: 20 from 11 DEUT/h");
    expect(energyInfo?.props?.["aria-label"]).toContain("Solar Satellites: 40 from 2 satellites (20 E/Sat)");
    expect(energyInfo?.props?.["aria-label"]).toContain("Mine output is reduced to 80%");
    expect(panelText).toContain("Mines produce resources");
    expect(panelText).toContain("Selected player planet");
    expect(panelText).toContain("Metal production +77/h");
    expect(panelText).toContain("Crystal production +29/h");
    expect(panelText).toContain("Deuterium production +14/h");
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

  test("renders canonical live-effective backend rates without recomputing them", () => {
    const topBar = renderTopBar({
      energy: {
        produced: 108,
        required: 217,
        scaleBps: 4_976,
        sources: {
          solarPlant: 0,
          fusionReactor: 0,
          fusionReactorDeuteriumConsumed: 0,
          solarSatellites: 108,
          solarSatelliteCount: 3,
          solarSatelliteEnergy: 36,
        },
      },
      rates: { metal: 120, crystal: 58, deuterium: 24 },
    });
    const panelText = visibleText(energyDetailsNode(topBar));

    expect(panelText).toContain("Metal production +120/h");
    expect(panelText).toContain("Crystal production +58/h");
    expect(panelText).toContain("Deuterium production +24/h");
    expect(panelText.replace(/\(\s+/g, "(")).toContain("Solar Satellites 108 from 3 satellites (36 E/Sat)");
    expect(panelText).toContain("Insufficient energy reduces mine output to 49%");
  });

  test("keeps crawler production visible while backend crawler metadata is syncing", () => {
    const topBar = renderTopBar({ crawlerProduction: undefined });
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Crawler production details are syncing")
    );
    const panelText = visibleText(energyDetailsNode(topBar));

    expect(energyInfo?.props?.["aria-label"]).toContain("Crawler production details are syncing from the backend production model.");
    expect(panelText).toContain("Crawler boost Syncing");
    expect(panelText).toContain("Crawlers Waiting for production model");
    expect(panelText).toContain("Crawler production details are syncing from the backend production model.");
  });

  test("labels energy popup values without selected player planet coordinates", () => {
    const topBar = renderTopBar();
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Energy powers mines")
    );
    const energyDetails = energyDetailsNode(topBar);

    expect(energyInfo?.props?.["aria-label"]).toContain("Context: Selected player planet.");
    expect(energyInfo?.props?.["aria-label"]).not.toContain("8:490:11");
    expect(visibleText(energyDetails)).toContain("Selected player planet");
    expect(visibleText(energyDetails)).not.toContain("8:490:11");
  });

  test("does not render selected planet coordinates in header chrome", () => {
    const topBar = renderTopBar();
    const headerText = visibleText(topBar);
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Energy powers mines")
    );

    expect(headerText).not.toContain("8:490:11");
    expect(energyInfo?.props?.["aria-label"]).not.toContain("8:490:11");
  });

  test("shows zero crawler effect in the resources info popup without implying a bonus", () => {
    const topBar = renderTopBar({
      crawlerProduction: {
        total: 0,
        effective: 0,
        maxEffective: 240,
        boostBps: "0",
        capped: false,
        productionIncreasePerHour: { metal: 0, crystal: 0, deuterium: 0 },
      },
    });
    const energyInfo = elementNodes(topBar).find(
      (item) => item.type === "summary"
        && typeof item.props?.["aria-label"] === "string"
        && item.props["aria-label"].includes("Crawler boost")
    );
    const panelText = visibleText(energyDetailsNode(topBar));

    expect(energyInfo?.props?.["aria-label"]).toContain("Crawler boost +0%");
    expect(panelText).toContain("Crawler boost +0%");
    expect(panelText).toContain("Crawlers 0 / 0 effective");
    expect(panelText).toContain("No crawlers are boosting this planet yet.");
  });

  test("shows active crawler bonus and per-resource impact in the resources info popup", () => {
    const topBar = renderTopBar({
      crawlerProduction: {
        total: 12,
        effective: 12,
        maxEffective: 240,
        boostBps: "24",
        capped: false,
        productionIncreasePerHour: { metal: 18, crystal: 7, deuterium: 3 },
      },
    });
    const panelText = visibleText(energyDetailsNode(topBar));

    expect(panelText).toContain("Crawler boost +0.24%");
    expect(panelText).toContain("Crawlers 12 / 12 effective");
    expect(panelText).toContain("Effective cap 240");
    expect(panelText).toContain("Metal impact +18/h");
    expect(panelText).toContain("Crystal impact +7/h");
    expect(panelText).toContain("Deuterium impact +3/h");
  });

  test("explains capped crawlers in the resources info popup", () => {
    const topBar = renderTopBar({
      crawlerProduction: {
        total: 100,
        effective: 24,
        maxEffective: 24,
        boostBps: "48",
        capped: true,
        productionIncreasePerHour: { metal: 8, crystal: 3, deuterium: 1 },
      },
    });
    const panelText = visibleText(energyDetailsNode(topBar));

    expect(panelText).toContain("Crawler boost +0.48%");
    expect(panelText).toContain("Crawlers 24 / 100 effective");
    expect(panelText).toContain("Effective cap 24");
    expect(panelText).toContain("Extra crawlers above the effective cap are idle until mine levels increase.");
  });

  test("vertically centers M/C/D/E values and spaces the energy info icon", () => {
    const topBar = renderTopBar();
    const nodes = elementNodes(topBar);
    const pipRows = nodes.filter(
      (node) =>
        typeof node.props?.className === "string" &&
        node.props.className.includes("inline-flex") &&
        node.props.className.includes("gap-0.5 sm:gap-1.5")
    );

    // Three resource pips (M/C/D) plus the energy pip (E) all share the inner row.
    expect(pipRows).toHaveLength(4);
    for (const row of pipRows) {
      expect(row.props.className).toContain("items-center");
      expect(row.props.className).not.toContain("items-baseline");
    }

    const energyDetails = energyDetailsNode(topBar);
    expect(energyDetails?.props?.className).toContain("ml-0.5");
    expect(energyDetails?.props?.className).toContain("sm:ml-1");
  });

  test("does not render pending collectable deltas next to resources", () => {
    const topBar = renderTopBar();
    const text = visibleText(topBar).replace(/\s+/g, "");

    expect(text).not.toContain("(+10)");
    expect(text).not.toContain("(+5)");
    expect(text).not.toContain("(+0)");
  });

  test("does not show fabricated resource pips while the wallet is disconnected", () => {
    // VEY-KANEO-458: disconnected must not render synthesized "0 +0/h" resources as if real.
    const text = visibleText(renderTopBar({ isWalletConnected: false }));

    expect(text).toContain("Connect wallet for resources");
    expect(text).not.toContain("+0/h");
    expect(text).not.toContain("Metal");
  });

  test("keeps loaded resources visible during background loading and error states", () => {
    expect(visibleText(renderTopBar({ resourceStatus: "loading" }))).toContain("Metal");
    expect(visibleText(renderTopBar({ resourceStatus: "loading" }))).not.toContain("Resources loading");
    expect(visibleText(renderTopBar({ resourceStatus: "error" }))).toContain("Metal");
    expect(visibleText(renderTopBar({ resourceStatus: "error" }))).not.toContain("Resources unavailable");
  });

  test("explains normal powered energy without low-energy impact copy", () => {
    const topBar = renderTopBar({
      energy: { produced: 160, required: 120, scaleBps: 10_000 },
    });
    const energyDetails = energyDetailsNode(topBar);
    const panelText = visibleText(energyDetails);

    expect(panelText).toContain("Balance 40");
    expect(panelText).toContain("Mine output is fully powered.");
    expect(panelText).not.toContain("Insufficient energy");
  });
});

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}): ComponentChildren {
  return TopBar({
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
    rates: { metal: 77, crystal: 29, deuterium: 14 },
    resources: { metal: 66, crystal: 248, deuterium: 31 },
    resourceStatus: "ready",
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

function linkWithLabel(node: ComponentChildren, label: string): VNode | undefined {
  return elementNodes(node).find((item) => item.type === "a" && item.props?.["aria-label"] === label);
}

function linksWithLabel(node: ComponentChildren, label: string): VNode[] {
  return elementNodes(node).filter((item) => item.type === "a" && item.props?.["aria-label"] === label);
}

function buttonsWithText(node: ComponentChildren, text: string): VNode[] {
  return elementNodes(node).filter((item) => item.type === "button" && visibleText(item).includes(text));
}

function energyDetailsNode(topBar: ComponentChildren): VNode | undefined {
  return elementNodes(topBar).find(
    (item) => item.type === "details"
      && typeof item.props?.className === "string"
      && item.props.className.includes("ml-0.5")
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
    if ("size" in (vnode.props ?? {}) || "strokeWidth" in (vnode.props ?? {})) {
      return [];
    }
    return elementNodes(vnode.type(vnode.props));
  }

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
