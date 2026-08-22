import { formatDurationUntil } from "./durationFormat";
import { queueProgress } from "./playableMvp";
import { timestampToMs } from "./timestampFormat";
import type { QueueStateResponse } from "./walletFlow";

export type ConstructionQueueKind = "building" | "defense" | "moon-building" | "research" | "ship";
export type ConstructionBodyKind = "moon" | "planet";

export type ConstructionProgress = {
  active: boolean;
  bodyKind: ConstructionBodyKind;
  complete: boolean;
  indeterminate: boolean;
  kind: ConstructionQueueKind;
  planetId: string;
  progress: number;
  queue: QueueStateResponse | null;
  readyAtMs?: number | undefined;
  remaining: string;
  startedAtMs?: number | undefined;
};

export type ConstructionProgressState = ReadonlyMap<string, ConstructionProgress>;

export type ConstructionQueueObservation = {
  bodyKind: ConstructionBodyKind;
  kind: ConstructionQueueKind;
  planetId: string;
  queue: QueueStateResponse | null | undefined;
};

export function constructionProgressKey(
  planetId: string,
  bodyKind: ConstructionBodyKind,
  kind: ConstructionQueueKind,
): string {
  return `${bodyKind}:${planetId}:${kind}`;
}

/** Prefer the most specific active read while filling optional timeline metadata
 * from matching broader snapshots. A lagging idle read cannot blank a queue that
 * another confirmed indexed surface still reports as active. */
export function selectActiveConstructionQueue(
  sources: readonly (QueueStateResponse | null | undefined)[],
): QueueStateResponse | null {
  const activeSources = sources.filter((queue): queue is QueueStateResponse => Boolean(queue?.active));
  const primary = activeSources[0];
  if (!primary) return null;

  return activeSources.slice(1).reduce((selected, fallback) => {
    if (!sameConstructionQueue(selected, fallback)) return selected;
    const asOfNow = selected.asOfNow ?? fallback.asOfNow;
    const productionTiming = selected.productionTiming ?? fallback.productionTiming;
    const startedAt = selected.startedAt ?? fallback.startedAt;
    return {
      ...fallback,
      ...selected,
      ...(asOfNow === undefined ? {} : { asOfNow }),
      ...(productionTiming === undefined ? {} : { productionTiming }),
      readyAt: selected.readyAt ?? fallback.readyAt,
      ...(startedAt === undefined ? {} : { startedAt }),
    };
  }, primary);
}

/**
 * Backend responses are the only queue source of truth.  This creates a
 * body-scoped display projection from the current response set; it deliberately
 * does not retain, settle, or repair an older queue in the browser.
 */
export function constructionQueueState(
  observations: readonly ConstructionQueueObservation[],
): Map<string, QueueStateResponse | null> {
  const next = new Map<string, QueueStateResponse | null>();
  for (const observation of observations) {
    const key = constructionProgressKey(observation.planetId, observation.bodyKind, observation.kind);
    next.set(key, observation.queue?.active ? observation.queue : null);
  }
  return next;
}

export function projectConstructionProgress(
  queues: ReadonlyMap<string, QueueStateResponse | null>,
  observations: readonly Omit<ConstructionQueueObservation, "queue">[],
  now: number,
): ConstructionProgressState {
  const progress = new Map<string, ConstructionProgress>();
  for (const observation of observations) {
    const key = constructionProgressKey(observation.planetId, observation.bodyKind, observation.kind);
    progress.set(key, constructionProgressForQueue({
      ...observation,
      now,
      queue: queues.get(key),
    }));
  }
  return progress;
}

export function constructionProgressForQueue({
  bodyKind,
  kind,
  now,
  planetId,
  queue,
}: {
  bodyKind: ConstructionBodyKind;
  kind: ConstructionQueueKind;
  now: number;
  planetId: string;
  queue: QueueStateResponse | null | undefined;
}): ConstructionProgress {
  const activeQueue = queue?.active ? queue : null;
  const readyAtMs = timestampToMs(activeQueue?.readyAt);
  const startedAtMs = timestampToMs(activeQueue?.startedAt ?? activeQueue?.productionTiming?.startedAt);
  const hasTimeline = readyAtMs !== undefined && startedAtMs !== undefined && startedAtMs < readyAtMs;
  // Completion is calculated by the backend's as-of-now projection.  The local
  // clock only animates a known-active queue; it never settles it.
  const complete = activeQueue?.asOfNow?.complete === true;
  const backendProgress = activeQueue?.asOfNow?.overallProgressBps;
  const progress = complete
    ? 1
    : hasTimeline
      ? queueProgress({ readyAt: readyAtMs, startedAt: startedAtMs }, now)
      : backendProgress === undefined
        ? 0
        : Math.min(1, Math.max(0, backendProgress / 10_000));
  const displayedQueue = complete ? null : activeQueue;

  return {
    active: displayedQueue !== null,
    bodyKind,
    complete,
    indeterminate: displayedQueue !== null && !hasTimeline && backendProgress === undefined,
    kind,
    planetId,
    progress,
    queue: displayedQueue,
    ...(readyAtMs === undefined ? {} : { readyAtMs }),
    remaining: displayedQueue === null
      ? "Idle"
      : readyAtMs === undefined
        ? "syncing"
        : formatDurationUntil(readyAtMs, now),
    ...(startedAtMs === undefined ? {} : { startedAtMs }),
  };
}

/**
 * A raw page snapshot can remain active while the body is off-screen and its
 * indexed completion refresh is still in flight. Progress visibility follows
 * the shared projection so every surface drops that stale completed queue at
 * the same instant.
 */
export function constructionQueueForDisplay<T>(
  queue: T | undefined,
  progress: ConstructionProgress | undefined,
): T | undefined {
  return progress?.active === false ? undefined : queue;
}

function sameConstructionQueue(left: QueueStateResponse, right: QueueStateResponse): boolean {
  return (left.kind === null || right.kind === null || left.kind === right.kind)
    && (left.itemId === undefined || right.itemId === undefined || left.itemId === right.itemId)
    && (left.targetLevel === undefined || right.targetLevel === undefined || left.targetLevel === right.targetLevel)
    && (left.readyAt === null || right.readyAt === null || left.readyAt === right.readyAt);
}
