import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Factory,
  FlaskConical,
  History,
  Moon,
  Orbit,
  ShieldAlert,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-preact";

import {
  fetchPlayerActivity,
  type PlayerActivityCategory,
  type PlayerActivityItem,
  type PlayerActivityResponse,
} from "../walletFlow";
import {
  browserPlayerActivityStorage,
  readPlayerActivityLastSeen,
  writePlayerActivityLastSeen,
} from "../playerActivityStorage";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";

const HISTORY_PAGE_SIZE = 25;
const AWAY_PAGE_SIZE = 100;
const LAST_SEEN_HEARTBEAT_MS = 60_000;

type ActivityDialogState =
  | { mode: "away"; response: PlayerActivityResponse | undefined; since: number }
  | { mode: "history"; response: PlayerActivityResponse | undefined };

export function PlayerActivityCenter({
  apiUrl,
  chainId,
  explorerUrl,
  historyOpen,
  onHistoryClose,
  wallet,
}: {
  apiUrl?: string | undefined;
  chainId: number;
  explorerUrl: string;
  historyOpen: boolean;
  onHistoryClose: () => void;
  wallet?: string | undefined;
}) {
  const [awayState, setAwayState] = useState<Extract<ActivityDialogState, { mode: "away" }> | null>(null);
  const [historyResponse, setHistoryResponse] = useState<PlayerActivityResponse | undefined>();
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [awayLoading, setAwayLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [lastSeenReady, setLastSeenReady] = useState(false);
  const identityKey = apiUrl && wallet ? `${apiUrl}:${chainId}:${wallet.toLowerCase()}` : "";

  useEffect(() => {
    setAwayState(null);
    setHistoryResponse(undefined);
    setHistoryPage(1);
    setError(undefined);
    setLastSeenReady(false);
    setAwayLoading(false);
    if (!apiUrl || !wallet) return;

    const storage = browserPlayerActivityStorage();
    const previous = readPlayerActivityLastSeen(storage, chainId, wallet);
    const now = Math.floor(Date.now() / 1_000);
    if (previous === null) {
      writePlayerActivityLastSeen(storage, chainId, wallet, now);
      setLastSeenReady(true);
      return;
    }

    let cancelled = false;
    setAwayState({ mode: "away", response: undefined, since: previous });
    setAwayLoading(true);
    void fetchPlayerActivity(apiUrl, wallet, {
      page: 1,
      pageSize: AWAY_PAGE_SIZE,
      since: previous,
      includeProjected: true,
    }).then((response) => {
      if (cancelled) return;
      writePlayerActivityLastSeen(storage, chainId, wallet, Number(response.through));
      setLastSeenReady(true);
      if (response.items.length > 0) {
        setAwayState((current) => current ? { mode: "away", response, since: previous } : null);
      } else {
        setAwayState(null);
      }
    }).catch(() => {
      // Keep the old timestamp so a transient API failure is retried next load.
      if (!cancelled) setAwayState(null);
    }).finally(() => {
      if (!cancelled) setAwayLoading(false);
    });
    return () => { cancelled = true; };
  }, [identityKey]);

  useEffect(() => {
    if (!lastSeenReady || !wallet) return;
    const storage = browserPlayerActivityStorage();
    const markPresent = () => writePlayerActivityLastSeen(storage, chainId, wallet, Math.floor(Date.now() / 1_000));
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") markPresent();
    };
    const timer = window.setInterval(markPresent, LAST_SEEN_HEARTBEAT_MS);
    window.addEventListener("pagehide", markPresent);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", markPresent);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [chainId, lastSeenReady, wallet]);

  useEffect(() => {
    if (!historyOpen || !apiUrl || !wallet) return;
    let cancelled = false;
    setAwayState(null);
    setLoading(true);
    setError(undefined);
    void fetchPlayerActivity(apiUrl, wallet, { page: historyPage, pageSize: HISTORY_PAGE_SIZE })
      .then((response) => {
        if (!cancelled) setHistoryResponse(response);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Activity history could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiUrl, historyOpen, historyPage, wallet]);

  if (!apiUrl || !wallet) return null;
  const state: ActivityDialogState | null = historyOpen
    ? { mode: "history", response: historyResponse }
    : awayState;
  if (!state) return null;

  const close = state.mode === "history" ? onHistoryClose : () => setAwayState(null);
  return (
    <PlayerActivityDialog
      error={state.mode === "history" ? error : undefined}
      explorerUrl={explorerUrl}
      loading={state.mode === "history" ? loading : awayLoading}
      mode={state.mode}
      onClose={close}
      onPageChange={state.mode === "history" ? setHistoryPage : undefined}
      response={state.response}
      since={state.mode === "away" ? state.since : undefined}
    />
  );
}

export function PlayerActivityDialog({
  error,
  explorerUrl,
  loading,
  mode,
  onClose,
  onPageChange,
  response,
  since,
}: {
  error?: string | undefined;
  explorerUrl: string;
  loading: boolean;
  mode: "away" | "history";
  onClose: () => void;
  onPageChange?: ((page: number) => void) | undefined;
  response?: PlayerActivityResponse | undefined;
  since?: number | undefined;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const counts = useMemo(
    () => response ? activityCategoryCounts(response.items, response.summary) : [],
    [response]
  );
  const title = mode === "away" ? "While you were away" : "Commander activity";
  const subtitle = mode === "away" && since
    ? `Updates since ${formatActivityTime(String(since))}`
    : "Your indexed Veydrift actions and transactions";

  return (
    <div
      aria-labelledby="player-activity-dialog-title"
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-[100] grid place-items-end bg-black/70 p-2 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className="modal-panel-enter grid max-h-[calc(100dvh-1rem)] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-white/10 bg-[#08101d] shadow-2xl shadow-black/50 sm:max-h-[min(48rem,calc(100dvh-2rem))]">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              {mode === "away" ? <Sparkles aria-hidden="true" size={17} /> : <History aria-hidden="true" size={17} />}
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-semibold leading-4 text-white sm:text-base sm:leading-5" id="player-activity-dialog-title">{title}</h2>
              <p className="-mt-0.5 text-[11px] leading-4 text-slate-400 sm:text-xs">{subtitle}</p>
            </div>
          </div>
          <button
            aria-label="Close activity"
            className="inline-grid h-9 w-9 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {mode === "away" && counts.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {counts.map(({ category, count }) => (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-slate-300" key={category}>
                  {activityCategoryLabel(category)} {count}
                </span>
              ))}
            </div>
          ) : null}

          {loading ? (
            <PlayerActivitySkeleton mode={mode} />
          ) : error ? (
            <div className="rounded border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">{error}</div>
          ) : response?.items.length ? (
            <div className="grid gap-2">
              {response.items.map((item) => (
                <ActivityRow explorerUrl={explorerUrl} item={item} key={item.id} />
              ))}
              {mode === "away" && response.pagination.totalEntries > response.items.length ? (
                <p className="px-1 pt-1 text-xs text-slate-400">
                  And {response.pagination.totalEntries - response.items.length} more. Open Commander activity for the complete history.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center text-center">
              <div>
                <Clock3 className="mx-auto text-slate-600" size={24} />
                <p className="mt-2 text-sm font-medium text-slate-300">No activity yet</p>
                <p className="mt-1 text-xs text-slate-500">Indexed transactions will appear here.</p>
              </div>
            </div>
          )}
        </div>

        {mode === "history" && response ? (
          <footer className="flex min-h-12 items-center justify-between gap-3 border-t border-white/10 px-3 py-2 sm:px-4">
              <p className="text-[11px] text-slate-500">
                {response.pagination.totalEntries.toLocaleString()} actions · Page {response.pagination.page} of {response.pagination.totalPages}
              </p>
              <div className="flex gap-1.5">
                <PageButton
                  disabled={!response.pagination.hasPreviousPage || loading}
                  label="Previous activity page"
                  onClick={() => onPageChange?.(response.pagination.page - 1)}
                >
                  <ChevronLeft aria-hidden="true" size={15} />
                </PageButton>
                <PageButton
                  disabled={!response.pagination.hasNextPage || loading}
                  label="Next activity page"
                  onClick={() => onPageChange?.(response.pagination.page + 1)}
                >
                  <ChevronRight aria-hidden="true" size={15} />
                </PageButton>
              </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

export function PlayerActivitySkeleton({ mode }: { mode: "away" | "history" }) {
  return (
    <SkeletonRegion className="grid min-h-48 gap-2" label={mode === "away" ? "Loading away activity" : "Loading activity"}>
      {mode === "away" ? (
        <div className="mb-1 flex gap-1.5">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ) : null}
      {skeletonList(3, (index) => (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded border border-white/10 bg-white/[0.025] p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-3" key={index}>
          <Skeleton className="h-8 w-8 rounded" />
          <div className="min-w-0">
            <Skeleton className={`h-3.5 ${index === 1 ? "w-2/5" : "w-3/5"}`} />
            <Skeleton className={`mt-2 h-2.5 ${index === 2 ? "w-1/2" : "w-4/5"}`} />
          </div>
          <Skeleton className="col-span-2 ml-[2.625rem] h-3 w-24 sm:col-span-1 sm:ml-0" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function ActivityRow({ explorerUrl, item }: { explorerUrl: string; item: PlayerActivityItem }) {
  const Icon = activityCategoryIcon(item.category);
  const transactionDelayed = item.transactionHash && Math.abs(Number(item.transactionAt) - Number(item.occurredAt)) > 60;
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded border border-white/10 bg-white/[0.025] p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-3">
      <span className={`grid h-8 w-8 place-items-center rounded border ${activityIconTone(item)}`}>
        <Icon aria-hidden="true" size={15} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-xs font-semibold text-slate-100 sm:text-sm">{item.title}</h3>
          {item.direction === "incoming" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/20 bg-rose-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-rose-200">
              <ArrowDownLeft size={10} /> Incoming
            </span>
          ) : item.direction === "outgoing" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-cyan-200">
              <ArrowUpRight size={10} /> Outgoing
            </span>
          ) : null}
        </div>
        {item.detail ? <p className="mt-1 truncate text-[11px] text-slate-400 sm:text-xs">{item.detail}</p> : null}
      </div>
      <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 pl-[2.625rem] sm:col-span-1 sm:block sm:pl-0 sm:text-right">
        <div>
          <time className="block whitespace-nowrap text-[11px] font-medium text-slate-300" dateTime={activityIsoTime(item.occurredAt)}>
            {formatActivityTime(item.occurredAt)}
          </time>
          {transactionDelayed ? <span className="block whitespace-nowrap text-[9px] text-slate-500">Recorded {formatActivityTime(item.transactionAt)}</span> : null}
        </div>
        {item.transactionHash ? (
          <a
            className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-cyan-300 transition hover:text-cyan-100"
            href={`${explorerUrl.replace(/\/+$/, "")}/tx/${item.transactionHash}`}
            rel="noreferrer"
            target="_blank"
          >
            View tx <ExternalLink aria-hidden="true" size={10} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function PageButton({ children, disabled, label, onClick }: { children: ComponentChildren; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="inline-grid h-8 w-9 place-items-center rounded border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function activityCategoryCounts(
  items: readonly PlayerActivityItem[],
  summary: Partial<Record<PlayerActivityCategory, number>>
) {
  const counts = new Map<PlayerActivityCategory, number>(
    Object.entries(summary).filter((entry): entry is [PlayerActivityCategory, number] => typeof entry[1] === "number")
  );
  if (counts.size === 0) {
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return [...counts].map(([category, count]) => ({ category, count })).sort((left, right) => right.count - left.count);
}

function activityCategoryLabel(category: PlayerActivityCategory): string {
  if (category === "infrastructure") return "Infrastructure";
  if (category === "production") return "Built";
  return category.replace(/^./, (character) => character.toUpperCase());
}

function activityCategoryIcon(category: PlayerActivityCategory): LucideIcon {
  if (category === "combat") return ShieldAlert;
  if (category === "infrastructure") return Factory;
  if (category === "research") return FlaskConical;
  if (category === "moon") return Moon;
  if (category === "mission") return Orbit;
  if (category === "production") return Sparkles;
  return History;
}

function activityIconTone(item: PlayerActivityItem): string {
  if (item.direction === "incoming") return "border-rose-300/20 bg-rose-300/10 text-rose-200";
  if (item.reconciliation === "projected") return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  return "border-cyan-300/20 bg-cyan-300/10 text-cyan-200";
}

function activityIsoTime(timestamp: string): string {
  const milliseconds = Number(timestamp) * 1_000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "";
}

function formatActivityTime(timestamp: string): string {
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isFinite(milliseconds)) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(milliseconds));
}
