import { describe, expect, test } from "bun:test";
import {
  fetchReferralShareImage,
  referralOgImageUrl,
  referralXCardUrl,
  referralXIntentUrl,
  referralXPostText,
  shareReferralOnX,
} from "../src/referralShare";

describe("referral X sharing", () => {
  const inviteLink = "https://veydrift.com/?ref=borodutch";

  test("builds a code-specific OG image and an encoded URL-bearing X intent", () => {
    expect(referralOgImageUrl(inviteLink, "Borodutch"))
      .toBe("https://veydrift.com/og/referral/borodutch.png");
    expect(referralXPostText("Borodutch")).toBe("Join me in Veydrift — invite code: borodutch");
    expect(referralXCardUrl(inviteLink))
      .toBe("https://veydrift.com/?ref=borodutch&x_card=2");

    const intent = new URL(referralXIntentUrl("Borodutch", inviteLink));
    expect(intent.origin).toBe("https://twitter.com");
    expect(intent.pathname).toBe("/intent/tweet");
    expect(intent.searchParams.get("text")).toBe("Join me in Veydrift — invite code: borodutch");
    expect(intent.searchParams.get("url")).toBe(referralXCardUrl(inviteLink));
    expect(referralXIntentUrl("Borodutch", inviteLink))
      .toContain(encodeURIComponent(referralXCardUrl(inviteLink)));
  });

  test("downloads a validated PNG as the share attachment", async () => {
    const requested: string[] = [];
    const image = await fetchReferralShareImage(
      inviteLink,
      "borodutch",
      (async (input) => {
        requested.push(String(input));
        return new Response(new Blob(["png"], { type: "image/png" }), { status: 200 });
      }) as typeof fetch,
    );

    expect(requested).toEqual(["https://veydrift.com/og/referral/borodutch.png"]);
    expect(image.name).toBe("veydrift-invite-borodutch.png");
    expect(image.type).toBe("image/png");
  });

  test("preserves native file sharing when the PNG is supported", async () => {
    const shared: ShareData[] = [];
    const image = new File(["png"], "invite.png", { type: "image/png" });
    const result = await shareReferralOnX("borodutch", inviteLink, image, {
      canShare: (data) => Boolean(data?.files?.length),
      share: async (data) => { shared.push(data ?? {}); },
    }, {});

    expect(result).toBe("shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.files).toEqual([image]);
    expect(shared[0]?.text).toContain("borodutch");
    expect(shared[0]).not.toHaveProperty("url");
  });

  test("opens an X composer with invite text and the exact referral URL when file sharing is unavailable", async () => {
    const opened: string[] = [];
    const image = new File(["png"], "invite.png", { type: "image/png" });
    const result = await shareReferralOnX("borodutch", inviteLink, image, {}, {
      open: (url) => {
        opened.push(String(url));
        return null;
      },
    });

    expect(result).toBe("opened");
    expect(opened).toEqual([referralXIntentUrl("borodutch", inviteLink)]);
  });

  test("keeps the URL fallback usable when PNG prefetch fails", async () => {
    const opened: string[] = [];
    await expect(fetchReferralShareImage(inviteLink, "borodutch", (async () => (
      new Response("unavailable", { status: 503 })
    )) as typeof fetch)).rejects.toThrow("Invite image request failed (503).");

    const result = await shareReferralOnX("borodutch", inviteLink, undefined, {}, {
      open: (url) => {
        opened.push(String(url));
        return null;
      },
    });

    expect(result).toBe("opened");
    expect(opened).toEqual([referralXIntentUrl("borodutch", inviteLink)]);
  });
});
