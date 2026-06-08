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
 * The settlement endpoint adds production accrual without subtracting recent
 * spends, so it can over-report after a ship / research / defense / building
 * start until the planet is re-settled on-chain. The infrastructure endpoint
 * (`/wallet/<addr>/infrastructure`) returns the accurate on-chain spendable
 * balance. Taking the element-wise minimum of the two — each projected forward
 * to `now` — keeps the UI from ever exceeding the accurate balance while still
 * ticking up with production between settlements. When one source is missing
 * (e.g. infrastructure resources are still warming), the other is used as-is.
 *
 * `freezeProjection` stops the forward production accrual. The displayed balance
 * is projected forward by a free-running `now` clock so it ticks up between
 * backend reads; but when the backend resource read is stale or unavailable
 * (API/RPC outage, backend sync paused) the underlying snapshots stop
 * refreshing while `now` keeps advancing, which would run the balance up toward
 * the storage caps and over-report a spendable balance the player does not have.
 * In that case the caller passes `freezeProjection: true` (and the unprojected
 * settlement snapshot as `settlementResources`) so neither source accrues past
 * its last known value. Production only ticks up while reads are fresh.
 */
export function canonicalSpendableResources({
  settlementResources,
  infrastructureResources,
  infrastructureSettledAtMs,
  rates,
  caps,
  now,
  freezeProjection = false,
}: {
  settlementResources: Resources | undefined;
  infrastructureResources: Resources | undefined;
  infrastructureSettledAtMs: number;
  rates: Resources;
  caps: Resources;
  now: number;
  freezeProjection?: boolean;
}): Resources | undefined {
  const projectedInfrastructure = projectResources({
    resources: infrastructureResources,
    rates,
    caps,
    settledAtMs: infrastructureSettledAtMs,
    // Freeze => project to the snapshot's own settle time (elapsed 0) so the
    // accurate read is used as-is instead of drifting toward storage caps.
    now: freezeProjection ? infrastructureSettledAtMs : now,
  });
  return minResources(settlementResources, projectedInfrastructure);
}
