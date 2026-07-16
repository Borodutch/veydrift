import { describe, expect, test } from "bun:test";
import {
  REFERRAL_SIGNATURE_REJECTION_MESSAGE,
  referralClaimCodeAfterDashboard,
  referralInviteActionAvailability,
  referralRejectedRequestMessage,
  referralSettlementBlocker
} from "../src/FirstPlanetSettlementApp";
import { referralCodeForLanding } from "../src/referralStorage";
import {
  REFERRAL_CODE_FRONT_RUN_MESSAGE,
  referralClaimErrorMessage,
  type ReferralDashboard,
} from "../src/walletFlow";

function referralDashboard(input: {
  code: string;
  link: string;
  status: "active" | "renewable" | "owned";
}): ReferralDashboard {
  const invite = {
    claimedAt: "2026-07-15T19:01:33.000Z",
    code: input.code,
    codeHash: `0x${"11".repeat(32)}`,
    commitment: `0x${"22".repeat(32)}`,
    expired: input.status !== "active",
    expiresAt: "2026-07-16T19:01:33.000Z",
    link: input.link,
    nextRedemptionAt: null,
    owner: "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee",
    redemptionCount: 0,
    remainingRedemptions: 3,
    renewable: input.status === "renewable",
    status: input.status,
    txHash: `0x${"33".repeat(32)}`
  };
  return {
    claimableRewardsWei: "0",
    configured: true,
    invite,
    invites: [invite],
    nextClaimAt: input.status === "active" ? invite.expiresAt : null,
    nextRedemptionAt: null,
    redemptions: [],
    remainingClaims: 3,
    remainingRedemptions: 3,
    rewardPerUseWei: "6000000000000000",
    totalAccruedRewardsWei: "0",
    totalPaidRewardsWei: "0"
  };
}

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

  test("replaces stale claim drafts with canonical active invite details", () => {
    const active = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "active"
    });
    expect(referralClaimCodeAfterDashboard("Z9VVTDYWW", active)).toBe("borodutch");

    const expired = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "renewable"
    });
    expect(referralClaimCodeAfterDashboard("new_code", expired)).toBe("new_code");
  });

  test("blocks active-window rotation and enables expired-window claims", () => {
    const active = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "active"
    });
    expect(referralInviteActionAvailability({
      busy: false,
      claimCode: "borodutch",
      dashboard: active,
      selectedCodeClaimable: true
    })).toEqual({ canClaim: false, inviteActive: true });

    const expired = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "renewable"
    });
    expect(referralInviteActionAvailability({
      busy: false,
      claimCode: "new_code",
      dashboard: expired,
      selectedCodeClaimable: true
    })).toEqual({ canClaim: true, inviteActive: false });
  });

  test("shows active invite details directly and removes the reveal gate", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    expect(REFERRAL_SIGNATURE_REJECTION_MESSAGE).toBe("Wallet signature rejected — no transaction was sent");
    expect(referralRejectedRequestMessage("signature")).toBe(REFERRAL_SIGNATURE_REJECTION_MESSAGE);
    expect(referralRejectedRequestMessage("claim-transaction")).toBe("Referral claim transaction was rejected.");
    expect(appSource).not.toContain("Reveal invite details");
    expect(appSource).not.toContain("Unlock invite");
    expect(appSource).not.toContain("fetchPrivateReferralDashboard");
    expect(appSource).not.toContain("referral:reveal");
    expect(appSource).toContain("{inviteActive ? (");
    expect(appSource).toContain("Copy code");
    expect(appSource).toContain("Copy link");
    expect(appSource).toContain("Share on X");
    expect(appSource).not.toContain("Paste image in X");
    expect(appSource).not.toContain("Attach image in X");
    expect(appSource).not.toContain("disabled={!xShareImage");
    expect(appSource).not.toContain("Invite image downloaded. Attach it in the X composer that opened.");
  });

  test("shows a specific code-race error when another wallet claims first", () => {
    expect(referralClaimErrorMessage({ data: `0xe1c8233f${"00".repeat(64)}` }))
      .toBe(REFERRAL_CODE_FRONT_RUN_MESSAGE);
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
