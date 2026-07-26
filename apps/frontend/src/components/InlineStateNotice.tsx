import type { ComponentChildren } from "preact";

export type InlineStateNoticeTone = "error" | "info" | "neutral" | "success";

const toneClassNames: Record<InlineStateNoticeTone, string> = {
  error: "border-rose-300/45 text-slate-300 [&_strong]:text-rose-100",
  info: "border-cyan-300/35 text-slate-400 [&_strong]:text-slate-200",
  neutral: "border-slate-500/35 text-slate-400 [&_strong]:text-slate-200",
  success: "border-emerald-300/35 text-slate-400 [&_strong]:text-emerald-100",
};

export function InlineStateNotice({
  blocking = false,
  children,
  className = "",
  title,
  tone = "neutral",
}: {
  blocking?: boolean | undefined;
  children?: ComponentChildren;
  className?: string | undefined;
  title?: string | undefined;
  tone?: InlineStateNoticeTone | undefined;
}) {
  return (
    <div
      aria-live={blocking ? "assertive" : "polite"}
      className={`inline-state-notice border-l-2 py-0.5 pl-3 text-sm leading-5 ${toneClassNames[tone]} ${className}`.trim()}
      role={blocking ? "alert" : "status"}
    >
      {title ? <strong className="block font-semibold">{title}</strong> : null}
      {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
    </div>
  );
}
