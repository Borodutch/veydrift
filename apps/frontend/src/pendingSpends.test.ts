import { describe, expect, test } from "bun:test";
import { canAfford } from "./playableMvp";
import { canonicalSpendableResources } from "./canonicalResources";
import {
  applyPendingSpends,
  createPendingSpend,
  isPendingSpendSettled,
  PENDING_SPEND_TTL_MS,
  reconcilePendingSpends,
  sumPendingSpendCosts,
  type PendingSpend,
} from "./pendingSpends";

const NO_RATES = { metal: 0, crystal: 0, deuterium: 0 };

function spend(overrides: Partial<PendingSpend> = {}): PendingSpend {
  return createPendingSpend({
    id: overrides.id ?? "s1",
    cost: overrides.cost ?? { metal: 3_200, crystal: 1_600, deuterium: 800 },
    baseline: overrides.baseline ?? { metal: 5_000, crystal: 4_000, deuterium: 3_000 },
    ratePerHour: overrides.ratePerHour ?? NO_RATES,
    now: overrides.createdAtMs ?? 0,
  });
}

describe("sumPendingSpendCosts", () => {
  test("adds costs across entries and ignores negatives", () => {
    const entries = [
      spend({ id: "a", cost: { metal: 100, crystal: 50, deuterium: 0 } }),
      spend({ id: "b", cost: { metal: 200, crystal: -10, deuterium: 25 } }),
    ];
    expect(sumPendingSpendCosts(entries)).toEqual({ metal: 300, crystal: 50, deuterium: 25 });
  });
});

describe("applyPendingSpends", () => {
  test("subtracts the outstanding cost from the balance (the headline fix)", () => {
    // Pre-spend display reads the full balance; after submitting a Shipyard
    // upgrade the displayed/gated balance must drop by the cost so the player
    // cannot launch a second unaffordable action that would revert on-chain.
    const balance = { metal: 3_485, crystal: 3_400, deuterium: 2_100 };
    const entries = [spend({ cost: { metal: 2_000, crystal: 1_000, deuterium: 0 } })];
    expect(applyPendingSpends(balance, entries)).toEqual({
      metal: 1_485,
      crystal: 2_400,
      deuterium: 2_100,
    });
  });

  test("clamps at zero and never returns a negative balance", () => {
    const balance = { metal: 100, crystal: 100, deuterium: 100 };
    const entries = [spend({ cost: { metal: 500, crystal: 0, deuterium: 0 } })];
    expect(applyPendingSpends(balance, entries)).toEqual({ metal: 0, crystal: 100, deuterium: 100 });
  });

  test("returns the balance unchanged with no pending spends", () => {
    const balance = { metal: 1, crystal: 2, deuterium: 3 };
    expect(applyPendingSpends(balance, [])).toEqual(balance);
  });

  test("passes through an undefined balance", () => {
    expect(applyPendingSpends(undefined, [spend()])).toBeUndefined();
  });
});

describe("isPendingSpendSettled", () => {
  const entry = spend({
    cost: { metal: 3_200, crystal: 1_600, deuterium: 800 },
    baseline: { metal: 5_000, crystal: 4_000, deuterium: 3_000 },
    ratePerHour: NO_RATES,
    createdAtMs: 0,
  });

  test("not settled while infrastructure still reports the pre-spend balance", () => {
    expect(isPendingSpendSettled(entry, { metal: 5_000, crystal: 4_000, deuterium: 3_000 }, 1_000)).toBe(false);
  });

  test("settled once infrastructure reflects the spend (drops past the halfway point)", () => {
    // baseline - cost = {1800, 2400, 2200}; halfway thresholds = {3400, 3200, 2600}.
    expect(isPendingSpendSettled(entry, { metal: 1_800, crystal: 2_400, deuterium: 2_200 }, 1_000)).toBe(true);
  });

  test("requires every spent resource to have dropped, not just one", () => {
    // metal dropped past threshold but crystal is still at the pre-spend level.
    expect(isPendingSpendSettled(entry, { metal: 1_800, crystal: 4_000, deuterium: 2_200 }, 1_000)).toBe(false);
  });

  test("not settled when infrastructure is unavailable", () => {
    expect(isPendingSpendSettled(entry, undefined, 1_000)).toBe(false);
  });

  test("tolerates production accrued since the spend", () => {
    // 3600/hour metal == 1/second; after 100s the read can be 100 higher and
    // still count as settled once it crosses the production-adjusted threshold.
    const accruing = spend({
      cost: { metal: 1_000, crystal: 0, deuterium: 0 },
      baseline: { metal: 5_000, crystal: 0, deuterium: 0 },
      ratePerHour: { metal: 3_600, crystal: 0, deuterium: 0 },
      createdAtMs: 0,
    });
    // threshold at 100s = 5000 + 100 - 500 = 4600; a 4550 read is settled.
    expect(isPendingSpendSettled(accruing, { metal: 4_550, crystal: 0, deuterium: 0 }, 100_000)).toBe(true);
    // a 4700 read (spend not yet reflected) is not settled.
    expect(isPendingSpendSettled(accruing, { metal: 4_700, crystal: 0, deuterium: 0 }, 100_000)).toBe(false);
  });
});

describe("reconcilePendingSpends", () => {
  test("keeps spends the backend has not yet reflected", () => {
    const entries = [spend({ baseline: { metal: 5_000, crystal: 4_000, deuterium: 3_000 } })];
    const kept = reconcilePendingSpends({
      entries,
      infrastructure: { metal: 5_000, crystal: 4_000, deuterium: 3_000 },
      now: 1_000,
    });
    expect(kept).toHaveLength(1);
  });

  test("drops spends once the backend reflects them (prevents double-counting)", () => {
    const entries = [spend()];
    const kept = reconcilePendingSpends({
      entries,
      infrastructure: { metal: 1_800, crystal: 2_400, deuterium: 2_200 },
      now: 1_000,
    });
    expect(kept).toHaveLength(0);
  });

  test("drops spends after the TTL backstop even if undetected (self-heals)", () => {
    const entries = [spend({ createdAtMs: 0 })];
    const kept = reconcilePendingSpends({
      entries,
      infrastructure: undefined, // never observed a settle
      now: PENDING_SPEND_TTL_MS + 1,
    });
    expect(kept).toHaveLength(0);
  });

  test("keeps subtracting through an infrastructure outage until the TTL", () => {
    // The QA failure mode: infra read unavailable/stale, so settlement would
    // over-report. The pending spend stays subtracted for the whole TTL window.
    const entries = [spend({ createdAtMs: 0 })];
    const kept = reconcilePendingSpends({
      entries,
      infrastructure: undefined,
      now: PENDING_SPEND_TTL_MS - 1,
    });
    expect(kept).toHaveLength(1);
  });
});

describe("end-to-end gating (VEY-392 acceptance criteria)", () => {
  const RATES = { metal: 0, crystal: 0, deuterium: 0 };
  const CAPS = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };

  test("a spend drops the displayed balance and gates an unaffordable follow-up", () => {
    // Pre-spend: settlement over-reports, infrastructure is accurate; the player
    // can afford a Shipyard upgrade (Metal 3200 / Crystal 1600 / Deut 800).
    const canonical = canonicalSpendableResources({
      settlementResources: { metal: 6_000, crystal: 6_000, deuterium: 6_000 },
      infrastructureResources: { metal: 3_485, crystal: 3_400, deuterium: 2_100 },
      infrastructureSettledAtMs: 0,
      rates: RATES,
      caps: CAPS,
      now: 0,
    })!;
    const upgradeCost = { metal: 3_200, crystal: 1_600, deuterium: 800 };
    expect(canAfford(canonical, upgradeCost)).toBe(true);

    // The player starts the upgrade; the cost is recorded as a pending spend
    // before the backend infrastructure read reflects it.
    const pending = [
      createPendingSpend({
        id: "upgrade",
        cost: upgradeCost,
        baseline: { metal: 3_485, crystal: 3_400, deuterium: 2_100 },
        ratePerHour: RATES,
        now: 0,
      }),
    ];
    const afterSpend = applyPendingSpends(canonical, pending)!;

    // Displayed balance dropped by the cost (no over-report)...
    expect(afterSpend).toEqual({ metal: 285, crystal: 1_800, deuterium: 1_300 });
    // ...and a second upgrade of the same cost is now correctly gated off,
    // preventing a tx that would revert with InsufficientResources on-chain.
    expect(canAfford(afterSpend, upgradeCost)).toBe(false);
  });
});

describe("createPendingSpend", () => {
  test("normalizes negative costs and sets the TTL", () => {
    const entry = createPendingSpend({
      id: "x",
      cost: { metal: -5, crystal: 10, deuterium: 0 },
      baseline: { metal: 1, crystal: 1, deuterium: 1 },
      ratePerHour: NO_RATES,
      now: 1_000,
    });
    expect(entry.cost).toEqual({ metal: 0, crystal: 10, deuterium: 0 });
    expect(entry.expiresAtMs).toBe(1_000 + PENDING_SPEND_TTL_MS);
  });
});
