import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOOP_ANIMATION_ALIASES, LOOP_ANIMATION_BASE, LOOP_ANIMATION_MASTER_BASE, LOOP_ANIMATION_STILL_BASE, LOOP_ANIMATION_WIDTHS,
  LOOP_ANIMATIONS, loopAnimationNameForStill, loopAnimationUrl, loopAnimationWidthFor, loopAnimationWidths,
} from "../loopAnimationConfig";
import {
  animationFilename, animationKey, animationRoot, animationVariants, assertAnimationVariantsReady, describeLoopMasters,
  imageAnimationVariants, loopAnimationVariants, prepareAnimationVariants,
} from "../scripts/animation-variants.mjs";
import { assertPinnedVariantsUnchanged, mediaManifest, syncMedia } from "../scripts/media.mjs";
import { clearPlanetAnimationCache, frontendResponse, loopAnimationRoute, planetAnimationCacheSize } from "../scripts/serve.mjs";
import { moonBuildingAsset, researchAssetByKey } from "../src/gameAssets";
import { buildingCatalog, defenseCatalog, researchCatalog, shipCatalog } from "../src/playableMvp";
import { readMp4, readWebm } from "./videoContainer";

// Same pinned media as the production server; no request may perform an encode.
beforeAll(() => syncMedia(), 1_800_000);

const loopNames = Object.keys(LOOP_ANIMATIONS);
const appStills = [
  ...buildingCatalog.map((building) => building.asset),
  ...(["lunarBase", "roboticsFactory", "jumpGate", "shipyard"] as const).map(moonBuildingAsset),
  ...shipCatalog.map((ship) => ship.asset),
  ...defenseCatalog.map((defense) => defense.asset),
  ...researchCatalog.map((research) => research.asset),
];
const request = (path: string, headers: Record<string, string> = {}) => frontendResponse(new Request(`http://localhost${path}`, { headers }));
const hasTool = (name: string) => { try { execFileSync(name, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };

describe("building/ship loop configuration", () => {
  test("ships the 47 approved loops, each resolved from the still the app actually renders", () => {
    expect(loopNames.sort()).toEqual([
      "buildings/crystal-mine-mid", "buildings/crystal-storage-mid", "buildings/deuterium-synthesizer-mid", "buildings/deuterium-tank-mid",
      "buildings/fusion-reactor-mid", "buildings/interdimensional-rift-stabilizer-mid", "buildings/jump-gate", "buildings/lunar-base",
      "buildings/metal-mine-mid", "buildings/metal-storage-mid", "buildings/missile-silo-mid", "buildings/moon-robotics-factory",
      "buildings/moon-shipyard", "buildings/research-lab-mid", "buildings/robotics-factory-mid", "buildings/shipyard-mid",
      "buildings/solar-plant-mid", "defenses/anti-ballistic-missile", "defenses/gauss-cannon", "defenses/heavy-laser",
      "defenses/interplanetary-missile", "defenses/ion-cannon", "defenses/large-shield-dome", "defenses/light-laser",
      "defenses/plasma-turret", "defenses/rocket-launcher", "defenses/small-shield-dome", "research/armor", "research/astrophysics",
      "research/combustion-drive", "research/energy", "ships/battlecruiser", "ships/battleship",
      "ships/bomber", "ships/colony-ship", "ships/crawler-approved", "ships/cruiser", "ships/deathstar", "ships/destroyer",
      "ships/heavy-fighter", "ships/large-cargo", "ships/light-fighter", "ships/pathfinder", "ships/reaper-symmetric", "ships/recycler",
      "ships/small-cargo", "ships/solar-satellite",
    ]);
    // Every ship and defense the app renders now plays a loop.
    for (const unit of [...shipCatalog, ...defenseCatalog]) expect([unit.key, loopAnimationNameForStill(unit.asset)]).toEqual([unit.key, expect.any(String)]);
    const resolved = new Map(appStills.flatMap((src) => {
      const name = loopAnimationNameForStill(src);
      return name ? [[src, name] as const] : [];
    }));
    // Every loop is reachable from the app, plus the three shared-art aliases.
    expect(new Set(resolved.values())).toEqual(new Set(loopNames));
    expect(resolved.size).toBe(50);
    expect(loopAnimationNameForStill(buildingCatalog.find((building) => building.key === "shipyard")!.asset)).toBe("buildings/shipyard-mid");
    // Research surfaces (tiles, detail, queues, planet/empire rows) all render the catalog asset.
    for (const [key, name] of [["armor", "armor"], ["astrophysics", "astrophysics"], ["combustionDrive", "combustion-drive"], ["energy", "energy"]]) {
      expect(loopAnimationNameForStill(researchCatalog.find((research) => research.key === key)!.asset)).toBe(`research/${name}`);
    }
    for (const [alias, target] of Object.entries(LOOP_ANIMATION_ALIASES)) {
      const still = (name: string) => readFileSync(new URL(`../public${LOOP_ANIMATION_STILL_BASE}/${name}.webp`, import.meta.url));
      // Aliases are only valid while production renders byte-identical art.
      expect(still(alias).equals(still(target))).toBe(true);
      expect(appStills).toContain(`${LOOP_ANIMATION_STILL_BASE}/${alias}.webp`);
      expect(loopAnimationNameForStill(`${LOOP_ANIMATION_STILL_BASE}/${alias}.webp`)).toBe(target);
    }
    for (const name of loopNames) {
      expect(readFileSync(new URL(`../public${LOOP_ANIMATION_STILL_BASE}/${name}.webp`, import.meta.url)).length).toBeGreaterThan(0);
    }
  });

  test("keeps the still for assets without a loop", () => {
    for (const src of [
      `${LOOP_ANIMATION_STILL_BASE}/rift-under-construction.webp`, `${LOOP_ANIMATION_STILL_BASE}/ships/crawler.webp`,
      researchAssetByKey.plasma, researchAssetByKey.weapons,
      "/assets/game/style-pass/generated/planets/lush-temperate.webp", "/assets/game/planet-animations/frozen-ice.webp",
      `${LOOP_ANIMATION_STILL_BASE}/ships/cruiser.png`, `${LOOP_ANIMATION_STILL_BASE}/ships/cruiser`, "/assets/game/buildings/metal-mine-mid.webp",
    ]) expect(loopAnimationNameForStill(src)).toBeUndefined();
  });

  test("advertises only bounded versioned sizes, never the 720 px master", () => {
    expect([...LOOP_ANIMATION_WIDTHS]).toEqual([64, 128, 256, 512]);
    for (const [name, loop] of Object.entries(LOOP_ANIMATIONS)) {
      expect(loop).toEqual({ version: expect.stringMatching(/^[0-9a-f]{12}$/), width: 720, frames: 84, fps: 24 });
      expect(loopAnimationWidths(loop)).toEqual([64, 128, 256, 512]);
      expect(loopAnimationUrl(name, "webm", 256)).toBe(`${LOOP_ANIMATION_BASE}/${name}.webm?size=256&v=${loop.version}`);
      expect(loopAnimationUrl(name, "mp4", 64)).toBe(`${LOOP_ANIMATION_BASE}/${name}.mp4?size=64&v=${loop.version}`);
      for (const size of [0, 100, 720, 1024]) expect(() => loopAnimationUrl(name, "webm", size)).toThrow();
    }
    expect(loopAnimationWidths({ width: 200 })).toEqual([64, 128]);
    expect(() => loopAnimationUrl("ships/crawler", "webm", 64)).toThrow();
    expect(() => loopAnimationUrl("toString", "webm", 64)).toThrow();
    // Rendered px x device pixel ratio picks the smallest covering size.
    expect([20, 64, 65, 88, 128, 200, 256, 300, 696, 2000].map((px) => loopAnimationWidthFor("ships/cruiser", px)))
      .toEqual([64, 64, 128, 128, 128, 256, 256, 512, 512, 512]);
  });

  test("pins every loop variant as served media and every master as publish-only", () => {
    const files = mediaManifest.files;
    for (const name of loopNames) expect(files[`${LOOP_ANIMATION_MASTER_BASE}/${name}.mp4`]?.publishOnly).toBe(true);
    const loops = loopAnimationVariants();
    expect(loops.length).toBe(loopNames.length * 4 * 2);
    for (const route of loops) expect(files[`animation-variants/${animationFilename(route)}`]?.publishOnly).toBeUndefined();
    // The server readiness gate covers the loops too.
    expect(animationVariants).toEqual([...imageAnimationVariants, ...loops]);
    expect(new Set(animationVariants.map(animationFilename)).size).toBe(animationVariants.length);
  });
});

describe("loop variant route", () => {
  const cruiser = LOOP_ANIMATIONS["ships/cruiser"]!;

  test("rejects an unknown name, extension, size or version before any file lookup", async () => {
    clearPlanetAnimationCache();
    const cases: Array<[string, number]> = [
      [`/assets/game/loops/ships/crawler.webm?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/ships/cruiser.webp?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/ships/cruiser.mkv?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/ships/cruiser?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/cruiser.webm?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/ships/toString.webm?size=64&v=${cruiser.version}`, 404],
      // URL parsing folds the dot segments, leaving an unknown name.
      [`/assets/game/loops/ships/%2e%2e/cruiser.webm?size=64&v=${cruiser.version}`, 404],
      [`/assets/game/loops/ships/cruiser.webm?v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.webm?size=720&v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.mp4?size=1024&v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.webm?size=100&v=${cruiser.version}`, 400],
      // One spelling per size, so a variant has a single CDN cache key.
      [`/assets/game/loops/ships/cruiser.webm?size=64.0&v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.webm?size=0x40&v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.webm?size=%2B64&v=${cruiser.version}`, 400],
      [`/assets/game/loops/ships/cruiser.webm?size=%2064&v=${cruiser.version}`, 400],
      ["/assets/game/loops/ships/cruiser.webm?size=64", 400],
      ["/assets/game/loops/ships/cruiser.webm?size=64&v=stale", 400],
      [`/assets/game/loop-masters/ships/cruiser.mp4`, 404],
    ];
    for (const [path, status] of cases) {
      const response = await request(path);
      expect([path, response.status]).toEqual([path, status]);
      expect(response.headers.get("cache-control")).toBeNull();
    }
    expect(planetAnimationCacheSize()).toBe(0);
    expect(loopAnimationRoute(new URL("http://localhost/assets/game/planet-animations/frozen-ice.webp"))).toBeNull();
  });

  test("serves immutable WebM/MP4 variants with byte ranges for Safari", async () => {
    clearPlanetAnimationCache();
    for (const [format, type] of [["webm", "video/webm"], ["mp4", "video/mp4"]] as const) {
      const path = loopAnimationUrl("ships/cruiser", format, 256);
      const route = loopAnimationRoute(new URL(`http://localhost${path}`));
      const pinned = mediaManifest.files[`animation-variants/${animationFilename(route as never)}`]!;
      const bytes = new Uint8Array(await readFile(join(animationRoot, animationFilename(route as never))));
      const whole = await request(path);
      expect(whole.status).toBe(200);
      expect(whole.headers.get("content-type")).toBe(type);
      expect(whole.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(whole.headers.get("accept-ranges")).toBe("bytes");
      expect(whole.headers.get("content-length")).toBe(String(pinned.bytes));
      expect(whole.headers.get("x-veydrift-animation-source")).toBe("precomputed");
      expect(whole.headers.get("x-veydrift-animation-cache")).toBe("miss");
      expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

      const part = await request(path, { range: "bytes=0-1" });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe(`bytes 0-1/${pinned.bytes}`);
      expect(part.headers.get("content-type")).toBe(type);
      expect(part.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(part.headers.get("x-veydrift-animation-cache")).toBe("hit");
      expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(0, 2));
      const tail = await request(path, { range: "bytes=-100" });
      expect(tail.status).toBe(206);
      expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.length - 100));
      const unsatisfiable = await request(path, { range: `bytes=${pinned.bytes}-` });
      expect(unsatisfiable.status).toBe(416);
      expect(unsatisfiable.headers.get("cache-control")).toBeNull();
    }
    // Only bounded file metadata is cached, one entry per variant.
    expect(planetAnimationCacheSize()).toBe(2);
  });

  test("every pinned variant matches its master's size, frame count, frame rate and duration", async () => {
    for (const route of loopAnimationVariants()) {
      const loop = LOOP_ANIMATIONS[route.assetType]!;
      const bytes = new Uint8Array(await readFile(join(animationRoot, animationFilename(route))));
      const info = route.format === "webm" ? readWebm(bytes) : readMp4(bytes);
      const where = animationKey(route);
      expect([where, info.width, info.height, info.frames]).toEqual([where, route.size, route.size, loop.frames]);
      expect(Math.abs(info.fps - loop.fps)).toBeLessThan(0.05);
      expect(Math.abs(info.duration - loop.frames / loop.fps)).toBeLessThan(1 / loop.fps);
    }
  });
});

describe("publish-time loop encoding and readiness", () => {
  async function fixture(frames = 12) {
    const root = await mkdtemp(join(tmpdir(), "veydrift-loop-"));
    const sourceRoot = join(root, "source");
    await mkdir(join(sourceRoot, LOOP_ANIMATION_MASTER_BASE, "ships"), { recursive: true });
    const master = join(sourceRoot, LOOP_ANIMATION_MASTER_BASE, "ships", "fixture.mp4");
    return { root, sourceRoot, master, output: join(root, "output"), frames };
  }

  test("the server does not start until every loop variant is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "veydrift-loop-ready-"));
    try {
      const variants = loopAnimationVariants({ "ships/fixture": { version: "0123456789ab", width: 720, frames: 84, fps: 24 } });
      const manifest: Record<string, { identity: string; sha256: string; bytes: number }> = {};
      for (const route of variants) {
        await writeFile(join(root, animationFilename(route)), "variant");
        manifest[animationKey(route)] = { identity: "fixture", sha256: "fixture", bytes: 7 };
      }
      await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
      expect(await assertAnimationVariantsReady(root, variants)).toEqual({ variants: 8, bytes: 56 });
      await rm(join(root, animationFilename(variants.at(-1)!)));
      await expect(assertAnimationVariantsReady(root, variants)).rejects.toThrow();
      // The real serve entry point awaits the same gate (with loops) before Bun.serve.
      const serve = await readFile(new URL("../scripts/serve.mjs", import.meta.url), "utf8");
      expect(serve.indexOf("await assertAnimationVariantsReady();")).toBeGreaterThan(-1);
      expect(serve.indexOf("await assertAnimationVariantsReady();")).toBeLessThan(serve.indexOf("Bun.serve({"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("publish refuses new bytes under an already pinned versioned variant URL", () => {
    const pin = (sha: string) => ({ sha256: sha.repeat(64), bytes: 1 });
    const previous = { "animation-variants/a.webm": pin("a"), "animation-variants/manifest.json": pin("m"), "assets/x.webp": pin("x") };
    expect(() => assertPinnedVariantsUnchanged(previous, { ...previous, "animation-variants/b.webm": pin("b") })).not.toThrow();
    expect(() => assertPinnedVariantsUnchanged(previous, { ...previous, "animation-variants/manifest.json": pin("n"), "assets/x.webp": pin("y") })).not.toThrow();
    expect(() => assertPinnedVariantsUnchanged(previous, { ...previous, "animation-variants/a.webm": pin("c") })).toThrow("Variant bytes changed");
  });

  test.skipIf(!hasTool("ffmpeg") || !hasTool("ffprobe"))("derives the loop set from the masters and rejects unusable ones", async () => {
    const f = await fixture();
    const stills = join(f.root, "stills");
    const encode = (size: number, path: string, color = "red") => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      `color=c=${color}:size=${size}x${size}:rate=24:duration=0.5`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
    try {
      await mkdir(join(stills, "ships"), { recursive: true });
      await writeFile(join(stills, "ships", "fixture.webp"), "still");
      const stillRoot = new URL(`file://${stills}/`);
      encode(512, f.master);
      const described = await describeLoopMasters(f.sourceRoot, stillRoot);
      expect(described).toEqual({ "ships/fixture": { version: expect.stringMatching(/^[0-9a-f]{12}$/), width: 512, frames: 12, fps: 24 } });
      // A redone master gets a new version automatically.
      encode(512, f.master, "blue");
      expect((await describeLoopMasters(f.sourceRoot, stillRoot))["ships/fixture"]!.version).not.toBe(described["ships/fixture"]!.version);
      encode(256, f.master);
      await expect(describeLoopMasters(f.sourceRoot, stillRoot)).rejects.toThrow("at least 512 px");
      encode(512, f.master);
      await rm(join(stills, "ships", "fixture.webp"));
      await expect(describeLoopMasters(f.sourceRoot, stillRoot)).rejects.toThrow("no still");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 60_000);

  test.skipIf(!hasTool("ffmpeg") || !hasTool("ffprobe"))("encodes every frame at the master cadence and rejects a mismatch", async () => {
    const f = await fixture();
    try {
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc=size=64x64:rate=24:duration=${f.frames / 24}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", f.master]);
      const loop = { version: "0123456789ab", width: 64, frames: f.frames, fps: 24 };
      const variants = loopAnimationVariants({ "ships/fixture": loop }).map((route) => ({ ...route, size: 16 }));
      expect((await prepareAnimationVariants({ root: f.output, sourceRoot: f.sourceRoot, variants })).variants).toBe(2);
      for (const route of variants) {
        const bytes = new Uint8Array(await readFile(join(f.output, animationFilename(route))));
        const info = route.format === "webm" ? readWebm(bytes) : readMp4(bytes);
        expect([info.width, info.height, info.frames]).toEqual([16, 16, f.frames]);
        expect(Math.abs(info.fps - 24)).toBeLessThan(0.05);
        expect(Math.abs(info.duration - f.frames / 24)).toBeLessThan(1 / 24);
      }
      expect((await assertAnimationVariantsReady(f.output, variants)).variants).toBe(2);
      // A variant that would not match the master's frames fails publish and readiness.
      const wrong = variants.map((route) => ({ ...route, version: "fedcba987654", frames: f.frames + 1 }));
      await expect(prepareAnimationVariants({ root: f.output, sourceRoot: f.sourceRoot, variants: wrong })).rejects.toThrow("Loop frame/cadence mismatch");
      await expect(assertAnimationVariantsReady(f.output, wrong)).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 60_000);
});
