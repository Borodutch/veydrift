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

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "sharp is required to generate image variants. Install it with:\n" +
      "  bun add -d sharp"
  );
  process.exit(1);
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_GAME_DIR = join(SCRIPT_DIR, "..", "public", "assets", "game");
const SIZES_DIR = join(PUBLIC_GAME_DIR, "sizes");

/** Canonical widths for UI use cases. */
const VARIANT_WIDTHS = [64, 256, 512];

/** Skip reference/concept images not used in the UI. */
const EXCLUDED_DIRS = new Set(["concepts", "style-pass"]); // style-pass subdirs are included, but style-pass/README.md etc are not

async function* walkGameImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
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

  for (const { fullPath, relPath, name } of images) {
    const originalRel = `/assets/game/${relPath.replace(/\\/g, "/")}`;
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
