import type { QueueStateResponse } from "./walletFlow";

export function activeProductionQueue(
  primaryQueue: QueueStateResponse | null | undefined,
  fallbackQueue: QueueStateResponse | null | undefined,
  kind: "defense" | "ship",
): QueueStateResponse | undefined {
  if (primaryQueue?.active) return primaryQueue;
  if (fallbackQueue?.active && fallbackQueue.kind === kind) return fallbackQueue;
  return undefined;
}
