import { afterEach, expect, test } from "bun:test";
import { h, render } from "preact";
import { useEffect } from "preact/hooks";
import { BackendDataStore } from "../src/backendDataStore";
import { ProductionCatalog, type ProductionCatalogItem } from "../src/components/ProductionCatalog";
import { DefensePage } from "../src/components/DefensePage";
import { OverviewPage } from "../src/components/OverviewPage";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainDefenseState, QueueStateResponse } from "../src/walletFlow";
import { MoonPage } from "../src/components/MoonPage";
import { defenseCatalog, shipyardCatalog } from "../src/playableMvp";
import { useProductionBuildPlan } from "../src/useProductionBuildPlan";
import { maxAddableProduction, type ProductionOrder, type ProductionPlanContext } from "../src/productionBuildPlan";
import { productionPlanContext } from "../src/productionBuildPlanContext";
import type { ChainMoonState } from "../src/walletFlow";
import { confirmTransactionRetry } from "../src/transactionActionGate";

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  attributes: { name: string; value: string }[] = [];
  style = { cssText: "", setProperty() {}, removeProperty() {} };
  onclick: unknown = null;
  disabled = false;
  listeners = new Map<string, (event: { type: string }) => void>();
  constructor(public nodeType: number, public nodeName: string, public data = "") {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  get textContent(): string { return this.nodeType === 3 ? this.data : this.childNodes.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.childNodes = []; this.data = value; }
  appendChild(child: TestNode) { return this.insertBefore(child, null); }
  insertBefore(child: TestNode, before: TestNode | null) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    return child;
  }
  removeChild(child: TestNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
  setAttribute(name: string, value: string) { this.attributes = [...this.attributes.filter(attr => attr.name !== name), { name, value: String(value) }]; }
  removeAttribute(name: string) { this.attributes = this.attributes.filter(attr => attr.name !== name); }
  addEventListener(name: string, callback: (event: { type: string }) => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  dispatchEvent(event: { type: string }) { this.listeners.get(event.type)?.call(this, event); }
  query(name: string): TestNode | undefined { return this.attributes.some(attr => attr.name === "aria-label" && attr.value === name)
    ? this : this.childNodes.map(child => child.query(name)).find(Boolean); }
  matching(name: string, value: string): TestNode[] { return [
    ...(this.attributes.some(attr => attr.name === name && attr.value === value) ? [this] : []),
    ...this.childNodes.flatMap(child => child.matching(name, value)),
  ]; }
  get ownerDocument() { return document; }
}
const document = Object.assign(new EventTarget(), {
  visibilityState: "visible",
  createElement: (name: string) => new TestNode(1, name.toUpperCase()),
  createElementNS: (_ns: string, name: string) => new TestNode(1, name.toUpperCase()),
  createTextNode: (text: string) => new TestNode(3, "#text", text),
});
const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const root = new TestNode(1, "DIV");
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  render(null, root as unknown as Element);
  if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

async function until(predicate: () => boolean, label = "condition") {
  for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(2);
  if (!predicate()) throw new Error(`Timed out: ${label}; rendered: ${root.textContent}`);
}
const ship = shipyardCatalog[0]!;
const item: ProductionCatalogItem = {
  ...ship, groupLabel: ship.group, countLabel: "Owned", countValue: 0,
  status: "ready", cost: { metal: 100, crystal: 0, deuterium: 0 },
  unitCost: { metal: 100, crystal: 0, deuterium: 0 }, unitCostRaw: { metal: "100", crystal: "0", deuterium: "0" },
  durationSeconds: 144, requirements: [], missing: [], quantity: 1,
  disabled: false, actionLabel: "Build", detailNote: "Ship",
};
const defense = defenseCatalog.find(entry => entry.key === "rocketLauncher")!;
const defenseItem: ProductionCatalogItem = { ...item, ...defense, groupLabel: defense.group };
const context: ProductionPlanContext = {
  body: "planet", resources: { metal: "10000", crystal: "0", deuterium: "0" },
  ships: [item], defenses: [defenseItem], available: true, defenseCounts: [], shipyardLevel: 0, naniteLevel: 0,
};
const order = { kind: "ship" as const, id: ship.id, quantity: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mountFlow(mode: "timeout" | "disconnect" | "reject" | "revert", body: "planet" | "moon" = "planet", initialRows: ProductionOrder[] = [order]) {
  const key = `0x2105:0xabc:7:${body}`;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const storage = new Map<string, string>();
  let consent = false;
  let sends = 0;
  let initialized = false;
  const first = deferred<string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), {
    confirm: () => consent,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  }) });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  const data = new BackendDataStore("https://recovery.test", {
    transactionForegroundTimeoutMs: 8, transactionPollIntervalMs: 0,
    transactionStatusReader: async hash => ({ events: [], indexedEventCount: 0, latestIndexedBlock: "20", receiptBlock: "20", transactionHash: hash, phase: mode === "revert" ? "reverted" : "applied" }),
  });
  function MountedPlan() {
    const plan = useProductionBuildPlan();
    useEffect(() => { plan.setDrafts({ [key]: initialRows }); initialized = true; }, []);
    const rows = plan.drafts[key] ?? [];
    const confirm = () => {
      if (!plan.start(key)) return;
      const submitted = [...rows];
      void data.runWriteTransaction({ key: `production-batch:${body}:7`, chainId: "0x2105", planetIds: ["7"],
        label: "Build plan", waitForIndexing: false, confirmRetry: confirmTransactionRetry,
        onStateChange: state => plan.onState(key, submitted, state),
        send: async beforeSend => {
          const control = beforeSend();
          sends++;
          if (sends > 1) return "0xretry";
          if (mode === "disconnect") { queueMicrotask(() => control.disconnected()); return first.promise; }
          if (mode === "reject") throw Object.assign(new Error("Rejected by wallet"), { code: 4001 });
          if (mode === "revert") return "0xreverted";
          return first.promise;
        },
      }).then(result => plan.onOutcome(key, submitted, result)).catch(error => { plan.release(key); plan.setError(key, String(error)); });
    };
    const planContext = { ...context, body };
    const buildPlan = { body, context: planContext, rows, busy: Boolean(plan.busy[key]), unknown: Boolean(plan.unknown[key]), ready: true,
      error: plan.errors[key],
      // Same state/eligibility path used by PlayableMvpApp; no fixture-only cap.
      onAdd: (next: ProductionOrder) => {
        if (plan.busyRef.current.has(key)) return;
        plan.setDrafts(previous => {
          const current = previous[key] ?? [];
          const max = maxAddableProduction(planContext, current, next.kind, next.id);
          if (next.quantity < 1 || next.quantity > max) return previous;
          return { ...previous, [key]: [...current, next] };
        });
      },
      onRemove: (index: number) => plan.setDrafts(previous => ({ ...previous, [key]: (previous[key] ?? []).filter((_, position) => position !== index) })),
      onClear: () => plan.setDrafts(previous => ({ ...previous, [key]: [] })), onConfirm: confirm };
    return <>
      <ProductionCatalog actionPending={false} canTransact emptyLabel="" items={[item]}
        onBuild={() => {}} onQuantity={() => {}} onSelect={() => {}} selectedKey={ship.key} productionKind="ship" buildPlan={buildPlan} />
      <ProductionCatalog actionPending={false} canTransact emptyLabel="" items={[defenseItem]}
        onBuild={() => {}} onQuantity={() => {}} onSelect={() => {}} selectedKey={defense.key} productionKind="defense" showPlan={false} buildPlan={buildPlan} />
    </>;
  }
  render(<MountedPlan />, root as unknown as Element);
  return { data, first, get initialized() { return initialized; }, get sends() { return sends; }, allow: () => { consent = true; } };
}
function click(name: string) {
  const node = root.query(name);
  expect(node).toBeDefined();
  node!.dispatchEvent({ type: "click", timeStamp: performance.now() });
}

function expectCount(count: number) {
  const panels = root.matching("data-build-plan", "true");
  expect(panels).toHaveLength(count ? 1 : 0);
  if (count) expect(root.query(`Build plan ${count} of 15 orders`)?.textContent).toBe(`${count}/15`);
  else expect(root.query("Build plan 0 of 15 orders")).toBeUndefined();
}

test.each(["planet", "moon"] as const)("mounted %s shared catalogs count Add, cap, Remove and Clear transitions", async body => {
  const flow = mountFlow("timeout", body, []);
  try {
    // Let the initial effect settle before interacting with the empty plan.
    await until(() => flow.initialized);
    expectCount(0);
    for (let count = 1; count <= 15; count++) {
      const label = count % 2 ? ship.label : defense.label;
      expect(root.query(`Add ${label} to build plan`)?.disabled).toBe(false);
      click(`Add ${label} to build plan`);
      await until(() => Boolean(root.query(`Build plan ${count} of 15 orders`)), `add ${count}`);
      expectCount(count);
    }
    expect(root.query("Confirm build plan")?.disabled).toBe(false);
    for (const label of [ship.label, defense.label]) {
      expect(root.query(`Add ${label} to build plan`)?.disabled).toBe(true);
      // Even a synthetic event bypassing native disabled-button handling cannot add row 16.
      click(`Add ${label} to build plan`);
      await Bun.sleep(2);
      expectCount(15);
    }
    click(`Remove ${ship.label} from build plan`);
    await until(() => Boolean(root.query("Build plan 14 of 15 orders")));
    expectCount(14);
    expect(root.query(`Add ${ship.label} to build plan`)?.disabled).toBe(false);
    expect(root.query(`Add ${defense.label} to build plan`)?.disabled).toBe(false);
    click(`Add ${defense.label} to build plan`);
    await until(() => Boolean(root.query("Build plan 15 of 15 orders")));
    expectCount(15);
    click("Clear build plan");
    await until(() => !root.query("Confirm build plan"));
    expectCount(0); // Empty plans are hidden, not rendered as 0/15.
  } finally { flow.data.dispose(); }
});

test.each(["timeout", "disconnect"] as const)("mounted %s late receipt removes submitted snapshot but retains newer shared row", async mode => {
  const flow = mountFlow(mode);
  try {
    await until(() => Boolean(root.query("Build plan 1 of 15 orders")));
    expectCount(1);
    click("Confirm build plan");
    await until(() => Boolean(root.query("Retry build plan after checking wallet activity")));
    expectCount(1);
    click(`Add ${defense.label} to build plan`);
    await until(() => Boolean(root.query("Build plan 2 of 15 orders")));
    expectCount(2);
    flow.first.resolve("0xlate");
    await until(() => Boolean(root.query("Build plan 1 of 15 orders")) && !root.query("Retry build plan after checking wallet activity"));
    expectCount(1);
    expect(root.query(`Remove ${ship.label} from build plan`)).toBeUndefined();
    expect(root.query(`Remove ${defense.label} from build plan`)).toBeDefined();
    // Both confirmed and applied notifications must clear the same snapshot only once.
    await Bun.sleep(10);
    expectCount(1);
    expect(flow.sends).toBe(1);
  } finally { flow.data.dispose(); }
});

test("mounted MoonPage shows one shared plan and both populated catalogs keep Add with a shared budget", () => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const defense = defenseCatalog.find(entry => entry.key === "rocketLauncher")!;
  const moon: ChainMoonState = {
    wallet: "0x1111111111111111111111111111111111111111", homePlanetId: "7",
    moon: { exists: true, planetId: "7", owner: "0x1111111111111111111111111111111111111111", fields: 9, diameterKm: 8774, createdAt: "1700000000", jumpGateReadyAt: "0" },
    buildings: [{ id: 3, key: "shipyard", label: "Shipyard", level: 3, cost: { metal: "100", crystal: "0", deuterium: "0" } }],
    queue: null, resources: { metal: "150", crystal: "0", deuterium: "0" },
    ships: [{ id: ship.id, count: 0, cost: { metal: "100", crystal: "0", deuterium: "0" }, durationSeconds: 60 }],
    defenses: [{ id: defense.id, count: 0, cost: { metal: "100", crystal: "0", deuterium: "0" }, durationSeconds: 60 }],
    defenseQueue: null,
  };
  const context = productionPlanContext("moon", { moon, defense: null, shipyard: null, infrastructure: null });
  const noop = () => {};
  render(<MoonPage moonState={moon} canTransact buildPlan={{ body: "moon", context,
    rows: [{ kind: "ship", id: ship.id, quantity: 1 }], busy: false, ready: true,
    onAdd: noop, onRemove: noop, onClear: noop, onConfirm: noop }} />, root as unknown as Element);
  expect(root.matching("data-production-catalog", "true")).toHaveLength(2);
  expect(root.matching("data-build-plan", "true")).toHaveLength(1);
  expect(root.matching("aria-label", "Confirm build plan")).toHaveLength(1);
  expect(root.matching("aria-label", "Clear build plan")).toHaveLength(1);
  expect(root.query(`Add ${ship.label} to build plan`)).toBeDefined();
  const defenseAdd = root.query(`Add ${defense.label} to build plan`);
  expect(defenseAdd).toBeDefined();
  expect(defenseAdd?.disabled).toBe(true); // Ship draft has spent 100 of the moon's 150 metal.
});

test.each(["timeout", "disconnect"] as const)("mounted plan recovers from %s, preserves draft and clears on late receipt", async mode => {
  const flow = mountFlow(mode);
  try {
    await until(() => Boolean(root.query("Confirm build plan")));
    click("Confirm build plan");
    await until(() => Boolean(root.query("Retry build plan after checking wallet activity")));
    expect(root.query("Clear build plan")?.disabled).toBe(false);
    expect(root.query(`Remove ${ship.label} from build plan`)?.disabled).toBe(false);
    expect(root.textContent).toContain("Check wallet activity");
    click("Retry build plan after checking wallet activity");
    await until(() => Boolean(root.query("Retry build plan after checking wallet activity")));
    expect(flow.sends).toBe(1); // declined consent does not send again
    flow.first.resolve("0xlate");
    await until(() => !root.query("Retry build plan after checking wallet activity"));
    expect(root.query("Confirm build plan")).toBeUndefined();
  } finally { flow.data.dispose(); }
});

test("mounted uncertain retry needs explicit consent, then new receipt removes only submitted snapshot", async () => {
  const flow = mountFlow("timeout");
  try {
    await until(() => Boolean(root.query("Confirm build plan")));
    click("Confirm build plan");
    await until(() => Boolean(root.query("Retry build plan after checking wallet activity")));
    flow.allow();
    click("Retry build plan after checking wallet activity");
    await until(() => flow.sends === 2);
    await until(() => !root.query("Confirm build plan") && !root.query("Retry build plan after checking wallet activity"));
    flow.first.resolve("0xlate");
    await Bun.sleep(5);
    expect(flow.sends).toBe(2);
  } finally { flow.data.dispose(); }
});

test.each(["reject", "revert"] as const)("mounted %s releases controls and preserves draft", async mode => {
  const flow = mountFlow(mode);
  try {
    await until(() => Boolean(root.query("Confirm build plan")));
    click("Confirm build plan");
    await until(() => Boolean(root.query("Confirm build plan")) && root.textContent.includes(mode === "reject" ? "Rejected" : "reverted") && !root.query("Retry build plan after checking wallet activity"));
    expect(root.query("Clear build plan")?.disabled).toBe(false);
    click("Clear build plan");
    await until(() => !root.query("Confirm build plan"));
  } finally { flow.data.dispose(); }
});


test("mounted Defenses and Overview consume completed units as current without settlement duty", () => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const now = 1700001000000;
  const noop = () => {};
  const queue: QueueStateResponse = {
    active: true, kind: "defense", itemId: 0, quantity: 23, readyAt: "1700001000",
    cost: { metal: "46000", crystal: "0", deuterium: "0" },
    productionTiming: { originalQuantity: 100, startedAt: "1700000000", unitWorkSeconds: "10", rate: "1" },
    asOfNow: { complete: true, secondsRemaining: 0, completedQuantity: 100, remainingQuantity: 0 },
  };
  const base: ChainDefenseState = {
    wallet: "0x1111111111111111111111111111111111111111", homePlanetId: "189",
    resources: { metal: "0", crystal: "0", deuterium: "0" },
    shipyardLevel: 1, naniteLevel: 0, missileSiloLevel: 0, technologyLevels: {},
    defenses: [{ id: 0, count: 101, cost: { metal: "2000", crystal: "0", deuterium: "0" } }],
    launchableDefenses: [{ id: 0, count: 101 }], queue: null, unsettledQueue: queue,
  };
  const initial = createInitialPlayableState(now);
  const mount = (page: "defenses" | "overview", state: ChainDefenseState) => {
    if (page === "defenses") render(<DefensePage defenseState={state} actionState={{ status: "idle" }}
      canTransact={false} loading={false} error={undefined} onBuild={noop} onRefresh={noop} now={now} />, root as unknown as Element);
    else render(<OverviewPage state={initial} settledState={initial} rates={initial.resources} caps={initial.resources}
      queueProgress={0} researchProgress={0} shipProgress={0} now={now} isWalletConnected onChainStatus="ready" onNavigate={noop}
      onChainQueues={{ wallet: base.wallet, homePlanetId: "189", building: null, ship: null, research: null,
        defense: state.queue, unsettledDefense: state.unsettledQueue }} />, root as unknown as Element);
  };
  for (const page of ["defenses", "overview"] as const) {
    // Before the remaining units mature, keep the existing building presentation.
    const building = { ...queue, asOfNow: { complete: false, secondsRemaining: 230, completedQuantity: 77, remainingQuantity: 23 } };
    mount(page, { ...base, defenses: [{ ...base.defenses[0]!, count: 78 }], queue: building, unsettledQueue: building });
    expect(root.textContent).not.toContain("Built · awaiting settlement");
    // Partially matured but not credited: only 3 due; 20 still queued.
    const partial = { ...queue, asOfNow: { complete: false, secondsRemaining: 200, completedQuantity: 80, remainingQuantity: 20 } };
    mount(page, { ...base, defenses: [{ ...base.defenses[0]!, count: 81 }], queue: { ...partial, quantity: 20 }, unsettledQueue: partial });
    expect(root.query("Defense settlement")).toBeUndefined();
    if (page === "defenses") expect(root.textContent).toContain("Deployed: 81");
    // Fully matured, backend projected queue has disappeared, canonical queue remains.
    mount(page, base);
    expect(root.query("Defense settlement")).toBeUndefined();
    expect(root.textContent).not.toContain("Already paid for and finished building");
    if (page === "overview") expect(root.textContent).toContain("No active defense production.");
    if (page === "defenses") {
      expect(root.textContent).toContain("Deployed: 101");
      expect(root.textContent).not.toContain("Awaiting settlement:");
    }
    // A new still-building backlog must coexist with the matured head notice.
    const backlog = { ...building, itemId: 1, quantity: 5,
      asOfNow: { complete: false, secondsRemaining: 50, completedQuantity: 0, remainingQuantity: 5 } };
    mount(page, { ...base, queue: backlog, unsettledQueue: { ...queue, backlog: [backlog] } });
    expect(root.query("Defense settlement")).toBeUndefined();
    expect(root.query("Queue: Light Laser")).toBeDefined();
    // Repeated canonical settled snapshots remove the notice without double credit.
    const settled = { ...base, defenses: [{ ...base.defenses[0]!, count: 101 }], unsettledQueue: null };
    for (let i = 0; i < 2; i++) {
      mount(page, settled);
      expect(root.query("Defense settlement")).toBeUndefined();
      expect(root.textContent).not.toContain("Awaiting settlement:");
      if (page === "defenses") expect(root.textContent).toContain("Deployed: 101");
    }
    render(null, root as unknown as Element);
  }
});
