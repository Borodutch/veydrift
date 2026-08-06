import { describe, expect, test } from "bun:test";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import {
  buildPaidAllianceInviteAuthorization,
  paidAllianceAuthorizationHash,
  paidAllianceInviteCommitment,
  PaidAllianceInviteRateLimiter,
  resolvePaidAllianceInvite,
  type PaidAllianceInviteState,
} from "./allianceInvites";
import { createRequestHandler } from "./server";

const signerKey = "0x1111111111111111111111111111111111111111111111111111111111111111";
const inviteAddress = "0x8888888888888888888888888888888888888888";
const invitee = "0x3333333333333333333333333333333333333333";
const secret = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const state: PaidAllianceInviteState = {
  allianceId: 7n,
  purchaser: "0x2222222222222222222222222222222222222222",
  settlementPrice: 10n,
  purchasedAt: 100n,
  validUntil: 9_999_999_999n,
  redeemed: false,
};

function config(): BackendConfig {
  return {
    chainId: 84532,
    deploymentMode: "test",
    gameContractAddress: "0x4444444444444444444444444444444444444444",
    indexDbPath: ":memory:",
    indexFromBlock: 0n,
    missionResolutionEnabled: false,
    paidAllianceInviteAddress: inviteAddress,
    paidAllianceInviteSignerPrivateKey: signerKey,
    qaSyntheticStationedDefenders: false,
    randomnessCommitmentStorePath: ".data/test-randomness.json",
    resourceTokenAddresses: {},
    rpcSource: "custom-url",
    rpcUrl: "https://example.invalid/rpc",
    wsRpcSource: "missing",
  };
}

describe("paid alliance invites", () => {
  test("keeps the secret off chain and signs a recipient- and expiry-bound commitment", async () => {
    const authorization = await buildPaidAllianceInviteAuthorization(config(), secret, invitee, state, 1_000n);
    expect(authorization.commitment).toBe(paidAllianceInviteCommitment(secret));
    expect(authorization.expiresAt).toBe("1600");
    const hash = paidAllianceAuthorizationHash(84532, inviteAddress, authorization.commitment, invitee, 1_600n);
    expect(await recoverMessageAddress({ message: { raw: hash }, signature: authorization.signature }))
      .toBe(privateKeyToAccount(signerKey).address);
    expect(JSON.stringify(authorization)).not.toContain(secret);
  });

  test("rejects invalid, expired, and redeemed states", () => {
    expect(() => paidAllianceInviteCommitment("guessable")).toThrow("32-byte high-entropy");
    expect(resolvePaidAllianceInvite(secret, { ...state, allianceId: 0n }, 1_000n).status).toBe("invalid");
    expect(resolvePaidAllianceInvite(secret, { ...state, validUntil: 1_000n }, 1_000n).status).toBe("expired");
    expect(resolvePaidAllianceInvite(secret, { ...state, redeemed: true }, 1_000n).status).toBe("redeemed");
  });

  test("bounds repeated redemption attempts", () => {
    const limiter = new PaidAllianceInviteRateLimiter(2, 1_000);
    expect(limiter.consume("client", 0)).toBe(true);
    expect(limiter.consume("client", 1)).toBe(true);
    expect(limiter.consume("client", 2)).toBe(false);
    expect(limiter.consume("client", 1_000)).toBe(true);
  });

  test("serves resolution and redemption without persisting the secret", async () => {
    const handler = createRequestHandler({
      config: config(),
      paidAllianceInviteReader: { invite: async () => state },
      role: "writer",
    });
    const resolution = await handler(new Request(`http://test/alliance-invites/resolve?secret=${secret}`));
    expect(resolution.status).toBe(200);
    expect((await resolution.json()).status).toBe("active");

    const redemption = await handler(new Request("http://test/alliance-invites/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, invitee }),
    }));
    expect(redemption.status).toBe(200);
    const body = await redemption.json();
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
