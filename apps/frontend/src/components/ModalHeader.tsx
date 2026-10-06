import type { ComponentChildren } from "preact";
import { X, type LucideIcon } from "lucide-preact";

/** Shared dialog title row: optional cyan icon, title, subtitle and the one close button style. */
export function ModalHeader({
  closeDisabled = false,
  closeLabel,
  icon: Icon,
  onClose,
  subtitle,
  title,
  titleId,
}: {
  closeDisabled?: boolean;
  closeLabel: string;
  icon?: LucideIcon | undefined;
  onClose: () => void;
  subtitle?: ComponentChildren;
  title: ComponentChildren;
  titleId?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {Icon ? <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-300" size={18} strokeWidth={2} /> : null}
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-base font-semibold leading-6 text-white" id={titleId}>{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
      </div>
      <button
        aria-label={closeLabel}
        className="-mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
        disabled={closeDisabled}
        onClick={onClose}
        title="Close"
        type="button"
      >
        <X aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
