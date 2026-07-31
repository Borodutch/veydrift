import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  parseProductionQuantity,
  ProductionCatalog,
  productionQuantityValidationMessage,
  type ProductionCatalogItem,
  type ProductionQuantityInput,
} from "../src/components/ProductionCatalog";
import { formatQueueEta } from "../src/components/QueueProgressPanel";

const productionCatalogSource = await Bun.file(
  new URL("../src/components/ProductionCatalog.tsx", import.meta.url),
).text();

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

    const button = elementNodes(catalog).find((node) => node.type === "button" && visibleText(node) === "Build");

    expect(button?.props.disabled).toBe(true);
    expect(visibleText(catalog)).toContain(productionQuantityValidationMessage);
    expect(productionCatalogSource).toContain("onQuantity(item.key, rawValue)");
    expect(productionCatalogSource).toContain("onQuantity(item.key, 1);");
  });

  test("keeps finite selected quantity edits raw until the page model validates them", () => {
    expect(parseProductionQuantity("2.9")).toBeUndefined();
    expect(productionCatalogSource).toContain("const rawValue = (event.currentTarget as HTMLInputElement).value;");
    expect(productionCatalogSource).toContain("onQuantity(item.key, rawValue);");
  });

  test("provides mobile-friendly decrement and increment quantity controls", () => {
    const quantities: ProductionQuantityInput[] = [];
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem({ quantity: 2 })],
      onBuild: () => undefined,
      onQuantity: (_key, quantity) => quantities.push(quantity),
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });
    const buttons = elementNodes(catalog).filter((node) => node.type === "button");
    const decrement = buttons.find((node) => node.props["aria-label"] === "Decrease Rocket Launcher quantity");
    const increment = buttons.find((node) => node.props["aria-label"] === "Increase Rocket Launcher quantity");

    decrement?.props.onClick();
    increment?.props.onClick();

    expect(quantities).toEqual([1, 3]);
    expect(decrement?.props.className).toContain("h-11");
    expect(increment?.props.className).toContain("h-11");
  });

  test("applies Max and Reset quantity presets through the shared responsive controls", () => {
    const quantities: ProductionQuantityInput[] = [];
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem({ maxQuantity: 9, quantity: 2 })],
      onBuild: () => undefined,
      onQuantity: (_key, quantity) => quantities.push(quantity),
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });
    const buttons = elementNodes(catalog).filter((node) => node.type === "button");
    const maximum = buttons.find((node) => node.props["aria-label"] === "Rocket Launcher maximum affordable quantity");
    const reset = buttons.find((node) => node.props["aria-label"] === "Rocket Launcher reset quantity");

    maximum?.props.onClick();
    reset?.props.onClick();

    expect(quantities).toEqual([9, 1]);
    expect(maximum?.props.className).toContain("h-11");
    expect(maximum?.props.className).toContain("sm:h-9");
    expect(reset?.props.className).toContain("h-11");
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

  test("renders compact borderless selected metadata under the combat summary", () => {
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

    const details = elementNodes(catalog)
      .find((node) => node.type === "p" && String(node.props.className).includes("leading-5 text-slate-400"));

    // VEY-KANEO-465: client-derived build time is removed; backend owns durations.
    expect(visibleText(details).replace(/\s+/g, " ").trim()).toContain("Total cost Metal 2,000 Deployed 12");
    expect(details?.props.className).not.toContain("border");
    expect(details?.props.className).toContain("flex-wrap");
    expect(details?.props.className).toContain("min-w-0");
    expect(elementNodes(catalog).find((node) => node.type === "input")?.props.className).toContain("text-center");
    expect(visibleText(details)).not.toContain("Status");
    expect(visibleText(catalog)).not.toContain("Combat");
    expect(visibleText(catalog)).not.toContain("Logistics");
  });

  test("switches the right-column selection to a large featured image layout", () => {
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem({ notes: ["A compact piece of unit lore."] })],
      onBuild: () => undefined,
      onQuantity: () => undefined,
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });
    const featuredLayout = elementNodes(catalog)
      .find((node) => node.props["data-selected-production-layout"] === "featured");
    const imageFrame = elementNodes(featuredLayout)
      .find((node) => node.type === "div" && String(node.props.className).includes("xl:aspect-[4/3]"));
    const image = elementNodes(featuredLayout).find((node) => node.type === "img");
    const lore = elementNodes(catalog)
      .find((node) => node.type === "div" && String(node.props.className).includes("leading-5 text-slate-300"));

    expect(featuredLayout?.props.className).toContain("xl:grid-cols-1");
    expect(imageFrame?.props.className).toContain("xl:w-full");
    expect(imageFrame?.props.className).toContain("xl:p-0");
    expect(image?.props.className).toContain("xl:object-cover");
    expect(lore?.props.className).toContain("hidden");
    expect(lore?.props.className).toContain("xl:grid");
  });

  test("flattens inline logistics and build details without bordered stat boxes", () => {
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem({
        detailLayout: "inline",
        detailSections: [
          { title: "Logistics", stats: [{ label: "Base speed", value: "7,500" }, { label: "Fuel use", value: "50" }] },
          { title: "Build", stats: [{ label: "At planet", value: "3" }, { label: "Price", value: "Metal 6,000" }] },
        ],
      })],
      onBuild: () => undefined,
      onQuantity: () => undefined,
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });
    const text = visibleText(catalog).replace(/\s+/g, " ");
    const definitionTerms = elementNodes(catalog).filter((node) => node.type === "dt");

    expect(text).toContain("Base speed 7,500");
    expect(text).toContain("Fuel use 50");
    expect(text).not.toContain("Logistics");
    expect(definitionTerms).toHaveLength(0);
  });

  test("mutes catalog item titles and omits empty status labels", () => {
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem({
        labelTone: "muted",
        status: "locked",
        statusLabel: undefined,
      })],
      onBuild: () => undefined,
      onQuantity: () => undefined,
      onSelect: () => undefined,
      selectedKey: "rocketLauncher",
    });
    const title = elementNodes(catalog)
      .find((node) => node.type === "p" && visibleText(node) === "Rocket Launcher");
    const catalogButton = elementNodes(catalog)
      .find((node) => node.type === "button" && visibleText(node).includes("Rocket Launcher"));
    const catalogImage = elementNodes(catalogButton).find((node) => node.type === "img");
    const catalogImageFrame = elementNodes(catalogButton)
      .find((node) => node.type === "div" && String(node.props.className).includes("h-11 w-11"));

    expect(title?.props.className).toContain("text-slate-500");
    expect(catalogButton?.props.className).not.toContain("opacity-60");
    expect(catalogButton?.props.className).not.toContain("grayscale");
    expect(catalogImageFrame?.props.className).not.toContain("p-1");
    expect(catalogImage?.props.className).toContain("object-cover");
    expect(visibleText(catalog)).toContain("Rocket Launcher");
    expect(visibleText(catalog)).not.toContain("Ready");
    expect(visibleText(catalog)).not.toContain("Locked");
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
        completedQuantity: 2,
        label: "Rocket Launcher",
        quantity: 2,
        readyAt: "1700000120",
        remainingQuantity: 2,
        startedAt: "1700000000",
      },
      selectedKey: "rocketLauncher",
    });
    const queuePanel = elementNodes(catalog)
      .find((node) => node.type === "section" && node.props["aria-label"] === "Queue: Rocket Launcher");
    const queueText = visibleText(queuePanel).replace(/\s+/g, " ");
    const compactQueueText = queueText.replace(/\s+/g, "");

    expect(queueText).toContain("Queue");
    expect(compactQueueText).toContain("×2");
    expect(compactQueueText).toContain("2/4·50%");
    expect(queueText).toContain("50%");
    expect(queueText).not.toContain("Refresh queue");
    expect(queueText).not.toContain("Rocket Launcher");
    expect(queueText).not.toContain("Time remaining");
    expect(queuePanel?.props.className).toContain("border");
    expect(queuePanel?.props.className).toContain("bg-cyan-300/[0.08]");
  });

  test("renders the backlog as a borderless icon-count rail", () => {
    const catalog = ProductionCatalog({
      actionPending: false,
      canTransact: true,
      emptyLabel: "Select an item.",
      items: [catalogItem()],
      now: 1_700_000_060_000,
      onBuild: () => undefined,
      onQuantity: () => undefined,
      onSelect: () => undefined,
      queue: {
        asset: "/assets/game/defenses/ion-cannon.webp",
        backlog: [
          {
            asset: "/assets/game/defenses/small-shield-dome.webp",
            label: "Small Shield Dome",
            quantity: 1,
            readyAt: "1700000200",
          },
          {
            asset: "/assets/game/defenses/gauss-cannon.webp",
            label: "Gauss Cannon",
            quantity: 4,
            readyAt: "1700000300",
          },
        ],
        label: "Ion Cannon",
        quantity: 22,
        readyAt: "1700000120",
        startedAt: "1700000000",
      },
      selectedKey: "rocketLauncher",
    });
    const queuePanel = elementNodes(catalog)
      .find((node) => node.type === "section" && node.props["aria-label"] === "Queue: Ion Cannon");
    const text = visibleText(queuePanel).replace(/\s+/g, " ");
    const compactText = text.replace(/\s+/g, "");
    const imageSources = elementNodes(catalog)
      .filter((node) => node.type === "img")
      .map((node) => node.props.src);
    const queueItems = elementNodes(queuePanel)
      .filter((node) => node.type === "span" && typeof node.props.title === "string");

    expect(compactText).toContain("×22");
    expect(compactText).toContain("×1");
    expect(compactText).toContain("×4");
    expect(text).not.toContain("Up next");
    expect(text).not.toContain("Ion Cannon");
    expect(text).not.toContain("Small Shield Dome");
    expect(text).not.toContain("Gauss Cannon");
    expect(text).toContain(formatQueueEta("1700000120"));
    expect(text).toContain(formatQueueEta("1700000200"));
    expect(text).toContain(formatQueueEta("1700000300"));
    expect(imageSources).toContain("/assets/game/defenses/ion-cannon.webp");
    expect(imageSources).toContain("/assets/game/defenses/small-shield-dome.webp");
    expect(imageSources).toContain("/assets/game/defenses/gauss-cannon.webp");
    expect(queuePanel?.props.className).toContain("border");
    expect(queueItems.every((node) => !String(node.props.className).includes("border"))).toBe(true);
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
