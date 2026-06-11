import type { FleetMissionSummary, MissionAsOfNow, QueueAsOfNow, QueueState } from "./evm";

// "As-of-now" derived state (VEY-KANEO-464). The read models persist canonical,
// settlement-anchored values (a queue's `readyAt`, a mission's `arrivalAt` /
// `returnAt`). Every consumer otherwise has to re-derive "is it done yet / how
// long left" against the wall clock, and each does it slightly differently. These
// helpers compute that derivation once, server-side, at request time, so every
// endpoint (personal and all-players) returns a consistent as-of-now view
// alongside the canonical fields.

export type { MissionAsOfNow, QueueAsOfNow } from "./evm";

export function nowSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1_000);
}

function secondsUntil(timestamp: string | null | undefined, nowSec: number): { remaining: number; due: boolean } {
  if (timestamp === null || timestamp === undefined) return { remaining: 0, due: false };
  const at = Number(timestamp);
  if (!Number.isFinite(at) || at <= 0) return { remaining: 0, due: false };
  const remaining = at - nowSec;
  return { remaining: Math.max(0, remaining), due: remaining <= 0 };
}

export function deriveQueueAsOfNow(readyAt: string | null | undefined, nowSec: number): QueueAsOfNow {
  const { remaining, due } = secondsUntil(readyAt, nowSec);
  return { secondsRemaining: remaining, complete: due };
}

// Returns a copy of the queue with `asOfNow` attached, recursing into `backlog`.
// Pure: never mutates the input (read models cache and persist these objects).
export function withQueueAsOfNow(queue: QueueState | null, nowSec: number): QueueState | null {
  if (!queue) return null;
  return {
    ...queue,
    asOfNow: deriveQueueAsOfNow(queue.readyAt, nowSec),
    ...(queue.backlog ? { backlog: queue.backlog.map((entry) => withQueueAsOfNow(entry, nowSec)!) } : {})
  };
}

export function deriveMissionAsOfNow(
  mission: Pick<FleetMissionSummary, "arrivalAt" | "returnAt">,
  nowSec: number
): MissionAsOfNow {
  const arrival = secondsUntil(mission.arrivalAt, nowSec);
  const ret = secondsUntil(mission.returnAt, nowSec);
  return {
    secondsUntilArrival: arrival.remaining,
    secondsUntilReturn: ret.remaining,
    arrived: arrival.due,
    returned: ret.due
  };
}

// Returns a copy of the mission with `asOfNow` attached. Pure: never mutates input.
export function withMissionAsOfNow(mission: FleetMissionSummary, nowSec: number): FleetMissionSummary {
  return {
    ...mission,
    asOfNow: deriveMissionAsOfNow(mission, nowSec)
  };
}
