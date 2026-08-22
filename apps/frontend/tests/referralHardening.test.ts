import { describe, expect, test } from "bun:test";
import {
  REFERRAL_SIGNATURE_REJECTION_MESSAGE,
  referralCodeDisclosurePresentation,
  referralClaimCodeAfterDashboard,
  referralInviteActionAvailability,
  referralInviteRefreshDelay,
  referralRejectedRequestMessage,
  referralSettlementBlocker,
  referralValidationMessage,
  referralValidationPresentation,
  referralValidationTone,
} from "../src/FirstPlanetSettlementApp";
import { referralCodeForLanding } from "../src/referralStorage";
import {
  REFERRAL_CODE_FRONT_RUN_MESSAGE,
  REFERRAL_TOP_UP_UNAVAILABLE_MESSAGE,
  referralClaimErrorMessage,
  type ReferralDashboard,
  type ReferralResolution,
} from "../src/walletFlow";

function referralResolution(
  status: ReferralResolution["status"],
  remainingRedemptions: number,
): ReferralResolution {
  return {
    codeHash: `0x${"11".repeat(32)}`,
    commitment: `0x${"22".repeat(32)}`,
    expiresAt: null,
    inviterRewardWei: "6000000000000000",
    message: `Referral ${status}.`,
    nextRedemptionAt: "2026-07-17T19:01:33.000Z",
    nextTopUpAt: "2026-07-16T19:01:33.000Z",
    normalizedCode: "borodutch",
    owner: "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee",
    ownership: "reserved",
    remainingRedemptions,
    renewable: false,
    topUpAvailable: false,
    startPriceWei: "12000000000000000",
    status,
    valid: status === "active",
  };
}

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
    expired: false,
    expiresAt: null,
    link: input.link,
    nextRedemptionAt: null,
    nextTopUpAt: "2026-07-16T19:01:33.000Z",
    owner: "0xbf74483db914192bb0a9577f3d8fb29a6d4c08ee",
    redemptionCount: 0,
    remainingRedemptions: 3,
    renewable: input.status === "renewable",
    topUpAvailable: input.status === "renewable",
    status: input.status === "renewable" ? "active" : input.status,
    txHash: `0x${"33".repeat(32)}`
  };
  return {
    claimableRewardsWei: "0",
    configured: true,
    invite,
    invites: [invite],
    nextClaimAt: invite.nextTopUpAt,
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
  test("shows only the remaining-use count for active and exhausted invite codes", () => {
    expect(referralValidationMessage(referralResolution("active", 2))).toBe("Active · 2/3 uses left.");
    expect(referralValidationMessage(referralResolution("exhausted", 0)))
      .toBe("No uses left · ask the code owner to top it up.");
  });

  test("preserves distinct validation help for other invite-code states", () => {
    expect(referralValidationMessage(referralResolution("inactive", 0)))
      .toBe("Inactive · this wallet uses a different invite code.");
    expect(referralValidationMessage(referralResolution("self_invite", 0)))
      .toBe("This wallet can’t use its own invite code.");
    expect(referralValidationMessage(referralResolution("already_redeemed", 0)))
      .toBe("This wallet already used an invite code.");
    expect(referralValidationMessage(referralResolution("available", 3)))
      .toBe("Available to claim.");
    expect(referralValidationMessage(referralResolution("unavailable", 0)))
      .toBe("Invite pricing is unavailable. Try again later.");
    expect(referralValidationMessage(referralResolution("invalid", 0)))
      .toBe("Invalid invite code · use 1–24 letters, numbers, underscores, or hyphens.");
  });

  test("projects concise semantic disclosure summaries for every applied-code state", () => {
    expect(referralCodeDisclosurePresentation("", { status: "idle" })).toEqual({
      appliedLabel: "Optional",
      code: "",
      status: undefined,
      tone: "pending",
    });

    expect(referralCodeDisclosurePresentation(" borodutch ", {
      status: "resolved",
      resolution: referralResolution("active", 2),
    })).toEqual({
      appliedLabel: "Invite code: borodutch",
      code: "borodutch",
      status: "Active · 2/3 uses left.",
      tone: "success",
    });

    expect(referralCodeDisclosurePresentation("borodutch", {
      status: "resolved",
      resolution: referralResolution("inactive", 0),
    })).toMatchObject({
      appliedLabel: "Invite code: borodutch",
      status: "Inactive · this wallet uses a different invite code.",
      tone: "warning",
    });

    expect(referralCodeDisclosurePresentation("not valid!", {
      status: "resolved",
      resolution: referralResolution("invalid", 0),
    })).toMatchObject({
      appliedLabel: "Invite code: not valid!",
      status: "Invalid invite code · use 1–24 letters, numbers, underscores, or hyphens.",
      tone: "error",
    });

    expect(referralValidationPresentation({ status: "loading" })).toEqual({
      message: "Checking invite code…",
      tone: "pending",
    });
    expect(referralValidationPresentation({ status: "error", message: "RPC details" })).toEqual({
      message: "Couldn’t check this invite code. Try again shortly.",
      tone: "error",
    });
  });

  test("maps active, warning, and error invite states to normal semantic tones", () => {
    expect(referralValidationTone(referralResolution("active", 2))).toBe("success");
    expect(referralValidationTone(referralResolution("inactive", 0))).toBe("warning");
    expect(referralValidationTone(referralResolution("exhausted", 0))).toBe("warning");
    expect(referralValidationTone(referralResolution("invalid", 0))).toBe("error");
    expect(referralValidationTone(referralResolution("unavailable", 0))).toBe("error");
  });

  test("keeps the invite editor collapsed, editable, clearable, and responsive", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(appSource).toContain('<details className="referral-code-disclosure">');
    expect(appSource).toContain('<summary className="referral-code-summary">');
    expect(appSource).not.toContain('<details className="referral-code-disclosure" open');
    expect(appSource).toContain("{presentation.appliedLabel}");
    expect(appSource).toContain('onClick={() => onChange("")}');
    expect(appSource).toContain("Optional. Add a valid invite code before connecting your wallet.");
    expect(stylesSource).toContain(".referral-code-summary-status");
    expect(stylesSource).toContain(".referral-code-status-success");
    expect(stylesSource).toContain(".referral-code-status-warning");
    expect(stylesSource).toContain(".referral-code-status-error");
    expect(stylesSource).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(stylesSource).toContain("min-height: 46px");
  });

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

  test("keeps referral redemption enabled for migration-authorized first-planet starts", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    expect(appSource).toContain(
      "const referral = await referralRedemptionForSettlement(wallet.account);"
    );
    expect(appSource).not.toContain("funding.migrationContractAddress\n          ? undefined");
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
    expect(referralClaimCodeAfterDashboard("new_code", expired)).toBe("borodutch");
  });

  test("refreshes an active invite dashboard when its next top-up opens", () => {
    const active = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "active"
    });
    const nextTopUpAt = Date.parse(active.invite!.nextTopUpAt!);
    expect(referralInviteRefreshDelay(active, nextTopUpAt - 60_000)).toBe(60_000);
    expect(referralInviteRefreshDelay(active, nextTopUpAt + 1)).toBe(1_000);

    const renewable = referralDashboard({
      code: "borodutch",
      link: "https://veydrift.com?ref=borodutch",
      status: "renewable"
    });
    expect(referralInviteRefreshDelay(renewable, nextTopUpAt)).toBeUndefined();
  });

  test("atomically installs the indexed renewal dashboard returned by claim recording", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    expect(appSource).toContain("const dashboard = await recordReferralClaimTransactionAfterIndexing(");
    expect(appSource).toContain('setReferralProgram({ status: "ready", dashboard });');
    expect(appSource).toContain("uses left");
    expect(appSource).not.toContain("uses left today");
    expect(appSource).not.toContain("await refreshReferralProgram(wallet.account);");
  });

  test("keeps the permanent invite dashboard concise across top-up states", async () => {
    const appSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    expect(appSource).toContain("Top up your invite code");
    expect(appSource).toContain("Your invite code never expires");
    expect(appSource).toContain("top it up to 3 available uses");
    expect(appSource).toContain("for inviting a friend");
    expect(appSource).toContain("Your friend gets");
    expect(appSource).toContain("<RankingCommanderLink");
    expect(appSource).toContain("<RankingsTable");
    expect(appSource).toContain("expandedHistoryWallets");
    expect(appSource).toContain("Commanders you've invited");
    expect(appSource).toContain("referral-history-header");
    expect(appSource).toContain("referral-history-commander");
    expect(appSource).toContain("backendDataStoreFor(apiBaseUrl).referralHistory(wallet, historyPage, 25)");
    expect(appSource).toContain("<RankingsPagination");
    expect(appSource).not.toContain("fetchPlayerProfile(apiBaseUrl, wallet)");
    expect(appSource).toContain("Lifetime earned");
    expect(appSource).toContain("Active invite code");
    expect(appSource).not.toContain("The previous invite window expired");
    expect(appSource).not.toContain("permanently owned valid code");
    expect(appSource).not.toContain("Rewards:");
    expect(appSource).not.toContain("Owned by you ·");
    expect(appSource).not.toContain("total invite use");
    expect(appSource).not.toContain("No invite link claimed yet");
    expect(appSource).not.toContain("redemption.invitee.slice");
  });

  test("blocks code rotation and enables a 24-hour top-up on the permanent code", () => {
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
      claimCode: "borodutch",
      dashboard: expired,
      selectedCodeClaimable: true
    })).toEqual({ canClaim: true, inviteActive: true });
    expect(referralInviteActionAvailability({
      busy: false,
      claimCode: "new_code",
      dashboard: expired,
      selectedCodeClaimable: true
    })).toEqual({ canClaim: false, inviteActive: true });
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
    expect(appSource).toContain("{inviteActive && invite ? (");
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

  test("shows a specific cooldown error when a top-up races the 24-hour boundary", () => {
    expect(referralClaimErrorMessage({ data: `0xe6c55a82${"00".repeat(64)}` }))
      .toBe(REFERRAL_TOP_UP_UNAVAILABLE_MESSAGE);
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
