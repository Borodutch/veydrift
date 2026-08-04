import type { JSX } from "preact";

interface PlanetImageSkeletonProps {
  className?: string;
}

export function PlanetImageSkeleton({ className = "" }: PlanetImageSkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(128,241,255,0.1),rgba(8,13,24,0.96)_58%)] ${className}`}
    >
      <div className="skeleton absolute inset-0 animate-pulse rounded-none opacity-70" />
      <div className="absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/15 bg-[radial-gradient(circle_at_36%_28%,rgba(226,252,255,0.1),rgba(128,241,255,0.035)_48%,rgba(5,7,13,0.32)_72%)] shadow-[0_0_32px_rgba(128,241,255,0.08)]" />
      <div className="absolute left-1/2 top-1/2 h-[26%] w-[70%] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-[50%] border border-cyan-200/10" />
      <span className="absolute left-[70%] top-[29%] h-1.5 w-1.5 rounded-full bg-amber-200/30 shadow-[0_0_10px_rgba(246,179,92,0.45)]" />
    </div>
  );
}
