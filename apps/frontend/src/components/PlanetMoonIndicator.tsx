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
  href,
  label = "Moon present",
  onClick,
  planetType,
  title,
}: {
  className?: string | undefined;
  compact?: boolean | undefined;
  href?: string | undefined;
  label?: string | undefined;
  onClick?: (() => void) | undefined;
  planetType?: PlanetType | null | undefined;
  title?: string | undefined;
}) {
  const sizeClass = compact ? "h-8 w-8 sm:h-4 sm:w-4" : "h-10 w-10 sm:h-5 sm:w-5";
  const indicatorClass = `absolute right-1 top-1 inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-full border border-cyan-100/70 bg-slate-950/85 shadow-[0_0_10px_rgba(103,232,249,0.35)] ${className}`;

  if (href) {
    return (
      <a
        aria-label={label}
        className={`${indicatorClass} transition hover:scale-105 hover:border-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/50`}
        data-planet-moon-indicator="true"
        href={href}
        title={title ?? label}
      >
        <MoonImage className="h-full w-full object-cover" planetType={planetType} />
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        aria-label={label}
        className={`${indicatorClass} transition hover:scale-105 hover:border-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/50`}
        data-planet-moon-indicator="true"
        onClick={onClick}
        title={title ?? label}
        type="button"
      >
        <MoonImage className="h-full w-full object-cover" planetType={planetType} />
      </button>
    );
  }

  return (
    <span
      aria-label={label}
      className={`pointer-events-none ${indicatorClass}`}
      data-planet-moon-indicator="true"
      title={title ?? label}
    >
      <MoonImage className="h-full w-full object-cover" planetType={planetType} />
    </span>
  );
}

export function PlanetMoonSubsection({
  action,
  className = "",
  compact = false,
  detail,
  label = "Moon",
  onClick,
  planetType,
  title,
}: {
  action?: ComponentChildren;
  className?: string | undefined;
  compact?: boolean | undefined;
  detail?: string | undefined;
  label?: string | undefined;
  onClick?: (() => void) | undefined;
  planetType?: PlanetType | null | undefined;
  title?: string | undefined;
}) {
  const summaryContent = (
    <>
      <span className={`${compact ? "h-6 w-6" : "h-7 w-7"} overflow-hidden rounded-full border border-cyan-100/30 bg-black/40`}>
        <MoonImage className="h-full w-full object-cover" planetType={planetType} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold text-cyan-100">{label}</span>
        {detail ? <span className="block truncate text-[10px] text-slate-400">{detail}</span> : null}
      </span>
    </>
  );
  const content = (
    <>
      {summaryContent}
      {action}
    </>
  );
  const baseClass = `${compact
    ? "mt-0.5 grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-1.5 px-1.5 py-1"
    : "mt-1.5 grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-2 px-2 py-1.5"
  } grid items-center rounded border border-cyan-200/15 bg-cyan-200/[0.06] text-left ${className}`;
  if (onClick && action) {
    return (
      <div
        className={`${baseClass} w-full cursor-pointer transition hover:border-cyan-200/35 hover:bg-cyan-200/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/30`}
        data-planet-moon-subsection="true"
        onClick={(event) => {
          if (event.target !== event.currentTarget && event.target instanceof Element && event.target.closest("button,a")) return;
          onClick();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
        title={title ?? `Open ${label}`}
      >
        {summaryContent}
        {action}
      </div>
    );
  }
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
