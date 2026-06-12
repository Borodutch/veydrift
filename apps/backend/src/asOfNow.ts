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

export type QueueAsOfNowSettlement = {
  queue: QueueState | null;
  completed: QueueState[];
};

function withQueueTiming(queue: QueueState, nowSec: number): QueueState {
  return {
    ...queue,
    asOfNow: deriveQueueAsOfNow(queue.readyAt, nowSec),
    ...(queue.backlog ? { backlog: queue.backlog.map((entry) => withQueueTiming(entry, nowSec)) } : {})
  };
}

function withoutBacklog(queue: QueueState): QueueState {
  const { backlog: _backlog, ...rest } = queue;
  return rest;
}

// Returns the queue state as if every elapsed active/backlog entry had already settled on-chain.
// Pure: never mutates the input (read models cache and persist these objects).
export function settleQueueAsOfNow(queue: QueueState | null, nowSec: number): QueueAsOfNowSettlement {
  if (!queue) return { queue: null, completed: [] };
  const ordered = [queue, ...(queue.backlog ?? [])];
  const completed: QueueState[] = [];
  let activeIndex = 0;
  for (; activeIndex < ordered.length; activeIndex += 1) {
    const entry = ordered[activeIndex];
    if (!entry || !deriveQueueAsOfNow(entry.readyAt, nowSec).complete) break;
    completed.push(withQueueTiming(withoutBacklog(entry), nowSec));
  }
  const active = ordered[activeIndex];
  if (!active) return { queue: null, completed };
  return {
    queue: withQueueTiming({ ...active, backlog: ordered.slice(activeIndex + 1) }, nowSec),
    completed
  };
}

export function withQueueAsOfNow(queue: QueueState | null, nowSec: number): QueueState | null {
  return queue ? withQueueTiming(queue, nowSec) : null;
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
