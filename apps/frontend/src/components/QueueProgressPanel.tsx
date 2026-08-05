import type { ComponentChildren } from "preact";
import type { ConstructionProgress } from "../constructionProgress";
import { queueProgressBarState, queueProgressFillState } from "../overviewData";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { AnimatedProgressBar } from "./AnimatedProgressBar";
import { OptimizedImage } from "./OptimizedImage";

type QueueTimestamp = number | string | null | undefined;
export type QueueProgressTone = "amber" | "cyan" | "rose" | "sky" | "violet";

type QueueProgressPanelAction = {
  disabled?: boolean | undefined;
  label: string;
  onClick: () => void;
};

export interface QueueProgressPanelProps {
  action?: QueueProgressPanelAction | undefined;
  asset?: string | undefined;
  children?: ComponentChildren;
  completedQuantity?: number | undefined;
  currentUnitProgressBps?: number | undefined;
  currentUnitSecondsRemaining?: number | undefined;
  embedded?: boolean | undefined;
  label: string;
  indeterminate?: boolean | undefined;
  itemText?: string | undefined;
  now?: number | undefined;
  progress?: number | undefined;
  progressState?: ConstructionProgress | undefined;
  quantity?: number | undefined;
  readyAt: QueueTimestamp;
  remainingQuantity?: number | undefined;
  startedAt?: QueueTimestamp;
  title: string;
  tone?: QueueProgressTone | undefined;
}

const toneClasses = {
  amber: {
    background: "bg-amber-300/[0.08]",
    fill: "bg-amber-300",
    text: "text-amber-200",
    button: "border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20",
  },
  cyan: {
    background: "bg-cyan-300/[0.08]",
    fill: "bg-cyan-300",
    text: "text-cyan-200",
    button: "border-cyan-300/40 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20",
  },
  rose: {
    background: "bg-rose-300/[0.08]",
    fill: "bg-rose-300",
    text: "text-rose-200",
    button: "border-rose-300/40 bg-rose-300/10 text-rose-200 hover:bg-rose-300/20",
  },
  sky: {
    background: "bg-sky-300/[0.08]",
    fill: "bg-sky-300",
    text: "text-sky-200",
    button: "border-sky-300/40 bg-sky-300/10 text-sky-200 hover:bg-sky-300/20",
  },
  violet: {
    background: "bg-violet-300/[0.08]",
    fill: "bg-violet-300",
    text: "text-violet-200",
    button: "border-violet-300/40 bg-violet-300/10 text-violet-200 hover:bg-violet-300/20",
  },
} as const;

export function QueueProgressPanel({
  action,
  asset,
  children,
  completedQuantity,
  embedded = false,
  indeterminate,
  itemText,
  label,
  now = Date.now(),
  progress,
  progressState,
  quantity,
  readyAt,
  remainingQuantity,
  startedAt,
  title,
  tone = "amber",
}: QueueProgressPanelProps) {
  const classes = toneClasses[tone];
  const readyAtMs = progressState?.readyAtMs ?? queueTimestampToMs(readyAt);
  const startedAtMs = progressState?.startedAtMs ?? queueTimestampToMs(startedAt);
  const hasCanonicalTimeline = readyAtMs !== undefined && startedAtMs !== undefined && startedAtMs < readyAtMs;
  const resolvedProgress = progressState?.progress ?? progress;
  const remaining = progressState?.remaining ?? (readyAtMs !== undefined && readyAtMs <= now ? "Ready" : "");
  const shouldIndeterminate = progressState?.indeterminate ?? indeterminate ?? (!hasCanonicalTimeline && resolvedProgress === undefined);
  const progressBar = queueProgressBarState({
    indeterminate: shouldIndeterminate,
    progress: resolvedProgress,
    remaining,
  });
  const progressFill = progressState
    ? { animated: false, durationMs: 0, elapsedMs: 0, progress: progressState.progress }
    : queueProgressFillState({
      indeterminate: shouldIndeterminate,
      now,
      progress: resolvedProgress,
      readyAt: readyAtMs,
      remaining,
      startedAt: hasCanonicalTimeline ? startedAtMs : undefined,
    });
  const percent = Math.round(progressFill.progress * 100);
  const totalQuantity = completedQuantity === undefined
    ? undefined
    : completedQuantity + (remainingQuantity ?? quantity ?? 0);
  const itemTitle = `${label}${quantity === undefined ? "" : ` ×${formatQuantity(quantity)}`}`;

  if (embedded) {
    return (
      <section
        aria-label={`${title}: ${label}`}
        className={`grid gap-2 ${!progressBar.indeterminate && percent >= 100 ? "queue-ready-pulse" : ""}`}
      >
        <span className="sr-only">{title}</span>

        <span className="flex min-w-0 items-center gap-3">
          {asset ? (
            <OptimizedImage
              alt=""
              className="h-11 w-11 shrink-0 rounded border border-white/10 bg-white/5 object-cover"
              sizes="icon"
              src={asset}
            />
          ) : (
            <span className="h-11 w-11 shrink-0 rounded bg-white/5" />
          )}

          <span className="grid min-w-0 flex-1 gap-2">
            <span className="flex min-w-0 items-start justify-between gap-2">
              <span className="grid gap-0.5 leading-none" title={itemTitle}>
                {itemText ? (
                  <span className="text-[11px] font-medium text-slate-200">
                    {itemText}
                  </span>
                ) : quantity === undefined ? null : (
                  <span className="text-xs font-medium tabular-nums text-slate-200">
                    ×{formatQuantity(quantity)}
                  </span>
                )}
                <span className="text-[10px] tabular-nums text-slate-500">
                  {formatQueueEta(readyAt)}
                </span>
              </span>
              {completedQuantity !== undefined && totalQuantity !== undefined ? (
                <span className={`whitespace-nowrap text-[11px] font-semibold tabular-nums ${classes.text}`}>
                  {formatQuantity(completedQuantity)}/{formatQuantity(totalQuantity)}
                </span>
              ) : progressBar.indeterminate ? (
                <span className={`text-[11px] font-semibold ${classes.text}`}>…</span>
              ) : null}
            </span>

            <AnimatedProgressBar
              className="h-1.5 w-full bg-white/10"
              fillClassName={classes.fill}
              indeterminate={progressBar.indeterminate}
              label={`${label} queue progress`}
              value={progressFill.progress}
            />
          </span>
        </span>

        {children ? <span className="flex flex-wrap items-center gap-2">{children}</span> : null}

        {action ? (
          <button
            className={`h-8 w-fit rounded border px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 ${classes.button}`}
            disabled={action.disabled}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label={`${title}: ${label}`}
      className={`grid gap-1 rounded border border-cyan-300/20 px-2.5 py-1.5 ${classes.background} ${
        !progressBar.indeterminate && percent >= 100 ? "queue-ready-pulse" : ""
      }`}
    >
      <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${classes.text}`}>
        {title}
      </span>

      <span className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5" title={itemTitle}>
          {asset ? (
            <OptimizedImage
              alt=""
              className="h-7 w-7 shrink-0 rounded object-contain"
              sizes="icon"
              src={asset}
            />
          ) : (
            <span className="h-7 w-7 shrink-0 rounded bg-white/5" />
          )}
          <span className="grid gap-0.5 leading-none">
            {itemText ? (
              <span className="text-[11px] font-medium text-slate-200">
                {itemText}
              </span>
            ) : quantity === undefined ? null : (
              <span className="text-[11px] font-medium tabular-nums text-slate-200">
                ×{formatQuantity(quantity)}
              </span>
            )}
            <span className="text-[9px] tabular-nums text-slate-500">
              {formatQueueEta(readyAt)}
            </span>
          </span>
        </span>

        <span className="inline-flex items-center gap-1.5">
          <AnimatedProgressBar
            className="h-1 w-14 overflow-hidden rounded-full bg-white/10 sm:w-20"
            fillClassName={classes.fill}
            indeterminate={progressBar.indeterminate}
            label={`${label} queue progress`}
            value={progressFill.progress}
          />
          <span className={`whitespace-nowrap text-[10px] font-semibold tabular-nums ${classes.text}`}>
            {completedQuantity !== undefined && totalQuantity !== undefined
              ? `${formatQuantity(completedQuantity)}/${formatQuantity(totalQuantity)} · `
              : ""}
            {progressBar.indeterminate ? "…" : `${percent}%`}
          </span>
        </span>

        {children ? (
          <span className="flex flex-wrap items-center gap-2">{children}</span>
        ) : null}

        {action ? (
          <button
            className={`ml-auto h-8 rounded border px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 ${classes.button}`}
            disabled={action.disabled}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ) : null}
      </span>
    </section>
  );
}

export function queueTimestampToMs(value: QueueTimestamp): number | undefined {
  return timestampToMs(value);
}

export function formatQueueEta(value: QueueTimestamp): string {
  return formatUserTimestamp(value, {
    fallback: "ETA —",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.floor(quantity));
}
