import { expect, test } from "bun:test";
import type { VNode } from "preact";
import { ProductionCatalog, type ProductionCatalogItem } from "./components/ProductionCatalog";
import { shipyardCatalog } from "./playableMvp";
import type { ProductionPlanContext } from "./productionBuildPlan";

const ship = shipyardCatalog[0]!;
const item: ProductionCatalogItem = {
  ...ship, groupLabel: "Civil", countLabel: "Owned", countValue: 0,
  status: "ready", cost: { metal: 100, crystal: 0, deuterium: 0 },
  unitCost: { metal: 100, crystal: 0, deuterium: 0 },
  unitCostRaw: { metal: "100", crystal: "0", deuterium: "0" },
  durationSeconds: 60, requirements: [], missing: [], quantity: 1,
  disabled: false, actionLabel: "Build", detailNote: "Ship",
};

// Resolve just the stateless production surface; image/icon internals are deliberately left opaque.
function flatten(value: unknown): Array<VNode<Record<string, unknown>>> {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const node = value as VNode<Record<string, unknown>>;
  const component = typeof node.type === "function" ? (node.type as { name: string }) : null;
  const descendants = component && ["SelectedProductionPanel", "ProductionBuildPlan", "CatalogButton"].includes(component.name)
    ? (node.type as (props: Record<string, unknown>) => unknown)(node.props)
    : node.props.children;
  return [node, ...flatten(descendants)];
}

test("compact plan uses an in-page queue-adjacent strip and accessible exact icons", () => {
  const context: ProductionPlanContext = {
    body: "planet", resources: { metal: "1000", crystal: "0", deuterium: "0" }, ships: [item], defenses: [], available: true, defenseCounts: [],
  };
  const noop = () => undefined;
  const nodes = flatten(ProductionCatalog({
    actionPending: false, canTransact: true, emptyLabel: "", items: [item],
    onBuild: noop, onQuantity: noop, onSelect: noop, selectedKey: ship.key,
    productionKind: "ship",
    buildPlan: { body: "planet", context, rows: [{ kind: "ship", id: ship.id, quantity: 1 }], ready: true, busy: false,
      onAdd: noop, onRemove: noop, onClear: noop, onConfirm: noop },
  }));
  const labels = nodes.map(node => node.props["aria-label"]);
  expect(nodes.some(node => node.props["data-build-plan"] !== undefined)).toBe(true);
  for (const label of ["Confirm build plan", "Clear build plan", `Remove ${ship.label} from build plan`,
    `Add ${ship.label} to build plan`, `Build ${ship.label} now`, `${ship.label} maximum affordable quantity`, `${ship.label} reset quantity`]) {
    expect(labels).toContain(label);
  }
  expect(nodes.some(node => node.type === "dialog")).toBe(false);
});
