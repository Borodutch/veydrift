import type { Resources } from "./playableMvp";

/**
 * Project a single settled resource value forward by the production accrued
 * since it was settled, capped at the storage cap. Mirrors the backend's
 * claimable accrual so the live display keeps ticking up between settlements.
 */
export function projectResourceAmount(
  settledValue: number,
  ratePerHour: number,
  cap: number,
  elapsedSeconds: number,
): number {
  const produced = Math.floor((Math.max(0, ratePerHour) * Math.max(0, elapsedSeconds)) / 3_600);
  const projected = settledValue + produced;
  const capped = Number.isFinite(cap) && cap > 0 ? Math.min(cap, projected) : projected;
  return Math.max(0, Math.floor(capped));
}

/**
 * Project a settled resource balance forward to `now` using its production
 * rates and storage caps. Returns `undefined` when the balance is unavailable.
 */
export function projectResources({
  resources,
  rates,
  caps,
  settledAtMs,
  now,
}: {
  resources: Resources | undefined;
  rates: Resources;
  caps: Resources;
  settledAtMs: number;
  now: number;
}): Resources | undefined {
  if (!resources) return undefined;

  const elapsedSeconds = Math.max(0, Math.floor((now - settledAtMs) / 1_000));
  return {
    metal: projectResourceAmount(resources.metal, rates.metal, caps.metal, elapsedSeconds),
    crystal: projectResourceAmount(resources.crystal, rates.crystal, caps.crystal, elapsedSeconds),
    deuterium: projectResourceAmount(resources.deuterium, rates.deuterium, caps.deuterium, elapsedSeconds),
  };
}

/**
 * Element-wise minimum of two candidate balances. Used to anchor the displayed
 * spendable balance to the most conservative (accurate) backend read so the UI
 * never over-reports resources the player cannot actually spend.
 */
export function minResources(
  a: Resources | undefined,
  b: Resources | undefined,
): Resources | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    metal: Math.min(a.metal, b.metal),
    crystal: Math.min(a.crystal, b.crystal),
    deuterium: Math.min(a.deuterium, b.deuterium),
  };
}

/**
 * Canonical spendable balance used for both the resource display and action
 * affordability gating.
 *
 * The authoritative source is a DIRECT on-chain `previewResources(planetId)`
 * read (`previewResources`). It is exactly what the contract returns as the
 * planet's current spendable balance — stored value plus all production accrued
 * since the on-chain `lastSettledAt`, capped at storage — so when a fresh read is
 * available it is used as the balance OUTRIGHT (projected forward only from its
 * own read time to tick smoothly between the ~10s polls).
 *
 * It is deliberately NOT folded into an element-wise minimum with the backend
 * `/wallet/<addr>/settlement` and `/wallet/<addr>/infrastructure` snapshots,
 * because those snapshots are unreliable in BOTH directions and a `min` clamps
 * the result to whichever one is wrong:
 *   - A snapshot already accrued toward `now`, projected forward again from
 *     `lastSettledAt`, OVER-reports — it double-counts the elapsed production
 *     (frontend crystal 12,143 vs on-chain previewResources 10,155).
 *   - A snapshot that LAGS the chain UNDER-reports. Observed live on a settled
 *     planet: backend infrastructure metal 20 vs on-chain previewResources 211,
 *     so `min` would hide ~190 metal of real, spendable production — the VEY-318
 *     under-report where the top bar is pinned to the stored value and uncollected
 *     production never appears.
 * The chain read can do neither: it is the same value a transaction spends
 * against, so the display and affordability gating track it exactly.
 *
 * The backend snapshots are only a FALLBACK for when no wallet is connected / the
 * chain read is unavailable (the caller passes a fresh `previewResources` or
 * nothing). In that case each backend source is anchored to its read time and the
 * element-wise minimum is taken so the display never exceeds the more
 * conservative source; when a source is missing the other is used as-is.
 *
 * `settlementSettledAtMs` and `previewSettledAtMs` default to `now` (project to
 * self ⇒ no accrual) so a caller that already projected a snapshot, or that has
 * no settle/read time, keeps the previous behaviour.
 *
 * `freezeProjection` stops the forward production accrual. The displayed balance
 * is projected forward by a free-running `now` clock so it ticks up between
 * backend reads; but when the backend resource read is stale or unavailable
 * (API/RPC outage, backend sync paused) the underlying snapshots stop
 * refreshing while `now` keeps advancing, which would run the balance up toward
 * the storage caps and over-report a spendable balance the player does not have.
 * In that case the caller passes `freezeProjection: true` so neither source
 * accrues past its last known value. Production only ticks up while reads are
 * fresh.
 */
export function canonicalSpendableResources({
  settlementResources,
  settlementSettledAtMs,
  infrastructureResources,
  infrastructureSettledAtMs,
  previewResources,
  previewSettledAtMs,
  rates,
  caps,
  now,
  freezeProjection = false,
}: {
  settlementResources: Resources | undefined;
  settlementSettledAtMs?: number;
  infrastructureResources: Resources | undefined;
  infrastructureSettledAtMs: number;
  previewResources?: Resources | undefined;
  previewSettledAtMs?: number | undefined;
  rates: Resources;
  caps: Resources;
  now: number;
  freezeProjection?: boolean;
}): Resources | undefined {
  // Authoritative path: the direct on-chain `previewResources` read is the real
  // current spendable balance, so use it outright when a fresh read is available.
  // Project it forward from its own read time so it keeps ticking between the
  // ~10s reads. The caller only passes a FRESH read, so a chain-read outage drops
  // it and falls through to the backend fallback below; that staleness gate
  // bounds any forward drift to a few seconds of production, so the projection is
  // not frozen here even when the backend read is stale.
  const projectedPreview = projectResources({
    resources: previewResources,
    rates,
    caps,
    settledAtMs: previewSettledAtMs ?? now,
    now,
  });
  if (projectedPreview) return projectedPreview;

  // Fallback (no wallet connected / chain read unavailable): project both backend
  // snapshots forward from their read times and take the element-wise minimum so
  // the display never exceeds the more conservative source. Frozen to the
  // last-known value during a backend/RPC outage so it cannot drift toward the
  // storage cap (VEY-392).
  const settlementSettledAt = settlementSettledAtMs ?? now;
  const projectedSettlement = projectResources({
    resources: settlementResources,
    rates,
    caps,
    settledAtMs: settlementSettledAt,
    // Freeze => project to the snapshot's own settle time (elapsed 0) so the
    // last-known read is used as-is instead of drifting toward storage caps.
    now: freezeProjection ? settlementSettledAt : now,
  });
  const projectedInfrastructure = projectResources({
    resources: infrastructureResources,
    rates,
    caps,
    settledAtMs: infrastructureSettledAtMs,
    now: freezeProjection ? infrastructureSettledAtMs : now,
  });
  return minResources(projectedSettlement, projectedInfrastructure);
}
