import type { Resources } from "./playableMvp";

/**
 * Client-side ledger of resource spends the player has submitted but that the
 * backend settlement / infrastructure reads do not yet reflect.
 *
 * The settlement endpoint adds production accrual without subtracting recent
 * spends, and the infrastructure endpoint is eventually consistent: right after
 * a build / research / ship / defense start mines, `/wallet/<addr>/infrastructure`
 * can still report the pre-spend balance for a few production ticks (or stay
 * stale entirely while the API is unavailable). During that window the
 * canonical `min(settlement, infrastructure)` balance over-reports, so action
 * buttons look affordable and the next tx reverts on-chain with
 * `InsufficientResources`.
 *
 * This ledger bridges that gap: when a spend is submitted we record its cost and
 * subtract it from the displayed/gated balance until we observe the backend has
 * caught up (or a TTL backstop elapses). The bias is intentionally conservative
 * — it never lets the UI report MORE than the real spendable balance.
 */
export type PendingSpend = {
  id: string;
  /** Resources committed by the submitted action. */
  cost: Resources;
  /**
   * Backend-known spendable balance at submit time (pre-spend). Used to detect
   * when a later infrastructure read reflects the spend.
   */
  baseline: Resources;
  /** Production rate (per hour) at submit time, for settle-detection tolerance. */
  ratePerHour: Resources;
  createdAtMs: number;
  /** Hard backstop: drop the entry once this passes even if undetected. */
  expiresAtMs: number;
};

/**
 * How long a submitted spend stays subtracted before the TTL backstop drops it.
 * Long enough to bridge backend settlement lag and short infra outages; short
 * enough that a missed settle-detection self-heals quickly instead of
 * under-reporting indefinitely.
 */
export const PENDING_SPEND_TTL_MS = 3 * 60_000;

const RESOURCE_KEYS: (keyof Resources)[] = ["metal", "crystal", "deuterium"];

function zeroResources(): Resources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

export function sumPendingSpendCosts(entries: readonly PendingSpend[]): Resources {
  return entries.reduce<Resources>(
    (acc, entry) => ({
      metal: acc.metal + Math.max(0, entry.cost.metal),
      crystal: acc.crystal + Math.max(0, entry.cost.crystal),
      deuterium: acc.deuterium + Math.max(0, entry.cost.deuterium),
    }),
    zeroResources(),
  );
}

/**
 * Subtract a resource cost from a candidate balance, clamped at zero. Returns the
 * balance unchanged when it is unavailable.
 */
export function subtractResourceCost(
  balance: Resources | undefined,
  cost: Resources,
): Resources | undefined {
  if (!balance) return balance;
  return {
    metal: Math.max(0, balance.metal - Math.max(0, cost.metal)),
    crystal: Math.max(0, balance.crystal - Math.max(0, cost.crystal)),
    deuterium: Math.max(0, balance.deuterium - Math.max(0, cost.deuterium)),
  };
}

/**
 * Subtract the outstanding pending-spend cost from a candidate balance, clamped
 * at zero. Returns the balance unchanged when there are no pending spends.
 */
export function applyPendingSpends(
  balance: Resources | undefined,
  entries: readonly PendingSpend[],
): Resources | undefined {
  if (!balance || entries.length === 0) return balance;
  return subtractResourceCost(balance, sumPendingSpendCosts(entries));
}

/** Element-wise maximum of two resource costs. */
export function maxResourceCost(a: Resources, b: Resources): Resources {
  return {
    metal: Math.max(a.metal, b.metal),
    crystal: Math.max(a.crystal, b.crystal),
    deuterium: Math.max(a.deuterium, b.deuterium),
  };
}

/**
 * A spend the backend already shows as an active queue item (build / research /
 * ship / defense). Unlike the in-session {@link PendingSpend} ledger, these are
 * re-derived from backend state on every load, so they survive a page reload and
 * have no TTL. They cover the gap the session ledger misses: a spend started in a
 * previous session — or one that outlived the ledger TTL — that the resource
 * snapshot does not yet reflect.
 */
export type QueueSpend = {
  cost: Resources;
  /** When the spend started on-chain (ms); undefined when unknown. */
  startedAtMs: number | undefined;
};

/**
 * Total cost of active-queue spends that are NOT yet reflected in the accurate
 * backend resource snapshot.
 *
 * A spend with `startedAtMs <= snapshotSettledAtMs` is already baked into the
 * snapshot, so it is skipped to avoid double-subtracting. When the snapshot
 * settle time is unknown — the accurate infrastructure read is unavailable or
 * still warming — the snapshot cannot be trusted to reflect the spend, so it is
 * subtracted (the conservative, never-over-report direction).
 */
export function unsettledQueueSpendCosts(
  spends: readonly QueueSpend[],
  snapshotSettledAtMs: number | undefined,
): Resources {
  return spends.reduce<Resources>((acc, spend) => {
    const reflectedInSnapshot =
      snapshotSettledAtMs !== undefined
      && spend.startedAtMs !== undefined
      && spend.startedAtMs <= snapshotSettledAtMs;
    if (reflectedInSnapshot) return acc;
    return {
      metal: acc.metal + Math.max(0, spend.cost.metal),
      crystal: acc.crystal + Math.max(0, spend.cost.crystal),
      deuterium: acc.deuterium + Math.max(0, spend.cost.deuterium),
    };
  }, zeroResources());
}

/**
 * A spend is considered "settled" — i.e. the backend infrastructure read now
 * accounts for it, so we must stop subtracting to avoid double-counting — once
 * the latest infrastructure balance has fallen at least halfway from the
 * production-adjusted pre-spend baseline toward the post-spend floor, for every
 * resource that was actually spent.
 *
 * Production only ever adds to the balance, so the production-adjusted baseline
 * is the highest the read can be if the spend has NOT landed; crossing the
 * halfway point toward `baseline - cost` is a robust signal that it has.
 */
export function isPendingSpendSettled(
  entry: PendingSpend,
  infrastructure: Resources | undefined,
  now: number,
): boolean {
  if (!infrastructure) return false;
  const spentKeys = RESOURCE_KEYS.filter((key) => entry.cost[key] > 0);
  if (spentKeys.length === 0) return true;
  const elapsedSeconds = Math.max(0, (now - entry.createdAtMs) / 1_000);
  return spentKeys.every((key) => {
    const produced = (Math.max(0, entry.ratePerHour[key]) * elapsedSeconds) / 3_600;
    const threshold = entry.baseline[key] + produced - entry.cost[key] / 2;
    return infrastructure[key] <= threshold;
  });
}

/**
 * Drop pending spends that have either been reflected by the backend
 * (`isPendingSpendSettled`) or outlived the TTL backstop. The remaining entries
 * are the ones still worth subtracting from the displayed/gated balance.
 */
export function reconcilePendingSpends({
  entries,
  infrastructure,
  now,
}: {
  entries: readonly PendingSpend[];
  infrastructure: Resources | undefined;
  now: number;
}): PendingSpend[] {
  return entries.filter(
    (entry) => now < entry.expiresAtMs && !isPendingSpendSettled(entry, infrastructure, now),
  );
}

/**
 * Build a pending-spend entry from a submitted action's cost and the current
 * backend-known balance / production rate.
 */
export function createPendingSpend({
  id,
  cost,
  baseline,
  ratePerHour,
  now,
  ttlMs = PENDING_SPEND_TTL_MS,
}: {
  id: string;
  cost: Resources;
  baseline: Resources;
  ratePerHour: Resources;
  now: number;
  ttlMs?: number;
}): PendingSpend {
  return {
    id,
    cost: {
      metal: Math.max(0, cost.metal),
      crystal: Math.max(0, cost.crystal),
      deuterium: Math.max(0, cost.deuterium),
    },
    baseline,
    ratePerHour,
    createdAtMs: now,
    expiresAtMs: now + Math.max(0, ttlMs),
  };
}
