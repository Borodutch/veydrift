import type { JSX } from "preact";

interface PlanetImageSkeletonProps {
  className?: string;
}

export function PlanetImageSkeleton({ className = "" }: PlanetImageSkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(8,13,24,0.95))] ${className}`}
    >
      <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,rgba(255,255,255,0.04),rgba(125,211,252,0.12),rgba(255,255,255,0.04))]" />
      <div className="absolute left-1/2 top-1/2 h-2/5 w-2/5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/15 bg-cyan-200/[0.04]" />
      <div className="absolute inset-x-[18%] top-1/2 h-px bg-cyan-200/10" />
    </div>
  );
}
