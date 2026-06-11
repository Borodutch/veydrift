import type { ComponentChildren, JSX } from "preact";

interface SkeletonProps {
  className?: string | undefined;
}

/**
 * Base shimmer block. Stands in for a single piece of still-loading content
 * (a line of text, an avatar, a thumbnail). Decorative only: group skeletons
 * inside a `SkeletonRegion` so assistive tech announces the loading state.
 *
 * Carries the `skeleton` class plus `animate-pulse` so the shimmer is visible
 * and the loading state is trivially detectable in QA/tests.
 */
export function Skeleton({ className = "" }: SkeletonProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block animate-pulse rounded bg-white/10 ${className}`}
    />
  );
}

interface SkeletonRegionProps {
  label: string;
  className?: string | undefined;
  children: ComponentChildren;
}

/**
 * Accessible wrapper for a skeleton loading layout. Preserves the
 * `role="status"` live-region semantics the old text loaders provided, so
 * screen readers still hear that content is loading while sighted users see
 * skeleton placeholders instead of fabricated/placeholder copy.
 */
export function SkeletonRegion({ label, className = "", children }: SkeletonRegionProps): JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" className={`skeleton-region ${className}`} role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Render `count` skeletons via `factory`, keyed by index. */
export function skeletonList(count: number, factory: (index: number) => JSX.Element): JSX.Element[] {
  return Array.from({ length: count }, (_unused, index) => factory(index));
}
