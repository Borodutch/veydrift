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

describe("canonicalSpendableResources (live tick from the snapshot read time)", () => {
  // The backend resource snapshots are live `previewResources` reads (already
  // accrued + capped), so the caller anchors them to the snapshot *read time*.
  // These cases exercise the inter-poll live tick: given a snapshot read at the
  // anchor, the canonical value accrues forward to `now` exactly once (both
  // sources share the read-time anchor, so the element-wise minimum is a single
  // projection — never the VEY-318 double-count from anchoring to `lastSettledAt`).
  const HOUR_MS = 3_600_000;
  const TOPBAR_CAPS = { metal: 75_000, crystal: 20_000, deuterium: 20_000 };

  test("accrues uncollected production forward from the read time, counted once", () => {
    // previewResources read 1h before `now`, with Metal/Crystal at 0.
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 0, crystal: 0, deuterium: 2_531 },
      settlementSettledAtMs: 0,
      infrastructureResources: { metal: 0, crystal: 0, deuterium: 2_531 },
      infrastructureSettledAtMs: 0,
      rates: { metal: 1_346, crystal: 627, deuterium: 110 },
      caps: TOPBAR_CAPS,
      now: HOUR_MS,
    });
    // 1h of accrual at the shown rates, counted exactly once: both sources share
    // the same read-time anchor and values, so the element-wise minimum is the
    // single projection — no double counting.
    expect(canonical).toEqual({ metal: 1_346, crystal: 627, deuterium: 2_641 });
  });

  test("ticks up as `now` advances past the read time", () => {
    const base = {
      settlementResources: { metal: 100, crystal: 100, deuterium: 100 },
      settlementSettledAtMs: 0,
      infrastructureResources: { metal: 100, crystal: 100, deuterium: 100 },
      infrastructureSettledAtMs: 0,
      rates: { metal: 3_600, crystal: 0, deuterium: 0 },
      caps: CAPS,
    };
    const at10s = canonicalSpendableResources({ ...base, now: 10_000 });
    const at40s = canonicalSpendableResources({ ...base, now: 40_000 });
    expect(at10s?.metal).toBe(110);
    expect(at40s?.metal).toBe(140);
    expect(at40s!.metal).toBeGreaterThan(at10s!.metal);
  });

  test("caps accrued production at storage", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 9_990, crystal: 0, deuterium: 0 },
      settlementSettledAtMs: 0,
      infrastructureResources: { metal: 9_990, crystal: 0, deuterium: 0 },
      infrastructureSettledAtMs: 0,
      rates: { metal: 3_600, crystal: 0, deuterium: 0 },
      caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      now: HOUR_MS, // +3_600 would exceed the cap
    });
    expect(canonical?.metal).toBe(10_000);
  });

  test("freeze holds the snapshot at its read time even with settlementSettledAtMs supplied", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 2_200, crystal: 2_150, deuterium: 2_100 },
      settlementSettledAtMs: 0,
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      now: 100 * HOUR_MS,
      freezeProjection: true,
    });
    // No drift toward the cap despite 100h of `now` advancing while frozen.
    expect(canonical).toEqual({ metal: 2_200, crystal: 2_150, deuterium: 2_100 });
  });

  test("defaults settlementSettledAtMs to now (no accrual) for back-compat", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: CAPS,
      now: 10_000,
    });
    // Without a settle time the settlement snapshot is used as-is.
    expect(canonical).toEqual({ metal: 5_000, crystal: 5_000, deuterium: 5_000 });
  });
});

describe("canonicalSpendableResources (on-chain previewResources is authoritative)", () => {
  // The direct on-chain `previewResources(planetId)` read is the contract's real
  // current spendable balance, so when a fresh read is available it is used
  // OUTRIGHT — never folded into a min with the backend snapshots, which are
  // unreliable in BOTH directions. A min would clamp to whichever backend source
  // is wrong: too-high (double-counted projection -> over-report) OR too-low (a
  // snapshot lagging the chain -> under-report, the current VEY-318 failure).
  const HOUR_MS = 3_600_000;
  const TOPBAR_CAPS = { metal: 75_000, crystal: 20_000, deuterium: 20_000 };

  test("uses the on-chain preview when a LAGGING backend snapshot would under-report (live planet-83 repro)", () => {
    // Live evidence (2026-06-09, planet 83, wallet 0x3727…8a69, contract 0xf12f):
    // the backend infrastructure read lagged the chain — metal 20 / crystal 5_484
    // vs on-chain previewResources metal 211 / crystal 5_538. A min(settlement,
    // infrastructure) clamped the top bar to the stored ~20 metal and the
    // uncollected production never appeared. The chain read is authoritative.
    const laggingBackend = { metal: 20, crystal: 5_484, deuterium: 51 };
    const onChainPreview = { metal: 211, crystal: 5_538, deuterium: 76 };
    const canonical = canonicalSpendableResources({
      settlementResources: laggingBackend,
      settlementSettledAtMs: HOUR_MS,
      infrastructureResources: laggingBackend,
      infrastructureSettledAtMs: HOUR_MS,
      previewResources: onChainPreview,
      previewSettledAtMs: HOUR_MS,
      rates: { metal: 419, crystal: 121, deuterium: 52 },
      caps: TOPBAR_CAPS,
      now: HOUR_MS,
    });
    expect(canonical).toEqual(onChainPreview);
  });

  test("uses the on-chain preview when an OVER-projected backend snapshot would over-report", () => {
    // Both backend sources were already accrued to `now` (crystal 10,155) but
    // carry an hour-old settle time, so projecting them forward adds ~753 crystal
    // a second time -> 10,908. The preview read (10,155) is used instead.
    const overReported = { metal: 6_000, crystal: 10_908, deuterium: 4_000 };
    const canonical = canonicalSpendableResources({
      settlementResources: overReported,
      settlementSettledAtMs: 0,
      infrastructureResources: overReported,
      infrastructureSettledAtMs: 0,
      previewResources: { metal: 6_000, crystal: 10_155, deuterium: 4_000 },
      previewSettledAtMs: HOUR_MS,
      rates: { metal: 0, crystal: 753, deuterium: 0 },
      caps: TOPBAR_CAPS,
      now: HOUR_MS,
    });
    expect(canonical).toEqual({ metal: 6_000, crystal: 10_155, deuterium: 4_000 });
  });

  test("ticks the preview forward from its own read time between reads", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 100_000, crystal: 100_000, deuterium: 100_000 },
      infrastructureResources: { metal: 100_000, crystal: 100_000, deuterium: 100_000 },
      infrastructureSettledAtMs: 0,
      previewResources: { metal: 1_000, crystal: 1_000, deuterium: 1_000 },
      // Preview read 10s ago; 3600/h == 1/s so it should accrue ~10 by now.
      previewSettledAtMs: 0,
      rates: { metal: 3_600, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 10_000,
    });
    expect(canonical).toEqual({ metal: 1_010, crystal: 1_000, deuterium: 1_000 });
  });

  test("caps the projected preview at storage", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: undefined,
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      previewResources: { metal: 9_990, crystal: 0, deuterium: 0 },
      previewSettledAtMs: 0,
      rates: { metal: 3_600, crystal: 0, deuterium: 0 },
      caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      now: HOUR_MS, // would accrue 3,600 metal but the 10,000 cap clamps it
    });
    expect(canonical!.metal).toBe(10_000);
  });

  test("a fresh preview keeps ticking even when the backend read is stale (freeze applies only to the fallback)", () => {
    // backendResourceReadStale signals a BACKEND outage; it must not freeze a
    // working on-chain read. The caller's staleness gate drops the preview once
    // the chain read itself goes stale, bounding any forward drift.
    const canonical = canonicalSpendableResources({
      settlementResources: undefined,
      infrastructureResources: undefined,
      infrastructureSettledAtMs: 0,
      previewResources: { metal: 1_000, crystal: 0, deuterium: 0 },
      previewSettledAtMs: 0,
      rates: { metal: 3_600, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 10_000, // 10s -> +10 metal
      freezeProjection: true,
    });
    expect(canonical!.metal).toBe(1_010);
  });

  test("falls back to the settlement/infrastructure minimum when no preview read is available", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      previewResources: undefined,
      rates: { metal: 0, crystal: 0, deuterium: 0 },
      caps: CAPS,
      now: 0,
    });
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });

  test("fallback freezes the backend snapshot during an outage (no drift toward the cap)", () => {
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      settlementSettledAtMs: 0,
      infrastructureResources: { metal: 2_117, crystal: 2_091, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      previewResources: undefined,
      rates: RATES,
      caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
      now: 100 * HOUR_MS,
      freezeProjection: true,
    });
    expect(canonical).toEqual({ metal: 2_117, crystal: 2_091, deuterium: 2_100 });
  });
});

describe("VEY-318 displayed resources while a build is queued", () => {
  // Nikita's repro (2026-06-08): top-bar Metal/Crystal dropped to 0 and stopped
  // accruing while a crystal-mine build was queued, "coming back to normal" only
  // when the build completed. Starting a build re-settles the planet with
  // Metal/Crystal drained near 0. The displayed balance is now the single polled
  // canonical source of truth with no client-side optimistic subtraction layered
  // on top (VEY-KANEO-430), so the regression to guard is that the polled
  // canonical balance itself ticks up between reads instead of freezing at the
  // drained settle value until the next settlement.
  const HOUR_MS = 3_600_000;
  const rates = { metal: 1_346, crystal: 627, deuterium: 110 };
  const caps = { metal: 75_000, crystal: 20_000, deuterium: 20_000 };

  function displayedWhileQueued(elapsedMs: number) {
    return canonicalSpendableResources({
      settlementResources: { metal: 10, crystal: 5, deuterium: 2_531 },
      settlementSettledAtMs: 0,
      infrastructureResources: { metal: 10, crystal: 5, deuterium: 2_531 },
      infrastructureSettledAtMs: 0,
      rates,
      caps,
      now: elapsedMs,
    });
  }

  test("displayed balance grows during an active queue instead of freezing at the drained settle value", () => {
    // Right at settle the balance is the drained read value the build left behind.
    expect(displayedWhileQueued(0)).toEqual({ metal: 10, crystal: 5, deuterium: 2_531 });

    const after1h = displayedWhileQueued(HOUR_MS)!;
    const after2h = displayedWhileQueued(2 * HOUR_MS)!;
    // It does NOT stay frozen: production accrues from the on-chain settle time.
    expect(after1h.metal).toBeGreaterThan(10);
    expect(after1h.crystal).toBeGreaterThan(5);
    // ...and keeps climbing as time passes while the build is still queued.
    expect(after2h.metal).toBeGreaterThan(after1h.metal);
    expect(after2h.crystal).toBeGreaterThan(after1h.crystal);
  });
});
