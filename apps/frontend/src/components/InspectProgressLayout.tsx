import type { ComponentChildren, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatDurationUntil } from "../durationFormat";
import { queueProgressPercent, type QueueTimeline } from "../playableMvp";
import { formatUserTimestamp } from "../timestampFormat";
import { OptimizedImage } from "./OptimizedImage";
import { PageHeader } from "./PageHeader";

const loadedDetailImageKeys = new Set<string>();

export const singleItemQueueProgressHeaderClassName = "grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start";
export const singleItemQueueProgressLabelClassName = "mt-1 break-words text-xs leading-5 text-amber-200/85";
export const singleItemQueueProgressPercentClassName = "w-fit rounded bg-black/20 px-2 py-1 text-xs font-semibold text-amber-100 sm:justify-self-end";

export function useInspectDetailSelection<ItemKey>(
  onSelectItem?: ((key: ItemKey) => void) | undefined,
) {
  const detailPanelRef = useRef<HTMLDivElement>(null);

  function selectInspectItem(key: ItemKey) {
    onSelectItem?.(key);

    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 0);
    }
  }

  return { detailPanelRef, selectInspectItem };
}

export function InspectPageHeader({
  actions,
  title,
}: {
  actions?: ComponentChildren | undefined;
  title: string;
}) {
  return PageHeader({
    actions,
    title,
  });
}

export function InspectTwoColumnLayout({
  catalog,
  catalogClassName = "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4",
  detail,
  detailPanelRef,
}: {
  catalog: ComponentChildren;
  catalogClassName?: string | undefined;
  detail: ComponentChildren;
  detailPanelRef?: Ref<HTMLDivElement> | undefined;
}) {
  const detailPanel = detailPanelRef ? (
    <div className="order-1 xl:order-2" ref={detailPanelRef}>
      {detail}
    </div>
  ) : (
    <div className="order-1 xl:order-2">
      {detail}
    </div>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:items-start">
      <div className={`order-2 xl:order-1 ${catalogClassName}`}>
        {catalog}
      </div>

      {detailPanel}
    </div>
  );
}

export function InspectCatalogTile({
  asset,
  currentText,
  isDimmed,
  isSelected,
  labelTone = "normal",
  label,
  onClick,
  statusText,
  statusTone = "accent",
}: {
  asset: string;
  currentText: string;
  isDimmed: boolean;
  isSelected: boolean;
  labelTone?: "normal" | "muted" | undefined;
  label: string;
  onClick: () => void;
  statusText: string;
  statusTone?: "accent" | "warning" | undefined;
}) {
  const accentClass = statusTone === "warning" ? "text-amber-300" : "text-signal";
  const labelClass = labelTone === "muted" ? "text-slate-500" : "text-white";

  return (
    <button
      aria-pressed={isSelected}
      className={`group min-w-0 rounded-md border bg-[#101624] p-2 text-left transition hover:border-signal/50 hover:bg-[#141d30] ${
        isSelected ? "border-signal/70 ring-1 ring-signal/40" : "border-white/10"
      } ${isDimmed ? "opacity-60 grayscale" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="block aspect-square overflow-hidden rounded border border-white/10 bg-black/20">
        <OptimizedImage
          alt=""
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          height={256}
          loading="lazy"
          sizes="112px"
          src={asset}
          width={256}
        />
      </span>
      <span className="mt-2 block min-w-0">
        <span className={`block truncate text-sm font-semibold ${labelClass}`}>{label}</span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-xs">
          <span className={isDimmed ? "text-slate-500" : "text-slate-300"}>
            {currentText}
          </span>
          <span className={`truncate text-right ${accentClass}`}>{statusText}</span>
        </span>
      </span>
    </button>
  );
}

export function InspectDetailImage({
  asset,
  cacheKey,
  isDimmed,
}: {
  asset: string;
  cacheKey: string;
  isDimmed: boolean;
}) {
  const currentCacheKeyRef = useRef(cacheKey);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const [loadedCacheKey, setLoadedCacheKey] = useState<string | null>(() => (
    loadedDetailImageKeys.has(cacheKey) ? cacheKey : null
  ));
  const isLoaded = loadedCacheKey === cacheKey;

  currentCacheKeyRef.current = cacheKey;

  useLayoutEffect(() => {
    const image = imageElementRef.current;
    const isCached = Boolean(image?.complete && image.naturalWidth > 0);

    if (loadedDetailImageKeys.has(cacheKey) || isCached) {
      loadedDetailImageKeys.add(cacheKey);
      setLoadedCacheKey(cacheKey);
      return;
    }

    setLoadedCacheKey(null);
  }, [cacheKey]);

  return (
    <div
      aria-busy={!isLoaded}
      className={`relative aspect-square overflow-hidden rounded-md border border-white/10 bg-black/20 ${
        isDimmed ? "opacity-70 grayscale" : ""
      }`}
    >
      {!isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/10 via-white/[0.04] to-white/[0.08]" />
      )}
      <OptimizedImage
        alt=""
        className={`h-full w-full object-cover transition-opacity duration-150 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        height={512}
        imageRef={imageElementRef}
        key={cacheKey}
        loading="lazy"
        onLoad={() => {
          if (cacheKey !== currentCacheKeyRef.current) return;
          loadedDetailImageKeys.add(cacheKey);
          setLoadedCacheKey(cacheKey);
        }}
        sizes="(min-width: 1280px) 400px, (min-width: 640px) 144px, 100vw"
        src={asset}
        width={512}
      />
    </div>
  );
}

export function InspectDetailShell({ children }: { children: ComponentChildren }) {
  return (
    <aside className="min-w-0 rounded-lg border border-white/10 bg-[#0f1624] p-3 xl:sticky xl:top-4">
      {children}
    </aside>
  );
}

export function InspectDetailHero({
  children,
  image,
}: {
  children: ComponentChildren;
  image: ComponentChildren;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-1">
      {image}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function InspectInfoBlock({
  children,
  label,
  value,
}: {
  children?: ComponentChildren | undefined;
  label: string;
  value?: string | undefined;
}) {
  return (
    <p className="min-w-0">
      <span className="block text-xs uppercase tracking-normal text-slate-500">{label}</span>
      {children ?? <span className="mt-1 block break-words text-sm font-semibold text-slate-200">{value}</span>}
    </p>
  );
}

export function InspectInfoRow({
  children,
  label,
  value,
}: {
  children?: ComponentChildren | undefined;
  label: string;
  value?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-200">{children ?? value}</dd>
    </div>
  );
}

export function SingleItemQueueProgress({
  isPrimaryItem,
  label,
  now,
  queue,
  readyAtLabel = "Ready at",
  title,
}: {
  isPrimaryItem: boolean;
  label: string;
  now: number;
  queue: QueueTimeline;
  readyAtLabel?: string | undefined;
  title: { active: string; context: string };
}) {
  const remaining = formatDurationUntil(queue.readyAt, now);
  const percent = queueProgressPercent(queue, now);

  return (
    <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-3">
      <div className={singleItemQueueProgressHeaderClassName}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">
            {isPrimaryItem ? title.active : title.context}
          </p>
          <p className={singleItemQueueProgressLabelClassName}>
            {label}
          </p>
        </div>
        <span className={singleItemQueueProgressPercentClassName}>
          {percent}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
        <div
          className="h-full rounded-full bg-amber-300 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-amber-100 sm:grid-cols-2">
        <p className="min-w-0">
          <span className="block uppercase tracking-normal text-amber-200/70">Time remaining</span>
          <span className="mt-1 block font-semibold">{remaining}</span>
        </p>
        <p className="min-w-0">
          <span className="block uppercase tracking-normal text-amber-200/70">{readyAtLabel}</span>
          <span className="mt-1 block font-semibold">{formatQueueReadyAt(queue.readyAt)}</span>
        </p>
      </div>
    </div>
  );
}

function formatQueueReadyAt(readyAtMs: number): string {
  return formatUserTimestamp(readyAtMs);
}
