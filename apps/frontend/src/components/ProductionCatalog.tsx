import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { formatCost } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import type { Resources } from "../playableMvp";
import { timestampToMs } from "../timestampFormat";
import type { QueueStateResponse } from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";
import { QueueProgressPanel } from "./QueueProgressPanel";
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
  cost: Resources | undefined;
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
  detailSections?: ProductionDetailSection[] | undefined;
  notes?: string[] | undefined;
  thumbnailStyle?: Record<string, string> | undefined;
};

export type ProductionQueue = {
  label: string;
  asset?: string | undefined;
  quantity?: number | undefined;
  readyAt: string | null;
  startedAt?: string | null | undefined;
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
    startedAt: queue.startedAt,
    backlog: queue.backlog?.filter((entry) => entry.active).map((entry) => {
      const backlogItem = catalog.find((candidate) => candidate.id === entry.itemId);
      return {
        asset: backlogItem?.asset,
        label: backlogItem?.label ?? (entry.kind === "defense" ? "Defense" : "Ship"),
        quantity: entry.quantity,
        readyAt: entry.readyAt,
        startedAt: entry.startedAt,
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
  onRefreshQueue,
  onSelect,
  queue,
  selectedKey,
}: ProductionCatalogProps<Key>) {
  const selected = selectedProductionItem(items, selectedKey);
  const groups = Array.from(new Map(items.map((item) => [item.group, item.groupLabel])).entries());

  return (
    <div className="grid gap-4">
      {queue && (
        <ProductionQueuePanel
          actionPending={actionPending}
          canTransact={canTransact}
          now={now}
          onRefresh={onRefreshQueue}
          queue={queue}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:items-start">
        <SelectedProductionPanel
          emptyLabel={emptyLabel}
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

function ProductionQueuePanel({
  actionPending,
  canTransact,
  now,
  onRefresh,
  queue,
}: {
  actionPending: boolean;
  canTransact: boolean;
  now: number;
  onRefresh?: (() => void) | undefined;
  queue: ProductionQueue;
}) {
  const ready = isQueueReady(queue.readyAt, now);

  return (
    <QueueProgressPanel
      action={onRefresh ? {
        disabled: !canTransact || actionPending,
        label: "Refresh queue",
        onClick: onRefresh,
      } : undefined}
      asset={queue.asset}
      label={queue.label}
      now={now}
      quantity={queue.quantity}
      readyAt={queue.readyAt}
      startedAt={queue.startedAt}
      title="Active queue"
      tone="cyan"
    >
      <div className="grid gap-2">
        <span>{ready ? "Ready now." : "Production in progress."}</span>
        {queue.backlog && queue.backlog.length > 0 ? (
          <div className="grid gap-1 border-t border-white/10 pt-2 text-xs text-slate-300">
            <span className="font-semibold uppercase tracking-[0.14em] text-slate-500">Queued next</span>
            {queue.backlog.map((entry, index) => (
              <div className="flex items-center justify-between gap-3" key={`${entry.label}-${index}`}>
                <span className="min-w-0 truncate">
                  {entry.label}{entry.quantity ? ` x${formatter.format(entry.quantity)}` : ""}
                </span>
                <span className="shrink-0 text-slate-500">{formatQueueReadyAt(entry.readyAt)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </QueueProgressPanel>
  );
}

function CatalogButton<Key extends string>({
  item,
  onSelect,
  selected,
}: {
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
      aria-pressed={selected}
      className={`grid min-h-16 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded border p-2 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${
        selected
          ? "border-cyan-300/50 bg-cyan-300/10"
          : "border-white/10 bg-[#101624] hover:border-white/20 hover:bg-white/5"
      }`}
      onClick={() => onSelect(item.key)}
      type="button"
    >
      <div className="h-11 w-11 overflow-hidden rounded border border-white/10 bg-black/20 p-1">
        <OptimizedImage
          alt=""
          className="h-full w-full object-contain"
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
  item,
  onBuild,
  onOpenRequirement,
  onQuantity,
}: {
  emptyLabel: string;
  item: ProductionCatalogItem<Key> | undefined;
  onBuild: (item: ProductionCatalogItem<Key>) => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onQuantity: (key: Key, quantity: ProductionQuantityInput) => void;
}) {
  if (!item) {
    return (
      <aside className="rounded border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
        {emptyLabel}
      </aside>
    );
  }

  const quantityInput = item.quantityInput ?? item.quantity;
  const quantityInvalid = item.quantityValid === false;

  return (
    <aside className="grid gap-4 rounded border border-white/10 bg-[#101624] p-4 xl:sticky xl:top-4 xl:order-2">
      <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
        <div className="aspect-square overflow-hidden rounded border border-white/10 bg-black/20 p-1">
          <OptimizedImage
            alt=""
            className="h-full w-full object-contain"
            sizes="shipThumbnail"
            src={item.asset}
            style={item.thumbnailStyle}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{item.label}</h3>
          <p className="mt-1 text-xs text-slate-400">{item.detailNote}</p>
        </div>
      </div>

      {item.notes?.length ? (
        <div className="grid gap-2 text-xs leading-5 text-slate-300">
          {item.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      ) : null}

      {item.detailSections?.length ? (
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
                    value={stat.value}
                  />
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Details</h4>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Stat className="col-span-2" label="Price" value={item.cost ? formatProductionPrice(item.cost) : "-"} />
            <Stat label={item.countLabel} value={item.countValue === undefined ? "unavailable" : format(item.countValue)} />
            {item.durationSeconds === undefined ? null : (
              <Stat label="Build time" value={formatDuration(item.durationSeconds)} />
            )}
          </dl>
        </div>
      )}

      <ProductionRequirementFlairs
        missing={item.missing}
        onOpenRequirement={onOpenRequirement}
        requirements={item.requirements}
      />

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={`${item.label} quantity`}
            className="h-9 w-24 rounded border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-signal/60"
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
            type="number"
            value={quantityInput}
          />
          <button
            className="h-9 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={item.disabled || quantityInvalid}
            onClick={() => onBuild(item)}
            type="button"
          >
            {item.actionLabel}
          </button>
        </div>
        {quantityInvalid || item.blockedReason ? (
          <p className="text-xs text-slate-500">
            {quantityInvalid ? productionQuantityValidationMessage : item.blockedReason}
          </p>
        ) : null}
      </div>
    </aside>
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
  value,
}: {
  className?: string | undefined;
  hint?: string | undefined;
  label: string;
  value: string;
}) {
  return (
    <div className={`rounded border border-white/10 bg-black/20 px-2 py-1.5 ${className}`}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-words text-slate-200">{value}</dd>
      {hint ? <dd className="mt-1 line-clamp-2 text-[10px] leading-3 text-slate-500">{hint}</dd> : null}
    </div>
  );
}

function isQueueReady(readyAt: string | null, now = Date.now()): boolean {
  const readyAtMs = timestampToMs(readyAt);
  return readyAtMs !== undefined && readyAtMs <= now;
}

function formatQueueReadyAt(readyAt: string | null): string {
  const readyAtMs = timestampToMs(readyAt);
  if (readyAtMs === undefined) return "Ready time unknown";
  return new Date(readyAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

export function formatProductionPrice(cost: Resources): string {
  return formatCost(cost);
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
    <div className={`rounded border p-3 text-sm ${classes[tone]}`}>
      {children}
    </div>
  );
}
