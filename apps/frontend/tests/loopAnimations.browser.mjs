// Run from apps/frontend: node --test tests/loopAnimations.browser.mjs
// Real components, the real dev media route (synced pinned media) and local disposable Chrome only.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("building/ship loops play lazily at a bounded size, in the still's exact box, and fall back to the still (#133)", { timeout: 300_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered loop regression");
  // Loop posters are the stills' build-time size variants (gitignored, made by prebuild/precheck).
  // In a fresh checkout the dev server would answer a poster with index.html, so an imageRef
  // loop's poster probe errors and correctly falls back to the still (#138): generate them first.
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/generate-image-variants.mjs", import.meta.url))]);
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
    // Records why a loop fell back to its still (media/source errors, refused play()) for failure messages.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.loopErrors = [];
      document.addEventListener('error', event => { const target = event.target; if (target instanceof HTMLVideoElement || target instanceof HTMLSourceElement) { const video = target instanceof HTMLVideoElement ? target : target.parentElement; window.loopErrors.push([target.tagName, target.getAttribute('src') || video?.currentSrc, video?.error?.code ?? null, video?.error?.message ?? null]); } }, true);
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { const result = play.call(this); result?.catch?.(error => window.loopErrors.push(['play', this.currentSrc, error?.name, error?.message])); return result; };` });
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function until(expression, message, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (!(await evaluate(expression))) {
        assert.ok(Date.now() < deadline, message + "\n" + await evaluate("JSON.stringify({ videos: document.querySelectorAll('video').length, tileStills: document.querySelectorAll('[data-tile] img').length, first: Array.from(document.querySelectorAll('video')).map(v => [v.parentElement.dataset.tile, v.readyState, v.paused, v.networkState, v.currentSrc]).slice(0, 8), errors: (window.loopErrors || []).length, lastErrors: (window.loopErrors || []).slice(-8) })"));
        await sleep(100);
      }
    }
    async function open() {
      await send("Page.navigate", { url });
      await until("Boolean(window.loopFixture && document.querySelector('[data-catalog] img, [data-catalog] video'))", "fixture did not render");
      // Boxes are compared across loads: measure after web fonts settle the layout (a slow CI load
      // measured the reduced-motion stills one text line higher than the loops).
      await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    }
    // Every element in the still's box, by stable key: tiles, icons, catalog thumbnails.
    const boxes = `Object.fromEntries([
      ...Array.from(document.querySelectorAll('[data-tile]')).map(t => ['tile ' + t.dataset.tile, t.firstElementChild]),
      ...Array.from(document.querySelectorAll('[data-icon]')).map(t => ['icon ' + t.dataset.icon, t.firstElementChild]),
      ...Array.from(document.querySelectorAll('[data-catalog] img, [data-catalog] video')).map((m, i) => ['catalog ' + i, m]),
      ...Array.from(document.querySelectorAll('[data-research] img, [data-research] video, [data-research-queue] img, [data-research-queue] video')).map((m, i) => ['research ' + i, m]),
      ['responsive', document.querySelector('[data-responsive]').firstElementChild],
      ['offscreen', document.querySelector('#offscreen').firstElementChild],
    ].map(([key, m]) => { const r = m.getBoundingClientRect(); return [key, { tag: m.tagName, x: r.x, y: r.y, w: r.width, h: r.height, fit: getComputedStyle(m).objectFit }]; }))`;
    const loopRequests = "performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/assets/game/loop'))";

    await open();
    const { loops, noLoopStill, stills } = await evaluate("window.loopFixture");
    const looped = Object.entries(stills).filter(([, name]) => name);
    // Research catalog key -> loop name (the still's file stem).
    const researchLoopByKey = {
      armor: "armor", astrophysics: "astrophysics", combustionDrive: "combustion-drive", computer: "computer", energy: "energy",
      graviton: "graviton", hyperspace: "hyperspace", hyperspaceDrive: "hyperspace-drive", impulseDrive: "impulse-drive",
      intergalacticResearchNetwork: "intergalactic-research-network", ion: "ion", laser: "laser", plasma: "plasma",
      shielding: "shielding", weapons: "weapons",
    };
    const researchLoops = Object.values(researchLoopByKey);
    assert.equal(new Set(looped.map(([, name]) => name)).size, 58);
    assert.equal(looped.length, 61, "58 loops plus 3 shared-art aliases");
    assert.deepEqual(Object.keys(stills).filter(src => !stills[src]), [], "every building, ship, defense and research still has a loop");

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

    // imageRef points at the loop's poster probe, the same image onLoad reports (#134).
    await until("Boolean(window.loopFixture.refLoad)", "imageRef loop never reported its poster");
    assert.deepEqual(await evaluate("window.loopFixture.refLoad"), { complete: true, sameAsRef: true });
    assert.equal(await evaluate("document.querySelector('[data-ref-probe]').firstElementChild.tagName"), "VIDEO");

    // The inspect panel's "already cached" fast path holds for a loop as for a still: a fresh
    // panel whose poster is cached is loaded by its first frame, with no skeleton (#134).
    const inspect = "document.querySelector('[data-inspect] [aria-busy]')";
    const busyAtFirstFrame = (asset, cacheKey) => evaluate(`new Promise(resolve => {
      window.loopFixture.inspect(${JSON.stringify(asset)}, ${JSON.stringify(cacheKey)});
      requestAnimationFrame(() => resolve([${inspect}.getAttribute('aria-busy'), ${inspect}.querySelector('video, img').tagName]));
    })`);
    const cruiserStill = "/assets/game/style-pass/generated/ships/cruiser.webp";
    await until(`${inspect}.getAttribute('aria-busy') === 'false'`, "inspect loop never loaded");
    assert.deepEqual(await busyAtFirstFrame(cruiserStill, "cruiser again"), ["false", "VIDEO"]);
    await busyAtFirstFrame(noLoopStill, "no-loop");
    await until(`${inspect}.getAttribute('aria-busy') === 'false'`, "inspect still never loaded");
    assert.deepEqual(await busyAtFirstFrame(noLoopStill, "no-loop again"), ["false", "IMG"]);
    await evaluate(`window.loopFixture.inspect(${JSON.stringify(cruiserStill)}, "initial")`);

    // A 24 px icon gets the 64 variant; an icon without a loop stays the plain <img>.
    assert.match(await evaluate("document.querySelector('[data-icon=cruiser] video').currentSrc"), /\/ships\/cruiser\.webm\?size=64&v=/);
    assert.equal(await evaluate("document.querySelector('[data-icon=no-loop]').innerHTML"), `<img alt="" class="h-6 w-6 rounded object-cover" height="24" loading="lazy" src="${noLoopStill}" width="24">`);

    // The real production catalog plays every shipyard and defense loop and keeps the still for art without one.
    // The catalog is taller than the viewport and off-screen loops have no sources yet: bring each one near it first.
    const catalogVideo = index => `document.querySelectorAll('[data-catalog] video')[${index}]`;
    const catalog = [];
    for (let index = 0; index < await evaluate("document.querySelectorAll('[data-catalog] video').length"); index++) {
      await evaluate(`${catalogVideo(index)}.scrollIntoView({ block: 'center' })`);
      await until(`Boolean(${catalogVideo(index)}.querySelector('source'))`, `catalog loop ${index} never got its sources`);
      catalog.push(await evaluate(`${catalogVideo(index)}.querySelector('source').getAttribute('src')`));
    }
    await evaluate("scrollTo(0, 0)");
    const catalogLoops = [
      ...["battlecruiser", "battleship", "bomber", "colony-ship", "crawler-approved", "cruiser", "deathstar", "destroyer", "heavy-fighter",
        "large-cargo", "light-fighter", "reaper-symmetric", "recycler", "small-cargo", "solar-satellite"].map(ship => `ships/${ship}`),
      ...["anti-ballistic-missile", "gauss-cannon", "heavy-laser", "interplanetary-missile", "ion-cannon", "large-shield-dome", "light-laser",
        "plasma-turret", "rocket-launcher", "small-shield-dome"].map(defense => `defenses/${defense}`),
    ];
    const catalogNames = new Set(catalog.map(src => /^\/assets\/game\/loops\/([a-z]+\/[a-z0-9-]+)\.webm\?size=/.exec(src)?.[1] ?? src));
    assert.deepEqual([...catalogNames].sort(), catalogLoops.sort(), "catalog loops");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[data-catalog] img')).map(i => i.getAttribute('src'))"), [noLoopStill], "only art without a loop keeps its still");

    // Selecting another ship swaps the featured loop (not just its poster); one without a loop shows its still.
    const featured = `document.querySelector('[data-selected-production-layout="featured"]')`;
    for (const [key, name] of [["destroyer", "ships/destroyer"], ["heavyFighter", "ships/heavy-fighter"], ["plasmaTurret", "defenses/plasma-turret"]]) {
      await evaluate(`window.loopFixture.select(${JSON.stringify(key)})`);
      await until(`(() => { const v = ${featured}.querySelector('video'); return Boolean(v && v.currentSrc.includes('/${name}.webm?size=') && v.readyState >= 2 && !v.paused); })()`, `featured loop did not follow ${key}`);
    }
    await evaluate("window.loopFixture.select('noLoop')");
    await until(`!${featured}.querySelector('video') && Boolean(${featured}.querySelector('img[src="${noLoopStill}"]'))`, "featured still for art without a loop");
    await evaluate("window.loopFixture.select('cruiser')");

    // Off-screen: nothing fetched, nothing decoding until it nears the viewport.
    assert.deepEqual(await evaluate("(() => { const v = document.querySelector('#offscreen video'); return [v.children.length, v.networkState, v.poster]; })()"), [0, 0, ""]);
    assert.equal((await evaluate(loopRequests)).filter(name => name.includes("size=256")).length, 0);
    await evaluate("document.querySelector('#offscreen').scrollIntoView({ block: 'center' })");
    await until("(() => { const v = document.querySelector('#offscreen video'); return v.readyState >= 2 && !v.paused; })()", "scrolled-in loop did not start");
    assert.match(await evaluate("document.querySelector('#offscreen video').currentSrc"), /\/ships\/cruiser\.webm\?size=256&v=/);
    assert.equal(await evaluate("document.querySelector('#offscreen video').getAttribute('aria-label')"), "Cruiser");
    // Leaving the viewport releases the decoder (no sources, nothing buffered), not just pauses.
    const released = "(v => v.paused && v.children.length === 0 && v.readyState === 0)";
    await until(`Array.from(document.querySelectorAll('[data-tile] video')).every(${released})`, "off-screen loops kept their decoders");
    await evaluate("scrollTo(0, 0)");
    await until(`${released}(document.querySelector('#offscreen video')) && Array.from(document.querySelectorAll('[data-tile] video')).every(v => v.readyState >= 2 && !v.paused)`, "loops did not resume/release with visibility");

    // The research page's tiles, queue panel and inspect detail play the research loops at a bounded size (#139).
    await evaluate("document.querySelector('[data-research]').scrollIntoView({ block: 'start' })");
    const researchPlaying = `Array.from(document.querySelectorAll('[data-research] video, [data-research-queue] video')).every(v => v.readyState >= 2 && !v.paused)`;
    await until(`document.querySelectorAll('[data-research] video').length === ${researchLoops.length} && ${researchPlaying}`, "research loops did not start");
    const researchTiles = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-research-tile]')).map(t => {
      const m = t.querySelector('video, img'); return [t.dataset.researchTile, m.tagName === 'VIDEO' ? m.currentSrc : m.getAttribute('src')];
    }))`);
    assert.deepEqual(Object.keys(researchTiles).sort(), Object.keys(researchLoopByKey).sort(), "one tile per research");
    for (const [key, src] of Object.entries(researchTiles)) {
      const name = researchLoopByKey[key];
      assert.match(src, new RegExp(`/assets/game/loops/research/${name}\\.webm\\?size=512&v=${loops[`research/${name}`].version}$`), key);
    }
    assert.match(await evaluate("document.querySelector('[data-research-queue] video').currentSrc"), /\/research\/armor\.webm\?size=(64|128)&v=/);
    const armorStill = "/assets/game/style-pass/generated/research/armor.webp";
    await evaluate(`window.loopFixture.inspect(${JSON.stringify(armorStill)}, "research:armor")`);
    await evaluate("document.querySelector('[data-inspect]').scrollIntoView({ block: 'center' })");
    await until(`(() => { const v = ${inspect}.querySelector('video'); return Boolean(v && v.currentSrc.includes('/research/armor.webm?size=') && v.readyState >= 2 && !v.paused); })()`, "research inspect loop did not play");
    await evaluate(`window.loopFixture.inspect(${JSON.stringify(cruiserStill)}, "initial")`);
    await evaluate("scrollTo(0, 0)");

    // Reduced motion switched on at runtime shows the stills, and switching it off restores the loops.
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await until("document.querySelectorAll('[data-tile] video').length === 0", "runtime reduced motion kept the loops");
    await send("Emulation.setEmulatedMedia", { features: [] });
    await until(`document.querySelectorAll('[data-tile] video').length === ${looped.length} && Array.from(document.querySelectorAll('[data-tile] video')).every(v => v.readyState >= 2 && !v.paused)`, "loops did not return after reduced motion");

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

    // A box that grows (e.g. a narrow to xl layout) upgrades to a sharper variant; it never downgrades.
    const responsive = "document.querySelector('[data-responsive] video')";
    await until(`${responsive}.currentSrc.includes('/ships/battlecruiser.webm?size=128&') && ${responsive}.readyState >= 2`, "small responsive loop");
    await evaluate("Object.assign(document.querySelector('[data-responsive]').style, { width: '256px', height: '256px' })");
    await until(`${responsive}.currentSrc.includes('/ships/battlecruiser.webm?size=512&') && ${responsive}.readyState >= 2 && !${responsive}.paused`, "grown loop did not upgrade");
    await evaluate("Object.assign(document.querySelector('[data-responsive]').style, { width: '64px', height: '64px' })");
    await sleep(300);
    assert.match(await evaluate(`${responsive}.currentSrc`), /\/ships\/battlecruiser\.webm\?size=512&/);

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
    // Under reduced motion a still that changes asset, with or without a loop, updates in place like a plain still.
    await evaluate(`window.featuredStill = ${featured}.querySelector('img')`);
    for (const [key, still] of [["destroyer", "/ships/destroyer.webp"], ["noLoop", noLoopStill], ["cruiser", "/ships/cruiser.webp"]]) {
      await evaluate(`window.loopFixture.select(${JSON.stringify(key)})`);
      await until(`${featured}.querySelector('img').getAttribute('src').includes(${JSON.stringify(still)})`, `featured still did not follow ${key}`);
      assert.equal(await evaluate(`${featured}.querySelector('img') === window.featuredStill`), true, `featured still remounted for ${key}`);
    }
    // Turning reduced motion off on a page that mounted the stills starts the loops without a re-render (#134).
    await send("Emulation.setEmulatedMedia", { features: [] });
    await until(`document.querySelectorAll('[data-tile] video').length === ${looped.length} && Array.from(document.querySelectorAll('[data-tile] video')).every(v => v.readyState >= 2 && !v.paused)`, "loops did not start when reduced motion turned off");

    // A loop whose sources fail falls back to its still; the others keep playing.
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Network.setBlockedURLs", { urls: ["*/ships/colony-ship.webm*", "*/ships/colony-ship.mp4*"] });
    await open();
    const colony = `document.querySelector('[data-tile="/assets/game/style-pass/generated/ships/colony-ship.webp"]')`;
    await until(`Boolean(${colony}.querySelector('img'))`, "failing loop sources did not fall back to the still");
    assert.equal(await evaluate("document.querySelectorAll('[data-tile] video').length"), looped.length - 1);
    await send("Network.setBlockedURLs", { urls: [] });

    // A pause()/load() interrupting play() rejects with AbortError: that is not a refusal.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('interrupted', 'AbortError')); };" });
    await open();
    await sleep(1_000);
    assert.equal(await evaluate("document.querySelectorAll('[data-tile] video').length"), looped.length);

    // Refused autoplay (e.g. iOS Low Power Mode) falls back to the still.
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
