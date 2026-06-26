import type { ComponentChildren } from "preact";
import { moonAsset } from "../gameAssets";
import { OptimizedImage } from "./OptimizedImage";

export function MoonImage({
  alt = "",
  className = "",
  loading = "lazy",
}: {
  alt?: string | undefined;
  className?: string | undefined;
  loading?: "eager" | "lazy" | undefined;
}) {
  return (
    <OptimizedImage
      alt={alt}
      className={className}
      loading={loading}
      sizes="icon"
      src={moonAsset.src}
    />
  );
}

export function PlanetMoonIndicator({
  className = "",
  compact = false,
  label = "Moon present",
}: {
  className?: string | undefined;
  compact?: boolean | undefined;
  label?: string | undefined;
}) {
  const sizeClass = compact ? "h-4 w-4" : "h-5 w-5";

  return (
    <span
      aria-label={label}
      className={`pointer-events-none absolute right-1 top-1 inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-full border border-cyan-100/70 bg-slate-950/85 shadow-[0_0_10px_rgba(103,232,249,0.35)] ${className}`}
      data-planet-moon-indicator="true"
      title={label}
    >
      <MoonImage className="h-full w-full object-cover" />
    </span>
  );
}

export function PlanetMoonSubsection({
  action,
  detail = "Child moon body",
  label = "Moon",
}: {
  action?: ComponentChildren;
  detail?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <div
      className="mt-1.5 grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-cyan-200/15 bg-cyan-200/[0.06] px-2 py-1.5 text-left"
      data-planet-moon-subsection="true"
    >
      <span className="h-7 w-7 overflow-hidden rounded-full border border-cyan-100/30 bg-black/40">
        <MoonImage className="h-full w-full object-cover" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold text-cyan-100">{label}</span>
        <span className="block truncate text-[10px] text-slate-400">{detail}</span>
      </span>
      {action}
    </div>
  );
}
