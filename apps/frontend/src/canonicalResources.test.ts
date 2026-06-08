import { describe, expect, test } from "bun:test";
import {
  canonicalSpendableResources,
  minResources,
  projectResourceAmount,
  projectResources,
} from "./canonicalResources";

const RATES = { metal: 3_600, crystal: 1_800, deuterium: 0 };
const CAPS = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };

describe("projectResourceAmount", () => {
  test("accrues production for the elapsed time", () => {
    // 3600/hour == 1/second, so 10s of elapsed time yields 10 produced.
    expect(projectResourceAmount(100, 3_600, 1_000_000, 10)).toBe(110);
  });

  test("never exceeds the storage cap", () => {
    expect(projectResourceAmount(995, 3_600, 1_000, 100)).toBe(1_000);
  });

  test("ignores negative rates and elapsed time", () => {
    expect(projectResourceAmount(100, -5, 1_000_000, 10)).toBe(100);
    expect(projectResourceAmount(100, 3_600, 1_000_000, -10)).toBe(100);
  });
});

describe("projectResources", () => {
  test("returns undefined when the balance is unavailable", () => {
    expect(
      projectResources({ resources: undefined, rates: RATES, caps: CAPS, settledAtMs: 0, now: 10_000 }),
    ).toBeUndefined();
  });

  test("accrues each resource from the settled timestamp to now", () => {
    const result = projectResources({
      resources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      rates: RATES,
      caps: CAPS,
      settledAtMs: 0,
      now: 10_000,
    });
    expect(result).toEqual({ metal: 2_127, crystal: 2_096, deuterium: 2_100 });
  });
});

describe("minResources", () => {
  test("returns the other balance when one is missing", () => {
    const balance = { metal: 1, crystal: 2, deuterium: 3 };
    expect(minResources(undefined, balance)).toEqual(balance);
    expect(minResources(balance, undefined)).toEqual(balance);
    expect(minResources(undefined, undefined)).toBeUndefined();
  });

  test("takes the element-wise minimum", () => {
    expect(
      minResources({ metal: 10, crystal: 5, deuterium: 8 }, { metal: 4, crystal: 9, deuterium: 8 }),
    ).toEqual({ metal: 4, crystal: 5, deuterium: 8 });
  });
});

describe("canonicalSpendableResources", () => {
  test("spend reduces the displayed balance: clamps to the accurate infrastructure read", () => {
    // Reproduces VEY-KANEO-392: after a spend the settlement endpoint still
    // reports the pre-spend balance (over-reporting), while infrastructure
    // reports the accurate post-spend balance. The canonical value must reflect
    // the spend (the lower, accurate number), not the over-report.
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 3_485, crystal: 3_400, deuterium: 2_100 },
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: { metal: 0, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 0,
    });
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });

  test("never over-reports above the accurate infrastructure balance", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 9_999, crystal: 9_999, deuterium: 9_999 },
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: { metal: 0, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 0,
    });
    expect(canonical!.metal).toBeLessThanOrEqual(2_117);
    expect(canonical!.crystal).toBeLessThanOrEqual(2_091);
    expect(canonical!.deuterium).toBeLessThanOrEqual(2_100);
  });

  test("keeps optimistic production accrual anchored to the post-spend base", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: CAPS,
      now: 10_000,
    });
    // Infrastructure base + 10s of accrual, still well below the over-reporting
    // settlement value, so the minimum picks the accrued infrastructure value.
    expect(canonical).toEqual({ metal: 2_127, crystal: 2_096, deuterium: 2_100 });
  });

  test("falls back to settlement when infrastructure resources are unavailable", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      rates: { metal: 0, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 0,
    });
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });

  test("returns undefined when no balance is available", () => {
    expect(
      canonicalSpendableResources({
        settlementResources: undefined,
        infrastructureResources: undefined,
        infrastructureSettledAtMs: 0,
        rates: RATES,
        caps: CAPS,
        now: 0,
      }),
    ).toBeUndefined();
  });
});

describe("canonicalSpendableResources (stale backend read / freeze projection)", () => {
  // Reproduces the VEY-KANEO-392 rework finding: during a backend (infrastructure
  // /API) outage the snapshots stop refreshing but the displayed-balance clock
  // (`now`) keeps advancing, so production accrual runs the balance up toward the
  // storage caps and over-reports (QA saw the top bar climb to the 10,000 cap).
  const LOW_CAPS = { metal: 10_000, crystal: 10_000, deuterium: 10_000 };
  const HOUR_MS = 3_600_000;

  test("without freeze, a stale snapshot drifts up toward the storage cap (the bug)", () => {
    const drifted = canonicalSpendableResources({
      settlementResources: undefined,
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: LOW_CAPS,
      // 100h elapsed with no refresh: production projects the stale read to the cap.
      now: 100 * HOUR_MS,
    });
    expect(drifted).toEqual({ metal: 10_000, crystal: 10_000, deuterium: 2_100 });
  });

  test("with freeze, the infrastructure read holds its last-known value (no cap drift)", () => {
    const frozen = canonicalSpendableResources({
      settlementResources: undefined,
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: LOW_CAPS,
      now: 100 * HOUR_MS,
      freezeProjection: true,
    });
    expect(frozen).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });

  test("during an outage the caller passes the unprojected settlement snapshot + freeze, so neither source over-reports", () => {
    // Mirrors PlayableMvpApp: when stale, `settlementResources` is the raw
    // snapshot (not the now-projected value) and infrastructure projection is
    // frozen. The result is the last-known balance, never the storage cap.
    const settlementSnapshot = { metal: 2_200, crystal: 2_150, deuterium: 2_100 };
    const canonical = canonicalSpendableResources({
      settlementResources: settlementSnapshot,
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: LOW_CAPS,
      now: 100 * HOUR_MS,
      freezeProjection: true,
    });
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
    expect(canonical!.metal).toBeLessThan(LOW_CAPS.metal);
  });

  test("freeze still falls back to the (frozen) settlement snapshot when infrastructure is unavailable", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: LOW_CAPS,
      now: 100 * HOUR_MS,
      freezeProjection: true,
    });
    // No infrastructure read to clamp against, but the settlement snapshot is the
    // unprojected last-known value (caller's responsibility while stale), so it
    // does not drift to the cap either.
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });

  test("fresh read (no freeze) still ticks production up between settlements", () => {
    const fresh = canonicalSpendableResources({
      settlementResources: { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: CAPS,
      now: 10_000,
      freezeProjection: false,
    });
    // 10s of accrual on the infrastructure base (preserves the merged UX).
    expect(fresh).toEqual({ metal: 2_127, crystal: 2_096, deuterium: 2_100 });
  });
});
