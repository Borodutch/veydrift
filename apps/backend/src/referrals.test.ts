import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  normalizeReferralCode,
  ReferralInviteStore,
  referralCodeHash,
  referralCommitment,
  referralQuota,
  referralWalletMessage,
  resolveReferralCode,
  type ReferralChainIndex
} from "./referrals";
import { createRequestHandler } from "./server";

const playerAccount = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const player = playerAccount.address;
const other = "0x9999999999999999999999999999999999999999" as const;
const invitee = "0x3333333333333333333333333333333333333333" as const;
const signerKey = "0x1111111111111111111111111111111111111111111111111111111111111111";
const startPriceWei = "12000000000000000";

function testConfig(): BackendConfig {
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
  const indexer = {
    currentStartPriceWei: () => startPriceWei,
    referralClaim: (owner: string, commitment: string, txHash: string) => claims.find((event) =>
      event.inviter.toLowerCase() === owner.toLowerCase()
      && event.commitment.toLowerCase() === commitment.toLowerCase()
      && event.transactionHash.toLowerCase() === txHash.toLowerCase()
    ) ?? null,
    referralClaims: (owner: string) => claims.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase()),
    referralClaimsByCodeHash: (codeHash: string) => claims.filter((event) => event.codeHash.toLowerCase() === codeHash.toLowerCase()),
    referralRedemption: (owner: string, wallet: string, commitment: string, txHash: string) => redemptions.find((event) =>
      event.inviter.toLowerCase() === owner.toLowerCase()
      && event.invitee.toLowerCase() === wallet.toLowerCase()
      && event.commitment.toLowerCase() === commitment.toLowerCase()
      && event.transactionHash.toLowerCase() === txHash.toLowerCase()
    ) ?? null,
    referralRedemptionsForInviter: (owner: string) => redemptions.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase()),
    referralRedemptionsForInvitee: (wallet: string) => redemptions.filter((event) => event.invitee.toLowerCase() === wallet.toLowerCase()),
    referralRewardClaimsForInviter: (owner: string) => rewardClaims.filter((event) => event.inviter.toLowerCase() === owner.toLowerCase())
  } as unknown as SettlementIndexer & ReferralChainIndex;
  return { claims, indexer, redemptions, rewardClaims };
}

function claimEvent(input: {
  code: string;
  owner?: `0x${string}`;
  activatedAt?: number;
  blockNumber?: number;
  txByte?: string;
}): IndexedReferralClaimEvent {
  const code = normalizeReferralCode(input.code);
  const owner = input.owner ?? player;
  const activatedAt = input.activatedAt ?? Math.floor(Date.now() / 1_000);
  return {
    eventName: "ReferralInviteWindowActivated",
    transactionHash: `0x${(input.txByte ?? "aa").repeat(32)}`,
    blockNumber: String(input.blockNumber ?? 100),
    logIndex: "0x0",
    inviter: owner,
    code,
    codeHash: referralCodeHash(code),
    commitment: referralCommitment(code, owner),
    claimedAt: String(activatedAt),
    activeUntil: String(activatedAt + 86_400),
    migrated: false
  };
}

function redemptionEvent(input: {
  code: string;
  invitee?: `0x${string}`;
  owner?: `0x${string}`;
  paid?: boolean;
  credited?: boolean;
  redeemedAt?: number;
  txByte?: string;
}): IndexedReferralRedemptionEvent {
  const owner = input.owner ?? player;
  return {
    eventName: "ReferralInviteRedeemed",
    transactionHash: `0x${(input.txByte ?? "bb").repeat(32)}`,
    blockNumber: "101",
    logIndex: "0x0",
    inviter: owner,
    invitee: input.invitee ?? invitee,
    commitment: referralCommitment(input.code, owner),
    rewardAmount: "6000000000000000",
    paid: input.paid ?? true,
    credited: input.credited ?? false,
    redeemedAt: String(input.redeemedAt ?? Math.floor(Date.now() / 1_000))
  };
}

describe("referral invites", () => {
  test("normalizes case, validates the 1–24 URL-safe contract, and preserves inviter-bound commitments", () => {
    expect(normalizeReferralCode(" My_Code-1 ")).toBe("my_code-1");
    expect(referralCodeHash("My_Code-1")).toBe(referralCodeHash("my_code-1"));
    expect(referralCommitment("My_Code-1", player)).toBe(referralCommitment("my_code-1", player));
    expect(referralCommitment("my_code-1", player)).not.toBe(referralCommitment("my_code-1", other));
    expect(() => normalizeReferralCode("")).toThrow("1–24");
    expect(() => normalizeReferralCode("contains space")).toThrow("1–24");
    expect(() => normalizeReferralCode("abcdefghijklmnopqrstuvwxy")).toThrow("1–24");
  });

  test("computes the exact inviter-wide rolling quota boundary", () => {
    const now = new Date("2026-07-08T12:00:00.000Z");
    expect(referralQuota([
      { redeemedAt: "2026-07-08T11:00:00.000Z" },
      { redeemedAt: "2026-07-08T10:00:00.000Z" },
      { redeemedAt: "2026-07-08T09:00:00.000Z" }
    ], now)).toEqual({
      remainingClaims: 0,
      nextClaimAt: "2026-07-09T09:00:00.000Z"
    });
    expect(referralQuota([
      { redeemedAt: "2026-07-07T12:00:00.000Z" },
      { redeemedAt: "2026-07-08T10:00:00.000Z" },
      { redeemedAt: "2026-07-08T09:00:00.000Z" }
    ], now).remainingClaims).toBe(1);
  });

  test("derives available, owned, reserved, renewable, active, and exhausted truth from chain events", () => {
    const chain = referralIndex();
    const now = new Date("2026-07-08T12:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1_000);

    expect(resolveReferralCode({ code: "Available", index: chain.indexer, wallet: player, now, startPriceWei }).status).toBe("available");

    chain.claims.push(claimEvent({ code: "Owned_Code", activatedAt: nowSeconds - 86_400, blockNumber: 100 }));
    const owned = resolveReferralCode({ code: "OWNED_CODE", index: chain.indexer, wallet: player, now, startPriceWei });
    expect(owned).toMatchObject({ ownership: "owned_by_you", renewable: true, status: "inactive" });
    const reserved = resolveReferralCode({ code: "owned_code", index: chain.indexer, wallet: other, now, startPriceWei });
    expect(reserved).toMatchObject({ ownership: "reserved", renewable: false, status: "inactive" });

    chain.claims.push(claimEvent({ code: "Owned_Code", activatedAt: nowSeconds - 60, blockNumber: 101, txByte: "ac" }));
    expect(resolveReferralCode({ code: "owned_code", index: chain.indexer, invitee, now, startPriceWei })).toMatchObject({
      status: "active",
      valid: true,
      ownership: "reserved"
    });

    chain.redemptions.push(
      redemptionEvent({ code: "owned_code", redeemedAt: nowSeconds - 3_000, txByte: "b1" }),
      redemptionEvent({ code: "owned_code", invitee: "0x4444444444444444444444444444444444444444", redeemedAt: nowSeconds - 2_000, txByte: "b2" }),
      redemptionEvent({ code: "owned_code", invitee: "0x5555555555555555555555555555555555555555", redeemedAt: nowSeconds - 1_000, txByte: "b3" })
    );
    expect(resolveReferralCode({
      code: "owned_code",
      index: chain.indexer,
      invitee: "0x6666666666666666666666666666666666666666",
      now,
      startPriceWei
    }).status).toBe("exhausted");
  });

  test("enforces chain-derived once-per-invitee truth across rotated codes", () => {
    const chain = referralIndex();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    chain.claims.push(claimEvent({ code: "second", activatedAt: nowSeconds - 30 }));
    chain.redemptions.push(redemptionEvent({ code: "first", invitee, redeemedAt: nowSeconds - 60 }));
    expect(resolveReferralCode({ code: "second", index: chain.indexer, invitee, startPriceWei }).status).toBe("already_redeemed");
  });

  test("reconstructs the current commitment by activation time and keeps historical codes inactive", () => {
    const chain = referralIndex();
    const now = new Date("2026-07-08T12:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1_000);

    // Migration batches need not be ordered by activation time. The contract keeps the
    // greatest activatedAt value as the current commitment even when that event arrived first.
    chain.claims.push(
      claimEvent({ code: "current", activatedAt: nowSeconds - 30, blockNumber: 100, txByte: "c1" }),
      claimEvent({ code: "historical", activatedAt: nowSeconds - 60, blockNumber: 101, txByte: "c2" })
    );

    expect(resolveReferralCode({ code: "current", index: chain.indexer, wallet: player, now, startPriceWei }))
      .toMatchObject({ status: "active", ownership: "owned_by_you" });
    expect(resolveReferralCode({ code: "historical", index: chain.indexer, wallet: player, now, startPriceWei }))
      .toMatchObject({ status: "inactive", ownership: "owned_by_you", renewable: false });

    const dashboard = new ReferralInviteStore().dashboard(player, chain.indexer, startPriceWei, true, false, now);
    expect(dashboard.invite).toMatchObject({ code: "current", status: "active" });
    expect(dashboard.invites.map((item) => item.code)).toEqual(["historical", "current"]);
  });

  test("builds dashboards solely from indexed activation, redemption, and reward events", () => {
    const chain = referralIndex();
    const store = new ReferralInviteStore("/path/that/must/not/be/read.json");
    const nowSeconds = Math.floor(Date.now() / 1_000);
    chain.claims.push(
      claimEvent({ code: "first", activatedAt: nowSeconds - 90_000, blockNumber: 100 }),
      claimEvent({ code: "Second_Code", activatedAt: nowSeconds - 60, blockNumber: 101, txByte: "ac" })
    );
    chain.redemptions.push(redemptionEvent({ code: "second_code", paid: false, credited: true }));
    chain.rewardClaims.push({
      eventName: "ReferralRewardClaimed",
      transactionHash: `0x${"cc".repeat(32)}`,
      blockNumber: "102",
      logIndex: "0x0",
      inviter: player,
      invitee,
      commitment: referralCommitment("second_code", player),
      recipient: player,
      amount: "6000000000000000",
      claimedAt: String(nowSeconds)
    });

    const dashboard = store.dashboard(player, chain.indexer, startPriceWei, true, true);
    expect(dashboard.invite).toMatchObject({ code: "second_code", status: "active" });
    expect(dashboard.invites.map((item) => item.code)).toEqual(["first", "second_code"]);
    expect(dashboard.totalAccruedRewardsWei).toBe("6000000000000000");
    expect(dashboard.totalPaidRewardsWei).toBe("6000000000000000");
    expect(dashboard.claimableRewardsWei).toBe("0");
  });

  test("claim-intent validates chain availability without creating a JSON authority file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veydrift-referrals-chain-only-"));
    try {
      const storePath = join(dir, "referrals.json");
      const chain = referralIndex();
      const store = new ReferralInviteStore(storePath);
      const handler = createRequestHandler({
        config: testConfig(),
        indexer: chain.indexer,
        referralStore: store,
        role: "reader"
      });
      const code = "Custom_Code";
      const commitment = referralCommitment(code, player);
      const signature = await playerAccount.signMessage({
        message: referralWalletMessage(player, "claim-transaction", commitment)
      });
      const response = await handler(new Request(`http://localhost/wallet/${player}/referrals/claim-intent`, {
        body: JSON.stringify({ code, commitment, signature }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        code: "custom_code",
        commitment,
        persisted: false,
        source: "chain"
      });
      expect(existsSync(storePath)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
