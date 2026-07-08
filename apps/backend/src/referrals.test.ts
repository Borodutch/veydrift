import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type { SettlementIndexer } from "./indexer";
import { createRequestHandler } from "./server";
import { ReferralInviteStore, referralCommitment, referralQuota } from "./referrals";

const player = "0x2222222222222222222222222222222222222222";
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
      const indexer = {
        walletSettlement: () => ({ homePlanetId: "1" })
      } as unknown as SettlementIndexer;
      const handler = createRequestHandler({
        config,
        indexer,
        referralStore: store,
        role: "reader"
      });

      const createdResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`, {
        method: "POST"
      }));
      const created = await createdResponse.json() as {
        code: string;
        commitment: string;
        link: string;
      };
      expect(createdResponse.status).toBe(200);
      expect(created.code.length).toBeGreaterThanOrEqual(32);
      expect(created.commitment).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(created.link).toBe(`https://veydrift.com?ref=${created.code}`);

      const duplicateCreateResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals`, {
        method: "POST"
      }));
      const duplicateCreate = await duplicateCreateResponse.json() as {
        code: string;
        commitment: string;
      };
      expect(duplicateCreate.code).toBe(created.code);
      expect(duplicateCreate.commitment).toBe(created.commitment);

      const txHash = `0x${"aa".repeat(32)}`;
      const txResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals/claim-transaction`, {
        body: JSON.stringify({ commitment: created.commitment, txHash }),
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
      expect(duplicateRedeemResponse.status).toBe(409);

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
      expect(dashboard.invites[0]?.txHash).toBe(txHash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
