import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";
import { ReferralInviteStore, referralCommitment, referralQuota } from "./referrals";

const playerAccount = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const player = playerAccount.address;
const invitee = "0x3333333333333333333333333333333333333333";
const signerKey = "0x1111111111111111111111111111111111111111111111111111111111111111";

function testConfig(referralStorePath: string): BackendConfig {
  return {
    chainId: 84532,
    deploymentMode: "test",
    gameContractAddress: "0x4444444444444444444444444444444444444444",
    indexDbPath: ":memory:",
    indexFromBlock: 0n,
    missionResolutionEnabled: false,
    qaSyntheticStationedDefenders: false,
    randomnessCommitmentStorePath: ".data/test-randomness.json",
    referralSignerPrivateKey: signerKey,
    referralStorePath,
    resourceTokenAddresses: {
      crystal: "0x6666666666666666666666666666666666666666",
      deuterium: "0x7777777777777777777777777777777777777777",
      metal: "0x5555555555555555555555555555555555555555"
    },
    rpcSource: "custom-url",
    rpcUrl: "https://example.invalid/rpc",
    settlementContractAddress: "0x4444444444444444444444444444444444444444",
    settlementStartPriceWei: "50000000000000000",
    wsRpcSource: "missing"
  };
}

describe("referral invites", () => {
  test("generates high-entropy commitments and computes rolling redemption quota", () => {
    const code = "abcDEF_123-abcDEF_123-abcDEF_123-abcDEF_123";
    expect(referralCommitment(code)).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(referralCommitment(code)).toBe(referralCommitment(` ${code} `));

    const now = new Date("2026-07-08T12:00:00.000Z");
    const quota = referralQuota([
      { redeemedAt: "2026-07-08T11:00:00.000Z" },
      { redeemedAt: "2026-07-08T10:00:00.000Z" },
      { redeemedAt: "2026-07-08T09:00:00.000Z" }
    ], now);
    expect(quota.remainingClaims).toBe(0);
    expect(quota.nextClaimAt).toBe("2026-07-09T09:00:00.000Z");
  });

  test("serves dashboard, claim transaction recording, and invitee-bound redemption", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const storePath = join(dir, "referrals.json");
      const config = testConfig(storePath);
      const store = new ReferralInviteStore(storePath);
      let claimIndexed = false;
      let redemptionIndexed = false;
      const claimTxHash = `0x${"aa".repeat(32)}` as `0x${string}`;
      const redemptionTxHash = `0x${"bb".repeat(32)}` as `0x${string}`;
      const indexer = {
        walletSettlement: (wallet: string) => ({
          homePlanetId: wallet.toLowerCase() === player.toLowerCase() ? "1" : wallet.toLowerCase() === invitee.toLowerCase() ? "2" : null
        }),
        referralClaim: (owner: string, commitment: string, txHash: string) =>
          claimIndexed
          && owner.toLowerCase() === player.toLowerCase()
          && commitment.toLowerCase() === created.commitment.toLowerCase()
          && txHash.toLowerCase() === claimTxHash.toLowerCase()
            ? { owner, commitment, txHash }
            : null,
        referralRedemption: (owner: string, wallet: string, commitment: string, txHash: string) =>
          redemptionIndexed
          && owner.toLowerCase() === player.toLowerCase()
          && wallet.toLowerCase() === invitee.toLowerCase()
          && commitment.toLowerCase() === created.commitment.toLowerCase()
          && txHash.toLowerCase() === redemptionTxHash.toLowerCase()
            ? { owner, wallet, commitment, txHash }
            : null
      } as unknown as SettlementIndexer;
      const handler = createRequestHandler({
        config,
        indexer,
        referralStore: store,
        role: "reader"
      });
      const dashboardResponseWithoutSignature = await handler(new Request(`http://localhost/wallet/${player}/referrals`));
      expect(dashboardResponseWithoutSignature.status).toBe(200);

      const createdResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      const created = await createdResponse.json() as {
        code: string;
        commitment: string;
        expiresAt: string;
        link: string;
      };
      expect(createdResponse.status).toBe(200);
      expect(created.code.length).toBeGreaterThanOrEqual(32);
      expect(created.commitment).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(created.expiresAt).toBeDefined();
      expect(created.link).toBe(`https://veydrift.com?ref=${created.code}`);

      const duplicateCreateResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      const duplicateCreate = await duplicateCreateResponse.json() as {
        code: string;
        commitment: string;
      };
      expect(duplicateCreate.code).toBe(created.code);
      expect(duplicateCreate.commitment).toBe(created.commitment);

      const unindexedClaimResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals/claim-transaction`, {
        body: JSON.stringify({ commitment: created.commitment, txHash: claimTxHash }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(unindexedClaimResponse.status).toBe(409);

      const unclaimedRedeemResponse = await handler(new Request("http://localhost/referrals/redeem", {
        body: JSON.stringify({ code: created.code, invitee }),
        method: "POST"
      }));
      expect(unclaimedRedeemResponse.status).toBe(409);

      claimIndexed = true;
      const txResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals/claim-transaction`, {
        body: JSON.stringify({ commitment: created.commitment, txHash: claimTxHash }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(txResponse.status).toBe(200);

      const redeemResponse = await handler(new Request("http://localhost/referrals/redeem", {
        body: JSON.stringify({ code: created.code, invitee }),
        method: "POST"
      }));
      const redeem = await redeemResponse.json() as {
        commitment: string;
        r: string;
        s: string;
        signature: string;
        v: number;
      };
      expect(redeemResponse.status).toBe(200);
      expect(redeem.commitment).toBe(created.commitment);
      expect(redeem.r).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(redeem.s).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect([27, 28]).toContain(redeem.v);
      expect(redeem.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      expect(privateKeyToAccount(signerKey).address.toLowerCase()).toBe("0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a");

      const duplicateRedeemResponse = await handler(new Request("http://localhost/referrals/redeem", {
        body: JSON.stringify({ code: created.code, invitee }),
        method: "POST"
      }));
      expect(duplicateRedeemResponse.status).toBe(200);

      const beforeConfirmationDashboardResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`));
      const beforeConfirmationDashboard = await beforeConfirmationDashboardResponse.json() as {
        invite: { redemptionCount: number } | null;
        remainingRedemptions: number;
      };
      expect(beforeConfirmationDashboard.remainingRedemptions).toBe(3);
      expect(beforeConfirmationDashboard.invite?.redemptionCount).toBe(0);

      const unconfirmedRedemptionResponse = await handler(new Request("http://localhost/referrals/redeem-transaction", {
        body: JSON.stringify({ code: created.code, invitee, txHash: redemptionTxHash }),
        method: "POST"
      }));
      expect(unconfirmedRedemptionResponse.status).toBe(409);

      redemptionIndexed = true;
      const unrelatedRedemptionResponse = await handler(new Request("http://localhost/referrals/redeem-transaction", {
        body: JSON.stringify({ code: created.code, invitee, txHash: `0x${"cc".repeat(32)}` }),
        method: "POST"
      }));
      expect(unrelatedRedemptionResponse.status).toBe(409);

      const mismatchedInviteeResponse = await handler(new Request("http://localhost/referrals/redeem-transaction", {
        body: JSON.stringify({ code: created.code, invitee: "0x4444444444444444444444444444444444444444", txHash: redemptionTxHash }),
        method: "POST"
      }));
      expect(mismatchedInviteeResponse.status).toBe(409);

      const confirmedRedemptionResponse = await handler(new Request("http://localhost/referrals/redeem-transaction", {
        body: JSON.stringify({ code: created.code, invitee, txHash: redemptionTxHash }),
        method: "POST"
      }));
      expect(confirmedRedemptionResponse.status).toBe(200);

      const duplicateConfirmedRedeemResponse = await handler(new Request("http://localhost/referrals/redeem", {
        body: JSON.stringify({ code: created.code, invitee }),
        method: "POST"
      }));
      expect(duplicateConfirmedRedeemResponse.status).toBe(409);

      const dashboardResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`));
      const dashboard = await dashboardResponse.json() as {
        invite: { status: string; txHash: string | null; redemptionCount: number } | null;
        invites: Array<{ status: string; txHash: string | null; redemptionCount: number }>;
        remainingClaims: number;
        remainingRedemptions: number;
      };
      expect(dashboard.remainingClaims).toBe(2);
      expect(dashboard.remainingRedemptions).toBe(2);
      expect(dashboard.invite?.status).toBe("active");
      expect(dashboard.invite?.redemptionCount).toBe(1);
      expect(dashboard.invites).toHaveLength(1);
      expect(dashboard.invites[0]?.status).toBe("active");
      expect(dashboard.invites[0]?.txHash).toBe(claimTxHash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("expires claimed invite codes after 24 hours and creates a fresh code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const store = new ReferralInviteStore(join(dir, "referrals.json"));
      const first = store.createInvite(player, new Date("2026-07-08T12:00:00.000Z"));
      const active = store.recordClaimTransaction(player, first.commitment, `0x${"aa".repeat(32)}`);
      expect(active.status).toBe("active");
      expect(active.expiresAt).toBe("2026-07-09T12:00:00.000Z");

      const expiredDashboard = store.dashboard(player, new Date("2026-07-09T12:00:00.000Z"));
      expect(expiredDashboard.invite?.status).toBe("expired");
      expect(expiredDashboard.invite?.expired).toBe(true);
      expect(() => store.pendingRedemption(first.code, invitee, new Date("2026-07-09T12:00:00.000Z"))).toThrow("expired");

      const next = store.createInvite(player, new Date("2026-07-09T12:00:01.000Z"));
      expect(next.code).not.toBe(first.code);
      expect(next.status).toBe("pending_claim");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
