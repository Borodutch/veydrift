import type { QueueStateResponse } from "./walletFlow";

export function activeProductionQueue(
  primaryQueue: QueueStateResponse | null | undefined,
  fallbackQueue: QueueStateResponse | null | undefined,
  kind: "defense" | "ship",
): QueueStateResponse | undefined {
  if (primaryQueue?.active) {
    return matchingActiveProductionQueue(primaryQueue, fallbackQueue, kind)
      ? mergeProductionQueue(primaryQueue, fallbackQueue)
      : primaryQueue;
  }
  if (fallbackQueue?.active && fallbackQueue.kind === kind) return fallbackQueue;
  return undefined;
}

function mergeProductionQueue(
  primaryQueue: QueueStateResponse,
  fallbackQueue: QueueStateResponse,
): QueueStateResponse {
  const fallbackStartedAt = fallbackQueue.startedAt ?? fallbackQueue.productionTiming?.startedAt;
  const startedAt = primaryQueue.startedAt ?? primaryQueue.productionTiming?.startedAt ?? fallbackStartedAt;
  const sameTimeline = primaryQueue.readyAt === null
    || primaryQueue.readyAt === undefined
    || primaryQueue.readyAt === fallbackQueue.readyAt;
  const productionTiming = primaryQueue.productionTiming
    ?? (sameTimeline ? fallbackQueue.productionTiming : undefined);
  const asOfNow = primaryQueue.asOfNow
    ?? (sameTimeline ? fallbackQueue.asOfNow : undefined);
  const queue = {
    ...primaryQueue,
    readyAt: primaryQueue.readyAt ?? fallbackQueue.readyAt,
    ...(productionTiming ? { productionTiming } : {}),
    ...(asOfNow ? { asOfNow } : {}),
  };

  return startedAt === undefined ? queue : { ...queue, startedAt };
}

function matchingActiveProductionQueue(
  primaryQueue: QueueStateResponse,
  fallbackQueue: QueueStateResponse | null | undefined,
  kind: "defense" | "ship",
): fallbackQueue is QueueStateResponse {
  if (!fallbackQueue?.active || primaryQueue.kind !== kind || fallbackQueue.kind !== kind) {
    return false;
  }

  return valuesMatch(primaryQueue.itemId, fallbackQueue.itemId)
    && valuesMatch(primaryQueue.targetLevel, fallbackQueue.targetLevel)
    && hasUsableFallbackStartedAt(primaryQueue, fallbackQueue);
}

function valuesMatch<T>(primaryValue: T | undefined, fallbackValue: T | undefined): boolean {
  return primaryValue === undefined || fallbackValue === undefined || primaryValue === fallbackValue;
}

function hasUsableFallbackStartedAt(
  primaryQueue: QueueStateResponse,
  fallbackQueue: QueueStateResponse,
): boolean {
  const fallbackStartedAt = fallbackQueue.startedAt ?? fallbackQueue.productionTiming?.startedAt;
  if (fallbackStartedAt === undefined || fallbackStartedAt === null) return false;

  const startedAt = Number(fallbackStartedAt);
  const readyAt = Number(primaryQueue.readyAt ?? fallbackQueue.readyAt);

  return Number.isFinite(startedAt) && Number.isFinite(readyAt) && startedAt < readyAt;
}
