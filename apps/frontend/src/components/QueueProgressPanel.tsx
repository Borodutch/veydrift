import type { ComponentChildren } from "preact";
import { formatDuration, formatDurationUntil } from "../durationFormat";
import { queueProgressBarState, queueProgressFillState } from "../overviewData";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { OptimizedImage } from "./OptimizedImage";

type QueueTimestamp = number | string | null | undefined;
type QueueProgressTone = "amber" | "cyan" | "rose" | "sky";

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
  label: string;
  indeterminate?: boolean | undefined;
  now?: number | undefined;
  progress?: number | undefined;
  quantity?: number | undefined;
  readyAt: QueueTimestamp;
  remainingQuantity?: number | undefined;
  startedAt?: QueueTimestamp;
  title: string;
  tone?: QueueProgressTone | undefined;
}

const toneClasses = {
  amber: {
    border: "border-amber-300/20",
    background: "bg-amber-300/10",
    eyebrow: "text-amber-200",
    muted: "text-amber-200/75",
    fill: "bg-amber-300",
    button: "border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20",
  },
  cyan: {
    border: "border-cyan-300/20",
    background: "bg-cyan-300/10",
    eyebrow: "text-cyan-200",
    muted: "text-cyan-200/75",
    fill: "bg-cyan-300",
    button: "border-cyan-300/40 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20",
  },
  rose: {
    border: "border-rose-300/20",
    background: "bg-rose-300/10",
    eyebrow: "text-rose-200",
    muted: "text-rose-200/75",
    fill: "bg-rose-300",
    button: "border-rose-300/40 bg-rose-300/10 text-rose-200 hover:bg-rose-300/20",
  },
  sky: {
    border: "border-sky-300/20",
    background: "bg-sky-300/10",
    eyebrow: "text-sky-200",
    muted: "text-sky-200/75",
    fill: "bg-sky-300",
    button: "border-sky-300/40 bg-sky-300/10 text-sky-200 hover:bg-sky-300/20",
  },
} as const;

export function QueueProgressPanel({
  action,
  asset,
  children,
  completedQuantity,
  currentUnitProgressBps,
  currentUnitSecondsRemaining,
  indeterminate,
  label,
  now = Date.now(),
  progress,
  quantity,
  readyAt,
  remainingQuantity,
  startedAt,
  title,
  tone = "amber",
}: QueueProgressPanelProps) {
  const classes = toneClasses[tone];
  const readyAtMs = queueTimestampToMs(readyAt);
  const startedAtMs = queueTimestampToMs(startedAt);
  const remaining = readyAtMs === undefined ? "Unknown" : formatDurationUntil(readyAtMs, now);
  const hasCanonicalTimeline = readyAtMs !== undefined && startedAtMs !== undefined && startedAtMs < readyAtMs;
  const shouldIndeterminate = indeterminate ?? (!hasCanonicalTimeline && progress === undefined);
  const progressBar = queueProgressBarState({
    indeterminate: shouldIndeterminate,
    progress,
    remaining,
  });
  const progressFill = queueProgressFillState({
    indeterminate: shouldIndeterminate,
    now,
    progress,
    readyAt: readyAtMs,
    remaining,
    startedAt: hasCanonicalTimeline ? startedAtMs : undefined,
  });
  const percent = Math.round(progressFill.progress * 100);
  const totalQuantity = completedQuantity === undefined
    ? undefined
    : completedQuantity + (remainingQuantity ?? quantity ?? 0);

  return (
    <section className={`grid gap-3 rounded-md border ${classes.border} ${classes.background} p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center ${!progressBar.indeterminate && percent >= 100 ? "queue-ready-pulse" : ""}`}>
      {asset ? (
        <div className="h-14 w-14 overflow-hidden rounded-md border border-white/10 bg-black/20 p-1">
          <OptimizedImage
            alt=""
            className="h-full w-full object-contain"
            sizes="icon"
            src={asset}
          />
        </div>
      ) : (
        <div className="hidden h-14 w-14 rounded-md border border-white/10 bg-black/20 sm:block" />
      )}

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${classes.eyebrow}`}>{title}</p>
            <p className="mt-1 break-words text-sm font-semibold text-white">
              {label}{quantity === undefined ? "" : ` x${formatQuantity(quantity)}`}
            </p>
            {children ? (
              <div className={`mt-1 text-xs leading-5 ${classes.muted}`}>{children}</div>
            ) : null}
          </div>
          <span className="shrink-0 rounded bg-black/20 px-2 py-1 text-xs font-semibold text-white">
            {progressBar.indeterminate ? "Pending" : `${percent}%`}
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
          {progressBar.indeterminate ? (
            <div className={`h-full w-2/3 rounded-full ${classes.fill} animate-pulse`} />
          ) : (
            <div
              className={`queue-fill h-full rounded-full ${classes.fill} transition-[width]`}
              style={{ width: `${percent}%` }}
            />
          )}
        </div>

        <div className="mt-3 grid gap-2 text-xs text-white/90 sm:grid-cols-2">
          <p className="min-w-0">
            <span className={`block uppercase tracking-normal ${classes.muted}`}>Time remaining</span>
            <span className="mt-1 block font-semibold">{remaining}</span>
          </p>
          <p className="min-w-0">
            <span className={`block uppercase tracking-normal ${classes.muted}`}>Ready at</span>
            <span className="mt-1 block font-semibold">{formatQueueReadyAt(readyAtMs)}</span>
          </p>
        </div>
        {completedQuantity !== undefined && totalQuantity !== undefined ? (
          <div className="mt-2 grid gap-2 border-t border-white/10 pt-2 text-xs text-white/90 sm:grid-cols-2">
            <p className="min-w-0">
              <span className={`block uppercase tracking-normal ${classes.muted}`}>Units complete</span>
              <span className="mt-1 block font-semibold">
                {formatQuantity(completedQuantity)} / {formatQuantity(totalQuantity)}
              </span>
            </p>
            <p className="min-w-0">
              <span className={`block uppercase tracking-normal ${classes.muted}`}>Current unit</span>
              <span className="mt-1 block font-semibold">
                {currentUnitProgressBps === undefined
                  ? "Timing unavailable"
                  : `${Math.round(currentUnitProgressBps / 100)}% · ${formatCurrentUnitRemaining(currentUnitSecondsRemaining)}`}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {action ? (
        <button
          className={`h-11 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:h-9 ${classes.button}`}
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

export function queueTimestampToMs(value: QueueTimestamp): number | undefined {
  return timestampToMs(value);
}

function formatQueueReadyAt(readyAtMs: number | undefined): string {
  return formatUserTimestamp(readyAtMs);
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.floor(quantity));
}

function formatCurrentUnitRemaining(seconds: number | undefined): string {
  if (seconds === undefined) return "time unavailable";
  return seconds <= 0 ? "ready" : `${formatDuration(seconds)} left`;
}
