import { expect, test } from "bun:test";
import type { VNode } from "preact";
import { ProductionCatalog, type ProductionCatalogItem } from "../src/components/ProductionCatalog";
import { QueueProgressPanel, queueStripClasses } from "../src/components/QueueProgressPanel";
import { shipyardCatalog } from "../src/playableMvp";

function nodes(value: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const node = value as VNode<Record<string, unknown>>;
  const children = typeof node.type === "function" && node.type.name === "ProductionBuildPlan"
    ? (node.type as (props: Record<string, unknown>) => unknown)(node.props) : node.props.children;
  return [node, ...nodes(children)];
}

test("Build plan and standalone Queue consume the same compact sizing classes", () => {
  const item: ProductionCatalogItem = {
    ...shipyardCatalog[0]!, groupLabel: "Ships", countLabel: "Owned", countValue: 0,
    status: "ready", cost: { metal: 100, crystal: 0, deuterium: 0 },
    unitCostRaw: { metal: "100", crystal: "0", deuterium: "0" }, durationSeconds: 60,
    requirements: [], missing: [], quantity: 1, disabled: false, actionLabel: "Build", detailNote: "",
  };
  const noop = () => undefined;
  const catalog = nodes(ProductionCatalog({
    actionPending: false, canTransact: true, emptyLabel: "", items: [item],
    onBuild: noop, onQuantity: noop, onSelect: noop,
    buildPlan: {
      body: "moon", context: { body: "moon", resources: { metal: "1000", crystal: "0", deuterium: "0" },
        ships: [item], defenses: [], available: true, defenseCounts: [], shipyardLevel: 0, naniteLevel: 0 },
      rows: [{ kind: "ship", id: item.id, quantity: 1 }], busy: false, ready: true,
      onAdd: noop, onRemove: noop, onClear: noop, onConfirm: noop,
    },
  }));
  const plan = nodes(catalog.find(node => node.props["data-build-plan"] !== undefined));
  const queue = nodes(QueueProgressPanel({ title: "Queue", label: item.label, asset: item.asset, quantity: 1, readyAt: null }));
  for (const shared of Object.values(queueStripClasses)) {
    expect(plan.some(node => String(node.props.className).includes(shared))).toBe(true);
    expect(queue.some(node => String(node.props.className).includes(shared))).toBe(true);
  }
  expect(queueStripClasses.heading).toBe("text-[10px] font-semibold uppercase tracking-[0.14em]");
  expect(queueStripClasses.thumbnail).toBe("h-7 w-7 shrink-0 rounded object-contain");
});
