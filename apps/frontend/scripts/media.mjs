// Large frontend media (trailer, planet/moon animation masters and their
// precomputed size variants) lives outside git and outside the Docker image.
// media.json pins every file by sha256; the files themselves are release
// assets named <sha256><ext>. The server syncs them into a persistent media
// root (an Easypanel bind mount in production) before it listens, so a deploy
// with unchanged media downloads and writes nothing.
//
// The media root is shared by the old and new containers during a start-first
// deploy, so it is content-addressed: blobs/<sha256><ext> are immutable and
// only ever created by a verified atomic rename, and each media.json gets its
// own views/<id>/ tree of relative symlinks. Two revisions never overwrite
// each other's files.
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const mediaManifestPath = fileURLToPath(new URL("../media.json", import.meta.url));
export const loopAnimationManifestPath = fileURLToPath(new URL("../loopAnimations.json", import.meta.url));
export const mediaRoot = resolve(process.env.VEYDRIFT_MEDIA_ROOT || fileURLToPath(new URL("../.media/", import.meta.url)));
// Maintainer working copy for `publish`; never read by the server.
export const mediaSourceRoot = fileURLToPath(new URL("../.media-src/", import.meta.url));
export const mediaManifest = JSON.parse(readFileSync(mediaManifestPath, "utf8"));
const downloadAttempts = 3;
const downloadTimeoutMs = 15 * 60_000;

function assertKey(key) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid media path: " + key);
  }
}

function assertEntry(entry) {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
    throw new Error("Invalid media pin");
  }
}

const blobName = (key, entry) => entry.sha256 + extname(key);

// Entries a running server reads; publish-only inputs (e.g. moon masters that
// no route serves) stay in the release for maintainers.
export function servedMediaEntries(manifest = mediaManifest) {
  return Object.entries(manifest.files).filter(([, entry]) => !entry.publishOnly);
}

const viewIds = new WeakMap();

export function mediaViewRoot({ root = mediaRoot, manifest = mediaManifest } = {}) {
  let id = viewIds.get(manifest);
  if (!id) {
    id = createHash("sha256").update(JSON.stringify(servedMediaEntries(manifest))).digest("hex").slice(0, 16);
    viewIds.set(manifest, id);
  }
  return join(root, "views", id);
}

// Public files are addressed by URL path; animation variants only through the
// animation route, so they are not exposed here.
export function mediaFileForPathname(pathname, { root = mediaRoot, manifest = mediaManifest } = {}) {
  const key = pathname.replace(/^\/+/, "");
  if (!key.startsWith("assets/") || !Object.hasOwn(manifest.files, key) || manifest.files[key].publishOnly) return null;
  return join(mediaViewRoot({ root, manifest }), key);
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
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
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
    if (bytes !== entry.bytes || hash.digest("hex") !== entry.sha256) throw new Error("Media download does not match its pin");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// A container killed mid-download or mid-view leaves its temporary behind;
// anything older than one download timeout cannot belong to a live sync.
async function removeStaleTemporaries(dir) {
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".tmp")) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > downloadTimeoutMs) await rm(path, { recursive: true, force: true });
  }
}

async function viewIsCurrent(view, entries) {
  for (const [key, entry] of entries) {
    const link = join(view, key);
    if (await readlink(link).catch(() => null) !== relative(dirname(link), join(view, "..", "..", "blobs", blobName(key, entry)))) return false;
  }
  return true;
}

// Idempotent and safe to run from several containers at once (start-first
// deploys, rollbacks): blobs are immutable and views are per-pin-set.
export async function syncMedia({
  root = mediaRoot, manifest = mediaManifest, fetchImpl = fetch, log = console.info, retryDelayMs = 2_000, all = false,
} = {}) {
  const entries = all ? Object.entries(manifest.files) : servedMediaEntries(manifest);
  const blobs = join(root, "blobs");
  await mkdir(blobs, { recursive: true });
  await removeStaleTemporaries(blobs);
  await removeStaleTemporaries(join(root, "views"));
  let downloaded = 0;
  let downloadedBytes = 0;
  for (const [key, entry] of entries) {
    assertKey(key);
    assertEntry(entry);
    const path = join(blobs, blobName(key, entry));
    // Blobs are only ever created by a verified rename of their own content.
    const current = await stat(path).catch(() => null);
    if (current?.isFile() && current.size === entry.bytes) continue;
    if (current) await rm(path, { force: true });
    const url = new URL(blobName(key, entry), manifest.baseUrl).href;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await download(url, entry, path, fetchImpl);
        break;
      } catch (error) {
        if (attempt >= downloadAttempts) throw new Error(`Media download failed for ${key}: ${error.message}`);
        log(JSON.stringify({ event: "media_download_retry", key, attempt, error: error.message }));
        await new Promise((done) => setTimeout(done, retryDelayMs * 2 ** (attempt - 1)));
      }
    }
    downloaded += 1;
    downloadedBytes += entry.bytes;
    log(JSON.stringify({ event: "media_download", key, bytes: entry.bytes }));
  }
  const view = all ? join(root, "views", "all") : mediaViewRoot({ root, manifest });
  if (!(await viewIsCurrent(view, entries))) {
    const building = `${view}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      for (const [key, entry] of entries) {
        const link = join(building, key);
        await mkdir(dirname(link), { recursive: true });
        await symlink(relative(dirname(join(view, key)), join(blobs, blobName(key, entry))), link);
      }
      // A concurrent start of the same revision may have published it meanwhile.
      if (await viewIsCurrent(view, entries)) return { files: entries.length, downloaded, downloadedBytes };
      await rm(view, { recursive: true, force: true });
      await rename(building, view).catch(async (error) => {
        // Another process published the same view first.
        if (!(await viewIsCurrent(view, entries))) throw error;
      });
    } finally {
      await rm(building, { recursive: true, force: true });
    }
  }
  return { files: entries.length, downloaded, downloadedBytes };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

// Maintainer flow for new or changed media: `checkout` copies every pinned
// file (including publish-only masters) into .media-src/, edit masters there,
// then `publish` regenerates the animation variants, re-pins media.json (and
// loopAnimations.json) and stages the content-addressed upload set in
// .media-src/.upload/.
export async function checkoutMedia({ source = mediaSourceRoot } = {}) {
  await syncMedia({ all: true });
  for (const [key, entry] of Object.entries(mediaManifest.files)) {
    const path = join(source, key);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(mediaRoot, "blobs", blobName(key, entry)), path);
  }
  return { files: Object.keys(mediaManifest.files).length, source };
}

export async function publishMedia({ source = mediaSourceRoot, stage = join(source, ".upload") } = {}) {
  const {
    animationConfigs, describeLoopMasters, imageAnimationVariants, loopAnimationVariants, prepareAnimationVariants,
  } = await import("./animation-variants.mjs");
  const { LOOP_ANIMATION_MASTER_BASE } = await import("../loopAnimationConfig.ts");
  // The loop set and versions come from the masters present in the working copy.
  const loops = await describeLoopMasters(source);
  await prepareAnimationVariants({
    root: join(source, "animation-variants"), sourceRoot: source, variants: [...imageAnimationVariants, ...loopAnimationVariants(loops)],
  });
  // Masters whose width is not a served size are only variant inputs.
  const publishOnly = new Set(animationConfigs.filter((config) => !config.widths.includes(config.masterWidth))
    .flatMap((config) => config.types.map((type) => `${config.base.slice(1)}/${type}.webp`)));
  for (const name of Object.keys(loops)) publishOnly.add(`${LOOP_ANIMATION_MASTER_BASE}/${name}.mp4`);
  const files = {};
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for await (const path of walk(source)) {
    const key = relative(source, path).split(sep).join("/");
    if (!key.startsWith("assets/") && !key.startsWith("animation-variants/")) continue;
    assertKey(key);
    const sha256 = await hashFile(path);
    files[key] = { sha256, bytes: (await stat(path)).size, ...(publishOnly.has(key) ? { publishOnly: true } : {}) };
    await copyFile(path, join(stage, sha256 + extname(key)));
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(loopAnimationManifestPath, JSON.stringify(loops, null, 2) + "\n");
  await writeFile(mediaManifestPath, JSON.stringify({ ...mediaManifest, files: sorted }, null, 2) + "\n");
  return { files: Object.keys(sorted).length, stage };
}

if (import.meta.main) {
  const command = process.argv[2] ?? "sync";
  if (command === "sync") console.info(JSON.stringify(await syncMedia({ all: process.argv.includes("--all") })));
  else if (command === "checkout") console.info(JSON.stringify(await checkoutMedia()));
  else if (command === "publish") console.info(JSON.stringify(await publishMedia()));
  else throw new Error("Usage: bun scripts/media.mjs [sync [--all]|checkout|publish]");
}
