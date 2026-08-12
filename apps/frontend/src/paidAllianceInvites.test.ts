import { describe, expect, test } from "bun:test";
import {
  generatePaidAllianceInviteSecret,
  paidAllianceInviteCommitment,
  paidAllianceInviteCommitmentFromPathname,
  paidAllianceInviteLink,
  paidAllianceInviteLocationState,
  paidAllianceInviteSecretFromHash,
  paidAllianceInviteSecretFromLocation,
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
    expect(source).toContain("Alliance treasury");
    expect(source).toContain("Buy private invite · 0.006 ETH (~$10)");
    expect(source).toContain("A redeemed invite adds 2% of the invitee&apos;s production to the alliance while they are a member; the invitee loses nothing.");
    expect(source).toContain("If an invitee leaves and rejoins the alliance, their production contribution resumes.");
    expect(source).toContain("Any alliance member can buy a private invite for 0.006 ETH.");
    expect(source).toContain("Only alliance officers and owners can view or recover invite links.");
    expect(source).toContain("Each link is unique and single-use; share it only with its intended invitee.");
    expect(source).toContain("The invited commander joins the game for free (Base gas only), starts with 2× resources, and produces 2× resources for their first 7 days.");
    expect(source).toContain("Invited by {playerLabel(member.invitedByDisplayName, member.invitedBy)}");
    expect(source).toContain("canManageMembers && paidInviteLinks.length");
    expect(source).toContain("Private invite ready");
    expect(source).toContain("Open invite");
    expect(source).toContain("Copy link");
    expect(source).toContain("copyReferralText(link)");
    expect(source).not.toContain("Copy private link(s)");
    expect(source).toContain("Redeemed private invites add 2% of that commander&apos;s production to the alliance.");
    expect(source).toContain("Officers and owners can move resources instantly to a planet with a built Rift.");
    expect(source).toContain('className="grid gap-1.5"');
    expect(source).toContain("Rift resources to");
    expect(source).toContain("No rift built");
    expect(source).toContain("<AllianceTreasuryResourceField");
    expect(source).toContain("availableLabel");
    expect(source).toContain("sm:col-span-3 2xl:col-span-1");
    expect(source).toContain("Recover alliance invite links");
    expect(source).not.toContain("Recover purchased invite links");
  });

  test("binds recovery to the officer or owner viewer wallet", async () => {
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
      expect(JSON.parse(requestBody)).toEqual({ viewer: account, signature: "0xabc" });
      expect(requestBody).not.toContain("purchaser");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("creates canonical public-commitment paths while keeping the private secret in the fragment", () => {
    const values = Array.from({ length: 32 }, (_, index) => index);
    const secret = generatePaidAllianceInviteSecret({
      getRandomValues(target: Uint8Array) {
        target.set(values);
        return target;
      },
    } as Crypto);
    const commitment = paidAllianceInviteCommitment(secret);
    expect(commitment).not.toBe(secret);
    const link = paidAllianceInviteLink(secret, "https://veydrift.com/game?tracking=old");
    const parsed = new URL(link);
    expect(parsed.pathname).toBe(`/alliance-invite/${commitment}`);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#allianceInvite=${secret}`);
    expect(paidAllianceInviteCommitmentFromPathname(parsed.pathname)).toBe(commitment);
    expect(paidAllianceInviteSecretFromLocation(parsed)).toBe(secret);
    expect(paidAllianceInviteSecretFromHash(parsed.hash)).toBe(secret);
    expect(`${parsed.origin}${parsed.pathname}`).not.toContain(secret);
  });

  test("preserves legacy hash invites and safely rejects malformed or mismatched canonical paths", () => {
    const secret = `0x${"ef".repeat(32)}`;
    const otherSecret = `0x${"ab".repeat(32)}`;
    const commitment = paidAllianceInviteCommitment(secret);

    expect(paidAllianceInviteSecretFromLocation({
      pathname: "/",
      hash: `#allianceInvite=${secret}`,
    })).toBe(secret);
    expect(paidAllianceInviteLocationState({
      pathname: "/",
      hash: `#allianceInvite=${secret}`,
    })).toEqual({ canonical: false, kind: "valid", secret });
    expect(paidAllianceInviteSecretFromLocation({
      pathname: "/game",
      hash: `#allianceInvite=${secret}`,
    })).toBe(secret);
    expect(paidAllianceInviteSecretFromLocation({
      pathname: `/alliance-invite/${commitment}`,
      hash: `#allianceInvite=${otherSecret}`,
    })).toBe("");
    expect(paidAllianceInviteLocationState({
      pathname: `/alliance-invite/${commitment}`,
      hash: `#allianceInvite=${secret}`,
    })).toEqual({ canonical: true, kind: "valid", secret });
    expect(paidAllianceInviteLocationState({
      pathname: `/alliance-invite/${commitment}`,
      hash: "",
    })).toEqual({ kind: "invalid" });
    expect(paidAllianceInviteLocationState({
      pathname: `/alliance-invite/${commitment}`,
      hash: `#allianceInvite=${otherSecret}`,
    })).toEqual({ kind: "invalid" });
    expect(paidAllianceInviteSecretFromLocation({
      pathname: "/alliance-invite/not-a-commitment",
      hash: `#allianceInvite=${secret}`,
    })).toBe("");
    expect(paidAllianceInviteLocationState({
      pathname: "/alliance-invite/not-a-commitment",
      hash: `#allianceInvite=${secret}`,
    })).toEqual({ kind: "invalid" });
    expect(paidAllianceInviteCommitmentFromPathname("/alliance-invite/0x1234")).toBe("");
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

  test("preflights private invitations and explains when one was already used", async () => {
    const source = await Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    expect(source).toContain("resolvePaidAllianceInvite(apiUrl, paidAllianceInviteSecret)");
    expect(source).toContain("Invitation already used");
    expect(source).toContain("has already been accepted");
    expect(source).toContain("Checking invitation");
    expect(source).toContain("const resolution = await refreshPaidAllianceInviteValidation();");
    expect(source).toContain("if (paidAllianceInviteSecret && !isUserRejected(error))");
    expect(source).toContain("Retry invitation");
  });

  test("settles a paid alliance invite for free with recipient-bound authorization", async () => {
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
    expect(transaction.value).toBe("0x0");
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
