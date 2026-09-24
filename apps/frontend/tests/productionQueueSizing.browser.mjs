// Run from apps/frontend: node --test tests/productionQueueSizing.browser.mjs
// Optional QUEUE_SIZING_ARTIFACTS writes screenshots + measured styles for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

test("Build plan matches the real active Queue at desktop/mobile sizes on both bodies", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-queue-sizing-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.QUEUE_SIZING_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/productionQueueSizing.html`;
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
    async function load(query, width = 1280) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      await send("Page.navigate", { url: url + "?" + query });
      const deadline = Date.now() + 20_000;
      while (!(await evaluate('Boolean(document.querySelector("[data-build-plan]"))'))) {
        assert.ok(Date.now() < deadline, "fixture did not render");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await evaluate('document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.decode())))');
    }
    const inspect = () => {
      const queue = document.querySelector('section[aria-label^="Queue:"]');
      const plan = document.querySelector('[data-build-plan]');
      const queueItem = queue.children[1].children[0];
      const planItem = plan.children[1].children[0];
      const styles = (node, properties) => Object.fromEntries(properties.map(key => [key, getComputedStyle(node)[key]]));
      const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      const typography = ['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'fontFamily'];
      const panel = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap'];
      const row = ['minHeight', 'columnGap', 'rowGap'];
      const pair = (q, p, props) => ({ queue: styles(q, props), plan: styles(p, props) });
      const buttons = [...plan.querySelectorAll('button')].map(button => {
        const box = rect(button);
        return { ...box, label: button.getAttribute('aria-label'), hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === button };
      });
      const children = [...plan.children[1].children].map(rect);
      return {
        heading: pair(queue.firstElementChild, plan.querySelector('h3'), typography),
        quantity: pair(queueItem.lastElementChild.firstElementChild, planItem.lastElementChild.firstElementChild, typography),
        eta: pair(queueItem.lastElementChild.lastElementChild, planItem.lastElementChild.lastElementChild, typography),
        thumbnail: pair(queue.querySelector('img'), plan.querySelector('img'), ['width', 'height', 'objectFit']),
        panel: pair(queue, plan, panel), row: pair(queue.children[1], plan.children[1], row),
        item: pair(queueItem, planItem, ['columnGap', 'height']),
        queue: rect(queue), plan: rect(plan), buttons, children,
        overflow: document.documentElement.scrollWidth > innerWidth,
        text: plan.textContent,
      };
    };
    for (const body of ['planet', 'moon']) for (const kind of ['ship', 'defense']) for (const width of [1280, 390, 320]) {
      await load(new URLSearchParams({ body, kind }), width);
      const result = await evaluate('(' + inspect.toString() + ')()');
      const label = body + '-' + kind + '-' + width;
      measurements.push({ label, ...result });
      for (const field of ['heading', 'quantity', 'eta', 'thumbnail', 'panel', 'row', 'item']) {
        assert.deepEqual(result[field].plan, result[field].queue, label + ': ' + field);
      }
      assert.equal(result.overflow, false, label + ': horizontal overflow');
      if (width === 1280) assert.equal(result.plan.height, result.queue.height, label + ': panel height');
      for (const button of result.buttons) {
        assert.ok(button.width >= 24 && button.height >= 24, label + ': minimum 24px hit target');
        assert.ok(button.hit, label + ': unobstructed ' + button.label);
      }
      for (let i = 0; i < result.children.length; i++) for (let j = i + 1; j < result.children.length; j++) {
        const a = result.children[i], b = result.children[j];
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, label + ': items/actions overlap');
      }
      if (artifacts) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, label + '.png'), Buffer.from(screenshot.data, 'base64'));
      }
    }
    // Maximum quantities/durations/costs wrap, without losing controls or overflowing.
    await load('body=moon&kind=ship&large=1', 320);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    if (artifacts) writeFileSync(join(artifacts, 'moon-ship-320-large.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    // Real pointer hit-testing and keyboard activation, with all submission disconnected.
    await load('body=planet&kind=defense', 390);
    const remove = await evaluate('(() => { const b = document.querySelector("[data-build-plan] button").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...remove, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...remove, button: 'left', clickCount: 1 });
    await evaluate('new Promise(requestAnimationFrame)');
    assert.equal(await evaluate('document.querySelectorAll("[data-build-plan] button[aria-label^=Remove]").length'), 3);
    await evaluate(`document.querySelector('button[aria-label="Confirm build plan"]').focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Clear build plan");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Confirm build plan");
    assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineWidth"), "2px");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await evaluate('new Promise(requestAnimationFrame)');
    assert.equal(await evaluate('document.querySelector("output").textContent'), '1');
    await evaluate(`document.querySelector('button[aria-label="Clear build plan"]').focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await evaluate("new Promise(requestAnimationFrame)");
    assert.equal(await evaluate('document.querySelector("[data-build-plan]") === null'), true);
    await load('body=moon&kind=defense&busy=1', 390);
    assert.equal(await evaluate('[...document.querySelectorAll("[data-build-plan] button")].every(button => button.disabled)'), true);
    await load('body=moon&kind=ship&unknown=1&error=1', 390);
    assert.ok(await evaluate('document.querySelector("[data-build-plan] [role=alert]").textContent.includes("previous request")'));
    assert.equal(await evaluate('document.querySelector("[data-build-plan] [role=status]").textContent'), 'Wallet request rejected');
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
