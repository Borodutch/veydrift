import { describe, expect, test } from "bun:test";
import {
  canEditEntityMedia,
  entityMediaEmbedUrl,
  entityMediaMessage,
  nextEntityMediaPlaybackState,
  parseYouTubeMediaUrl,
} from "./entityMedia";

describe("entity media", () => {
  test("parses supported YouTube video and playlist URLs without accepting arbitrary providers", () => {
    expect(parseYouTubeMediaUrl("https://youtu.be/dQw4w9WgXcQ?t=2")).toEqual({
      ok: true,
      media: { type: "video", id: "dQw4w9WgXcQ" },
    });
    expect(parseYouTubeMediaUrl("https://www.youtube.com/playlist?list=PL1234567890abcdef")).toEqual({
      ok: true,
      media: { type: "playlist", id: "PL1234567890abcdef" },
    });
    expect(parseYouTubeMediaUrl("https://example.com/embed/dQw4w9WgXcQ")).toEqual({
      ok: false,
      error: "Only YouTube video and playlist URLs are supported.",
    });
    expect(parseYouTubeMediaUrl("https://www.youtube.com/watch?v=<script>")).toMatchObject({ ok: false });
  });

  test("builds only privacy-enhanced muted autoplay embed URLs", () => {
    expect(entityMediaEmbedUrl({ type: "video", id: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1&rel=0"
    );
    expect(entityMediaEmbedUrl({ type: "playlist", id: "PL1234567890abcdef" })).toBe(
      "https://www.youtube-nocookie.com/embed/videoseries?autoplay=1&mute=1&playsinline=1&rel=0&list=PL1234567890abcdef"
    );
  });

  test("keeps media off for the current entity visit until the visitor explicitly turns it back on", () => {
    const initial = { enabled: true, entityKey: "planet:7" };
    const off = nextEntityMediaPlaybackState(initial, "planet:7", "turn-off");
    expect(off).toEqual({ enabled: false, entityKey: "planet:7" });
    expect(nextEntityMediaPlaybackState(off, "planet:7", "sync-entity")).toBe(off);
    expect(nextEntityMediaPlaybackState(off, "planet:8", "sync-entity")).toEqual({
      enabled: true,
      entityKey: "planet:8",
    });
    expect(nextEntityMediaPlaybackState(off, "planet:7", "turn-on")).toEqual({
      enabled: true,
      entityKey: "planet:7",
    });
  });

  test("shows editors only to the matching owner or an authorized alliance role", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const visitor = "0x2222222222222222222222222222222222222222";
    expect(canEditEntityMedia({ entityKind: "planet", ownerWallet: owner, viewerWallet: owner.toUpperCase() })).toBe(true);
    expect(canEditEntityMedia({ entityKind: "moon", ownerWallet: owner, viewerWallet: visitor })).toBe(false);
    expect(canEditEntityMedia({ entityKind: "player", ownerWallet: owner, viewerWallet: visitor })).toBe(false);
    expect(canEditEntityMedia({ entityKind: "alliance", isCurrentAlliance: true, allianceRole: "officer" })).toBe(true);
    expect(canEditEntityMedia({ entityKind: "alliance", isCurrentAlliance: true, allianceRole: "member" })).toBe(false);
    expect(canEditEntityMedia({ entityKind: "alliance", isCurrentAlliance: false, allianceRole: "owner" })).toBe(false);
  });

  test("binds signatures to the wallet, entity, and normalized media identifier", () => {
    expect(entityMediaMessage({
      entityId: "7",
      entityKind: "planet",
      media: { type: "video", id: "dQw4w9WgXcQ" },
      wallet: "0x1111111111111111111111111111111111111111",
    })).toContain("Entity: planet:7\nYouTube media: video:dQw4w9WgXcQ");
  });
});
