import { describe, expect, test } from "bun:test";
import {
  generatePaidAllianceInviteSecret,
  paidAllianceInviteCommitment,
  paidAllianceInviteLink,
  paidAllianceInviteSecretFromSearch,
  PAID_ALLIANCE_INVITE_PRICE_WEI,
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
    expect(source).toContain("Credit treasury to active planet");
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
    expect(paidAllianceInviteSecretFromSearch(new URL(link).search)).toBe(secret);
  });

  test("buys for exactly 0.006 ETH and credits the selected planet", async () => {
    const requests: unknown[] = [];
    const provider = providerRecording(requests);
    const secret = `0x${"ab".repeat(32)}`;
    await sendBuyPaidAllianceInviteTransaction(provider, account, inviteContract, paidAllianceInviteCommitment(secret), PAID_ALLIANCE_INVITE_PRICE_WEI);
    await sendWithdrawPaidAllianceBonusTransaction(provider, account, inviteContract, "7", "42");
    expect(requests).toHaveLength(2);
    expect((requests[0] as any).params[0].data.slice(0, 10)).toBe("0x9c9a1061");
    expect((requests[0] as any).params[0].value).toBe("0x1550f7dca70000");
    expect((requests[1] as any).params[0].data.slice(0, 10)).toBe("0x441a3e70");
  });

  test("settles a prepaid invite with zero value and recipient-bound authorization", async () => {
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
    expect(transaction.value).toBeUndefined();
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
