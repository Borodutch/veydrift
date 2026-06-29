import type { ComponentChildren } from "preact";
import { moonImageForType } from "../gameAssets";
import type { PlanetType } from "../types";
import type { SizePreset } from "../utils/imageSizes";
import { OptimizedImage } from "./OptimizedImage";

export function MoonImage({
  alt = "",
  className = "",
  height,
  loading = "lazy",
  planetType,
  sizes = "icon",
  width,
}: {
  alt?: string | undefined;
  className?: string | undefined;
  height?: number | undefined;
  loading?: "eager" | "lazy" | undefined;
  planetType?: PlanetType | null | undefined;
  sizes?: SizePreset | string | undefined;
  width?: number | undefined;
}) {
  return (
    <OptimizedImage
      alt={alt}
      className={className}
      {...(height === undefined ? {} : { height })}
      loading={loading}
      sizes={sizes}
      src={moonImageForType(planetType)}
      {...(width === undefined ? {} : { width })}
    />
  );
}

export function PlanetMoonIndicator({
  className = "",
  compact = false,
  label = "Moon present",
  planetType,
}: {
  className?: string | undefined;
  compact?: boolean | undefined;
  label?: string | undefined;
  planetType?: PlanetType | null | undefined;
}) {
  const sizeClass = compact ? "h-4 w-4" : "h-5 w-5";

  return (
    <span
      aria-label={label}
      className={`pointer-events-none absolute right-1 top-1 inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-full border border-cyan-100/70 bg-slate-950/85 shadow-[0_0_10px_rgba(103,232,249,0.35)] ${className}`}
      data-planet-moon-indicator="true"
      title={label}
    >
      <MoonImage className="h-full w-full object-cover" planetType={planetType} />
    </span>
  );
}

export function PlanetMoonSubsection({
  action,
  className = "",
  detail,
  label = "Moon",
  onClick,
  planetType,
  title,
}: {
  action?: ComponentChildren;
  className?: string | undefined;
  detail?: string | undefined;
  label?: string | undefined;
  onClick?: (() => void) | undefined;
  planetType?: PlanetType | null | undefined;
  title?: string | undefined;
}) {
  const content = (
    <>
      <span className="h-7 w-7 overflow-hidden rounded-full border border-cyan-100/30 bg-black/40">
        <MoonImage className="h-full w-full object-cover" planetType={planetType} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold text-cyan-100">{label}</span>
        {detail ? <span className="block truncate text-[10px] text-slate-400">{detail}</span> : null}
      </span>
      {action}
    </>
  );
  const baseClass = `mt-1.5 grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-cyan-200/15 bg-cyan-200/[0.06] px-2 py-1.5 text-left ${className}`;
  if (onClick) {
    return (
      <button
        className={`${baseClass} w-full transition hover:border-cyan-200/35 hover:bg-cyan-200/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/30`}
        data-planet-moon-subsection="true"
        onClick={onClick}
        title={title ?? `Open ${label}`}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={baseClass}
      data-planet-moon-subsection="true"
      title={title}
    >
      {content}
    </div>
  );
}
