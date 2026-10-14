// Run from apps/frontend: node --test tests/demolishIcon.browser.mjs
// Optional DEMOLISH_ICON_ARTIFACTS writes screenshots. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

const views = {
  planet: { label: "Metal Mine", upgrade: 'button[aria-label="Upgrade Metal Mine to Level 7"]' },
  moon: { label: "Robotics Factory", upgrade: 'button[aria-label="Upgrade Robotics Factory to Level 4"]' },
};

test("Demolish is an icon-only button inline with Upgrade on planet and moon buildings (#120)", { timeout: 180_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered demolish layout regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-demolish-icon-"));
  const server = await createServer({
    // These fixtures render building detail panels, not animated planets.
    plugins: [{ name: "demolish-icon-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.DEMOLISH_ICON_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/demolishIcon.html`;
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
    const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const rect = selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; })()`);
    // Real pointer input: a mouse click on desktop, a touch tap on mobile.
    async function tap(selector, mobile) {
      const box = await rect(selector);
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (mobile) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      }
      await settle();
    }
    for (const width of [1280, 390]) {
      const mobile = width < 640;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
      for (const [view, { label, upgrade }] of Object.entries(views)) {
        const demolish = `button[aria-label="Demolish ${label}"]`;
        for (const state of ["ready", "blocked"]) {
          await send("Page.navigate", { url: `${url}?view=${view}&state=${state}` });
          const deadline = Date.now() + 20_000;
          // Moon detail opens on the Lunar Base; pick the demolishable structure like a player would.
          const tile = `Array.from(document.querySelectorAll("button[aria-pressed]")).find(b => b.textContent.includes(${JSON.stringify(label)}))`;
          while (view === "moon" && !(await evaluate(`Boolean(${tile})`))) {
            assert.ok(Date.now() < deadline, `moon catalog did not render: ${state} ${width}`);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (view === "moon") await evaluate(`${tile}.click()`);
          while (!(await evaluate(`Boolean(window.demolishFixture && document.querySelector(${JSON.stringify(demolish)}) && document.querySelector(${JSON.stringify(upgrade)}))`))) {
            assert.ok(Date.now() < deadline, `demolish fixture did not render: ${view} ${state} ${width}\n` + await evaluate("document.body.textContent.slice(0, 800)"));
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          await evaluate(`document.querySelector(${JSON.stringify(upgrade)}).scrollIntoView({ block: "center" })`);
          await settle();
          const where = `${view} ${state} ${width}`;

          // Exactly one Demolish control: an icon (svg) with no visible text, labelled and titled.
          assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).filter(b => (b.getAttribute('aria-label') || '').startsWith('Demolish')).length"), 1, where);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).textContent.trim()`), "", where);
          assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(demolish)} + " svg"))`), true, where);

          // Inline with Upgrade: one row of Upgrade [+ Supply] + Demolish, the destructive icon last.
          const up = await rect(upgrade), icon = await rect(demolish);
          const row = await evaluate(`Array.from(document.querySelector(${JSON.stringify(demolish)}).parentElement.children).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute("aria-label"), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })`);
          const expectedRow = view === "planet" && state === "blocked"
            ? [await evaluate(`document.querySelector(${JSON.stringify(upgrade)}).getAttribute("aria-label")`), "Supply missing resources for Metal Mine", `Demolish ${label}`]
            : [await evaluate(`document.querySelector(${JSON.stringify(upgrade)}).getAttribute("aria-label")`), `Demolish ${label}`];
          assert.deepEqual(row.map(b => b.label), expectedRow, where);
          for (const [index, button] of row.entries()) {
            assert.ok(Math.abs(button.top - up.top) < 1 && Math.abs(button.bottom - up.bottom) < 1, `${where}: ${button.label} not on the Upgrade row ${JSON.stringify(row)}`);
            if (index > 0) assert.ok(button.left >= row[index - 1].right && button.left - row[index - 1].right <= 12, `${where}: gap before ${button.label} ${JSON.stringify(row)}`);
          }
          assert.ok(icon.right <= await evaluate("innerWidth"), `${where}: icon overflows`);
          assert.ok(icon.width >= 40 && icon.height >= 40, `${where}: tap target ${icon.width}x${icon.height}`);
          assert.ok(icon.width < up.width / 2, `${where}: icon should stay small next to Upgrade`);
          assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, where);
          if (artifacts) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(artifacts, `demolish-${view}-${state}-${width}.png`), Buffer.from(shot.data, "base64")); }

          if (state === "ready") {
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).title`), "Demolish", where);
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).getAttribute("aria-disabled")`), null, where);
            await tap(demolish, mobile);
            // The #112 confirmation dialog opens; nothing is sent until it is confirmed.
            assert.equal(await evaluate("document.querySelector('#demolition-title') !== null"), true, `${where}: demolition dialog did not open`);
            assert.equal(await evaluate("window.demolishFixture.calls.demolish"), 0, where);
            if (artifacts) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(artifacts, `demolish-${view}-dialog-${width}.png`), Buffer.from(shot.data, "base64")); }
          } else {
            const reason = await evaluate(`document.querySelector(${JSON.stringify(demolish)}).title`);
            assert.match(reason, /^Not enough /, `${where}: tooltip should carry the exact unavailability reason`);
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).getAttribute("aria-disabled")`), "true", where);
            const reasonRow = "document.getElementById(document.querySelector(" + JSON.stringify(demolish) + ").getAttribute('aria-controls'))";
            assert.equal(await evaluate(reasonRow + ".getAttribute('role')"), "status", where);
            assert.equal(await evaluate(reasonRow + ".hidden"), true, `${where}: reason should start collapsed`);
            await tap(demolish, mobile);
            assert.equal(await evaluate("document.querySelector('#demolition-title') !== null"), false, `${where}: blocked Demolish opened the dialog`);
            assert.equal(await evaluate(reasonRow + ".hidden"), false, `${where}: tapping should reveal the reason`);
            assert.equal(await evaluate(reasonRow + ".textContent"), reason, `${where}: revealed reason should match the tooltip`);
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).getAttribute("aria-expanded")`), "true", where);
            if (artifacts) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(artifacts, `demolish-${view}-reason-${width}.png`), Buffer.from(shot.data, "base64")); }
            await tap(demolish, mobile);
            assert.equal(await evaluate(reasonRow + ".hidden"), true, `${where}: second tap should hide the reason`);
          }
          console.log("PASS demolish icon", where);
        }
      }
    }
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
