// Local-only real-component fixture. No wallet, API, or production entry imports this file.
import { render } from "preact";
import { useState } from "preact/hooks";
import { ProductionCatalog, type ProductionCatalogItem } from "../../src/components/ProductionCatalog";
import { defenseCatalog, shipyardCatalog } from "../../src/playableMvp";
import type { ProductionBody, ProductionOrder, ProductionPlanContext } from "../../src/productionBuildPlan";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const body: ProductionBody = params.get("body") === "moon" ? "moon" : "planet";
const kind = params.get("kind") === "ship" ? "ship" : "defense";
const now = 1_790_279_000_000;
const catalog = kind === "ship" ? shipyardCatalog : defenseCatalog;
const items: ProductionCatalogItem[] = catalog.slice(0, 4).map((item, index) => ({
  ...item, groupLabel: kind === "ship" ? "Ships" : "Defenses", countLabel: "Owned", countValue: 100,
  status: "ready", cost: { metal: 2000, crystal: 500, deuterium: 100 },
  unitCost: { metal: 2000, crystal: 500, deuterium: 100 },
  unitCostRaw: { metal: "2000", crystal: "500", deuterium: "100" },
  durationSeconds: 720, requirements: [], missing: [], quantity: 1, disabled: false,
  actionLabel: "Build", detailNote: "", queued: index === 0 ? 1 : 0,
}));
const queue = {
  label: items[0]!.label, asset: items[0]!.asset, quantity: 1,
  startedAt: String((now - 60_000) / 1000), readyAt: String((now + 240_000) / 1000),
  completedQuantity: 0, remainingQuantity: 1, currentUnitSecondsRemaining: 240, currentUnitProgressBps: 2000,
};
const context: ProductionPlanContext = {
  body, resources: { metal: "999999999999999", crystal: "999999999999999", deuterium: "999999999999999" },
  ships: kind === "ship" ? items : [], defenses: kind === "defense" ? items : [],
  available: true, defenseCounts: [], shipyardLevel: 4, naniteLevel: 0,
  ...(kind === "ship" ? { shipQueue: queue } : { defenseQueue: queue }),
};
function Fixture() {
  const [rows, setRows] = useState<ProductionOrder[]>(items.slice(0, params.get("count") === "1" ? 1 : 4).map(item => ({
    kind, id: item.id, quantity: params.has("large") ? 4294967295 : 1,
  })));
  const [confirmations, setConfirmations] = useState(0);
  const noop = () => undefined;
  return <main style={{ maxWidth: "960px", margin: "24px auto", padding: "0 16px" }}>
    <p style={{ fontSize: "12px", color: "#94a3b8" }}>Local fixture · {body} {kind === "ship" ? "Shipyard" : "Defenses"} · disconnected submission</p>
    <ProductionCatalog items={items} queue={queue} queueTone={kind === "ship" ? "cyan" : "rose"} now={now}
      actionPending={false} canTransact emptyLabel="" onBuild={noop} onQuantity={noop} onSelect={noop}
      productionKind={kind} buildPlan={{ body, context, rows, ready: true, busy: params.has("busy"),
        unknown: params.has("unknown"), error: params.has("error") ? "Wallet request rejected" : undefined,
        onAdd: order => setRows(previous => [...previous, order]),
        onRemove: index => setRows(previous => previous.filter((_, i) => i !== index)),
        onClear: () => setRows([]), onConfirm: () => setConfirmations(previous => previous + 1),
      }} />
    <output aria-label="Fixture confirmations">{confirmations}</output>
  </main>;
}
document.body.style.background = "#05070d";
render(<Fixture />, document.getElementById("app")!);
