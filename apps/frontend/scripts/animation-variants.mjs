import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { mediaSourceRoot, mediaViewRoot } from "./media.mjs";
import {
  PLANET_ANIMATION_BASE, PLANET_ANIMATION_TYPES, PLANET_ANIMATION_VERSION, PLANET_ANIMATION_WIDTHS,
  MOON_ANIMATION_BASE, MOON_ANIMATION_TYPES, MOON_ANIMATION_VERSION, MOON_ANIMATION_WIDTHS, MOON_ANIMATION_MASTER_WIDTH,
} from "../planetAnimationConfig.ts";
import {
  LOOP_ANIMATION_BASE, LOOP_ANIMATION_FORMATS, LOOP_ANIMATION_MASTER_BASE, LOOP_ANIMATION_STILL_BASE, LOOP_ANIMATION_WIDTHS,
  LOOP_ANIMATIONS, loopAnimationWidths,
} from "../loopAnimationConfig.ts";

export const animationConfigs = [
  { base: PLANET_ANIMATION_BASE, types: PLANET_ANIMATION_TYPES, version: PLANET_ANIMATION_VERSION, widths: PLANET_ANIMATION_WIDTHS, masterWidth: 1024 },
  { base: MOON_ANIMATION_BASE, types: MOON_ANIMATION_TYPES, version: MOON_ANIMATION_VERSION, widths: MOON_ANIMATION_WIDTHS, masterWidth: MOON_ANIMATION_MASTER_WIDTH },
];

// Every ffmpeg argument of a loop encode except the input/output paths; {size}
// and {frames} are filled per variant. The whole template (and the ffmpeg
// build) is part of every loop version, so changing any of it re-versions the
// loop URLs instead of changing bytes behind an immutable URL. A fixed thread
// count keeps the output independent of the machine's CPU count.
const loopCommon = ["-vf", "scale={size}:{size}:flags=lanczos", "-an", "-g", "{frames}", "-threads", "4", "-pix_fmt", "yuv420p"];
export const loopEncoding = {
  webm: [...loopCommon, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-deadline", "good", "-cpu-used", "1", "-row-mt", "1", "-f", "webm"],
  mp4: [...loopCommon, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-profile:v", "high", "-movflags", "+faststart", "-f", "mp4"],
};
const loopArgs = (route) => loopEncoding[route.format].map((arg) => arg.replaceAll("{size}", String(route.size)).replaceAll("{frames}", String(route.frames)));

// Each served loop size in both formats, never larger than its master.
export function loopAnimationVariants(loops = LOOP_ANIMATIONS) {
  return Object.entries(loops).flatMap(([assetType, loop]) => loopAnimationWidths(loop).flatMap((size) =>
    LOOP_ANIMATION_FORMATS.map((format) => ({
      base: LOOP_ANIMATION_BASE, assetType, version: loop.version, size, format, masterWidth: loop.width, frames: loop.frames, fps: loop.fps,
    }))));
}

// Masters and their precomputed variants are pinned media (see media.mjs). The
// server reads them from the synced view; variants are generated only in the
// maintainer's publish working copy, never during a build.
export const animationRoot = join(mediaViewRoot(), "animation-variants");
// Bounded by the canonical allowlists: 60 planet/moon derivatives plus every
// loop size in both formats, no historical versions.
export const imageAnimationVariants = animationConfigs.flatMap((config) => config.types.flatMap((assetType) =>
  config.widths.filter((size) => size !== config.masterWidth).map((size) => ({ ...config, assetType, size }))));
export const animationVariants = [...imageAnimationVariants, ...loopAnimationVariants()];
export const maxAnimationBytes = 512 * 1024 * 1024;
export function animationKey(route) {
  return `${route.version}:${route.base}:${route.assetType}:${route.size}` + (route.format ? `:${route.format}` : "");
}
export function animationFilename(route) {
  return createHash("sha256").update(animationKey(route)).digest("hex") + (route.format ? `.${route.format}` : ".webp");
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG || "ffmpeg";
const ffprobe = () => process.env.FFPROBE || "ffprobe";
const preparing = new Map();
// The full -version output: release, configuration and library versions.
const ffmpegBuild = async () => hash((await run(ffmpeg(), ["-version"])).stdout);

export async function probeVideo(path) {
  const { stdout } = await run(ffprobe(), [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,nb_read_frames:format=duration", "-of", "json", path,
  ]);
  const { streams: [video] = [], format = {} } = JSON.parse(stdout);
  const [numerator, denominator] = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: video?.width, height: video?.height, frames: Number(video?.nb_read_frames),
    fps: numerator / (denominator || 1), duration: Number(format.duration),
  };
}

// Masters dropped into <source>/<LOOP_ANIMATION_MASTER_BASE>/<category>/<still>.mp4
// define the loop set (publish only).
export async function describeLoopMasters(source = mediaSourceRoot, stillRoot = new URL(`../public${LOOP_ANIMATION_STILL_BASE}/`, import.meta.url)) {
  const root = join(source, LOOP_ANIMATION_MASTER_BASE);
  let encoder;
  const loops = {};
  for (const category of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory())) {
    for (const file of (await readdir(join(root, category.name))).filter((name) => name.endsWith(".mp4")).sort()) {
      const name = `${category.name}/${file.slice(0, -".mp4".length)}`;
      if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) throw new Error("Invalid loop master name: " + name);
      if (!existsSync(new URL(`${name}.webp`, stillRoot))) throw new Error("Loop master has no still to replace: " + name);
      const path = join(root, category.name, file);
      const master = await probeVideo(path);
      if (master.width !== master.height || master.width < Math.max(...LOOP_ANIMATION_WIDTHS) || !(master.frames > 0)
        || !Number.isInteger(master.fps) || Math.abs(master.duration - master.frames / master.fps) > 1 / master.fps) {
        throw new Error(`Loop master must be square, at least ${Math.max(...LOOP_ANIMATION_WIDTHS)} px, whole-number fps, constant frame rate: ${name}`);
      }
      encoder ??= await ffmpegBuild();
      const version = hash(JSON.stringify({ master: hash(await readFile(path)), encoder, loopEncoding })).slice(0, 12);
      loops[name] = { version, width: master.width, frames: master.frames, fps: master.fps };
    }
  }
  return Object.fromEntries(Object.entries(loops).sort(([a], [b]) => a.localeCompare(b)));
}

// One preparation per root; all encodes are sequential, never request-driven.
// Rejected preparations are evicted so a corrected source can be retried.
export function prepareAnimationVariants({
  root = join(mediaSourceRoot, "animation-variants"), sourceRoot = mediaSourceRoot, variants = animationVariants,
} = {}) {
  if (preparing.has(root)) return preparing.get(root);
  const work = prepare(root, sourceRoot, variants).finally(() => preparing.delete(root));
  preparing.set(root, work);
  return work;
}

async function encodeImage(sharp, source, route, key) {
  const output = await sharp(source, { animated: true })
    .resize({ width: route.size, height: route.size, fit: "fill" })
    .webp({ quality: 82, effort: 4 }).toBuffer();
  const metadata = await sharp(output, { animated: true }).metadata();
  const original = await sharp(source, { animated: true }).metadata();
  if (metadata.width !== route.size || metadata.pageHeight !== route.size || metadata.pages !== original.pages
    || metadata.loop !== original.loop || JSON.stringify(metadata.delay) !== JSON.stringify(original.delay)) {
    throw new Error("Animation frame/cadence mismatch: " + key);
  }
  return output;
}

async function encodeLoop(sourcePath, master, route, key, temporary) {
  await run(ffmpeg(), ["-v", "error", "-y", "-i", sourcePath, ...loopArgs(route), temporary]);
  const variant = await probeVideo(temporary);
  if (variant.width !== route.size || variant.height !== route.size || variant.frames !== master.frames
    || variant.frames !== route.frames || variant.fps !== master.fps || variant.fps !== route.fps
    || Math.abs(variant.duration - master.duration) > 1 / master.fps) {
    throw new Error("Loop frame/cadence mismatch: " + key);
  }
  return readFile(temporary);
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
  let encoder;
  let sourcePath, source, sourceHash, master;
  for (const route of variants) {
    const nextPath = route.format
      ? join(sourceRoot, LOOP_ANIMATION_MASTER_BASE, route.assetType + ".mp4")
      : join(sourceRoot, route.base, route.assetType + ".webp");
    if (nextPath !== sourcePath) {
      sourcePath = nextPath;
      source = await readFile(sourcePath);
      sourceHash = hash(source);
      master = undefined;
    }
    if (route.format) encoder ??= await ffmpegBuild();
    const key = animationKey(route);
    const filename = animationFilename(route);
    const path = join(root, filename);
    const identity = route.format
      ? hash(JSON.stringify({ key, sourceHash, encoder, args: loopArgs(route) }))
      : hash(JSON.stringify({ key, sourceHash, encoder: sharp.versions, resize: "fill", quality: 82, effort: 4 }));
    let output;
    if (previous[key]?.identity === identity) {
      try {
        const existing = await readFile(path);
        if (hash(existing) === previous[key].sha256) output = existing;
      } catch { /* Missing/corrupt output must be regenerated. */ }
    }
    if (!output) {
      const started = performance.now();
      const temporary = path + ".tmp";
      try {
        if (route.format) {
          master ??= await probeVideo(sourcePath);
          output = await encodeLoop(sourcePath, master, route, key, temporary);
        } else {
          output = await encodeImage(sharp, source, route, key);
        }
        if (bytes + output.length > maxAnimationBytes) throw new Error("Animation disk budget exceeded");
        await writeFile(temporary, output);
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
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
// is retained; response bodies are streamed from the media-root files.
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
