import { Moon } from "lucide-preact";

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
  const iconSize = compact ? 10 : 12;

  return (
    <span
      aria-label={label}
      className={`pointer-events-none absolute right-1 top-1 inline-flex ${sizeClass} items-center justify-center rounded-full border border-cyan-100/70 bg-slate-950/85 text-cyan-100 shadow-[0_0_10px_rgba(103,232,249,0.35)] ${className}`}
      data-planet-moon-indicator="true"
      title={label}
    >
      <Moon aria-hidden="true" size={iconSize} strokeWidth={2.4} />
    </span>
  );
}
