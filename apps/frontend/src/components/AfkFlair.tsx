export function AfkFlair({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded border border-amber-300/40 bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-normal text-amber-100 ${className}`}
      title="AFK commander: attack protection inactivity rules apply"
    >
      AFK
    </span>
  );
}
