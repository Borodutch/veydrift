import type { ComponentChildren } from "preact";
import { formatDurationUntil } from "../durationFormat";
import { queueProgressPercent } from "../playableMvp";
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
  label: string;
  now?: number | undefined;
  quantity?: number | undefined;
  readyAt: QueueTimestamp;
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
  label,
  now = Date.now(),
  quantity,
  readyAt,
  startedAt,
  title,
  tone = "amber",
}: QueueProgressPanelProps) {
  const classes = toneClasses[tone];
  const readyAtMs = queueTimestampToMs(readyAt);
  const startedAtMs = queueTimestampToMs(startedAt);
  const percent = queueProgressPercent(
    readyAtMs === undefined ? undefined : {
      readyAt: readyAtMs,
      startedAt: startedAtMs ?? readyAtMs,
    },
    now,
  );
  const remaining = readyAtMs === undefined ? "Unknown" : formatDurationUntil(readyAtMs, now);

  return (
    <section className={`grid gap-3 rounded-md border ${classes.border} ${classes.background} p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center`}>
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
            {percent}%
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
          <div
            className={`h-full rounded-full ${classes.fill} transition-[width]`}
            style={{ width: `${percent}%` }}
          />
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
      </div>

      {action ? (
        <button
          className={`h-9 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 ${classes.button}`}
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
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function formatQueueReadyAt(readyAtMs: number | undefined): string {
  if (readyAtMs === undefined) return "Unknown";
  return new Date(readyAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.floor(quantity));
}
