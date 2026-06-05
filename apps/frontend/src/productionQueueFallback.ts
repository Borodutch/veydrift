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
  const startedAt = primaryQueue.startedAt ?? fallbackQueue.startedAt;
  const queue = {
    ...primaryQueue,
    readyAt: primaryQueue.readyAt ?? fallbackQueue.readyAt,
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
  if (fallbackQueue.startedAt === undefined || fallbackQueue.startedAt === null) return false;

  const startedAt = Number(fallbackQueue.startedAt);
  const readyAt = Number(primaryQueue.readyAt ?? fallbackQueue.readyAt);

  return Number.isFinite(startedAt) && Number.isFinite(readyAt) && startedAt < readyAt;
}
