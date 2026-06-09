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
 * The settlement (`/wallet/<addr>/settlement`) and infrastructure
 * (`/wallet/<addr>/infrastructure`) backend endpoints report resources for the
 * planet's on-chain `lastSettledAt`. Each is projected forward from its own
 * settle time to `now` here (`current = settled + rate × elapsed`, capped at
 * storage) so the top bar ticks up live and includes production accrued before
 * the page loaded — instead of staying pinned at the raw last-settled value
 * (VEY-318: Metal / Crystal stuck at 0 when the planet was last settled near 0).
 *
 * Anchoring to the chain (VEY-318 over-report fix): a projected backend snapshot
 * can drift ABOVE the real on-chain balance — e.g. when the backend snapshot is
 * itself already accrued toward now, projecting it forward again double-counts
 * the elapsed production (frontend crystal 12,143 vs on-chain previewResources
 * 10,155 ≈ one extra elapsed-since-settle production). `minResources(settlement,
 * infrastructure)` does not catch this because BOTH sources get the same
 * projection. So when a direct on-chain `previewResources(planetId)` read is
 * available it is passed as a third source: it is the contract's authoritative
 * current spendable (stored + accrual, capped), projected forward from ITS own
 * read time, and folded into the element-wise minimum. The displayed /
 * affordability balance can therefore never exceed what a transaction would
 * actually have, eliminating the double-count regardless of whether a backend
 * source is raw-stored or pre-accrued. When the preview read is missing/stale
 * the helper falls back to the settlement/infrastructure minimum.
 *
 * The settlement endpoint also adds production accrual without subtracting
 * recent spends, so it can over-report after a ship / research / defense /
 * building start until the planet is re-settled on-chain; the infrastructure
 * endpoint reports the accurate on-chain spendable balance. The element-wise
 * minimum across all available sources — each projected forward to `now` — keeps
 * the UI from ever exceeding the accurate balance while still ticking up with
 * production between settlements. When a source is missing (e.g. infrastructure
 * resources are still warming, or no wallet is connected to read the chain), the
 * remaining sources are used.
 *
 * `settlementSettledAtMs` and `previewSettledAtMs` default to `now` (project to
 * self ⇒ no accrual) so a caller that already projected the snapshot, or that
 * has no settle/read time, keeps the previous behaviour.
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
  // The direct on-chain `previewResources` read is the authoritative current
  // spendable. Project it forward from its own read time so it keeps ticking
  // between reads, but it caps every other source at the chain's real balance.
  const previewSettledAt = previewSettledAtMs ?? now;
  const projectedPreview = projectResources({
    resources: previewResources,
    rates,
    caps,
    settledAtMs: previewSettledAt,
    now: freezeProjection ? previewSettledAt : now,
  });
  return minResources(minResources(projectedSettlement, projectedInfrastructure), projectedPreview);
}
