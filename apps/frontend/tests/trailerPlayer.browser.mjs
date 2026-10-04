// Run from apps/frontend: node --test tests/trailerPlayer.browser.mjs
// Optional TRAILER_ARTIFACTS writes local fixture screenshots for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Landing and Pact share lazy, responsive, user-initiated trailer playback", { timeout: 300_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for trailer playback regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-trailer-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.TRAILER_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/trailerPlayer.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    function send(method, params = {}, page = true) {
      const commandId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 15_000);
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
        if (message.method === 'Network.requestWillBeSent' && message.params.request.url.endsWith('.mp4')) mediaRequests.push(message.params.request.url);
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
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }

    const mediaRequests = [];
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*://api.veydrift.com/*', '*://api-test.veydrift.com/*', '*/prod-api/*', '*/test-api/*', '*/local-api/*'] });
    async function until(expression, label) {
      const deadline = Date.now() + 20000;
      while (!await evaluate(expression)) {
        assert.ok(Date.now() < deadline, label);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    async function click(selector) {
      const point = await evaluate('(() => { const b = document.querySelector(' + JSON.stringify(selector) + '); b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button,a")===b}; })()');
      assert.ok(point.hit, selector + ': unobstructed');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    const playButton = 'button[aria-label="Play the two-minute Veydrift trailer"]';
    for (const route of ['pact', 'landing']) {
      mediaRequests.length = 0;
      await send('Page.navigate', { url: url + '?' + route });
      await until('Boolean(document.querySelector("video"))', route + ': mounted');
      await evaluate('document.fonts.ready');
      await new Promise(resolve => setTimeout(resolve, 300));
      const initial = await evaluate(`(() => { const v = document.querySelector('video'); return { src:v.querySelector('source').getAttribute('src'), poster:v.getAttribute('poster'), captions:v.querySelector('track').getAttribute('src'), preload:v.preload, inline:v.playsInline, autoplay:v.autoplay, paused:v.paused, controls:v.controls }; })()`);
      assert.deepEqual(initial, { src:'/assets/landing/veydrift-trailer-v1.mp4', poster:'/assets/landing/veydrift-trailer-v1-poster.webp', captions:'/assets/landing/veydrift-trailer-v1.vtt', preload:'none', inline:true, autoplay:false, paused:true, controls:false });
      assert.equal(mediaRequests.length, 0, route + ': no movie request before intent');
      for (const width of [320, 390, 1440]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
        const size = await evaluate(`(() => { const v=document.querySelector('video'), r=v.getBoundingClientRect(), p=v.parentElement.getBoundingClientRect(); return {width:r.width,height:r.height,inside:r.x>=0 && r.right<=innerWidth && r.bottom<=p.bottom && r.top>=p.top,overflow:document.documentElement.scrollWidth>innerWidth}; })()`);
        assert.equal(size.inside, true, route + ': player fits at ' + width);
        assert.ok(Math.abs(size.width / size.height - 16/9) < 0.02, route + ': aspect ratio');
        assert.equal(size.overflow, false, route + ': page overflow');
        if (artifacts) {
          await evaluate('document.querySelector("video").scrollIntoView({block:"center"})');
          const shot = await send('Page.captureScreenshot', { format:'png' });
          writeFileSync(join(artifacts, route + '-' + width + '.png'), Buffer.from(shot.data, 'base64'));
        }
      }
      if (route === 'pact') {
        await click('a[href="#trailer"]');
        await until('location.hash === "#trailer"', 'in-page CTA');
        assert.equal(await evaluate('location.pathname + location.search'), '/tests/fixtures/trailerPlayer.html?pact');
        assert.equal(await evaluate('document.activeElement.id'), 'trailer', 'keyboard focus reaches the trailer');
        assert.equal(mediaRequests.length, 0, 'anchor does not autoplay or fetch movie');
        assert.equal(await evaluate(`Boolean(document.querySelector('a[href="#join"]'))`), true);
      }
      // Deterministic rejected play: retry must restore the labeled overlay.
      await evaluate('window.realPlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function() { return Promise.reject(new DOMException("Blocked", "NotAllowedError")); }');
      await click(playButton);
      await until('Boolean(document.querySelector(' + JSON.stringify(playButton) + ')) && !document.querySelector("video").controls', 'rejected play restores retry');
      assert.equal(mediaRequests.length, 0, 'failed mocked play did not fetch');
      await evaluate('HTMLMediaElement.prototype.play = window.realPlay');
      // Keyboard intent starts the actual approved movie, not a mocked media element.
      await evaluate('document.querySelector(' + JSON.stringify(playButton) + ').focus()');
      await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13 });
      await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
      await until('!document.querySelector("video").paused && document.querySelector("video").currentTime > 0', route + ': actual playback');
      assert.equal(await evaluate('document.querySelector("video").controls'), true);
      assert.equal(await evaluate('Boolean(document.querySelector(' + JSON.stringify(playButton) + '))'), false);
      assert.ok(mediaRequests.length > 0, 'movie loads after intent');
      await evaluate('document.querySelector("video").pause()');
      assert.equal(await evaluate('document.querySelector("video").controls'), true, 'native controls remain when paused');
      await evaluate('document.querySelector("video").currentTime = 30');
      await until('Math.abs(document.querySelector("video").currentTime - 30) < 0.5 && !document.querySelector("video").seeking', 'native seeking');
      await evaluate('document.querySelector("video").textTracks[0].mode = "showing"');
      await until('document.querySelector("video").textTracks[0].cues?.length > 0', 'English captions load');
      // Native ended event restores replay; no custom pause/seek/fullscreen chrome.
      await evaluate('document.querySelector("video").dispatchEvent(new Event("ended"))');
      await until('Boolean(document.querySelector(' + JSON.stringify(playButton) + ')) && !document.querySelector("video").controls', 'ended restores replay');
    }
    await send('Browser.close', {}, false);
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
