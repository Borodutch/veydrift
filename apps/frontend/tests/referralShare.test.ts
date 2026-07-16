import { describe, expect, test } from "bun:test";
import {
  fetchReferralShareImage,
  referralOgImageUrl,
  referralXIntentUrl,
  referralXPostText,
  shareReferralOnX,
} from "../src/referralShare";

describe("referral X sharing", () => {
  test("builds a code-specific OG image and a link-free X intent", () => {
    expect(referralOgImageUrl("https://veydrift.com/?ref=borodutch", "Borodutch"))
      .toBe("https://veydrift.com/og/referral/borodutch.png");
    expect(referralXPostText("Borodutch")).toBe("Join me in Veydrift — invite code: borodutch");

    const intent = referralXIntentUrl("Borodutch");
    expect(intent).toContain("twitter.com/intent/tweet?text=");
    expect(intent).not.toContain("url=");
    expect(intent).not.toContain("veydrift.com");
  });

  test("downloads a validated PNG as the share attachment", async () => {
    const requested: string[] = [];
    const image = await fetchReferralShareImage(
      "https://veydrift.com/?ref=borodutch",
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

  test("hands the image and code to native share without a URL", async () => {
    const shared: ShareData[] = [];
    const image = new File(["png"], "invite.png", { type: "image/png" });
    const result = await shareReferralOnX("borodutch", image, {
      canShare: (data) => Boolean(data?.files?.length),
      share: async (data) => { shared.push(data ?? {}); },
    }, {});

    expect(result).toBe("shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.files).toEqual([image]);
    expect(shared[0]?.text).toContain("borodutch");
    expect(shared[0]).not.toHaveProperty("url");
  });

  test("opens a link-free X composer when file sharing is unavailable", async () => {
    const opened: string[] = [];
    const image = new File(["png"], "invite.png", { type: "image/png" });
    const result = await shareReferralOnX("borodutch", image, {}, {
      open: (url) => {
        opened.push(String(url));
        return null;
      },
    });

    expect(result).toBe("downloaded");
    expect(opened).toEqual([referralXIntentUrl("borodutch")]);
  });
});
