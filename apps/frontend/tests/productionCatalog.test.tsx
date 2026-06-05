import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { ProductionCatalog, type ProductionCatalogItem } from "../src/components/ProductionCatalog";

describe("ProductionCatalog selected panel", () => {
  test("renders compact selected details as price, count, and build time only", () => {
    const item: ProductionCatalogItem<"rocketLauncher"> = {
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
      durationSeconds: 960,
    };
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

    expect(labels).toEqual(["Price", "Deployed", "Build time"]);
    expect(visibleText(definitionList)).toContain("Metal 2,000");
    expect(visibleText(definitionList)).not.toContain("Status");
    expect(visibleText(catalog)).not.toContain("Combat");
    expect(visibleText(catalog)).not.toContain("Logistics");
  });
});

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
