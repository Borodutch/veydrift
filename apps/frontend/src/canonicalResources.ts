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
 */
export function canonicalSpendableResources({
  settlementResources,
  infrastructureResources,
  infrastructureSettledAtMs,
  rates,
  caps,
  now,
}: {
  settlementResources: Resources | undefined;
  infrastructureResources: Resources | undefined;
  infrastructureSettledAtMs: number;
  rates: Resources;
  caps: Resources;
  now: number;
}): Resources | undefined {
  const projectedInfrastructure = projectResources({
    resources: infrastructureResources,
    rates,
    caps,
    settledAtMs: infrastructureSettledAtMs,
    now,
  });
  return minResources(settlementResources, projectedInfrastructure);
}
