import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatDurationUntil } from "../durationFormat";
import { queueProgressPercent, type QueueTimeline } from "../playableMvp";
import { OptimizedImage } from "./OptimizedImage";

const loadedDetailImageKeys = new Set<string>();

export function InspectCatalogTile({
  asset,
  currentText,
  isDimmed,
  isSelected,
  label,
  onClick,
  statusText,
  statusTone = "accent",
}: {
  asset: string;
  currentText: string;
  isDimmed: boolean;
  isSelected: boolean;
  label: string;
  onClick: () => void;
  statusText: string;
  statusTone?: "accent" | "warning" | undefined;
}) {
  const accentClass = statusTone === "warning" ? "text-amber-300" : "text-signal";

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
        <span className="block truncate text-sm font-semibold text-white">{label}</span>
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">
            {isPrimaryItem ? title.active : title.context}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-200/85">
            {label}
          </p>
        </div>
        <span className="shrink-0 rounded bg-black/20 px-2 py-1 text-xs font-semibold text-amber-100">
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
  if (!Number.isFinite(readyAtMs)) return "Unknown";
  return new Date(readyAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
