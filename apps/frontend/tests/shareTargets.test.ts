import { describe, expect, test } from "bun:test";

import { shareTargets } from "../src/shareTargets";

// VEY-KANEO-339: the battle-report share dialog renders social share-intent links. These assert the
// intent URLs are well-formed, point at the right networks, and carry the encoded report link, so the
// in-app dialog always offers working "share to X / Telegram / Farcaster" targets.

const URL = "https://test.veydrift.com/#/mission/228";

describe("shareTargets", () => {
  test("returns no targets for an empty URL so the dialog can omit the social row", () => {
    expect(shareTargets("")).toEqual([]);
  });

  test("builds X, Telegram, and Farcaster intent links in order", () => {
    const targets = shareTargets(URL);
    expect(targets.map((target) => target.key)).toEqual(["x", "telegram", "farcaster"]);
  });

  test("X target opens a tweet intent carrying the encoded report link", () => {
    const x = shareTargets(URL).find((target) => target.key === "x");
    expect(x?.href).toBe(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent("Veydrift battle report")}&url=${encodeURIComponent(URL)}`,
    );
    // The raw (unencoded) hash URL must never be inlined — that would truncate at the `#`.
    expect(x?.href).not.toContain(URL);
  });

  test("Telegram target opens the share/url intent with the link and text", () => {
    const telegram = shareTargets(URL).find((target) => target.key === "telegram");
    expect(telegram?.href).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(URL)}&text=${encodeURIComponent("Veydrift battle report")}`,
    );
  });

  test("Farcaster target embeds the link in a Warpcast compose URL", () => {
    const farcaster = shareTargets(URL).find((target) => target.key === "farcaster");
    expect(farcaster?.href).toBe(
      `https://warpcast.com/~/compose?text=${encodeURIComponent("Veydrift battle report")}&embeds[]=${encodeURIComponent(URL)}`,
    );
  });

  test("honors a custom share text", () => {
    const targets = shareTargets(URL, "Look at this raid");
    for (const target of targets) {
      expect(target.href).toContain(encodeURIComponent("Look at this raid"));
    }
  });

  test("every target carries a human label", () => {
    for (const target of shareTargets(URL)) {
      expect(target.label.length).toBeGreaterThan(0);
    }
  });
});
