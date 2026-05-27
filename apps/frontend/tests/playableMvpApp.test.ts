import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { infrastructureActionNoticeFor, PlanetSelector } from "../src/PlayableMvpApp";
import type { ManagedPlanetResponse } from "../src/walletFlow";

describe("Playable MVP app display helpers", () => {
  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("renders desktop planet selector as compact image-and-name buttons only", () => {
    let selectedPlanetId = "2";
    const selector = PlanetSelector({
      action: { status: "idle" },
      canTransact: true,
      layout: "sidebar",
      onAbandon: () => undefined,
      onSelect: (planetId) => {
        selectedPlanetId = planetId;
      },
      planets: [
        planet({
          coordinates: "1:23:4",
          fieldsUsed: 14,
          isHomePlanet: true,
          moon: { exists: true },
          name: "Erebus",
          planetId: "1",
          queues: {
            building: activeQueue(),
            defense: null,
            ship: null,
          },
        }),
        planet({
          coordinates: "1:24:8",
          isHomePlanet: false,
          name: "Nyx",
          planetId: "2",
          resources: {
            metal: "0",
            crystal: "0",
            deuterium: "0",
          },
        }),
      ],
      selectedPlanetId: "2",
    });

    const text = visibleText(selector);

    expect(text).toContain("Erebus");
    expect(text).toContain("Nyx");
    expect(text).not.toContain("Planet selector");
    expect(text).not.toContain("Owned planets");
    expect(text).not.toContain("active world");
    expect(text).not.toContain("1:23:4");
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Colony");
    expect(text).not.toContain("14/163 fields");
    expect(text).not.toContain("Moon");
    expect(text).not.toContain("Building");
    expect(text).not.toContain("M1 C1 D1");
    expect(text).not.toContain("Abandon");
    expect(buttons(selector).map((button) => button.props["aria-label"])).toEqual([
      "Select Erebus at 1:23:4",
      "Select Nyx at 1:24:8",
    ]);
    expect(selectedButton(selector)?.props.className).toContain("border-cyan-300/70");
    expect(selectedImageFrame(selector)?.props.className).not.toContain("border");
    expect(selectedImageFrame(selector)?.props.className).not.toContain("ring");

    buttons(selector)[0].props.onClick();
    expect(selectedPlanetId).toBe("1");
  });
});

function planet(overrides: Partial<ManagedPlanetResponse>): ManagedPlanetResponse {
  return {
    planetId: "1",
    owner: "0x1111111111111111111111111111111111111111",
    name: "Erebus",
    galaxy: 1,
    system: 23,
    position: 4,
    coordinates: "1:23:4",
    fields: 163,
    fieldsUsed: 0,
    fieldsCapacity: 163,
    temperature: 12,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    isHomePlanet: true,
    lastSettledAt: "1770000000",
    resources: {
      metal: "500",
      crystal: "500",
      deuterium: "0",
    },
    keyLevels: {
      metalMine: 1,
      crystalMine: 1,
      deuteriumSynthesizer: 1,
      solarPlant: 1,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
    moon: null,
    ...overrides,
  };
}

function activeQueue() {
  return {
    active: true,
    kind: "building",
    itemId: 0,
    targetLevel: 2,
    readyAt: "1770000600",
    startedAt: "1770000000",
    cost: {
      metal: "60",
      crystal: "15",
      deuterium: "0",
    },
  };
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

function buttons(node: ComponentChildren): VNode[] {
  return nodesByType(node, "button");
}

function selectedButton(node: ComponentChildren): VNode | undefined {
  return buttons(node).find((button) => button.props["aria-current"] === "true");
}

function selectedImageFrame(node: ComponentChildren): VNode | undefined {
  const buttonChildren = selectedButton(node)?.props.children as ComponentChildren;
  return nodesByType(buttonChildren, "span").find((span) =>
    String(span.props.className ?? "").includes("h-14 w-14")
  );
}

function nodesByType(node: ComponentChildren, type: string): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child) => nodesByType(child, type));
  }

  const vnode = node as VNode;
  const matches = vnode.type === type ? [vnode] : [];
  return matches.concat(nodesByType(vnode.props?.children as ComponentChildren, type));
}
