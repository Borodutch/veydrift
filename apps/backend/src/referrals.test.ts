import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type {
  IndexedReferralClaimEvent,
  IndexedReferralRedemptionEvent,
  IndexedReferralRewardClaimEvent
} from "./evm";
import type { SettlementIndexer } from "./indexer";
import {
  ReferralInviteStore,
  referralCodeHash,
  referralCommitment,
  referralQuota,
  referralWalletMessage,
  resolveReferralCode
} from "./referrals";
import { createRequestHandler } from "./server";

const playerAccount = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const player = playerAccount.address;
const invitee = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const signerKey = "0x1111111111111111111111111111111111111111111111111111111111111111";
const startPriceWei = "12000000000000000";

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
    referralSystemAddress: "0x8888888888888888888888888888888888888888",
    resourceTokenAddresses: {
      crystal: "0x6666666666666666666666666666666666666666",
      deuterium: "0x7777777777777777777777777777777777777777",
      metal: "0x5555555555555555555555555555555555555555"
    },
    rpcSource: "custom-url",
    rpcUrl: "https://example.invalid/rpc",
    settlementContractAddress: "0x4444444444444444444444444444444444444444",
    settlementStartPriceWei: startPriceWei,
    wsRpcSource: "missing"
  };
}

function referralIndex() {
  const claims: IndexedReferralClaimEvent[] = [];
  const redemptions: IndexedReferralRedemptionEvent[] = [];
  const rewardClaims: IndexedReferralRewardClaimEvent[] = [];
  let indexedStartPriceWei: string | null = startPriceWei;
  const indexer = {
    currentStartPriceWei: () => indexedStartPriceWei,
    referralClaim: (owner: string, commitment: string, txHash: string) => claims.find((event) =>
      event.inviter.toLowerCase() === owner.toLowerCase()
      && event.commitment.toLowerCase() === commitment.toLowerCase()
      && event.transactionHash.toLowerCase() === txHash.toLowerCase()
    ) ?? null,
    referralClaims: (owner: string) => claims.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase()),
    referralRedemption: (owner: string, wallet: string, commitment: string, txHash: string) => redemptions.find((event) =>
      event.inviter.toLowerCase() === owner.toLowerCase()
      && event.invitee.toLowerCase() === wallet.toLowerCase()
      && event.commitment.toLowerCase() === commitment.toLowerCase()
      && event.transactionHash.toLowerCase() === txHash.toLowerCase()
    ) ?? null,
    referralRedemptionsForInviter: (owner: string) => redemptions.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase()),
    referralRewardClaimsForInviter: (owner: string) => rewardClaims.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase())
  } as unknown as SettlementIndexer;
  return {
    claims,
    indexer,
    redemptions,
    rewardClaims,
    setStartPriceWei(value: string | null) { indexedStartPriceWei = value; }
  };
}

function claimEvent(commitment: `0x${string}`, txByte = "aa", claimedAt = Math.floor(Date.now() / 1_000)): IndexedReferralClaimEvent {
  return {
    eventName: "ReferralCodeClaimed",
    transactionHash: `0x${txByte.repeat(32)}`,
    blockNumber: "100",
    logIndex: "0x0",
    inviter: player,
    commitment,
    claimedAt: claimedAt.toString()
  };
}

function redemptionEvent(input: {
  commitment: `0x${string}`;
  invitee?: `0x${string}`;
  paid?: boolean;
  credited?: boolean;
  redeemedAt?: number;
  txByte?: string;
}): IndexedReferralRedemptionEvent {
  return {
    eventName: "ReferralInviteRedeemed",
    transactionHash: `0x${(input.txByte ?? "bb").repeat(32)}`,
    blockNumber: "101",
    logIndex: "0x0",
    inviter: player,
    invitee: input.invitee ?? invitee,
    commitment: input.commitment,
    rewardAmount: "6000000000000000",
    paid: input.paid ?? true,
    credited: input.credited ?? false,
    redeemedAt: (input.redeemedAt ?? Math.floor(Date.now() / 1_000)).toString()
  };
}

describe("referral invites", () => {
  test("binds commitments to the inviter and computes the exact rolling quota boundary", () => {
    const code = "borodutch";
    const other = "0x9999999999999999999999999999999999999999";
    expect(referralCodeHash(code)).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(referralCommitment(code, player)).toBe(referralCommitment(` ${code} `, player));
    expect(referralCommitment(code, player)).not.toBe(referralCommitment(code, other));

    const now = new Date("2026-07-08T12:00:00.000Z");
    const quota = referralQuota([
      { redeemedAt: "2026-07-08T11:00:00.000Z" },
      { redeemedAt: "2026-07-08T10:00:00.000Z" },
      { redeemedAt: "2026-07-08T09:00:00.000Z" }
    ], now);
    expect(quota).toEqual({
      remainingClaims: 0,
      nextClaimAt: "2026-07-09T09:00:00.000Z"
    });
    expect(referralQuota([
      { redeemedAt: "2026-07-07T12:00:00.000Z" },
      { redeemedAt: "2026-07-08T10:00:00.000Z" },
      { redeemedAt: "2026-07-08T09:00:00.000Z" }
    ], now).remainingClaims).toBe(1);
  });

  test("protects private codes, persists preimages before submission, and reconciles chain events after callback loss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const storePath = join(dir, "referrals.json");
      const store = new ReferralInviteStore(storePath);
      const config = testConfig(storePath);
      const chain = referralIndex();
      const code = "borodutch";
      const commitment = referralCommitment(code, player);
      const claimTxHash = `0x${"aa".repeat(32)}`;
      const claimSignature = await playerAccount.signMessage({
        message: referralWalletMessage(player, "claim-transaction", commitment)
      });
      const dashboardSignature = await playerAccount.signMessage({
        message: referralWalletMessage(player, "dashboard")
      });
      const handler = createRequestHandler({ config, indexer: chain.indexer, referralStore: store, role: "reader" });

      const intentResponse = await handler(new Request(`http://localhost/wallet/${player}/referrals/claim-intent`, {
        body: JSON.stringify({ code, commitment, signature: claimSignature }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(intentResponse.status).toBe(200);

      const publicPending = await (await handler(new Request(`http://localhost/wallet/${player}/referrals`))).json() as {
        invite: { code: string | null; link: string | null; status: string } | null;
      };
      expect(publicPending.invite).toMatchObject({ code: null, link: null, status: "pending_claim" });

      const unauthenticatedPrivate = await handler(new Request(`http://localhost/wallet/${player}/referrals`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(unauthenticatedPrivate.status).toBe(401);

      // Simulate successful on-chain claim followed by callback loss and backend restart.
      chain.claims.push(claimEvent(commitment, "aa"));
      const restartedStore = new ReferralInviteStore(storePath);
      const restartedHandler = createRequestHandler({
        config,
        indexer: chain.indexer,
        referralStore: restartedStore,
        role: "reader"
      });
      const privateDashboardResponse = await restartedHandler(new Request(`http://localhost/wallet/${player}/referrals`, {
        body: JSON.stringify({ signature: dashboardSignature }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      const privateDashboard = await privateDashboardResponse.json() as {
        invite: { code: string | null; link: string | null; status: string; txHash: string | null } | null;
        rewardPerUseWei: string | null;
      };
      expect(privateDashboardResponse.status).toBe(200);
      expect(privateDashboard.invite).toMatchObject({
        code,
        link: `https://veydrift.com?ref=${code}`,
        status: "active",
        txHash: claimTxHash
      });
      expect(privateDashboard.rewardPerUseWei).toBe("6000000000000000");

      const publicActive = await (await restartedHandler(new Request(`http://localhost/wallet/${player}/referrals`))).json() as {
        invite: { code: string | null; link: string | null } | null;
      };
      expect(publicActive.invite).toMatchObject({ code: null, link: null });

      const resolveResponse = await restartedHandler(new Request(
        `http://localhost/referrals/resolve?code=${code}&invitee=${invitee}`
      ));
      expect(await resolveResponse.json()).toMatchObject({
        valid: true,
        status: "active",
        startPriceWei,
        inviterRewardWei: "6000000000000000",
        commitment
      });

      // The handler was already created: changing the indexed projection must update all
      // truthful copy without a backend restart or request-time RPC read.
      chain.setStartPriceWei("18000000000000000");
      const updatedResolve = await restartedHandler(new Request(
        `http://localhost/referrals/resolve?code=${code}&invitee=${invitee}`
      ));
      expect(await updatedResolve.json()).toMatchObject({
        valid: true,
        startPriceWei: "18000000000000000",
        inviterRewardWei: "9000000000000000"
      });
      const updatedPrivateDashboard = await restartedHandler(new Request(`http://localhost/wallet/${player}/referrals`, {
        body: JSON.stringify({ signature: dashboardSignature }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(await updatedPrivateDashboard.json()).toMatchObject({
        rewardPerUseWei: "9000000000000000"
      });

      const redeemResponse = await restartedHandler(new Request("http://localhost/referrals/redeem", {
        body: JSON.stringify({ code, invitee }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      const redeem = await redeemResponse.json() as { commitment: string; signature: string };
      expect(redeemResponse.status).toBe(200);
      expect(redeem.commitment).toBe(commitment);
      expect(redeem.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

      const callbackWithoutSignature = await restartedHandler(new Request(`http://localhost/wallet/${player}/referrals/claim-transaction`, {
        body: JSON.stringify({ code, commitment, txHash: claimTxHash }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(callbackWithoutSignature.status).toBe(401);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("resolves invalid, unclaimed, self, already-used, exhausted, expired, and unavailable states", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const store = new ReferralInviteStore(join(dir, "referrals.json"));
      const chain = referralIndex();
      const code = "statecode";
      const commitment = referralCommitment(code, player);
      const now = new Date("2026-07-15T12:00:00.000Z");
      const nowSeconds = Math.floor(now.getTime() / 1_000);

      expect(resolveReferralCode({ code: "not_found", index: chain.indexer, now, startPriceWei, store }).status).toBe("invalid");
      store.recordClaimIntent(player, code, commitment, now);
      expect(resolveReferralCode({ code, index: chain.indexer, now, startPriceWei, store }).status).toBe("unclaimed");

      chain.claims.push(claimEvent(commitment, "c1", nowSeconds));
      expect(resolveReferralCode({ code, index: chain.indexer, invitee: player, now, startPriceWei, store }).status).toBe("self_invite");
      expect(resolveReferralCode({ code, index: chain.indexer, now, startPriceWei: null, store }).status).toBe("unavailable");

      chain.redemptions.push(redemptionEvent({ commitment, invitee, redeemedAt: nowSeconds - 300, txByte: "d1" }));
      expect(resolveReferralCode({ code, index: chain.indexer, invitee, now, startPriceWei, store }).status).toBe("already_redeemed");
      chain.redemptions.push(
        redemptionEvent({ commitment, invitee: "0x3000000000000000000000000000000000000002", redeemedAt: nowSeconds - 200, txByte: "d2" }),
        redemptionEvent({ commitment, invitee: "0x3000000000000000000000000000000000000003", redeemedAt: nowSeconds - 100, txByte: "d3" })
      );
      expect(resolveReferralCode({
        code,
        index: chain.indexer,
        invitee: "0x3000000000000000000000000000000000000004",
        now,
        startPriceWei,
        store
      }).status).toBe("exhausted");

      const expiredCode = "old_code1";
      const expiredCommitment = referralCommitment(expiredCode, player);
      store.recordClaimIntent(player, expiredCode, expiredCommitment, new Date(now.getTime() - 86_401_000));
      chain.claims.push(claimEvent(expiredCommitment, "c2", nowSeconds - 86_401));
      expect(resolveReferralCode({ code: expiredCode, index: chain.indexer, now, startPriceWei, store }).status).toBe("expired");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("derives rotation quota and paid, credited, and claimed reward history only from indexed events", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const store = new ReferralInviteStore(join(dir, "referrals.json"));
      const chain = referralIndex();
      const firstCode = "firstcode";
      const secondCode = "next_code";
      const firstCommitment = referralCommitment(firstCode, player);
      const secondCommitment = referralCommitment(secondCode, player);
      const nowSeconds = Math.floor(Date.now() / 1_000);
      store.recordClaimIntent(player, firstCode, firstCommitment, new Date((nowSeconds - 86_400) * 1_000));
      store.recordClaimIntent(player, secondCode, secondCommitment);
      chain.claims.push(
        claimEvent(firstCommitment, "aa", nowSeconds - 86_400),
        claimEvent(secondCommitment, "ab", nowSeconds)
      );
      chain.redemptions.push(
        redemptionEvent({ commitment: firstCommitment, invitee: "0x3000000000000000000000000000000000000001", redeemedAt: nowSeconds - 3_000, txByte: "b1" }),
        redemptionEvent({ commitment: firstCommitment, invitee: "0x3000000000000000000000000000000000000002", redeemedAt: nowSeconds - 2_000, txByte: "b2" }),
        redemptionEvent({ commitment: secondCommitment, invitee, credited: true, paid: false, redeemedAt: nowSeconds - 1_000, txByte: "b3" })
      );

      const beforeClaim = store.dashboard(player, chain.indexer, startPriceWei, true, true);
      expect(beforeClaim.remainingRedemptions).toBe(0);
      expect(beforeClaim.nextRedemptionAt).not.toBeNull();
      expect(beforeClaim.totalAccruedRewardsWei).toBe("18000000000000000");
      expect(beforeClaim.totalPaidRewardsWei).toBe("12000000000000000");
      expect(beforeClaim.claimableRewardsWei).toBe("6000000000000000");
      expect(beforeClaim.redemptions.at(-1)?.paymentStatus).toBe("credited");

      const resolution = resolveReferralCode({
        code: secondCode,
        index: chain.indexer,
        invitee: "0x3000000000000000000000000000000000000004",
        startPriceWei,
        store
      });
      expect(resolution.status).toBe("exhausted");

      chain.rewardClaims.push({
        eventName: "ReferralRewardClaimed",
        transactionHash: `0x${"cc".repeat(32)}`,
        blockNumber: "102",
        logIndex: "0x0",
        inviter: player,
        invitee,
        commitment: secondCommitment,
        recipient: player,
        amount: "6000000000000000",
        claimedAt: nowSeconds.toString()
      });
      const afterClaim = store.dashboard(player, chain.indexer, startPriceWei, true, true);
      expect(afterClaim.totalPaidRewardsWei).toBe("18000000000000000");
      expect(afterClaim.claimableRewardsWei).toBe("0");
      expect(afterClaim.redemptions.at(-1)?.paymentStatus).toBe("claimed");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("keeps legacy indexed redemptions in quota history without inventing reward truth", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const store = new ReferralInviteStore(join(dir, "referrals.json"));
      const chain = referralIndex();
      const code = "old_event";
      const commitment = referralCommitment(code, player);
      store.recordClaimIntent(player, code, commitment);
      chain.claims.push(claimEvent(commitment));
      chain.redemptions.push({
        eventName: "ReferralInviteRedeemed",
        transactionHash: `0x${"dd".repeat(32)}`,
        blockNumber: "99",
        logIndex: "0x0",
        inviter: player,
        invitee,
        commitment,
        redeemedAt: Math.floor(Date.now() / 1_000).toString()
      } as IndexedReferralRedemptionEvent);

      const dashboard = store.dashboard(player, chain.indexer, startPriceWei, true, true);
      expect(dashboard.remainingRedemptions).toBe(2);
      expect(dashboard.totalAccruedRewardsWei).toBe("0");
      expect(dashboard.totalPaidRewardsWei).toBe("0");
      expect(dashboard.claimableRewardsWei).toBe("0");
      expect(dashboard.redemptions).toEqual([
        expect.objectContaining({ rewardAmountWei: null, paymentStatus: "legacy_unknown" })
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("collapses a same-code re-claim to the latest canonical claim event", () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-"));
    try {
      const store = new ReferralInviteStore(join(dir, "referrals.json"));
      const chain = referralIndex();
      const code = "reclaimed";
      const commitment = referralCommitment(code, player);
      const nowSeconds = Math.floor(Date.now() / 1_000);
      store.recordClaimIntent(player, code, commitment);
      chain.claims.push(
        claimEvent(commitment, "a1", nowSeconds - 172_800),
        claimEvent(commitment, "a2", nowSeconds)
      );

      const dashboard = store.dashboard(player, chain.indexer, startPriceWei, true, true);
      expect(dashboard.invites).toHaveLength(1);
      expect(dashboard.invite?.txHash).toBe(`0x${"a2".repeat(32)}`);
      expect(dashboard.invite?.status).toBe("active");
      expect(resolveReferralCode({ code, index: chain.indexer, startPriceWei, store }).status).toBe("active");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
