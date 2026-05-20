#!/usr/bin/env node
/**
 * Build-time image variant generator for Veydrift game assets.
 *
 * Scans public/assets/game/ for .webp images and generates smaller
 * variants at canonical sizes used by the UI. Variants are written to
 * public/assets/game/sizes/<width>/<original-relative-path> so they are
 * copied into dist/ by Vite without extra config.
 *
 * Usage:
 *   bun scripts/generate-image-variants.mjs
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

let sharpModule;
async function getSharp({ required = true } = {}) {
  if (sharpModule) return sharpModule;

  try {
    sharpModule = (await import("sharp")).default;
    return sharpModule;
  } catch (error) {
    if (!required) return null;

    console.error(
      "sharp is required when image variants are missing or stale. Install it with:\n" +
        "  bun add -d sharp"
    );
    if (error instanceof Error && error.message) {
      console.error(`Import error: ${error.message}`);
    }
    process.exit(1);
  }
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_GAME_DIR = join(SCRIPT_DIR, "..", "public", "assets", "game");
const SIZES_DIR = join(PUBLIC_GAME_DIR, "sizes");

/** Canonical widths for UI use cases. */
const VARIANT_WIDTHS = [64, 256, 512];

/** Skip reference/concept images not used in the UI. */
const EXCLUDED_DIRS = new Set(["concepts", "style-pass"]); // style-pass subdirs are included, but style-pass/README.md etc are not

async function readExistingManifest() {
  const manifestPath = join(SIZES_DIR, "manifest.json");
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return {};
  }
}

async function* walkGameImages(dir) {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(PUBLIC_GAME_DIR, fullPath);

    if (entry.isDirectory()) {
      // Skip the output directory to avoid infinite recursion
      if (entry.name === "sizes") continue;
      // Skip concept/reference directories entirely
      if (entry.name === "concepts") continue;
      // Recurse into everything else (buildings, ships, planets, style-pass, etc.)
      yield* walkGameImages(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".webp")) continue;

    yield { fullPath, relPath, name: entry.name };
  }
}

async function generateVariant(originalPath, relPath, targetWidth) {
  const sizeDir = join(SIZES_DIR, String(targetWidth), dirname(relPath));
  const outPath = join(sizeDir, basename(relPath));

  // Skip if variant already exists and is newer than original
  try {
    const [origStat, varStat] = await Promise.all([
      stat(originalPath),
      stat(outPath),
    ]);
    if (varStat.mtimeMs >= origStat.mtimeMs) {
      return { outPath, skipped: true };
    }
  } catch {
    // Variant doesn't exist yet — proceed
  }

  await mkdir(sizeDir, { recursive: true });

  const sharp = await getSharp();
  await sharp(originalPath)
    .resize({
      width: targetWidth,
      height: targetWidth,
      fit: "inside", // preserve aspect ratio, max dimension = targetWidth
      withoutEnlargement: true,
    })
    .webp({ quality: 85, effort: 4 })
    .toFile(outPath);

  return { outPath, skipped: false };
}

async function getCurrentManifestEntry(originalPath, relPath, originalRel, existingManifest, { checkFreshness }) {
  const existingEntry = existingManifest[originalRel];
  if (!existingEntry || typeof existingEntry.width !== "number" || typeof existingEntry.height !== "number") {
    return null;
  }

  const origStat = checkFreshness ? await stat(originalPath) : null;
  const variants = existingEntry.variants ?? {};

  for (const w of VARIANT_WIDTHS) {
    if (w >= existingEntry.width) continue;

    const expectedVariantRel = `/assets/game/sizes/${w}/${relPath.replace(/\\/g, "/")}`;
    if (variants[w] !== expectedVariantRel) return null;

    const outPath = join(SIZES_DIR, String(w), dirname(relPath), basename(relPath));
    try {
      const varStat = await stat(outPath);
      if (origStat && varStat.mtimeMs < origStat.mtimeMs) return null;
    } catch {
      return null;
    }
  }

  return existingEntry;
}

async function main() {
  console.log("🔧 Generating image variants for Veydrift assets...\n");

  const images = [];
  for await (const img of walkGameImages(PUBLIC_GAME_DIR)) {
    images.push(img);
  }

  if (images.length === 0) {
    console.log("No .webp images found in public/assets/game/");
    return;
  }

  let generated = 0;
  let skipped = 0;
  const manifest = {};
  const existingManifest = await readExistingManifest();

  for (const { fullPath, relPath, name } of images) {
    const originalRel = `/assets/game/${relPath.replace(/\\/g, "/")}`;
    const currentEntry = await getCurrentManifestEntry(fullPath, relPath, originalRel, existingManifest, {
      checkFreshness: true,
    });
    if (currentEntry) {
      manifest[originalRel] = currentEntry;

      const cachedWidths = VARIANT_WIDTHS.filter((w) => w < currentEntry.width).length;
      skipped += cachedWidths;

      const label = `  ${relPath} (${currentEntry.width}×${currentEntry.height})`;
      const results = VARIANT_WIDTHS.map((w) => (w >= currentEntry.width ? `${w}w→original` : `${w}w✓`));
      console.log(`${label}  ${results.join(", ")}`);
      continue;
    }

    const reusableEntry = await getCurrentManifestEntry(fullPath, relPath, originalRel, existingManifest, {
      checkFreshness: false,
    });
    const sharp = await getSharp({ required: !reusableEntry });
    if (!sharp && reusableEntry) {
      manifest[originalRel] = reusableEntry;

      const cachedWidths = VARIANT_WIDTHS.filter((w) => w < reusableEntry.width).length;
      skipped += cachedWidths;

      const label = `  ${relPath} (${reusableEntry.width}×${reusableEntry.height})`;
      const results = VARIANT_WIDTHS.map((w) => (w >= reusableEntry.width ? `${w}w→original` : `${w}w✓`));
      console.warn(`${label}  ${results.join(", ")} (reused; sharp unavailable)`);
      continue;
    }

    const meta = await sharp(fullPath).metadata();
    const width = meta.width ?? 1024;
    const height = meta.height ?? 1024;

    manifest[originalRel] = {
      width,
      height,
      variants: {},
    };

    const label = `  ${relPath} (${width}×${height})`;
    const results = [];

    for (const w of VARIANT_WIDTHS) {
      if (w >= width) {
        // Skip variant larger than or equal to original
        manifest[originalRel].variants[w] = originalRel;
        results.push(`${w}w→original`);
        continue;
      }
      const { skipped: didSkip } = await generateVariant(fullPath, relPath, w);
      const variantRel = `/assets/game/sizes/${w}/${relPath.replace(/\\/g, "/")}`;
      manifest[originalRel].variants[w] = variantRel;
      if (didSkip) {
        skipped++;
        results.push(`${w}w✓`);
      } else {
        generated++;
        results.push(`${w}w✨`);
      }
    }

    console.log(`${label}  ${results.join(", ")}`);
  }

  // Write manifest for potential future use (component currently uses convention-based paths)
  const manifestPath = join(SIZES_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📝 Wrote manifest: ${relative(join(SCRIPT_DIR, ".."), manifestPath)}`);

  console.log(
    `\n✅ Done: ${generated} variants generated, ${skipped} already up-to-date, ${images.length} source images.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
