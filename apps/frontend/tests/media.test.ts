import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animationConfigs, animationFilename, animationVariants } from "../scripts/animation-variants.mjs";
import { mediaFileForPathname, mediaManifest, syncMedia } from "../scripts/media.mjs";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "veydrift-media-"));
  const blobs = new Map<string, Uint8Array>();
  const manifest = { baseUrl: "https://media.test/release/", files: {} as Record<string, { sha256: string; bytes: number }> };
  for (const [key, text] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(text);
    manifest.files[key] = { sha256: sha256(bytes), bytes: bytes.length };
    blobs.set(sha256(bytes), bytes);
  }
  const requests: string[] = [];
  const fetchImpl = async (url: string) => {
    requests.push(url);
    const name = url.slice(manifest.baseUrl.length).replace(/\.[^.]+$/, "");
    const bytes = blobs.get(name);
    return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
  };
  return { root, manifest, blobs, requests, fetchImpl, log: () => {} };
}

describe("pinned external media", () => {
  test("pins every animation master, precomputed variant and the trailer, none of them in git", () => {
    const keys = Object.keys(mediaManifest.files);
    expect(mediaManifest.baseUrl).toBe("https://github.com/Borodutch/veydrift/releases/download/media-v1/");
    expect(keys).toContain("assets/landing/veydrift-trailer-v1.mp4");
    expect(keys).toContain("animation-variants/manifest.json");
    for (const { base, types } of animationConfigs) {
      for (const type of types) expect(keys).toContain(`${base.slice(1)}/${type}.webp`);
    }
    for (const route of animationVariants) expect(keys).toContain(`animation-variants/${animationFilename(route)}`);
    for (const [key, entry] of Object.entries(mediaManifest.files) as [string, { sha256: string; bytes: number }][]) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
      if (key.startsWith("assets/")) expect(existsSync(new URL(`../public/${key}`, import.meta.url))).toBe(false);
    }
  });

  test("downloads missing files once, verifies them, and does no network work on a warm root", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video", "animation-variants/a.webp": "variant" });
    try {
      expect(await syncMedia(f)).toEqual({ files: 2, downloaded: 2, downloadedBytes: 12 });
      expect(f.requests.sort()).toEqual([
        `${f.manifest.baseUrl}${f.manifest.files["animation-variants/a.webp"]!.sha256}.webp`,
        `${f.manifest.baseUrl}${f.manifest.files["assets/landing/clip.mp4"]!.sha256}.mp4`,
      ].sort());
      expect(await readFile(join(f.root, "assets/landing/clip.mp4"), "utf8")).toBe("video");
      f.requests.length = 0;
      expect(await syncMedia(f)).toEqual({ files: 2, downloaded: 0, downloadedBytes: 0 });
      expect(f.requests).toEqual([]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("replaces a same-size corrupted file after its stamp no longer matches", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video" });
    try {
      await syncMedia(f);
      const path = join(f.root, "assets/landing/clip.mp4");
      await writeFile(path, "VIDEO");
      await utimes(path, new Date(), new Date(Date.now() + 5_000));
      expect((await syncMedia(f)).downloaded).toBe(1);
      expect(await readFile(path, "utf8")).toBe("video");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("fails closed on a download that does not match its pin, leaving no partial file", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video" });
    const pinned = f.manifest.files["assets/landing/clip.mp4"]!.sha256;
    f.blobs.set(pinned, new TextEncoder().encode("vidEo"));
    try {
      await expect(syncMedia(f)).rejects.toThrow("Media download failed for assets/landing/clip.mp4");
      expect(f.requests.length).toBe(3);
      expect(existsSync(join(f.root, "assets/landing/clip.mp4"))).toBe(false);
      expect(existsSync(join(f.root, "assets/landing"))).toBe(true);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects manifest paths that escape the media root", async () => {
    const f = await fixture({ "assets/../../escape.txt": "x" });
    try {
      await expect(syncMedia(f)).rejects.toThrow("Invalid media path");
      expect(f.requests).toEqual([]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("addresses only pinned public files, never variants or unknown paths", () => {
    const manifest = { baseUrl: "https://media.test/", files: { "assets/landing/clip.mp4": { sha256: "0", bytes: 1 }, "animation-variants/a.webp": { sha256: "0", bytes: 1 } } };
    expect(mediaFileForPathname("/assets/landing/clip.mp4", { root: "/media", manifest })).toBe("/media/assets/landing/clip.mp4");
    expect(mediaFileForPathname("/animation-variants/a.webp", { root: "/media", manifest })).toBeNull();
    expect(mediaFileForPathname("/assets/landing/other.mp4", { root: "/media", manifest })).toBeNull();
  });
});
