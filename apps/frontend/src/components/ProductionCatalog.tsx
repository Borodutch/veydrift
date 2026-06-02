import type { ComponentChildren } from "preact";
import type { Resources } from "../playableMvp";
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
  statusLabel: string;
  cost: Resources | undefined;
  durationSeconds?: number | undefined;
  requirements: ProductionRequirementState[];
  missing: string[];
  blockedReason?: string | undefined;
  quantity: number;
  disabled: boolean;
  actionLabel: string;
  detailNote: string;
  thumbnailStyle?: Record<string, string> | undefined;
};

export type ProductionQueue = {
  label: string;
  asset?: string | undefined;
  quantity?: number | undefined;
  readyAt: string | null;
  startedAt?: string | null | undefined;
};

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
  };
}

export function ProductionCatalog<Key extends string>({
  actionPending,
  canTransact,
  emptyLabel,
  items,
  onBuild,
  onFinishQueue,
  onOpenRequirement,
  onQuantity,
  onRefreshQueue,
  onSelect,
  queue,
  selectedKey,
}: {
  actionPending: boolean;
  canTransact: boolean;
  emptyLabel: string;
  items: ProductionCatalogItem<Key>[];
  onBuild: (item: ProductionCatalogItem<Key>) => void;
  onFinishQueue?: (() => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onQuantity: (key: Key, quantity: number) => void;
  onRefreshQueue?: (() => void) | undefined;
  onSelect: (key: Key) => void;
  queue?: ProductionQueue | undefined;
  selectedKey: Key | undefined;
}) {
  const selected = selectedProductionItem(items, selectedKey);
  const groups = Array.from(new Map(items.map((item) => [item.group, item.groupLabel])).entries());

  return (
    <div className="grid gap-4">
      {queue && (
        <ProductionQueuePanel
          actionPending={actionPending}
          canTransact={canTransact}
          onFinish={onFinishQueue}
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
  onFinish,
  onRefresh,
  queue,
}: {
  actionPending: boolean;
  canTransact: boolean;
  onFinish?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  queue: ProductionQueue;
}) {
  const ready = isQueueReady(queue.readyAt);
  const action = ready ? onFinish : onRefresh;

  return (
    <QueueProgressPanel
      action={action ? {
        disabled: !canTransact || actionPending || (ready && !onFinish),
        label: ready ? "Complete queue" : "Refresh queue",
        onClick: action,
      } : undefined}
      asset={queue.asset}
      label={queue.label}
      quantity={queue.quantity}
      readyAt={queue.readyAt}
      startedAt={queue.startedAt}
      title="Active queue"
      tone="cyan"
    >
      {ready ? "Ready now." : "Production in progress."}
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
        <p className="truncate text-sm font-semibold text-white">{item.label}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {item.countLabel}: {item.countValue === undefined ? "unavailable" : format(item.countValue)}
          {item.queued ? ` · Queued ${format(item.queued)}` : ""}
        </p>
      </div>
      <span className={`text-xs font-semibold ${statusClass}`}>{item.statusLabel}</span>
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
  onQuantity: (key: Key, quantity: number) => void;
}) {
  if (!item) {
    return (
      <aside className="rounded border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
        {emptyLabel}
      </aside>
    );
  }

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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected</p>
          <h3 className="mt-1 text-base font-semibold text-white">{item.label}</h3>
          <p className="mt-1 text-xs text-slate-400">{item.detailNote}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Stat label={item.countLabel} value={item.countValue === undefined ? "unavailable" : format(item.countValue)} />
        <Stat label="Build time" value={item.durationSeconds === undefined ? "-" : formatDuration(item.durationSeconds)} />
        <Stat label="Metal" value={item.cost ? format(item.cost.metal) : "-"} />
        <Stat label="Crystal" value={item.cost ? format(item.cost.crystal) : "-"} />
        <Stat label="Deut" value={item.cost ? format(item.cost.deuterium) : "-"} />
        <Stat label="Status" value={item.statusLabel} />
      </dl>

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
            min={1}
            onInput={(event) => {
              const value = Number((event.currentTarget as HTMLInputElement).value);
              onQuantity(item.key, Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1);
            }}
            type="number"
            value={item.quantity}
          />
          <button
            className="h-9 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={item.disabled}
            onClick={() => onBuild(item)}
            type="button"
          >
            {item.actionLabel}
          </button>
        </div>
        {item.blockedReason ? <p className="text-xs text-slate-500">{item.blockedReason}</p> : null}
      </div>
    </aside>
  );
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value}</dd>
    </div>
  );
}

function isQueueReady(readyAt: string | null): boolean {
  return readyAt ? Number(readyAt) <= Math.floor(Date.now() / 1_000) : false;
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatDuration(seconds: number): string {
  if (seconds < 3_600) {
    return `${Math.ceil(seconds / 60)}m`;
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h ${Math.ceil((seconds % 3_600) / 60)}m`;
  }

  return `${Math.floor(seconds / 86_400)}d ${Math.ceil((seconds % 86_400) / 3_600)}h`;
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
