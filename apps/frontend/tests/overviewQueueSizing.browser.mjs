// Run from apps/frontend: node --test tests/overviewQueueSizing.browser.mjs
// Optional OVERVIEW_SIZING_ARTIFACTS writes screenshots + measured styles for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Overview queues stay independently compact on phones and aligned at sm/xl", { timeout: 300_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-overview-sizing-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.OVERVIEW_SIZING_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/overviewQueueSizing.html`;
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

    const inspect = () => {
      const panels = ['Buildings', 'Defenses', 'Research', 'Shipyard'].map(label => document.querySelector('section[aria-label="' + label + '"]'));
      const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      return {
        columns: getComputedStyle(panels[0].parentElement).gridTemplateColumns.split(' ').length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        panels: panels.map(panel => ({ ...rect(panel), text: panel.textContent,
          clipped: [panel, ...panel.querySelectorAll('p, li, [role=alert], button')].some(node => node.clientWidth > 0 && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)),
          outside: [...panel.querySelectorAll('p, li, button, [role=alert]')].some(node => { const r = rect(node), p = rect(panel); return r.x < p.x || r.x + r.width > p.x + p.width + 1 || r.y + r.height > p.y + p.height + 1; }),
          buttons: [...panel.querySelectorAll('button')].map(button => ({ ...rect(button), type: button.type, label: button.textContent })),
        })),
      };
    };
    await send('Page.navigate', { url });
    const deadline = Date.now() + 20000;
    while (!await evaluate('Boolean(window.fixture && document.querySelector("section[aria-label=Buildings]"))')) {
      assert.ok(Date.now() < deadline, 'fixture did not mount');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await evaluate('document.fonts.ready');
    for (const width of [320, 375, 390, 430, 639, 640, 768, 1279, 1280, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1400, deviceScaleFactor: 1, mobile: width < 640 });
      const results = [];
      for (const [mode, count] of [['empty', 0], ['mixed', 1], ['mixed', 8], ['active', 8]]) {
        await evaluate('fixture.show(' + JSON.stringify(mode) + ',' + count + '); new Promise(requestAnimationFrame)');
        const result = await evaluate('(' + inspect.toString() + ')()');
        const label = width + '-' + mode + '-' + count;
        measurements.push({ label, ...result }); results.push(result);
        assert.equal(result.columns, width < 640 ? 1 : width < 1280 ? 2 : 4, label + ': columns');
        assert.equal(result.overflow, false, label + ': page overflow');
        for (const panel of result.panels) {
          assert.equal(panel.clipped, false, label + ': clipped content ' + panel.text);
          assert.equal(panel.outside, false, label + ': content outside card');
          for (const button of panel.buttons) {
            assert.ok(button.height >= 36, label + ': existing touch target preserved');
            assert.equal(button.type, 'button');
          }
        }
        if (width < 640) {
          for (let i = 1; i < 4; i++) assert.ok(result.panels[i].y >= result.panels[i-1].y + result.panels[i-1].height + 11, label + ': cards overlap');
        } else {
          assert.ok(result.panels.every(panel => Math.abs(panel.height - result.panels[0].height) < 1), label + ': equal row alignment');
        }
        if (mode !== 'empty') assert.match(result.panels[1].text, /Built · awaiting settlement.*Already paid for.*No need to buy them again/s);
        if (mode === 'active') {
          assert.match(result.panels[0].text, /Construction blocked/);
          assert.match(result.panels[2].text, /Research request rejected/);
        }
        if (artifacts && [390, 640, 1280].includes(width)) {
          const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          writeFileSync(join(artifacts, label + '.png'), Buffer.from(screenshot.data, 'base64'));
        }
      }
      if (width < 640) {
        for (const index of [0, 2, 3]) {
          assert.equal(results[1].panels[index].height, results[0].panels[index].height, width + ': empty card grew with settlement neighbor');
          assert.equal(results[2].panels[index].height, results[0].panels[index].height, width + ': empty card grew with longer queue');
          assert.ok(results[0].panels[index].height < 110, width + ': empty card has unnecessary filler');
        }
        assert.ok(results[2].panels[1].height > results[1].panels[1].height, width + ': tall neighbor actually grew');
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 1, mobile: true });
    await evaluate('fixture.show(); new Promise(requestAnimationFrame)');
    for (const [label, page] of [['Buildings', 'infrastructure'], ['Defenses', 'defenses'], ['Research', 'research'], ['Shipyard', 'shipyard']]) {
      const selector = 'section[aria-label="' + label + '"] button';
      const point = await evaluate('(() => { const b = document.querySelector(' + JSON.stringify(selector) + '); b.scrollIntoView({block:"center"}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===b}; })()');
      assert.ok(point.hit, label + ': button unobstructed');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      assert.equal(await evaluate('fixture.navigated()'), page, label + ': click navigation');
    }
    await evaluate('document.querySelector("section[aria-label=Buildings] button").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.equal(await evaluate('fixture.navigated()'), 'infrastructure', 'keyboard navigation');
    if (artifacts) writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
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
