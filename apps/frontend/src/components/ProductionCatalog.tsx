import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { formatCost } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import type { Resources } from "../playableMvp";
import type { QueueStateResponse } from "../walletFlow";
import { constructionQueueForDisplay, type ConstructionProgress } from "../constructionProgress";
import { OptimizedImage } from "./OptimizedImage";
import {
  formatQueueEta,
  QueueProgressPanel,
  type QueueProgressTone,
} from "./QueueProgressPanel";
import {
  RequirementFlairs as SharedRequirementFlairs,
  type RequirementFlair,
  type RequirementTarget,
} from "./RequirementFlairs";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export type ProductionRequirementState = RequirementFlair;
export type ProductionQuantityInput = number | string;

export type ProductionDetailStat = {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "danger" | "normal" | undefined;
  wide?: boolean | undefined;
};

export type ProductionDetailSection = {
  title: string;
  stats: ProductionDetailStat[];
};

export type ProductionCatalogItem<Key extends string = string> = {
  key: Key;
  id: number;
  label: string;
  group: string;
  groupLabel: string;
  asset: string;
  countLabel: string;
  countValue: number | undefined;
  queued?: number | undefined;
  status: "ready" | "locked" | "queued" | "unavailable";
  statusLabel?: string | undefined;
  labelTone?: "normal" | "muted" | undefined;
  // The prominently displayed amount charged for the currently selected quantity.
  cost: Resources | undefined;
  unitCost?: Resources | undefined;
  costAffordable?: boolean | undefined;
  maxQuantity?: number | undefined;
  // Predicted build time for the selected quantity (VEY-KANEO-472). Backend-sourced
  // per-unit duration scaled by quantity; undefined when the backend omits it.
  durationSeconds?: number | undefined;
  requirements: ProductionRequirementState[];
  missing: string[];
  blockedReason?: string | undefined;
  quantity: number;
  quantityInput?: ProductionQuantityInput | undefined;
  quantityValid?: boolean | undefined;
  disabled: boolean;
  actionLabel: string;
  detailNote: string;
  detailLayout?: "sections" | "inline" | undefined;
  detailSections?: ProductionDetailSection[] | undefined;
  readOnly?: boolean | undefined;
  notes?: string[] | undefined;
  thumbnailStyle?: Record<string, string> | undefined;
};

export type ProductionQueue = {
  label: string;
  asset?: string | undefined;
  quantity?: number | undefined;
  readyAt: string | null;
  startedAt?: string | null | undefined;
  completedQuantity?: number | undefined;
  remainingQuantity?: number | undefined;
  currentUnitSecondsRemaining?: number | undefined;
  currentUnitProgressBps?: number | undefined;
  overallProgressBps?: number | undefined;
  backlog?: ProductionQueue[] | undefined;
};

type ProductionCatalogSource<Key extends string> = {
  asset: string;
  group: string;
  id: number;
  key: Key;
  label: string;
};

type ProductionItemAdapterResult<Key extends string> = Omit<
  ProductionCatalogItem<Key>,
  "asset" | "group" | "id" | "key" | "label" | "quantity" | "quantityInput" | "quantityValid"
>;

export type ProductionItemAdapterContext = {
  quantity: number;
  quantityInput: ProductionQuantityInput;
  quantityValid: boolean;
};

export function adaptProductionItems<Key extends string, Source extends ProductionCatalogSource<Key>>(
  catalog: readonly Source[],
  quantities: Record<string, ProductionQuantityInput>,
  adapt: (source: Source, context: ProductionItemAdapterContext) => ProductionItemAdapterResult<Key>,
): ProductionCatalogItem<Key>[] {
  return catalog.map((source) => {
    const quantityInput = quantities[source.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    return {
      asset: source.asset,
      group: source.group,
      id: source.id,
      key: source.key,
      label: source.label,
      quantity,
      quantityInput,
      quantityValid: parsedQuantity !== undefined,
      ...adapt(source, { quantity, quantityInput, quantityValid: parsedQuantity !== undefined }),
    };
  });
}

export function selectedProductionItem<Key extends string>(
  items: readonly ProductionCatalogItem<Key>[],
  selectedKey: Key | undefined,
): ProductionCatalogItem<Key> | undefined {
  return items.find((item) => item.key === selectedKey) ?? items[0];
}

export function productionQueueViewModel(
  queue: QueueStateResponse | null | undefined,
  catalog: readonly { id: number; label: string; asset: string }[],
): ProductionQueue | undefined {
  if (!queue?.active) return undefined;
  const item = catalog.find((candidate) => candidate.id === queue.itemId);
  return {
    asset: item?.asset,
    label: item?.label ?? (queue.kind === "defense" ? "Defense" : "Ship"),
    quantity: queue.quantity,
    readyAt: queue.readyAt,
    startedAt: queue.startedAt ?? queue.productionTiming?.startedAt,
    completedQuantity: queue.asOfNow?.completedQuantity,
    remainingQuantity: queue.asOfNow?.remainingQuantity,
    currentUnitSecondsRemaining: queue.asOfNow?.currentUnitSecondsRemaining,
    currentUnitProgressBps: queue.asOfNow?.currentUnitProgressBps,
    overallProgressBps: queue.asOfNow?.overallProgressBps,
    backlog: queue.backlog?.filter((entry) => entry.active).map((entry) => {
      const backlogItem = catalog.find((candidate) => candidate.id === entry.itemId);
      return {
        asset: backlogItem?.asset,
        label: backlogItem?.label ?? (entry.kind === "defense" ? "Defense" : "Ship"),
        quantity: entry.quantity,
        readyAt: entry.readyAt,
        startedAt: entry.startedAt ?? entry.productionTiming?.startedAt,
      };
    }),
  };
}

export type ProductionCatalogProps<Key extends string> = {
  actionPending: boolean;
  canTransact: boolean;
  emptyLabel: string;
  items: ProductionCatalogItem<Key>[];
  now?: number | undefined;
  onBuild: (item: ProductionCatalogItem<Key>) => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onQuantity: (key: Key, quantity: ProductionQuantityInput) => void;
  onRefreshQueue?: (() => void) | undefined;
  onSelect: (key: Key) => void;
  queue?: ProductionQueue | undefined;
  queueProgress?: ConstructionProgress | undefined;
  queueTone?: QueueProgressTone | undefined;
  selectedKey: Key | undefined;
};

export function ProductionSection<Key extends string>({
  children,
  items,
  title,
  ...catalogProps
}: Omit<ProductionCatalogProps<Key>, "items" | "onQuantity"> & {
  children?: ComponentChildren;
  items: (quantities: Record<string, ProductionQuantityInput>) => ProductionCatalogItem<Key>[];
  title?: string | undefined;
}) {
  const [quantities, setQuantities] = useState<Record<string, ProductionQuantityInput>>({});
  return (
    <section className="grid gap-3">
      {title ? <div className="min-w-0"><h3 className="text-base font-semibold text-white">{title}</h3></div> : null}
      {children}
      <ProductionCatalog
        {...catalogProps}
        items={items(quantities)}
        onQuantity={(key, quantity) => setQuantities((previous) => ({ ...previous, [key]: quantity }))}
      />
    </section>
  );
}

export function ProductionCatalog<Key extends string>({
  actionPending,
  canTransact,
  emptyLabel,
  items,
  now = Date.now(),
  onBuild,
  onOpenRequirement,
  onQuantity,
  onSelect,
  queue,
  queueProgress,
  queueTone = "cyan",
  selectedKey,
}: ProductionCatalogProps<Key>) {
  const selected = selectedProductionItem(items, selectedKey);
  const groups = Array.from(new Map(items.map((item) => [item.group, item.groupLabel])).entries());
  const selectedPanelId = `production-detail-${items[0]?.key ?? "item"}`;
  const displayedQueue = constructionQueueForDisplay(queue, queueProgress);

  if (items.length === 0) {
    return (
      <div className="rounded border border-white/10 bg-[#101624] px-4 py-3 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-production-catalog>
      {displayedQueue && (
        <ProductionQueuePanel
          now={now}
          progressState={queueProgress}
          queue={displayedQueue}
          tone={queueTone}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:items-start">
        <SelectedProductionPanel
          emptyLabel={emptyLabel}
          id={selectedPanelId}
          item={selected}
          onBuild={onBuild}
          onOpenRequirement={onOpenRequirement}
          onQuantity={onQuantity}
        />

        <div className="grid gap-3 xl:order-1">
          {groups.map(([group, label]) => (
            <section className="grid gap-2" key={group}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {label}
                </h3>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {items.filter((item) => item.group === group).map((item) => (
                  <CatalogButton
                    controls={selectedPanelId}
                    item={item}
                    key={item.key}
                    onSelect={onSelect}
                    selected={selected?.key === item.key}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductionQueuePanel({
  embedded = false,
  now,
  progressState,
  queue,
  showBacklogEta = true,
  tone = "cyan",
}: {
  embedded?: boolean | undefined;
  now: number;
  progressState?: ConstructionProgress | undefined;
  queue: ProductionQueue;
  showBacklogEta?: boolean | undefined;
  tone?: QueueProgressTone | undefined;
}) {
  const totalReadyAt = queue.backlog?.at(-1)?.readyAt ?? queue.readyAt;
  return (
    <QueueProgressPanel
      asset={queue.asset}
      label={queue.label}
      now={now}
      progressState={progressState}
      completedQuantity={queue.completedQuantity}
      completionReadyAt={embedded ? totalReadyAt : undefined}
      completionStartedAt={embedded ? queue.startedAt : undefined}
      currentUnitProgressBps={queue.currentUnitProgressBps}
      currentUnitSecondsRemaining={queue.currentUnitSecondsRemaining}
      embedded={embedded}
      progress={queue.overallProgressBps === undefined ? undefined : queue.overallProgressBps / 10_000}
      quantity={queue.quantity}
      readyAt={queue.readyAt}
      remainingQuantity={queue.remainingQuantity}
      startedAt={queue.startedAt}
      title="Queue"
      tone={tone}
    >
      {queue.backlog && queue.backlog.length > 0 ? (
        queue.backlog.map((entry, index) => {
          const entryTitle = `${entry.label}${entry.quantity ? ` ×${formatter.format(entry.quantity)}` : ""}`;
          return (
            <span
              className="inline-flex items-center gap-1.5"
              key={`${entry.label}-${index}`}
              title={entryTitle}
            >
              {entry.asset ? (
                <OptimizedImage
                  alt=""
                  className="h-6 w-6 shrink-0 rounded object-contain"
                  sizes="icon"
                  src={entry.asset}
                />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded bg-white/5" />
              )}
              <span className="grid gap-0.5 leading-none">
                {entry.quantity ? (
                  <span className="text-[11px] font-medium tabular-nums text-slate-300">
                    ×{formatter.format(entry.quantity)}
                  </span>
                ) : null}
                {showBacklogEta ? (
                  <span className="text-[9px] tabular-nums text-slate-500">
                    {formatQueueEta(entry.readyAt)}
                  </span>
                ) : null}
              </span>
            </span>
          );
        })
      ) : null}
    </QueueProgressPanel>
  );
}

function CatalogButton<Key extends string>({
  controls,
  item,
  onSelect,
  selected,
}: {
  controls: string;
  item: ProductionCatalogItem<Key>;
  onSelect: (key: Key) => void;
  selected: boolean;
}) {
  const statusClass = {
    locked: "text-amber-300",
    queued: "text-cyan-200",
    ready: "text-emerald-300",
    unavailable: "text-slate-400",
  }[item.status];
  const labelClass = item.labelTone === "muted" ? "text-slate-500" : "text-white";

  return (
    <button
      aria-controls={controls}
      aria-label={`Select ${item.label}`}
      aria-pressed={selected}
      className={`grid min-h-16 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded border p-2 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${
        selected
          ? "border-cyan-300/50 bg-cyan-300/10"
          : "border-white/10 bg-[#101624] hover:border-white/20 hover:bg-white/5"
      }`}
      data-production-catalog-key={item.key}
      onClick={(event) => {
        onSelect(item.key);
        if (!selected && typeof window !== "undefined") {
          revealProductionPanelAfterSelection(
            event.currentTarget,
            window.innerWidth,
            (callback) => window.requestAnimationFrame(callback),
          );
        }
      }}
      type="button"
    >
      <div className="h-11 w-11 overflow-hidden rounded border border-white/10 bg-black/20">
        <OptimizedImage
          alt=""
          className="h-full w-full object-cover"
          sizes="icon"
          src={item.asset}
          style={item.thumbnailStyle}
        />
      </div>
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${labelClass}`}>{item.label}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {item.countLabel}: {item.countValue === undefined ? "unavailable" : format(item.countValue)}
          {item.queued ? ` · Queued ${format(item.queued)}` : ""}
        </p>
      </div>
      {item.statusLabel ? <span className={`text-xs font-semibold ${statusClass}`}>{item.statusLabel}</span> : null}
    </button>
  );
}

function SelectedProductionPanel<Key extends string>({
  emptyLabel,
  id,
  item,
  onBuild,
  onOpenRequirement,
  onQuantity,
}: {
  emptyLabel: string;
  id: string;
  item: ProductionCatalogItem<Key> | undefined;
  onBuild: (item: ProductionCatalogItem<Key>) => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onQuantity: (key: Key, quantity: ProductionQuantityInput) => void;
}) {
  if (!item) {
    return (
      <aside className="rounded border border-white/10 bg-[#101624] p-4 text-sm text-slate-400" id={id}>
        {emptyLabel}
      </aside>
    );
  }

  const quantityInput = item.quantityInput ?? item.quantity;
  const quantityInvalid = item.quantityValid === false;
  const quantityDigits = Math.max(1, String(quantityInput).length);

  return (
    <aside
      className="grid min-w-0 max-w-full gap-3 overflow-hidden rounded border border-white/10 bg-[#101624] p-4 xl:sticky xl:top-4 xl:order-2"
      data-selected-production-panel
      id={id}
    >
      <div
        className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 xl:grid-cols-1 xl:gap-4"
        data-selected-production-layout="featured"
      >
        <div className="aspect-square overflow-hidden rounded border border-white/10 bg-black/20 p-1 xl:aspect-[4/3] xl:w-full xl:p-0">
          <OptimizedImage
            alt=""
            className="h-full w-full object-contain xl:object-cover"
            sizes="(min-width: 1280px) 348px, 84px"
            src={item.asset}
            style={item.thumbnailStyle}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white xl:text-lg">{item.label}</h3>
          <p className="mt-1 text-xs text-slate-400">{item.detailNote}</p>
          <div className="mt-3">
            <SelectedProductionDetails item={item} />
          </div>
        </div>
      </div>

      {item.notes?.length ? (
        <div className="hidden gap-2 text-xs leading-5 text-slate-300 xl:grid">
          {item.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      ) : null}

      {!item.readOnly ? (
        <ProductionRequirementFlairs
          missing={item.missing}
          onOpenRequirement={onOpenRequirement}
          requirements={item.requirements}
        />
      ) : null}

      {!item.readOnly ? <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-[2.75rem_auto_2.75rem] items-center gap-1 sm:grid-cols-[2rem_auto_2rem]">
            <button
              aria-label={`Decrease ${item.label} quantity`}
              className="h-11 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9"
              disabled={quantityInvalid || item.quantity <= 1}
              onClick={() => onQuantity(item.key, Math.max(1, item.quantity - 1))}
              type="button"
            >
              -
            </button>
            <input
              aria-label={`${item.label} quantity`}
              className="h-9 min-w-16 rounded border border-white/10 bg-[#070913] px-2 text-center font-mono text-sm text-white outline-none [appearance:textfield] [color-scheme:dark] focus:border-signal/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              inputMode="numeric"
              min={1}
              onBlur={() => {
                if (quantityInvalid) {
                  onQuantity(item.key, 1);
                }
              }}
              onInput={(event) => {
                const rawValue = (event.currentTarget as HTMLInputElement).value;
                onQuantity(item.key, rawValue);
              }}
              step={1}
              style={{ width: `calc(${quantityDigits}ch + 3rem)` }}
              type="number"
              value={quantityInput}
            />
            <button
              aria-label={`Increase ${item.label} quantity`}
              className="h-11 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9"
              onClick={() => onQuantity(item.key, (parseProductionQuantity(quantityInput) ?? 1) + 1)}
              type="button"
            >
              +
            </button>
          </div>
          <button
            className="h-11 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:h-9"
            disabled={item.disabled || quantityInvalid}
            onClick={() => onBuild(item)}
            type="button"
          >
            {item.actionLabel}
          </button>
          <button
            aria-label={`${item.label} maximum affordable quantity`}
            className="h-11 rounded border border-white/10 bg-white/[0.03] px-2 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9"
            disabled={item.maxQuantity === undefined || item.maxQuantity < 1 || (!quantityInvalid && item.quantity === item.maxQuantity)}
            onClick={() => {
              if (item.maxQuantity !== undefined && item.maxQuantity >= 1) onQuantity(item.key, item.maxQuantity);
            }}
            type="button"
          >
            Max
          </button>
          <button
            aria-label={`${item.label} reset quantity`}
            className="h-11 rounded border border-white/10 bg-white/[0.03] px-2 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9"
            disabled={!quantityInvalid && item.quantity === 1}
            onClick={() => onQuantity(item.key, 1)}
            type="button"
          >
            Reset
          </button>
        </div>
        {quantityInvalid || item.blockedReason ? (
          <p className="text-xs text-slate-500">
            {quantityInvalid ? productionQuantityValidationMessage : item.blockedReason}
          </p>
        ) : null}
      </div> : null}
    </aside>
  );
}

type ProductionSelectionTrigger = {
  closest: (selector: string) => {
    querySelector: (selector: string) => {
      scrollIntoView: (options: ScrollIntoViewOptions) => void;
    } | null;
  } | null;
};

export function revealProductionPanelAfterSelection(
  trigger: ProductionSelectionTrigger,
  viewportWidth: number,
  schedule: (callback: () => void) => void,
): void {
  if (viewportWidth >= 1280) return;
  const panel = trigger.closest("[data-production-catalog]")
    ?.querySelector("[data-selected-production-panel]");
  if (!panel) return;
  schedule(() => panel.scrollIntoView({ behavior: "auto", block: "start" }));
}

function SelectedProductionDetails<Key extends string>({
  item,
}: {
  item: ProductionCatalogItem<Key>;
}) {
  if (item.detailSections?.length && item.detailLayout !== "inline") {
    return (
      <div className="grid gap-3">
        {item.detailSections.map((section) => (
          <div className="grid gap-2" key={section.title}>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{section.title}</h4>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {section.stats.map((stat) => (
                <Stat
                  className={stat.wide ? "col-span-2" : ""}
                  hint={stat.hint}
                  key={`${section.title}-${stat.label}`}
                  label={stat.label}
                  tone={stat.tone}
                  value={stat.value}
                />
              ))}
            </dl>
          </div>
        ))}
      </div>
    );
  }

  const stats: ProductionDetailStat[] = item.detailSections?.length
    ? item.detailSections.flatMap((section) => section.stats)
    : [
        {
          label: "Total cost",
          value: item.cost ? formatProductionPrice(item.cost) : "-",
          tone: item.costAffordable === false ? "danger" as const : "normal" as const,
        },
        ...(item.unitCost
          ? [{ label: "Per unit", value: formatProductionPrice(item.unitCost), tone: "normal" as const }]
          : []),
        {
          label: item.countLabel,
          value: item.countValue === undefined ? "unavailable" : format(item.countValue),
        },
        ...(item.durationSeconds === undefined
          ? []
          : [{ label: "Build time", value: formatDuration(item.durationSeconds) }]),
      ];

  return (
    <p className="flex min-w-0 flex-wrap gap-x-2 text-xs leading-5 text-slate-400">
      {stats.map((stat, index) => (
        <span
          className={stat.label.includes("cost") || stat.label === "Per unit" ? "min-w-0 break-words" : "whitespace-nowrap"}
          key={`${stat.label}-${index}`}
          title={stat.hint}
        >
          {stat.label} <span className={stat.tone === "danger" ? "text-rose-300" : "text-slate-300"}>{stat.value}</span>
        </span>
      ))}
    </p>
  );
}

export const productionQuantityValidationMessage = "Enter a whole number of 1 or more.";

export function parseProductionQuantity(input: ProductionQuantityInput | undefined): number | undefined {
  if (input === undefined) return 1;
  if (typeof input === "number") {
    return Number.isSafeInteger(input) && input >= 1 ? input : undefined;
  }

  const trimmed = input.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function ProductionRequirementFlairs({
  missing,
  onOpenRequirement,
  requirements,
}: {
  missing: string[];
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  requirements: ProductionRequirementState[];
}) {
  if (requirements.length === 0 && missing.length === 0) {
    return (
      <div className="rounded border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-200">
        No unlock requirements.
      </div>
    );
  }

  const visibleRequirements = requirements.length > 0
    ? requirements
    : missing.map((label) => ({ label, met: false }));

  return (
    <SharedRequirementFlairs
      emptyLabel="No unlock requirements."
      onOpenRequirement={onOpenRequirement}
      requirements={visibleRequirements}
    />
  );
}

function Stat({
  className = "",
  hint,
  label,
  tone = "normal",
  value,
}: {
  className?: string | undefined;
  hint?: string | undefined;
  label: string;
  tone?: "danger" | "normal" | undefined;
  value: string;
}) {
  return (
    <div className={`rounded border px-2 py-1.5 ${tone === "danger" ? "border-rose-300/30 bg-rose-300/5" : "border-white/10 bg-black/20"} ${className}`}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`break-words ${tone === "danger" ? "text-rose-200" : "text-slate-200"}`}>{value}</dd>
      {hint ? <dd className="mt-1 line-clamp-2 text-[10px] leading-3 text-slate-500">{hint}</dd> : null}
    </div>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

export function formatProductionPrice(cost: Resources): string {
  return formatCost(cost);
}

export function scaleProductionCost(unitCost: Resources, quantity: number): Resources {
  return {
    metal: unitCost.metal * quantity,
    crystal: unitCost.crystal * quantity,
    deuterium: unitCost.deuterium * quantity,
  };
}

export function maxAffordableProductionQuantity(
  resources: Resources | undefined,
  unitCost: Resources | undefined,
): number | undefined {
  if (!resources || !unitCost) return undefined;
  const limits = (["metal", "crystal", "deuterium"] as const)
    .filter((resource) => unitCost[resource] > 0)
    .map((resource) => Math.floor(resources[resource] / unitCost[resource]));
  if (limits.length === 0) return undefined;
  return Math.max(0, Math.min(...limits, Number.MAX_SAFE_INTEGER));
}

export function Notice({
  children,
  tone,
}: {
  children: ComponentChildren;
  tone: "danger" | "neutral" | "success";
}) {
  const classes = {
    danger: "border-rose-300/20 bg-rose-300/5 text-rose-200",
    neutral: "border-sky-300/20 bg-sky-300/5 text-sky-200",
    success: "border-emerald-300/20 bg-emerald-300/5 text-emerald-200",
  } as const;

  return (
    <div className={`notice-enter rounded border p-3 text-sm ${classes[tone]}`}>
      {children}
    </div>
  );
}
