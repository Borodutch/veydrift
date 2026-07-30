import type { ComponentChildren } from "preact";
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
} as const;

export function QueueProgressPanel({
  action,
  asset,
  children,
  completedQuantity,
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
  const hasCanonicalTimeline = readyAtMs !== undefined && startedAtMs !== undefined && startedAtMs < readyAtMs;
  const shouldIndeterminate = indeterminate ?? (!hasCanonicalTimeline && progress === undefined);
  const progressBar = queueProgressBarState({
    indeterminate: shouldIndeterminate,
    progress,
    remaining: readyAtMs !== undefined && readyAtMs <= now ? "Ready" : "",
  });
  const progressFill = queueProgressFillState({
    indeterminate: shouldIndeterminate,
    now,
    progress,
    readyAt: readyAtMs,
    remaining: readyAtMs !== undefined && readyAtMs <= now ? "Ready" : "",
    startedAt: hasCanonicalTimeline ? startedAtMs : undefined,
  });
  const percent = Math.round(progressFill.progress * 100);
  const totalQuantity = completedQuantity === undefined
    ? undefined
    : completedQuantity + (remainingQuantity ?? quantity ?? 0);
  const itemTitle = `${label}${quantity === undefined ? "" : ` ×${formatQuantity(quantity)}`}`;

  return (
    <section
      aria-label={`${title}: ${label}`}
      className={`grid gap-1 rounded border border-cyan-300/20 px-2.5 py-1.5 ${classes.background} ${!progressBar.indeterminate && percent >= 100 ? "queue-ready-pulse" : ""}`}
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
            {quantity === undefined ? null : (
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
          <span
            aria-label={`${label} queue progress`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progressBar.indeterminate ? undefined : percent}
            className="h-1 w-14 overflow-hidden rounded-full bg-white/10 sm:w-20"
            role="progressbar"
          >
            {progressBar.indeterminate ? (
              <span className={`block h-full w-2/3 rounded-full ${classes.fill} animate-pulse`} />
            ) : (
              <span
                className={`queue-fill block h-full rounded-full ${classes.fill} transition-[width]`}
                style={{ width: `${percent}%` }}
              />
            )}
          </span>
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
