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

function bigintOrNull(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function boundedBps(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator <= 0n) return 0;
  if (numerator >= denominator) return 10_000;
  return Number((numerator * 10_000n) / denominator);
}

function proportionalResource(value: string, numerator: number, denominator: number): string {
  if (numerator <= 0 || denominator <= 0) return "0";
  try {
    return ((BigInt(value) * BigInt(numerator)) / BigInt(denominator)).toString();
  } catch {
    return "0";
  }
}

function projectedProductionEntry(
  queue: QueueState,
  nowSec: number
): { active: QueueState | null; completed: QueueState | null } | null {
  const timing = queue.productionTiming;
  const remainingCanonical = queue.quantity;
  if (!timing || remainingCanonical === undefined || remainingCanonical <= 0) return null;

  const startedAt = bigintOrNull(timing.startedAt);
  const readyAt = bigintOrNull(queue.readyAt);
  const unitWorkSeconds = bigintOrNull(timing.unitWorkSeconds);
  const rate = bigintOrNull(timing.rate);
  const originalQuantity = Math.max(0, Math.floor(timing.originalQuantity));
  if (
    startedAt === null
    || readyAt === null
    || unitWorkSeconds === null
    || rate === null
    || rate <= 0n
    || originalQuantity <= 0
    || originalQuantity < remainingCanonical
  ) {
    return null;
  }

  const now = BigInt(Math.max(0, Math.floor(nowSec)));
  let completedTotal = 0;
  if (now >= readyAt || unitWorkSeconds === 0n) {
    completedTotal = originalQuantity;
  } else if (now > startedAt) {
    const completed = ((now - startedAt) * rate) / unitWorkSeconds;
    completedTotal = Math.min(originalQuantity, Number(completed));
  }

  const completedCanonical = originalQuantity - remainingCanonical;
  const newlyCompleted = Math.max(0, Math.min(remainingCanonical, completedTotal - completedCanonical));
  const remainingProjected = remainingCanonical - newlyCompleted;
  const completedCost = {
    metal: proportionalResource(queue.cost.metal, newlyCompleted, remainingCanonical),
    crystal: proportionalResource(queue.cost.crystal, newlyCompleted, remainingCanonical),
    deuterium: proportionalResource(queue.cost.deuterium, newlyCompleted, remainingCanonical)
  };
  const remainingCost = {
    metal: (BigInt(queue.cost.metal) - BigInt(completedCost.metal)).toString(),
    crystal: (BigInt(queue.cost.crystal) - BigInt(completedCost.crystal)).toString(),
    deuterium: (BigInt(queue.cost.deuterium) - BigInt(completedCost.deuterium)).toString()
  };

  const nextUnitNumber = Math.min(originalQuantity, completedTotal + 1);
  const nextUnitElapsed = unitWorkSeconds === 0n
    ? 1n
    : (unitWorkSeconds * BigInt(nextUnitNumber) + rate - 1n) / rate;
  const previousUnitElapsed = completedTotal <= 0
    ? 0n
    : (unitWorkSeconds * BigInt(completedTotal) + rate - 1n) / rate;
  const nextUnitAt = startedAt + (nextUnitElapsed < 1n ? 1n : nextUnitElapsed);
  const previousUnitAt = startedAt + previousUnitElapsed;
  const currentBoundary = nextUnitAt > readyAt ? readyAt : nextUnitAt;
  const currentStart = previousUnitAt > readyAt ? readyAt : previousUnitAt;
  const currentUnitSecondsRemaining = remainingProjected <= 0 || now >= currentBoundary
    ? 0
    : Number(currentBoundary - now);
  const currentUnitProgressBps = remainingProjected <= 0
    ? 10_000
    : boundedBps(now - currentStart, currentBoundary - currentStart);
  const asOfNow: QueueAsOfNow = {
    secondsRemaining: remainingProjected <= 0 || now >= readyAt ? 0 : Number(readyAt - now),
    complete: remainingProjected <= 0,
    completedQuantity: Math.min(originalQuantity, completedTotal),
    remainingQuantity: remainingProjected,
    currentUnitSecondsRemaining,
    currentUnitProgressBps,
    overallProgressBps: boundedBps(now - startedAt, readyAt - startedAt)
  };

  const completed = newlyCompleted > 0
    ? {
        ...withoutBacklog(queue),
        quantity: newlyCompleted,
        cost: completedCost,
        asOfNow: { ...asOfNow, complete: true, secondsRemaining: 0 }
      }
    : null;
  const active = remainingProjected > 0
    ? {
        ...withoutBacklog(queue),
        quantity: remainingProjected,
        cost: remainingCost,
        startedAt: timing.startedAt,
        asOfNow
      }
    : null;
  return { active, completed };
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
    if (!entry) break;
    const production = projectedProductionEntry(entry, nowSec);
    if (production) {
      if (production.completed) completed.push(production.completed);
      if (production.active) {
        return {
          queue: {
            ...production.active,
            backlog: ordered.slice(activeIndex + 1).map((queued) => withQueueTiming(queued, nowSec))
          },
          completed
        };
      }
      continue;
    }
    if (!deriveQueueAsOfNow(entry.readyAt, nowSec).complete) break;
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
