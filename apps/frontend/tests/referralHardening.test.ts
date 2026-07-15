import { describe, expect, test } from "bun:test";
import { referralSettlementBlocker } from "../src/FirstPlanetSettlementApp";
import { referralCodeForLanding } from "../src/referralStorage";

describe("referral hardening", () => {
  test("blocks settlement until the backend reports an active invite", () => {
    expect(referralSettlementBlocker("borodutch", { status: "idle" })).toContain("still loading");
    expect(referralSettlementBlocker("borodutch", { status: "loading" })).toContain("still loading");
    expect(referralSettlementBlocker("borodutch", {
      status: "resolved",
      resolution: {
        commitment: null,
        expiresAt: null,
        inviterRewardWei: null,
        message: "This invite is exhausted.",
        nextRedemptionAt: null,
        remainingRedemptions: 0,
        startPriceWei: null,
        status: "exhausted",
        valid: false
      }
    })).toBe("This invite is exhausted.");
    expect(referralSettlementBlocker("borodutch", {
      status: "resolved",
      resolution: {
        commitment: `0x${"11".repeat(32)}`,
        expiresAt: "2026-07-16T00:00:00.000Z",
        inviterRewardWei: "25000000000000000",
        message: "Invite active.",
        nextRedemptionAt: null,
        remainingRedemptions: 2,
        startPriceWei: "50000000000000000",
        status: "active",
        valid: true
      }
    })).toBeUndefined();
    expect(referralSettlementBlocker("", { status: "idle" })).toBeUndefined();
  });

  test("shows every rejected validation state before wallet submission", () => {
    for (const status of ["expired", "exhausted", "self_invite", "already_redeemed", "invalid"] as const) {
      expect(referralSettlementBlocker("borodutch", {
        status: "resolved",
        resolution: {
          commitment: null,
          expiresAt: null,
          inviterRewardWei: "6000000000000000",
          message: `Referral ${status}.`,
          nextRedemptionAt: null,
          remainingRedemptions: 0,
          startPriceWei: "12000000000000000",
          status,
          valid: false
        }
      })).toBe(`Referral ${status}.`);
    }
  });

  test("hydrates a fresh-wallet settlement from the referral link and keeps it through reload", () => {
    expect(referralCodeForLanding("?ref=fresh_usr", "")).toBe("fresh_usr");
    expect(referralCodeForLanding("?ref=fresh_usr", "old_code1")).toBe("fresh_usr");
    expect(referralCodeForLanding("", "fresh_usr")).toBe("fresh_usr");
  });

  test("persists referral intent and avoids hard-coded fiat or multiplier promises", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const storageSource = await Bun.file(new URL("../src/referralStorage.ts", import.meta.url)).text();
    const serverSource = await Bun.file(new URL("../scripts/serve.mjs", import.meta.url)).text();

    expect(storageSource).toContain("veydrift.referral.settlement-code.v1");
    expect(storageSource).toContain("veydrift.referral.claim-code.v1");
    expect(appSource).toContain("persistReferralClaimIntent");
    expect(appSource).not.toContain("$3,000");
    expect(appSource).not.toContain("$3000");
    expect(serverSource).not.toMatch(/2x|double your|reward boost/i);
  });
});
