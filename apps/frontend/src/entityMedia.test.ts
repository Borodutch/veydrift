import { describe, expect, test } from "bun:test";
import {
  canEditEntityMedia,
  entityMediaEmbedUrl,
  entityMediaMessage,
  nextEntityMediaPlaybackState,
  parseYouTubeMediaUrl,
  updateEntityMedia,
} from "./entityMedia";
import type { Eip1193Provider } from "./walletFlow";
import { personalSignPayload } from "./walletFlow";

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
      version: 4,
      wallet: "0x1111111111111111111111111111111111111111",
    })).toContain("Entity: planet:7\nVersion: 4\nYouTube media: video:dQw4w9WgXcQ");
  });

  test("acquires a fresh entity challenge and binds it to the signed mutation", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ body?: string; url: string }> = [];
    let signedPayload = "";
    const provider: Eip1193Provider = {
      async request<T>(args: { method: string; params?: unknown[] }): Promise<T> {
        signedPayload = String(args.params?.[0] ?? "");
        return "0x1234" as T;
      },
    };
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ ...(typeof init?.body === "string" ? { body: init.body } : {}), url });
      if (url.includes("/challenge?")) {
        return Response.json({
          entityKind: "planet",
          entityId: "7",
          version: 12,
          wallet: "0x1111111111111111111111111111111111111111",
        });
      }
      return Response.json({ entityKind: "planet", entityId: "7", media: null, version: 13 });
    }) as unknown as typeof fetch;

    try {
      await updateEntityMedia(
        "https://api.test",
        provider,
        "0x1111111111111111111111111111111111111111",
        "planet",
        "7",
        ""
      );
      expect(requests[0]?.url).toContain("/entity-media/planet/7/challenge?wallet=");
      expect(signedPayload).toBe(personalSignPayload(entityMediaMessage({
        entityId: "7",
        entityKind: "planet",
        media: null,
        version: 12,
        wallet: "0x1111111111111111111111111111111111111111",
      })));
      expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({ version: 12 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces a stale authorization response instead of reporting success", async () => {
    const originalFetch = globalThis.fetch;
    const provider: Eip1193Provider = {
      async request<T>(): Promise<T> {
        return "0x1234" as T;
      },
    };
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Response.json({
          entityKind: "planet",
          entityId: "7",
          version: 3,
          wallet: "0x1111111111111111111111111111111111111111",
        });
      }
      return Response.json({
        error: "entity_media_stale_authorization",
        message: "This media authorization has expired or was already used. Try saving again.",
      }, { status: 409 });
    }) as unknown as typeof fetch;

    try {
      await expect(updateEntityMedia(
        "https://api.test",
        provider,
        "0x1111111111111111111111111111111111111111",
        "planet",
        "7",
        ""
      )).rejects.toThrow("authorization has expired or was already used");
      expect(requestCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
