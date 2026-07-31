export function AnimatedProgressBar({
  className = "h-1.5 w-full bg-white/10",
  fillClassName = "bg-signal",
  indeterminate = false,
  label,
  value = 0,
}: {
  className?: string | undefined;
  fillClassName?: string | undefined;
  indeterminate?: boolean | undefined;
  label: string;
  value?: number | undefined;
}) {
  const progress = Math.max(0, Math.min(1, value));
  const percent = Math.round(progress * 100);

  return (
    <span
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={indeterminate ? undefined : percent}
      className={`block overflow-hidden rounded-full ${className}`}
      role="progressbar"
    >
      {indeterminate ? (
        <span className={`block h-full w-2/3 rounded-full ${fillClassName} animate-pulse`} />
      ) : (
        <span
          className={`queue-fill block h-full rounded-full ${fillClassName} transition-[width]`}
          style={{ width: `${percent}%` }}
        />
      )}
    </span>
  );
}
