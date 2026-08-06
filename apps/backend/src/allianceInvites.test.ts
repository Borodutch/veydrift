import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendConfig } from "./config";
import {
  buildPaidAllianceInviteAuthorization,
  paidAllianceAuthorizationHash,
  paidAllianceInviteCommitment,
  PaidAllianceInviteRateLimiter,
  PaidAllianceInviteSecretStore,
  paidAllianceInviteRecoveryMessage,
  paidAllianceInviteSecretRecordAad,
  paidAllianceInviteStoreMessage,
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
    const resolution = await handler(new Request("http://test/alliance-invites/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    }));
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

  test("encrypts recoverable secrets at rest and authorizes only the purchaser", async () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-paid-invite-"));
    try {
      const path = join(directory, "invites.json");
      const purchaserAccount = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
      const purchaserState = { ...state, purchaser: purchaserAccount.address };
      const commitment = paidAllianceInviteCommitment(secret);
      const storeSignature = await purchaserAccount.signMessage({
        message: paidAllianceInviteStoreMessage(purchaserAccount.address, commitment),
      });
      const store = new PaidAllianceInviteSecretStore(path, `0x${"44".repeat(32)}`);
      await store.store(secret, purchaserAccount.address, storeSignature, purchaserState);
      expect(readFileSync(path, "utf8")).not.toContain(secret);
      store.close();

      const recoverySignature = await purchaserAccount.signMessage({
        message: paidAllianceInviteRecoveryMessage(purchaserAccount.address),
      });
      const restarted = new PaidAllianceInviteSecretStore(path, `0x${"55".repeat(32)}`, [`0x${"44".repeat(32)}`]);
      expect(await restarted.recover(purchaserAccount.address, recoverySignature)).toEqual([{ commitment, secret }]);

      const attacker = privateKeyToAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
      const attackerSignature = await attacker.signMessage({
        message: paidAllianceInviteRecoveryMessage(purchaserAccount.address),
      });
      await expect(restarted.recover(purchaserAccount.address, attackerSignature)).rejects.toThrow("Invalid purchaser authorization");
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects cross-purchaser encrypted-row substitution through recovery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-paid-invite-swap-"));
    try {
      const path = join(directory, "invites.sqlite");
      const encryptionKey = `0x${"44".repeat(32)}`;
      const victim = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
      const attacker = privateKeyToAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
      const attackerSecret = `0x${"bb".repeat(32)}` as const;
      const victimCommitment = paidAllianceInviteCommitment(secret);
      const attackerCommitment = paidAllianceInviteCommitment(attackerSecret);
      const store = new PaidAllianceInviteSecretStore(path, encryptionKey);
      await store.store(secret, victim.address, await victim.signMessage({
        message: paidAllianceInviteStoreMessage(victim.address, victimCommitment),
      }), { ...state, purchaser: victim.address });
      await store.store(attackerSecret, attacker.address, await attacker.signMessage({
        message: paidAllianceInviteStoreMessage(attacker.address, attackerCommitment),
      }), { ...state, purchaser: attacker.address });
      store.close();

      const database = new Database(path);
      const victimCiphertext = database.query(`
        SELECT ciphertext, iv, tag FROM paid_alliance_invite_secrets WHERE commitment = ?
      `).get(victimCommitment) as { ciphertext: string; iv: string; tag: string };
      database.query(`
        UPDATE paid_alliance_invite_secrets SET ciphertext = ?, iv = ?, tag = ? WHERE commitment = ?
      `).run(victimCiphertext.ciphertext, victimCiphertext.iv, victimCiphertext.tag, attackerCommitment);
      database.close();

      const restarted = new PaidAllianceInviteSecretStore(path, encryptionKey);
      const handler = createRequestHandler({
        config: config(),
        paidAllianceInviteReader: { invite: async () => ({ ...state, purchaser: attacker.address }) },
        paidAllianceInviteSecretStore: restarted,
        role: "writer",
      });
      const response = await handler(new Request("http://test/alliance-invites/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purchaser: attacker.address,
          signature: await attacker.signMessage({
            message: paidAllianceInviteRecoveryMessage(attacker.address),
          }),
        }),
      }));
      const body = await response.text();
      expect(response.status).toBe(400);
      expect(body).not.toContain(secret);
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects authenticated plaintext that does not match its row commitment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-paid-invite-commitment-"));
    try {
      const path = join(directory, "invites.sqlite");
      const keyHex = `0x${"44".repeat(32)}`;
      const purchaser = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
      const commitment = paidAllianceInviteCommitment(secret);
      const store = new PaidAllianceInviteSecretStore(path, keyHex);
      await store.store(secret, purchaser.address, await purchaser.signMessage({
        message: paidAllianceInviteStoreMessage(purchaser.address, commitment),
      }), { ...state, purchaser: purchaser.address });
      store.close();

      const { createCipheriv, randomBytes } = await import("node:crypto");
      const wrongSecret = `0x${"bb".repeat(32)}`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex.slice(2), "hex"), iv);
      cipher.setAAD(paidAllianceInviteSecretRecordAad(commitment, purchaser.address));
      const ciphertext = Buffer.concat([cipher.update(wrongSecret, "utf8"), cipher.final()]);
      const database = new Database(path);
      database.query(`
        UPDATE paid_alliance_invite_secrets SET ciphertext = ?, iv = ?, tag = ? WHERE commitment = ?
      `).run(
        ciphertext.toString("base64"),
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        commitment,
      );
      database.close();

      const restarted = new PaidAllianceInviteSecretStore(path, keyHex);
      await expect(restarted.recover(purchaser.address, await purchaser.signMessage({
        message: paidAllianceInviteRecoveryMessage(purchaser.address),
      }))).rejects.toThrow("cannot be decrypted");
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("recovery returns only active purchaser links", async () => {
    const directory = mkdtempSync(join(tmpdir(), "veydrift-paid-invite-filter-"));
    try {
      const path = join(directory, "invites.sqlite");
      const purchaser = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
      const secrets = [secret, `0x${"bb".repeat(32)}`, `0x${"cc".repeat(32)}`] as const;
      const commitments = secrets.map(paidAllianceInviteCommitment);
      const states = new Map([
        [commitments[0], { ...state, purchaser: purchaser.address }],
        [commitments[1], { ...state, purchaser: purchaser.address, redeemed: true }],
        [commitments[2], { ...state, purchaser: purchaser.address, validUntil: 1n }],
      ]);
      const store = new PaidAllianceInviteSecretStore(path, `0x${"44".repeat(32)}`);
      for (const [index, inviteSecret] of secrets.entries()) {
        const commitment = commitments[index]!;
        await store.store(inviteSecret, purchaser.address, await purchaser.signMessage({
          message: paidAllianceInviteStoreMessage(purchaser.address, commitment),
        }), states.get(commitment)!);
      }
      const handler = createRequestHandler({
        config: config(),
        paidAllianceInviteReader: { invite: async (commitment) => states.get(commitment)! },
        paidAllianceInviteSecretStore: store,
        role: "writer",
      });
      const response = await handler(new Request("http://test/alliance-invites/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purchaser: purchaser.address,
          signature: await purchaser.signMessage({
            message: paidAllianceInviteRecoveryMessage(purchaser.address),
          }),
        }),
      }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.invites).toEqual([expect.objectContaining({
        commitment: commitments[0],
        secret: secrets[0],
        status: "active",
      })]);
      expect(JSON.stringify(body)).not.toContain(secrets[1]);
      expect(JSON.stringify(body)).not.toContain(secrets[2]);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
