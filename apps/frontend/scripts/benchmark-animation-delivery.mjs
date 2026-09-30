// Run after bun run build. Starts TWO fresh frontend processes; never touches production.
// bun scripts/benchmark-animation-delivery.mjs > animation-delivery.json
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { animationVariants, animationRoot, animationFilename, assertAnimationVariantsReady } from "./animation-variants.mjs";

// Local fixture traffic must stay on loopback even in an HTTP-proxy shell.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const cwd = fileURLToPath(new URL("../", import.meta.url));
const disk = await assertAnimationVariantsReady();
let apiRequests = 0;
const mockApi = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
  apiRequests++;
  return Response.json({ mission: { missionType: "Transport", status: "Outbound" } });
} });
const report = { disk, maxVariants: animationVariants.length, boots: [], decoded: 0 };
try {
  for (let boot = 0; boot < 2; boot++) {
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port;
    await reservation.stop(true);
    const child = Bun.spawn([process.execPath, "scripts/serve.mjs"], {
      cwd, env: { ...process.env, PORT: String(port), VEYDRIFT_PUBLIC_API_URL: mockApi.url.origin },
      stdout: "pipe", stderr: "pipe",
    });
    // Drain output while running; a full diagnostic pipe must never stall the child.
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    let peakRssKiB = 0;
    const sample = () => {
      try { peakRssKiB = Math.max(peakRssKiB, Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim())); } catch { /* Child exited. */ }
    };
    const monitor = setInterval(sample, 100);
    const started = performance.now();
    const initialApiRequests = apiRequests;
    try {
      const origin = "http://127.0.0.1:" + port;
      let ready = false;
      while (performance.now() - started < 10_000) {
        if (child.exitCode !== null) throw new Error("Frontend exited before readiness");
        try { if ((await fetch(origin + "/", { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* Await bind. */ }
        await Bun.sleep(25);
      }
      assert(ready, "Frontend was not ready in 10s");
      const readyMs = performance.now() - started;
      sample();
      const baselineRssKiB = peakRssKiB;
      const rounds = [];
      for (const round of ["cold", "warm"]) {
        const request = async (path, animation = false) => {
          const start = performance.now();
          const response = await fetch(origin + path, { signal: AbortSignal.timeout(9_000) });
          const ttfbMs = performance.now() - start;
          const bytes = (await response.arrayBuffer()).byteLength;
          const totalMs = performance.now() - start;
          assert.equal(response.status, 200, path);
          assert(totalMs < 9_000, path);
          if (animation) {
            assert.equal(response.headers.get("x-veydrift-animation-source"), "precomputed");
            assert.equal(response.headers.get("x-veydrift-animation-cache"), round === "cold" ? "miss" : "hit");
            assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
            assert.equal(Number(response.headers.get("content-length")), bytes);
          }
          return { path, ttfbMs, totalMs, bytes };
        };
        const assets = animationVariants.map((r) => r.base + "/" + r.assetType + ".webp?size=" + r.size + "&v=" + r.version);
        // All 60 canonical variants in one page fan-out, beyond a normal sidebar/detail view.
        // Control HTML + real frontend metadata/API fetch run during that same burst.
        const controls = ["/", "/infrastructure", round === "cold" ? "/mission/1" : "/mission/2"];
        const all = await Promise.all([...assets.map((p) => request(p, true)), ...controls.map((p) => request(p))]);
        rounds.push({ round, assets: all.slice(0, assets.length), controls: all.slice(assets.length) });
        sample();
      }
      assert.equal(apiRequests - initialApiRequests, 2, "Both rounds must reach the API fixture, not metadata fallback/cache");
      report.boots.push({ readyMs, baselineRssKiB, peakRssKiB, apiRequests: apiRequests - initialApiRequests, rounds });
    } finally {
      clearInterval(monitor);
      child.kill();
      await child.exited;
      const log = (await stdout) + (await stderr);
      assert(!/animation_resize|client_disconnected|handler_pending|timed out/i.test(log), log);
    }
  }
  // Decode ALL frames sequentially after latency measurement, never flatten animations.
  sharp.cache(false);
  for (const route of animationVariants) {
    const path = join(animationRoot, animationFilename(route));
    const original = await sharp(join(cwd, "public", route.base, route.assetType + ".webp"), { animated: true }).metadata();
    const metadata = await sharp(path, { animated: true }).metadata();
    assert.equal(metadata.width, route.size);
    assert.equal(metadata.pageHeight, route.size);
    assert.equal(metadata.pages, original.pages);
    assert.equal(metadata.loop, original.loop);
    assert.deepEqual(metadata.delay, original.delay);
    const decoded = await sharp(path, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.height, route.size * original.pages);
    assert.equal(decoded.data.length, route.size * route.size * original.pages * decoded.info.channels);
    report.decoded++;
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await mockApi.stop(true); }
