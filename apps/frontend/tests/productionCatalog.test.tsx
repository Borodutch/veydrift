import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  parseProductionQuantity,
  ProductionCatalog,
  productionQuantityValidationMessage,
  type ProductionCatalogItem,
  type ProductionQuantityInput,
} from "../src/components/ProductionCatalog";

describe("ProductionCatalog selected panel", () => {
  test("allows the selected quantity input to be cleared while editing and restores it on blur", () => {
    const item: ProductionCatalogItem<"rocketLauncher"> = catalogItem({
      quantity: 7,
      quantityInput: "",
      quantityValid: false,
    });
    const quantities: ProductionQuantityInput[] = [];
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [item],
      onBuild: () => undefined,
      onQuantity: (_key, quantity) => quantities.push(quantity),
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });

    const input = elementNodes(catalog).find((node) => node.type === "input");
    const button = elementNodes(catalog).find((node) => node.type === "button" && visibleText(node) === "Build");

    expect(input?.props.value).toBe("");
    expect(button?.props.disabled).toBe(true);
    expect(visibleText(catalog)).toContain(productionQuantityValidationMessage);

    input?.props.onInput({ currentTarget: { value: "" } });
    input?.props.onBlur();

    expect(quantities).toEqual(["", 1]);
  });

  test("keeps finite selected quantity edits raw until the page model validates them", () => {
    const item = catalogItem({ quantity: 1 });
    const quantities: ProductionQuantityInput[] = [];
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [item],
      onBuild: () => undefined,
      onQuantity: (_key, quantity) => quantities.push(quantity),
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });

    const input = elementNodes(catalog).find((node) => node.type === "input");
    input?.props.onInput({ currentTarget: { value: "2.9" } });

    expect(quantities).toEqual(["2.9"]);
  });

  for (const [label, input] of [
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-1"],
    ["decimal", "2.5"],
    ["non-numeric", "abc"],
    ["over-limit", "9007199254740993"],
  ] as const) {
    test(`rejects ${label} quantity drafts`, () => {
      expect(parseProductionQuantity(input)).toBeUndefined();
    });
  }

  test("renders compact selected details as price and count only (no client build time)", () => {
    const item = catalogItem();
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [item],
      onBuild: () => undefined,
      onQuantity: () => undefined,
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });

    const definitionList = elementNodes(catalog).find((node) => node.type === "dl");
    const labels = elementNodes(definitionList).filter((node) => node.type === "dt").map(visibleText);

    // VEY-KANEO-465: client-derived build time is removed; backend owns durations.
    expect(labels).toEqual(["Price", "Deployed"]);
    expect(visibleText(definitionList)).toContain("Metal 2,000");
    expect(visibleText(definitionList)).not.toContain("Status");
    expect(visibleText(catalog)).not.toContain("Combat");
    expect(visibleText(catalog)).not.toContain("Logistics");
  });

  test("uses the caller clock for active production queue progress", () => {
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem()],
      now: 1_700_000_060_000,
      onBuild: () => undefined,
      onFinishQueue: () => undefined,
      onQuantity: () => undefined,
      onRefreshQueue: () => undefined,
      onSelect: () => undefined,
      queue: {
        asset: "/assets/game/defenses/rocket-launcher.webp",
        label: "Rocket Launcher",
        quantity: 2,
        readyAt: "1700000120",
        startedAt: "1700000000",
      },
      selectedKey: "rocketLauncher",
    });
    const text = visibleText(catalog);
    const normalizedText = text.replace(/\s+/g, " ");

    expect(text).toContain("Active queue");
    expect(normalizedText).toContain("Rocket Launcher x2");
    expect(text).toContain("50%");
    expect(text).toContain("Time remaining 1m");
    expect(text).toContain("Production in progress.");
    expect(text).toContain("Refresh queue");
    expect(text).not.toContain("Ready now.");
  });
});

function catalogItem(overrides: Partial<ProductionCatalogItem<"rocketLauncher">> = {}): ProductionCatalogItem<"rocketLauncher"> {
  return {
    actionLabel: "Build",
    asset: "/assets/game/defenses/rocket-launcher.webp",
    cost: { metal: 2_000, crystal: 0, deuterium: 0 },
    countLabel: "Deployed",
    countValue: 12,
    detailNote: "Attack 80 · Shield 20 · Hull 200",
    disabled: false,
    group: "kinetic",
    groupLabel: "Kinetic batteries",
    id: 0,
    key: "rocketLauncher",
    label: "Rocket Launcher",
    missing: [],
    quantity: 1,
    requirements: [],
    status: "ready",
    statusLabel: "Ready",
    ...overrides,
  };
}

function visibleText(node: ComponentChildren): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    const Component = vnode.type as (props: Record<string, unknown>) => ComponentChildren;
    return visibleText(Component(vnode.props ?? {}));
  }
  return visibleText(vnode.props?.children);
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(elementNodes);
  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    const Component = vnode.type as (props: Record<string, unknown>) => ComponentChildren;
    return elementNodes(Component(vnode.props ?? {}));
  }
  return [vnode, ...elementNodes(vnode.props?.children)];
}
