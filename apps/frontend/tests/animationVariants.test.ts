import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  animationFilename, animationKey, animationVariants, assertAnimationVariantsReady,
  prepareAnimationVariants,
} from "../scripts/animation-variants.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "veydrift-animation-"));
  const sourceRoot = join(root, "source");
  const output = join(root, "output");
  const route = { ...animationVariants[0], size: 8 };
  const path = join(sourceRoot, route.base, route.assetType + ".webp");
  await mkdir(join(sourceRoot, route.base), { recursive: true });
  const pixels = Buffer.alloc(16 * 32 * 4, 255);
  pixels.fill(0, 0, 16 * 16 * 4);
  const source = await sharp(pixels, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } })
    .webp({ lossless: true, loop: 0, delay: [70, 90] }).toBuffer();
  await writeFile(path, source);
  return { root, source, path, route, options: { root: output, sourceRoot, variants: [route] } };
}

describe("bounded build-time animation variants", () => {
  test("deduplicates concurrent work, preserves all decoded frames/cadence, and reuses exact identities", async () => {
    const f = await fixture();
    try {
      const first = prepareAnimationVariants(f.options);
      expect(prepareAnimationVariants(f.options)).toBe(first);
      expect((await first).variants).toBe(1);
      const path = join(f.options.root, animationFilename(f.route));
      const metadata = await sharp(path, { animated: true }).metadata();
      const decoded = await sharp(path, { animated: true }).raw().toBuffer({ resolveWithObject: true });
      expect(metadata.pages).toBe(2);
      expect(metadata.pageHeight).toBe(8);
      expect(metadata.width).toBe(8);
      expect(metadata.delay).toEqual([70, 90]);
      expect(metadata.loop).toBe(0);
      expect(decoded.info.height).toBe(16);
      expect(decoded.data.length).toBe(8 * 16 * decoded.info.channels);
      const originalMtime = (await stat(path)).mtimeMs;
      await prepareAnimationVariants(f.options);
      expect((await stat(path)).mtimeMs).toBe(originalMtime);
      expect((await assertAnimationVariantsReady(f.options.root, [f.route])).variants).toBe(1);
      // Corruption is not accepted as an unchanged build-cache hit.
      await writeFile(path, "corrupt");
      await prepareAnimationVariants(f.options);
      expect((await sharp(path, { animated: true }).metadata()).pages).toBe(2);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("evicts failed preparation and fails readiness until repaired", async () => {
    const f = await fixture();
    try {
      await writeFile(f.path, "invalid WebP");
      await expect(prepareAnimationVariants(f.options)).rejects.toThrow();
      await expect(assertAnimationVariantsReady(f.options.root, [f.route])).rejects.toThrow();
      await writeFile(f.path, f.source);
      await prepareAnimationVariants(f.options);
      const output = join(f.options.root, animationFilename(f.route));
      await rm(output);
      await expect(assertAnimationVariantsReady(f.options.root, [f.route])).rejects.toThrow();
      await prepareAnimationVariants(f.options);
      expect((await assertAnimationVariantsReady(f.options.root, [f.route])).variants).toBe(1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("keys source/version/encoder identity, prunes old versions, and bounds the canonical set", async () => {
    const f = await fixture();
    const manifest = () => readFile(join(f.options.root, "manifest.json"), "utf8").then(JSON.parse);
    try {
      await prepareAnimationVariants(f.options);
      const key = animationKey(f.route);
      const identity = (await manifest())[key].identity;
      // Same timing, new source bytes: regeneration is required even if mtimes match.
      const changed = await sharp(f.source, { animated: true }).negate().webp({ lossless: true }).toBuffer();
      await writeFile(f.path, changed);
      await prepareAnimationVariants(f.options);
      expect((await manifest())[key].identity).not.toBe(identity);
      const wrongEncoder = await manifest();
      wrongEncoder[key].identity = "old encoder";
      await writeFile(join(f.options.root, "manifest.json"), JSON.stringify(wrongEncoder));
      await prepareAnimationVariants(f.options);
      expect((await manifest())[key].identity).not.toBe("old encoder");
      const next = { ...f.route, version: "next" };
      expect(animationFilename(next)).not.toBe(animationFilename(f.route));
      await prepareAnimationVariants({ ...f.options, variants: [next] });
      expect(Object.keys(await manifest())).toEqual([animationKey(next)]);
      await expect(stat(join(f.options.root, animationFilename(f.route)))).rejects.toThrow();
      expect(animationVariants.length).toBe(60);
      expect(new Set(animationVariants.map(animationFilename)).size).toBe(60);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
