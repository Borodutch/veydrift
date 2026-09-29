import type { QueueStateResponse } from "./walletFlow";

/** Only the matured part of canonical unsettled batches, never already credited units. */
export function pendingDefenseSettlement(queue: QueueStateResponse | null | undefined): Map<number, number> {
  const counts = new Map<number, number>();
  if (!queue) return counts;
  for (const batch of [queue, ...(queue.backlog ?? [])]) {
    if (batch.active === false || batch.itemId === undefined) continue;
    const quantity = Math.max(0, batch.quantity ?? 0);
    // completedQuantity is cumulative for the original purchase (100), not the
    // canonical remainder (23). remainingQuantity excludes already credited units.
    const remaining = batch.asOfNow?.complete ? 0 : batch.asOfNow?.remainingQuantity;
    if (remaining === undefined) continue;
    const due = Math.max(0, Math.min(quantity, quantity - remaining));
    if (due > 0) counts.set(batch.itemId, (counts.get(batch.itemId) ?? 0) + due);
  }
  return counts;
}
