// Run from apps/frontend: node --test tests/loopAnimations.browser.mjs
// Real components, the real dev media route (synced pinned media) and local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("building/ship loops play lazily at a bounded size, in the still's exact box, and fall back to the still (#133)", { timeout: 300_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered loop regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-loops-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/loopAnimations.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    function send(method, params = {}, page = true) {
      const commandId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 30_000);
        pending.set(commandId, { resolve, reject, timer });
        chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
      });
    }
    chrome.stdio[4].on("data", chunk => {
      buffered += chunk.toString();
      let end;
      while ((end = buffered.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        const command = pending.get(message.id);
        if (!command) continue;
        pending.delete(message.id); clearTimeout(command.timer);
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      }
    });
    await send("Browser.getVersion", {}, false);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, false));
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function until(expression, message, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (!(await evaluate(expression))) {
        assert.ok(Date.now() < deadline, message + "\n" + await evaluate("JSON.stringify(Array.from(document.querySelectorAll('video')).map(v => [v.parentElement.dataset.tile, v.readyState, v.paused, v.networkState, v.currentSrc]).slice(0, 8))"));
        await sleep(100);
      }
    }
    async function open() {
      await send("Page.navigate", { url });
      await until("Boolean(window.loopFixture && document.querySelector('[data-catalog] img, [data-catalog] video'))", "fixture did not render");
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    }
    // Every element in the still's box, by stable key: tiles, icons, catalog thumbnails.
    const boxes = `Object.fromEntries([
      ...Array.from(document.querySelectorAll('[data-tile]')).map(t => ['tile ' + t.dataset.tile, t.firstElementChild]),
      ...Array.from(document.querySelectorAll('[data-icon]')).map(t => ['icon ' + t.dataset.icon, t.firstElementChild]),
      ...Array.from(document.querySelectorAll('[data-catalog] img, [data-catalog] video')).map((m, i) => ['catalog ' + i, m]),
      ['offscreen', document.querySelector('#offscreen').firstElementChild],
    ].map(([key, m]) => { const r = m.getBoundingClientRect(); return [key, { tag: m.tagName, x: r.x, y: r.y, w: r.width, h: r.height, fit: getComputedStyle(m).objectFit }]; }))`;
    const loopRequests = "performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/assets/game/loop'))";

    await open();
    const { loops, stills } = await evaluate("window.loopFixture");
    const looped = Object.entries(stills).filter(([, name]) => name);
    assert.equal(new Set(looped.map(([, name]) => name)).size, 22);
    assert.equal(looped.length, 25, "22 loops plus 3 shared-art aliases");

    // On-screen loops: 64 CSS px at 2x picks the 128 variant, WebM first, poster from the still's sizes.
    await until(`Array.from(document.querySelectorAll('[data-tile] video')).every(v => v.readyState >= 2 && !v.paused)`, "on-screen loops did not start");
    for (const [src, name] of Object.entries(stills)) {
      const state = await evaluate(`(() => { const m = document.querySelector('[data-tile="${src}"]').firstElementChild; return { tag: m.tagName, src: m.currentSrc, poster: m.poster, sources: m.tagName === 'VIDEO' ? Array.from(m.children).map(s => [s.type, s.getAttribute('src')]) : [], muted: m.muted, loop: m.loop, inline: m.playsInline, preload: m.preload, auto: m.autoplay }; })()`);
      if (!name) {
        assert.equal(state.tag, "IMG", `${src} has no loop and keeps its still`);
        continue;
      }
      const version = loops[name].version;
      assert.equal(state.tag, "VIDEO", src);
      assert.deepEqual(state.sources, [
        ['video/webm; codecs="vp9"', `/assets/game/loops/${name}.webm?size=128&v=${version}`],
        ["video/mp4", `/assets/game/loops/${name}.mp4?size=128&v=${version}`],
      ], src);
      assert.ok(state.src.endsWith(`/assets/game/loops/${name}.webm?size=128&v=${version}`), `${src}: ${state.src}`);
      assert.ok(state.poster.endsWith(src.replace("/assets/game/", "/assets/game/sizes/256/")), `${src}: poster ${state.poster}`);
      assert.deepEqual([state.muted, state.loop, state.inline, state.preload, state.auto], [true, true, true, "none", true], src);
    }
    const before = await evaluate("Array.from(document.querySelectorAll('[data-tile] video')).map(v => v.currentTime)");
    await sleep(600);
    const after = await evaluate("Array.from(document.querySelectorAll('[data-tile] video')).map(v => v.currentTime)");
    assert.ok(after.every((time, index) => time !== before[index]), "every on-screen loop is advancing");

    // A 24 px icon gets the 64 variant; an icon without a loop stays the plain <img>.
    assert.match(await evaluate("document.querySelector('[data-icon=cruiser] video').currentSrc"), /\/ships\/cruiser\.webm\?size=64&v=/);
    assert.equal(await evaluate("document.querySelector('[data-icon=small-cargo]').innerHTML"), '<img alt="" class="h-6 w-6 rounded object-cover" height="24" loading="lazy" src="/assets/game/style-pass/generated/ships/small-cargo.webp" width="24">');

    // The real production catalog plays the five ship loops and keeps the other stills.
    const catalog = await evaluate("Array.from(document.querySelectorAll('[data-catalog] video')).map(v => v.querySelector('source').getAttribute('src'))");
    for (const ship of ["battlecruiser", "colony-ship", "cruiser", "destroyer", "heavy-fighter"]) {
      assert.ok(catalog.some(src => src.startsWith(`/assets/game/loops/ships/${ship}.webm?size=`)), `catalog ${ship}: ${catalog}`);
    }
    assert.ok(await evaluate("document.querySelectorAll('[data-catalog] img').length") > 0, "catalog ships without a loop keep their still");

    // Off-screen: nothing fetched, nothing decoding until it nears the viewport.
    assert.deepEqual(await evaluate("(() => { const v = document.querySelector('#offscreen video'); return [v.children.length, v.networkState, v.poster]; })()"), [0, 0, ""]);
    assert.equal((await evaluate(loopRequests)).filter(name => name.includes("size=256")).length, 0);
    await evaluate("document.querySelector('#offscreen').scrollIntoView({ block: 'center' })");
    await until("(() => { const v = document.querySelector('#offscreen video'); return v.readyState >= 2 && !v.paused; })()", "scrolled-in loop did not start");
    assert.match(await evaluate("document.querySelector('#offscreen video').currentSrc"), /\/ships\/cruiser\.webm\?size=256&v=/);
    assert.equal(await evaluate("document.querySelector('#offscreen video').getAttribute('aria-label')"), "Cruiser");
    await until("Array.from(document.querySelectorAll('[data-tile] video')).every(v => v.paused)", "off-screen loops kept playing");
    await evaluate("scrollTo(0, 0)");
    await until("document.querySelector('#offscreen video').paused && Array.from(document.querySelectorAll('[data-tile] video')).every(v => !v.paused)", "loops did not resume/pause with visibility");

    // The browser only ever asked for bounded, versioned variants; never a master.
    const requested = await evaluate(loopRequests);
    assert.ok(requested.length > 0);
    for (const name of requested) {
      const match = /\/assets\/game\/loops\/([a-z-]+\/[a-z0-9-]+)\.(webm|mp4)\?size=(\d+)&v=([0-9a-f]+)$/.exec(name);
      assert.ok(match, name);
      assert.ok([64, 128, 256, 512].includes(Number(match[3])), name);
      assert.equal(match[4], loops[match[1]].version, name);
    }
    await evaluate("scrollTo(0, 0)");
    const animated = await evaluate(boxes);

    // Reduced motion renders exactly the still, in exactly the same boxes, with no loop fetches.
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await open();
    assert.equal(await evaluate("document.querySelectorAll('video').length"), 0);
    assert.deepEqual(await evaluate(loopRequests), []);
    const still = await evaluate(boxes);
    assert.deepEqual(Object.keys(still), Object.keys(animated));
    for (const [key, box] of Object.entries(animated)) {
      const other = still[key];
      assert.equal(other.tag, "IMG", key);
      for (const field of ["x", "y", "w", "h"]) assert.ok(Math.abs(box[field] - other[field]) < 0.5, `${key} ${field}: video ${JSON.stringify(box)} still ${JSON.stringify(other)}`);
      assert.equal(box.fit, other.fit, key);
    }

    // Refused autoplay (e.g. iOS Low Power Mode) falls back to the still.
    await send("Emulation.setEmulatedMedia", { features: [] });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('refused', 'NotAllowedError')); };" });
    await open();
    await until("document.querySelectorAll('[data-tile] video').length === 0", "refused autoplay kept the video");
    assert.equal(await evaluate("document.querySelectorAll('[data-tile] img').length"), Object.keys(stills).length);
    console.log("PASS loop animations", JSON.stringify({ loops: Object.keys(loops).length, requests: requested.length }));
    await send("Browser.close", {}, false);
  } finally {
    for (const command of pending.values()) clearTimeout(command.timer);
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
