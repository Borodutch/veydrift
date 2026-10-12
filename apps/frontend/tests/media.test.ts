import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animationConfigs, animationFilename, animationVariants } from "../scripts/animation-variants.mjs";
import { mediaFileForPathname, mediaManifest, mediaViewRoot, syncMedia } from "../scripts/media.mjs";

type Pin = { sha256: string; bytes: number; publishOnly?: boolean };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fixture(files: Record<string, string | { text: string; publishOnly: true }>) {
  const root = await mkdtemp(join(tmpdir(), "veydrift-media-"));
  const blobs = new Map<string, Uint8Array>();
  const manifest = { baseUrl: "https://media.test/release/", files: {} as Record<string, Pin> };
  for (const [key, value] of Object.entries(files)) {
    const text = typeof value === "string" ? value : value.text;
    const bytes = new TextEncoder().encode(text);
    manifest.files[key] = { sha256: sha256(bytes), bytes: bytes.length, ...(typeof value === "string" ? {} : { publishOnly: true as const }) };
    blobs.set(sha256(bytes), bytes);
  }
  const requests: string[] = [];
  const fetchImpl = async (url: string) => {
    requests.push(url);
    const bytes = blobs.get(url.slice(manifest.baseUrl.length).replace(/\.[^.]+$/, ""));
    return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
  };
  return { root, manifest, blobs, requests, options: { root, manifest, fetchImpl, log: () => {}, retryDelayMs: 0 } };
}

const read = (root: string, manifest: { files: Record<string, Pin> }, key: string) =>
  readFile(join(mediaViewRoot({ root, manifest } as never), key), "utf8");

describe("pinned external media", () => {
  test("pins every animation master, precomputed variant and the trailer, none of them in git", () => {
    const files = mediaManifest.files as Record<string, Pin>;
    expect(mediaManifest.baseUrl).toBe("https://github.com/Borodutch/veydrift/releases/download/media-v1/");
    expect(files["assets/landing/veydrift-trailer-v1.mp4"]?.publishOnly).toBeUndefined();
    expect(files["animation-variants/manifest.json"]?.publishOnly).toBeUndefined();
    for (const { base, types, widths, masterWidth } of animationConfigs) {
      // A master is synced only when a route serves it at full size.
      for (const type of types) expect(files[`${base.slice(1)}/${type}.webp`]?.publishOnly).toBe(widths.includes(masterWidth) ? undefined : true);
    }
    for (const route of animationVariants) expect(files[`animation-variants/${animationFilename(route)}`]?.publishOnly).toBeUndefined();
    expect(Object.keys(files).length).toBe(2 + animationVariants.length + animationConfigs.reduce((sum, config) => sum + config.types.length, 0));
    for (const [key, entry] of Object.entries(files)) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
      if (key.startsWith("assets/")) expect(existsSync(new URL(`../public/${key}`, import.meta.url))).toBe(false);
    }
  });

  test("downloads missing blobs once and does no network work on a warm root", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video", "animation-variants/a.webp": "variant" });
    try {
      expect(await syncMedia(f.options)).toEqual({ files: 2, downloaded: 2, downloadedBytes: 12 });
      expect(f.requests.sort()).toEqual([
        `${f.manifest.baseUrl}${f.manifest.files["animation-variants/a.webp"]!.sha256}.webp`,
        `${f.manifest.baseUrl}${f.manifest.files["assets/landing/clip.mp4"]!.sha256}.mp4`,
      ].sort());
      expect(await read(f.root, f.manifest, "assets/landing/clip.mp4")).toBe("video");
      f.requests.length = 0;
      expect(await syncMedia(f.options)).toEqual({ files: 2, downloaded: 0, downloadedBytes: 0 });
      expect(f.requests).toEqual([]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("skips publish-only inputs at runtime but fetches them for maintainers", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video", "assets/game/moon.webp": { text: "master", publishOnly: true } });
    try {
      expect((await syncMedia(f.options)).downloaded).toBe(1);
      expect(mediaFileForPathname("/assets/game/moon.webp", f.options)).toBeNull();
      expect((await syncMedia({ ...f.options, all: true })).downloaded).toBe(1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("keeps each revision's files intact when two pin sets share one media root", async () => {
    const old = await fixture({ "assets/landing/clip.mp4": "old cut", "animation-variants/manifest.json": "{\"v\":1}" });
    const next = await fixture({ "assets/landing/clip.mp4": "new cut!", "animation-variants/manifest.json": "{\"v\":2}" });
    const shared = { ...next.options, root: old.root };
    try {
      await syncMedia(old.options);
      // Start-first deploy, then a rollback that re-syncs the old pins.
      await Promise.all([syncMedia(shared), syncMedia(old.options)]);
      expect(await read(old.root, old.manifest, "assets/landing/clip.mp4")).toBe("old cut");
      expect(await read(old.root, next.manifest, "assets/landing/clip.mp4")).toBe("new cut!");
      expect(await read(old.root, old.manifest, "animation-variants/manifest.json")).toBe("{\"v\":1}");
      expect(await read(old.root, next.manifest, "animation-variants/manifest.json")).toBe("{\"v\":2}");
      expect((await readdir(join(old.root, "views"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(old.root, { recursive: true, force: true });
      await rm(next.root, { recursive: true, force: true });
    }
  });

  test("concurrent cold syncs of one pin set both succeed without leftovers", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video", "animation-variants/a.webp": "variant" });
    try {
      await Promise.all([syncMedia(f.options), syncMedia(f.options)]);
      expect(await read(f.root, f.manifest, "animation-variants/a.webp")).toBe("variant");
      expect((await readdir(join(f.root, "blobs"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      expect((await syncMedia(f.options)).downloaded).toBe(0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("replaces a wrong-size blob and removes temporaries abandoned by killed downloads", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video" });
    const blobs = join(f.root, "blobs");
    const name = f.manifest.files["assets/landing/clip.mp4"]!.sha256 + ".mp4";
    try {
      await mkdir(blobs, { recursive: true });
      await writeFile(join(blobs, name), "vid");
      await writeFile(join(blobs, name + ".123.abcd.tmp"), "partial");
      await writeFile(join(blobs, name + ".456.ef01.tmp"), "live");
      const old = new Date(Date.now() - 60 * 60_000);
      await utimes(join(blobs, name + ".123.abcd.tmp"), old, old);
      expect((await syncMedia(f.options)).downloaded).toBe(1);
      expect(await read(f.root, f.manifest, "assets/landing/clip.mp4")).toBe("video");
      expect((await readdir(blobs)).sort()).toEqual([name, name + ".456.ef01.tmp"]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("fails closed after backed-off retries when a download does not match its pin", async () => {
    const f = await fixture({ "assets/landing/clip.mp4": "video" });
    f.blobs.set(f.manifest.files["assets/landing/clip.mp4"]!.sha256, new TextEncoder().encode("vidEo"));
    try {
      await expect(syncMedia(f.options)).rejects.toThrow("Media download failed for assets/landing/clip.mp4");
      expect(f.requests.length).toBe(3);
      expect(await readdir(join(f.root, "blobs"))).toEqual([]);
      expect(existsSync(join(mediaViewRoot(f.options), "assets/landing/clip.mp4"))).toBe(false);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects manifest paths that escape the media root and malformed pins", async () => {
    const escape = await fixture({ "assets/../../escape.txt": "x" });
    const malformed = await fixture({ "assets/landing/clip.mp4": "video" });
    malformed.manifest.files["assets/landing/clip.mp4"]!.sha256 = "../../x";
    try {
      await expect(syncMedia(escape.options)).rejects.toThrow("Invalid media path");
      await expect(syncMedia(malformed.options)).rejects.toThrow("Invalid media pin");
      expect([...escape.requests, ...malformed.requests]).toEqual([]);
    } finally {
      await rm(escape.root, { recursive: true, force: true });
      await rm(malformed.root, { recursive: true, force: true });
    }
  });

  test("addresses only pinned, served public files, never variants or unknown paths", () => {
    const manifest = { baseUrl: "https://media.test/", files: {
      "assets/landing/clip.mp4": { sha256: "0".repeat(64), bytes: 1 },
      "assets/game/moon.webp": { sha256: "1".repeat(64), bytes: 1, publishOnly: true },
      "animation-variants/a.webp": { sha256: "2".repeat(64), bytes: 1 },
    } };
    const view = mediaViewRoot({ root: "/media", manifest });
    expect(view.startsWith("/media/views/")).toBe(true);
    expect(mediaFileForPathname("/assets/landing/clip.mp4", { root: "/media", manifest })).toBe(`${view}/assets/landing/clip.mp4`);
    expect(mediaFileForPathname("/assets/game/moon.webp", { root: "/media", manifest })).toBeNull();
    expect(mediaFileForPathname("/animation-variants/a.webp", { root: "/media", manifest })).toBeNull();
    expect(mediaFileForPathname("/assets/landing/other.mp4", { root: "/media", manifest })).toBeNull();
  });
});
