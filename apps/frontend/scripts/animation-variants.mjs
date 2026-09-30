import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLANET_ANIMATION_BASE, PLANET_ANIMATION_TYPES, PLANET_ANIMATION_VERSION, PLANET_ANIMATION_WIDTHS,
  MOON_ANIMATION_BASE, MOON_ANIMATION_TYPES, MOON_ANIMATION_VERSION, MOON_ANIMATION_WIDTHS, MOON_ANIMATION_MASTER_WIDTH,
} from "../planetAnimationConfig.ts";

export const animationConfigs = [
  { base: PLANET_ANIMATION_BASE, types: PLANET_ANIMATION_TYPES, version: PLANET_ANIMATION_VERSION, widths: PLANET_ANIMATION_WIDTHS, masterWidth: 1024 },
  { base: MOON_ANIMATION_BASE, types: MOON_ANIMATION_TYPES, version: MOON_ANIMATION_VERSION, widths: MOON_ANIMATION_WIDTHS, masterWidth: MOON_ANIMATION_MASTER_WIDTH },
];
export const animationRoot = fileURLToPath(new URL("../.animation-variants/", import.meta.url));
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
// Bounded by the canonical allowlists: currently 60 derivatives, no historical versions.
export const animationVariants = animationConfigs.flatMap((config) => config.types.flatMap((assetType) =>
  config.widths.filter((size) => size !== config.masterWidth).map((size) => ({ ...config, assetType, size }))));
export const maxAnimationBytes = 512 * 1024 * 1024;
export function animationKey(route) { return `${route.version}:${route.base}:${route.assetType}:${route.size}`; }
export function animationFilename(route) { return createHash("sha256").update(animationKey(route)).digest("hex") + ".webp"; }
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const preparing = new Map();

// One preparation per root; all encodes are sequential, never request-driven.
// Rejected preparations are evicted so a corrected source can be retried.
export function prepareAnimationVariants({ root = animationRoot, sourceRoot = publicRoot, variants = animationVariants } = {}) {
  if (preparing.has(root)) return preparing.get(root);
  const work = prepare(root, sourceRoot, variants).finally(() => preparing.delete(root));
  preparing.set(root, work);
  return work;
}

async function prepare(root, sourceRoot, variants) {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);
  sharp.concurrency(1);
  await mkdir(root, { recursive: true });
  let previous = {};
  try { previous = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")); } catch { /* Cold build. */ }
  // Readiness is published only after the complete current build succeeds.
  await rm(join(root, "manifest.json"), { force: true });
  const expected = new Set(variants.map(animationFilename));
  for (const filename of await readdir(root)) {
    if (!expected.has(filename)) await rm(join(root, filename), { recursive: true, force: true });
  }
  const manifest = {};
  let bytes = 0;
  let sourcePath, source, sourceHash;
  for (const route of variants) {
    const nextPath = join(sourceRoot, route.base, route.assetType + ".webp");
    if (nextPath !== sourcePath) {
      sourcePath = nextPath;
      source = await readFile(sourcePath);
      sourceHash = hash(source);
    }
    const key = animationKey(route);
    const filename = animationFilename(route);
    const path = join(root, filename);
    const identity = hash(JSON.stringify({ key, sourceHash, encoder: sharp.versions, resize: "fill", quality: 82, effort: 4 }));
    let output;
    if (previous[key]?.identity === identity) {
      try {
        const existing = await readFile(path);
        if (hash(existing) === previous[key].sha256) output = existing;
      } catch { /* Missing/corrupt output must be regenerated. */ }
    }
    if (!output) {
      const started = performance.now();
      output = await sharp(source, { animated: true })
        .resize({ width: route.size, height: route.size, fit: "fill" })
        .webp({ quality: 82, effort: 4 }).toBuffer();
      const metadata = await sharp(output, { animated: true }).metadata();
      const original = await sharp(source, { animated: true }).metadata();
      if (metadata.width !== route.size || metadata.pageHeight !== route.size || metadata.pages !== original.pages
        || metadata.loop !== original.loop || JSON.stringify(metadata.delay) !== JSON.stringify(original.delay)) {
        throw new Error("Animation frame/cadence mismatch: " + key);
      }
      if (bytes + output.length > maxAnimationBytes) throw new Error("Animation disk budget exceeded");
      const temporary = path + ".tmp";
      try { await writeFile(temporary, output); await rename(temporary, path); }
      finally { await rm(temporary, { force: true }); }
      console.info(JSON.stringify({ event: "animation_precompute", key, bytes: output.length, durationMs: Math.round(performance.now() - started) }));
    }
    bytes += output.length;
    if (bytes > maxAnimationBytes) throw new Error("Animation disk budget exceeded");
    manifest[key] = { identity, sha256: hash(output), bytes: output.length };
  }
  await writeFile(join(root, "manifest.json.tmp"), JSON.stringify(manifest));
  await rename(join(root, "manifest.json.tmp"), join(root, "manifest.json"));
  return { variants: variants.length, bytes };
}

// Fail closed before listening, not after a user's first request. Only metadata
// is retained; response bodies are streamed from the image-layer files.
export async function assertAnimationVariantsReady(root = animationRoot, variants = animationVariants) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (Object.keys(manifest).length !== variants.length) throw new Error("Incomplete animation manifest");
  let bytes = 0;
  for (const route of variants) {
    const entry = manifest[animationKey(route)];
    const file = await stat(join(root, animationFilename(route)));
    if (!entry || !file.isFile() || file.size !== entry.bytes || !file.size) throw new Error("Missing animation variant: " + animationKey(route));
    bytes += file.size;
  }
  if (bytes > maxAnimationBytes) throw new Error("Animation disk budget exceeded");
  return { variants: variants.length, bytes };
}

if (import.meta.main) console.info(JSON.stringify(await prepareAnimationVariants()));
