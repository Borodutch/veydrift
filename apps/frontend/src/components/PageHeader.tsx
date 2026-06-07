import { RefreshCw } from "lucide-preact";
import type { ComponentChildren } from "preact";

export type RefreshButtonState = {
  disabled: boolean;
  label: "Refresh" | "Refreshing";
};

export function refreshButtonState(loading: boolean): RefreshButtonState {
  return {
    disabled: loading,
    label: loading ? "Refreshing" : "Refresh",
  };
}

export function RefreshButton({
  disabled = false,
  loading,
  onRefresh,
  title = "Refresh state",
}: {
  disabled?: boolean | undefined;
  loading: boolean;
  onRefresh: () => void;
  title?: string | undefined;
}) {
  const state = refreshButtonState(loading);

  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled || state.disabled}
      onClick={onRefresh}
      title={title}
      type="button"
    >
      <RefreshCw aria-hidden="true" size={14} />
      {state.label}
    </button>
  );
}

export function PageHeader({
  actions,
  bordered = true,
  beforeTitle,
  eyebrow,
  subtitle,
  title,
  titleSize = "lg",
}: {
  actions?: ComponentChildren | undefined;
  bordered?: boolean | undefined;
  beforeTitle?: ComponentChildren | undefined;
  eyebrow?: string | undefined;
  subtitle?: ComponentChildren | undefined;
  title: ComponentChildren;
  titleSize?: "lg" | "xl" | undefined;
}) {
  const borderClass = bordered ? "border-b border-white/10 pb-4" : "";
  const titleClass = titleSize === "xl" ? "text-2xl" : "text-lg";

  return (
    <header className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${borderClass}`}>
      <div className="min-w-0">
        {beforeTitle}
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-normal text-cyan-300/80">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-1 " : ""}${titleClass} font-semibold text-white`}>
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl break-words text-sm leading-6 text-slate-400">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
