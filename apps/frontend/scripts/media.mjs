// Large frontend media (trailer, planet/moon animation masters and their
// precomputed size variants) lives outside git and outside the Docker image.
// media.json pins every file by sha256; the files themselves are release
// assets named <sha256><ext>. The server syncs them into a persistent media
// root (an Easypanel bind mount in production) before it listens, so a deploy
// with unchanged media downloads and writes nothing.
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const mediaManifestPath = fileURLToPath(new URL("../media.json", import.meta.url));
export const mediaRoot = resolve(process.env.VEYDRIFT_MEDIA_ROOT || fileURLToPath(new URL("../.media/", import.meta.url)));
export const mediaManifest = JSON.parse(readFileSync(mediaManifestPath, "utf8"));
const stampName = ".verified.json";
const downloadAttempts = 3;
const downloadTimeoutMs = 15 * 60_000;

function assertKey(key) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid media path: " + key);
  }
}

// Public files are addressed by URL path; animation variants only through the
// animation route, so they are not exposed here.
export function mediaFileForPathname(pathname, { root = mediaRoot, manifest = mediaManifest } = {}) {
  const key = pathname.replace(/^\/+/, "");
  if (!key.startsWith("assets/") || !Object.hasOwn(manifest.files, key)) return null;
  return join(root, key);
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, entry, path, fetchImpl) {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const file = await open(temporary, "w");
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        bytes += chunk.length;
        if (bytes > entry.bytes) throw new Error("Media download larger than pinned size");
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    const sha256 = hash.digest("hex");
    if (bytes !== entry.bytes || sha256 !== entry.sha256) throw new Error("Media download does not match its pin");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Idempotent and safe to run from two containers at once (start-first
// deploys): files are only replaced by verified, atomically renamed copies.
export async function syncMedia({ root = mediaRoot, manifest = mediaManifest, fetchImpl = fetch, log = console.info } = {}) {
  let stamps = {};
  try { stamps = JSON.parse(await readFile(join(root, stampName), "utf8")); } catch { /* Cold media root. */ }
  const verified = {};
  let downloaded = 0;
  let downloadedBytes = 0;
  for (const [key, entry] of Object.entries(manifest.files)) {
    assertKey(key);
    const path = join(root, key);
    const current = await stat(path).catch(() => null);
    const stamp = stamps[key];
    let valid = Boolean(current?.isFile() && current.size === entry.bytes);
    // Size+mtime stamps avoid re-hashing ~1 GB on every restart.
    if (valid && !(stamp?.sha256 === entry.sha256 && stamp.size === current.size && stamp.mtimeMs === current.mtimeMs)) {
      valid = (await hashFile(path)) === entry.sha256;
    }
    if (!valid) {
      await mkdir(dirname(path), { recursive: true });
      const url = new URL(entry.sha256 + extname(key), manifest.baseUrl).href;
      for (let attempt = 1; ; attempt += 1) {
        try {
          await download(url, entry, path, fetchImpl);
          break;
        } catch (error) {
          if (attempt >= downloadAttempts) throw new Error(`Media download failed for ${key}: ${error.message}`);
          log(JSON.stringify({ event: "media_download_retry", key, attempt, error: error.message }));
        }
      }
      downloaded += 1;
      downloadedBytes += entry.bytes;
      log(JSON.stringify({ event: "media_download", key, bytes: entry.bytes }));
    }
    const final = await stat(path);
    verified[key] = { sha256: entry.sha256, size: final.size, mtimeMs: final.mtimeMs };
  }
  if (JSON.stringify(verified) !== JSON.stringify(stamps)) {
    const temporary = join(root, `${stampName}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    await mkdir(root, { recursive: true });
    await writeFile(temporary, JSON.stringify(verified));
    await rename(temporary, join(root, stampName));
  }
  return { files: Object.keys(verified).length, downloaded, downloadedBytes };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

// Maintainer flow for new or changed media: place masters under the media
// root, regenerate the animation variants, re-pin media.json and stage the
// content-addressed upload set. Upload the staged files to the release named
// by baseUrl (gh release upload <tag> <stage>/*), then commit media.json.
export async function publishMedia({ root = mediaRoot, stage = join(root, ".upload") } = {}) {
  const { animationRoot, prepareAnimationVariants } = await import("./animation-variants.mjs");
  if (resolve(animationRoot) !== join(root, "animation-variants")) throw new Error("Publish from the configured media root");
  await prepareAnimationVariants({ root: animationRoot, sourceRoot: root });
  const files = {};
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for await (const path of walk(root)) {
    const key = relative(root, path).split(sep).join("/");
    if (!key.startsWith("assets/") && !key.startsWith("animation-variants/")) continue;
    assertKey(key);
    const sha256 = await hashFile(path);
    files[key] = { sha256, bytes: (await stat(path)).size };
    await link(path, join(stage, sha256 + extname(key))).catch((error) => { if (error.code !== "EEXIST") throw error; });
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(mediaManifestPath, JSON.stringify({ ...mediaManifest, files: sorted }, null, 2) + "\n");
  return { files: Object.keys(sorted).length, stage };
}

if (import.meta.main) {
  const command = process.argv[2] ?? "sync";
  if (command === "sync") console.info(JSON.stringify(await syncMedia()));
  else if (command === "publish") console.info(JSON.stringify(await publishMedia()));
  else throw new Error("Usage: bun scripts/media.mjs [sync|publish]");
}
