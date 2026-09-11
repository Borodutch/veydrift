import { type PlayerQueuesResponse } from "../walletFlow";

export function isOverviewResearchReadyToFinish(
  queue: PlayerQueuesResponse["research"] | undefined,
  now: number,
): boolean {
  return Boolean(queue?.active && queue.readyAt && Number(queue.readyAt) * 1_000 <= now);
}
