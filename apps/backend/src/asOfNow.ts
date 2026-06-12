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

export type SettledQueueItem = {
  itemId: number | null;
  quantity: number;
  targetLevel: number | null;
};

// Read-time completion of production/research queues whose `readyAt` has already
// elapsed (VEY-KANEO-461). The game contract finishes a queued build/research
// lazily on the next settlement, running `while (queue.active && queue.readyAt <=
// now)` over the active head then each backlog entry in order; each finished item
// bumps its count/level and is removed from the queue, emitted as a single
// *Completed event. If that event is dropped from the websocket `logs` feed (and
// no canonical reconcile has since re-baselined the planet) the indexed queue row
// stays present forever — served as a perpetually "ready" item whose count/level
// never advances. Folding the elapsed entries out at read time mirrors the
// contract's own lazy completion exactly, so served state stays correct straight
// from the indexed DB with zero chain reads. It is idempotent with the real
// *Completed event: when that event lands it deletes the queue row AND writes the
// same final total, so `base count + folded queue quantity` is unchanged.
//
// Returns the queue with elapsed entries removed (the first still-pending entry
// becomes the active head) plus the list of completed items so count/level read
// models can apply the same fold. Pure: never mutates the input.
export function settleCompletedQueue(
  queue: QueueState | null,
  nowSec: number
): { active: QueueState | null; completed: SettledQueueItem[] } {
  if (!queue) return { active: null, completed: [] };
  const ordered: QueueState[] = [queue, ...(queue.backlog ?? [])];
  const completed: SettledQueueItem[] = [];
  let pendingFrom = ordered.length;
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
    // Stop at the first entry not yet due: later entries cannot finish before an
    // earlier one (the contract completes them strictly in order), so a null /
    // future readyAt anywhere keeps it and everything after it queued.
    if (!deriveQueueAsOfNow(entry.readyAt, nowSec).complete) {
      pendingFrom = index;
      break;
    }
    completed.push({
      itemId: entry.itemId ?? null,
      quantity: entry.quantity ?? 0,
      targetLevel: entry.targetLevel ?? null
    });
  }

  const remaining = ordered.slice(pendingFrom);
  const head = remaining[0];
  if (!head) {
    return { active: null, completed };
  }
  const rest = remaining.slice(1);
  const active: QueueState = { ...head };
  if (rest.length > 0) {
    active.backlog = rest;
  } else {
    delete active.backlog;
  }
  return { active, completed };
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
