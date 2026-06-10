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

/**
 * The resource deduction to subtract from the canonical displayed / gated
 * balance, combining the in-session pending-spend ledger with the backend
 * active-queue spends.
 *
 * The two sources estimate the SAME underlying spends, so they are combined with
 * an element-wise max (never a sum) to avoid double-subtracting.
 *
 * When `previewAnchored` is true the canonical balance is the authoritative
 * on-chain `previewResources` read, which already reflects every spend that has
 * MINED — including every active backend queue, since the contract deducts a
 * queue's cost in the same settlement that starts it. Subtracting the queue cost
 * again would double-count and pin Metal/Crystal at 0 (VEY-KANEO-428: a fleet
 * launch re-settles the planet and refreshes the preview to the post-spend
 * balance while the backend snapshot still lags). So only the in-session ledger
 * is applied then — its remaining entries are pre-mine spends the preview has not
 * yet reduced, which must still gate affordability (VEY-392). `reconcilePendingSpends`
 * is responsible for dropping ledger entries the preview already reflects.
 */
export function spendDeductionForDisplay({
  pendingSpends,
  queueSpend,
  previewAnchored,
}: {
  pendingSpends: readonly PendingSpend[];
  queueSpend: Resources;
  previewAnchored: boolean;
}): Resources {
  const ledger = sumPendingSpendCosts(pendingSpends);
  return previewAnchored ? ledger : maxResourceCost(ledger, queueSpend);
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
 * The on-chain contract deducts a queue's cost at the moment it is started, in
 * the same settlement that advances the planet's `lastSettledAt` (see
 * `startBuildingUpgrade` / `startResearch` / `startShipProduction` /
 * `startDefenseProduction`: each calls `_settleResources` then `_spend`). So any
 * snapshot the backend serves with a known settle time was read from indexed
 * state that already includes the BuildingStarted/ResearchQueued/... event and
 * therefore already reflects the spend. When the snapshot settle time is known
 * we treat the spend as reflected — even when the spend's own start time is
 * unknown (the indexer frequently cannot backfill `startedAt`). Subtracting it
 * again would double-count and pin Metal/Crystal at 0 for the whole build
 * (VEY-318: top bar stuck at 0 with positive production until the queue clears).
 *
 * A spend is only subtracted when the snapshot settle time is unknown — the
 * accurate infrastructure read is unavailable, stale, or still warming — so the
 * snapshot cannot be trusted to reflect it (the conservative, never-over-report
 * direction; covered by the in-session pending-spend ledger for fresh spends),
 * or when the snapshot is known to predate the spend (`startedAtMs >
 * snapshotSettledAtMs`).
 */
export function unsettledQueueSpendCosts(
  spends: readonly QueueSpend[],
  snapshotSettledAtMs: number | undefined,
): Resources {
  return spends.reduce<Resources>((acc, spend) => {
    const reflectedInSnapshot =
      snapshotSettledAtMs !== undefined
      && (spend.startedAtMs === undefined || spend.startedAtMs <= snapshotSettledAtMs);
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
 * Drop pending spends that have either been reflected by an authoritative
 * spendable read (`isPendingSpendSettled`) or outlived the TTL backstop. The
 * remaining entries are the ones still worth subtracting from the displayed /
 * gated balance.
 *
 * An entry is reconciled away as soon as EITHER authoritative read reflects it:
 *   - `infrastructure`: the backend `/infrastructure` snapshot.
 *   - `preview`: the direct on-chain `previewResources(planetId)` read.
 * The displayed balance is anchored to the preview read when it is fresh (see
 * `canonicalSpendableResources`), but that read leads the backend snapshot: once
 * a submitted spend mines, the preview drops to the post-spend balance while the
 * infrastructure snapshot can still lag at the pre-spend value for several
 * production ticks. Settling against ONLY the lagging snapshot would keep
 * subtracting the cost from a canonical balance the preview already reduced,
 * double-counting and pinning Metal/Crystal at 0 until the snapshot catches up
 * (VEY-KANEO-428: launching a fleet re-settles the planet and widens this
 * window). Settling against the preview read too closes it, while still gating
 * affordability during the pre-mine window where the preview has not yet moved.
 */
export function reconcilePendingSpends({
  entries,
  infrastructure,
  preview,
  now,
}: {
  entries: readonly PendingSpend[];
  infrastructure: Resources | undefined;
  preview?: Resources | undefined;
  now: number;
}): PendingSpend[] {
  return entries.filter(
    (entry) =>
      now < entry.expiresAtMs
      && !isPendingSpendSettled(entry, infrastructure, now)
      && !isPendingSpendSettled(entry, preview, now),
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
