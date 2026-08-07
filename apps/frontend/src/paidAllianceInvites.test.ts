import { describe, expect, test } from "bun:test";
import {
  generatePaidAllianceInviteSecret,
  paidAllianceInviteCommitment,
  paidAllianceInviteLink,
  paidAllianceInviteSecretFromHash,
  PAID_ALLIANCE_INVITE_PRICE_WEI,
  recoverPaidAllianceInvites,
  resolvePaidAllianceInvite,
  sendBuyPaidAllianceInviteTransaction,
  sendSettlementTransaction,
  sendWithdrawPaidAllianceBonusTransaction,
  type Eip1193Provider,
} from "./walletFlow";

const account = "0x1111111111111111111111111111111111111111";
const inviteContract = "0x2222222222222222222222222222222222222222";
const game = "0x3333333333333333333333333333333333333333";

describe("paid alliance invite frontend flow", () => {
  test("shows the public treasury and member purchase/withdraw controls", async () => {
    const source = await Bun.file(new URL("./components/AlliancePage.tsx", import.meta.url)).text();
    expect(source).toContain("Production bonus treasury");
    expect(source).toContain("Buy private invite · 0.006 ETH (~$10)");
    expect(source).toContain("Credit selected resources to active Rift planet");
    expect(source).toContain("Interdimensional Rift Stabilizer");
    expect(source.match(/Recover purchased invite links/g)).toHaveLength(2);
    expect(source).not.toContain("Recover alliance invite links");
  });

  test("binds recovery to the purchaser wallet and payload", async () => {
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];
    let requestBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return Response.json({ invites: [] });
    }) as typeof fetch;
    try {
      await recoverPaidAllianceInvites(
        "https://api.veydrift.com",
        providerRecording(requests),
        account,
      );
      expect((requests[0] as any).method).toBe("personal_sign");
      expect((requests[0] as any).params[1]).toBe(account);
      expect(JSON.parse(requestBody)).toEqual({ purchaser: account, signature: "0xabc" });
      expect(requestBody).not.toContain("viewer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("creates unique private links whose secret is not the on-chain commitment", () => {
    const values = Array.from({ length: 32 }, (_, index) => index);
    const secret = generatePaidAllianceInviteSecret({
      getRandomValues(target: Uint8Array) {
        target.set(values);
        return target;
      },
    } as Crypto);
    const commitment = paidAllianceInviteCommitment(secret);
    expect(commitment).not.toBe(secret);
    const link = paidAllianceInviteLink(secret, "https://veydrift.com/game");
    const parsed = new URL(link);
    expect(parsed.search).toBe("");
    expect(paidAllianceInviteSecretFromHash(parsed.hash)).toBe(secret);
    expect(link.split("#")[0]).not.toContain(secret);
  });

  test("buys for exactly 0.006 ETH and supports a partial Rift-planet credit", async () => {
    const requests: unknown[] = [];
    const provider = providerRecording(requests);
    const secret = `0x${"ab".repeat(32)}`;
    await sendBuyPaidAllianceInviteTransaction(provider, account, inviteContract, paidAllianceInviteCommitment(secret), PAID_ALLIANCE_INVITE_PRICE_WEI);
    await sendWithdrawPaidAllianceBonusTransaction(provider, account, inviteContract, "7", "42", {
      metal: "100",
      crystal: "0",
      deuterium: "7",
    });
    expect(requests).toHaveLength(2);
    expect((requests[0] as any).params[0].data.slice(0, 10)).toBe("0x9c9a1061");
    expect((requests[0] as any).params[0].value).toBe("0x1550f7dca70000");
    expect((requests[1] as any).params[0].data.slice(0, 10)).toBe("0x2d20f511");
  });

  test("sends bearer secrets only in POST bodies, never request URLs", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = "";
    let requestBody = "";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? "");
      return Response.json({ status: "active", valid: true, commitment: `0x${"12".repeat(32)}`, allianceId: "7" });
    }) as typeof fetch;
    try {
      const secret = `0x${"ef".repeat(32)}`;
      await resolvePaidAllianceInvite("https://api.veydrift.com", secret);
      expect(requestUrl).toBe("https://api.veydrift.com/alliance-invites/resolve");
      expect(requestUrl).not.toContain(secret);
      expect(requestBody).toContain(secret);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("settles an invite for the normal start price with recipient-bound authorization", async () => {
    const requests: unknown[] = [];
    const provider = providerRecording(requests);
    await sendSettlementTransaction(provider, account, { address: game }, {
      allianceInvite: {
        commitment: `0x${"cd".repeat(32)}`,
        expiresAt: "12345",
        signature: `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      },
      startPriceWei: 10n,
    });
    const transaction = (requests[0] as any).params[0];
    expect(transaction.data.slice(0, 10)).toBe("0x042fec83");
    expect(transaction.value).toBe("0xa");
  });
});

function providerRecording(requests: unknown[]): Eip1193Provider {
  return {
    async request({ method, params }) {
      requests.push({ method, params });
      return "0xabc" as never;
    },
  };
}
